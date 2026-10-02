import { URL } from 'url';
import dns from 'dns';
import net from 'net';

// Cache for DNS resolution results to optimize high-throughput proxy requests
interface DnsCacheEntry {
  isSafe: boolean;
  resolvedIps: string[];
  cachedAt: number;
}
const DNS_CACHE = new Map<string, DnsCacheEntry>();
const DNS_CACHE_TTL_MS = 10000; // 10-second DNS cache TTL

export function clearDnsCache() {
  DNS_CACHE.clear();
}

/**
 * List of forbidden hostnames and domain suffixes.
 */
const FORBIDDEN_HOST_PATTERNS: (string | RegExp)[] = [
  'localhost',
  'localhost.localdomain',
  'ip6-localhost',
  'ip6-loopback',
  'metadata.google.internal',
  'metadata',
  'metadata.internal',
  'instance-data',
  'instance-data.ec2.internal',
  'kubernetes.default',
  'kubernetes.default.svc',
  'host.docker.internal',
  'gateway.docker.internal',
  'docker.for.mac.localhost',
  'docker.for.win.localhost',
  /\.local$/i,
  /\.internal$/i,
  /\.lan$/i,
  /\.corp$/i,
  /\.home$/i,
  /\.invalid$/i,
  /\.test$/i,
  /\.onion$/i,
];

/**
 * Parses numeric/encoded IPv4 representations:
 * - Dotted octal: "0177.0.0.1" -> "127.0.0.1"
 * - Dotted hex: "0x7f.0.0.1" -> "127.0.0.1"
 * - Decimal integer: "2130706433" -> "127.0.0.1"
 * - Hex integer: "0x7f000001" -> "127.0.0.1"
 * - Octal integer: "017700000001" -> "127.0.0.1"
 * - Shortened forms: "127.1" -> "127.0.0.1", "10.1" -> "10.0.0.1"
 */
export function parseNumericIpv4(host: string): string | null {
  const trimmed = host.trim().toLowerCase();

  // 1. Single integer string (decimal, hex "0x...", octal "0...")
  if (/^(0x[0-9a-f]+|0[0-7]+|[0-9]+)$/.test(trimmed)) {
    let intVal: number;
    if (trimmed.startsWith('0x')) {
      intVal = parseInt(trimmed, 16);
    } else if (trimmed.startsWith('0') && trimmed.length > 1 && !trimmed.includes('8') && !trimmed.includes('9')) {
      intVal = parseInt(trimmed, 8);
    } else {
      intVal = parseInt(trimmed, 10);
    }

    if (isNaN(intVal) || intVal < 0 || intVal > 0xffffffff) return null;
    const b1 = (intVal >>> 24) & 255;
    const b2 = (intVal >>> 16) & 255;
    const b3 = (intVal >>> 8) & 255;
    const b4 = intVal & 255;
    return `${b1}.${b2}.${b3}.${b4}`;
  }

  // 2. Dotted notation (1 to 4 parts)
  const parts = trimmed.split('.');
  if (parts.length >= 1 && parts.length <= 4) {
    const parsedParts: number[] = [];
    for (const part of parts) {
      if (!part) return null;
      let val: number;
      if (part.startsWith('0x')) {
        val = parseInt(part, 16);
      } else if (part.startsWith('0') && part.length > 1 && !part.includes('8') && !part.includes('9')) {
        val = parseInt(part, 8);
      } else if (/^[0-9]+$/.test(part)) {
        val = parseInt(part, 10);
      } else {
        return null;
      }
      if (isNaN(val) || val < 0) return null;
      parsedParts.push(val);
    }

    if (parsedParts.length === 4) {
      if (parsedParts.some(p => p > 255)) return null;
      return parsedParts.join('.');
    } else if (parsedParts.length === 3) {
      // a.b.c -> a.b.0.c if c <= 65535 -> a.b.(c>>8).(c&255)
      const [a, b, c] = parsedParts;
      if (a > 255 || b > 255 || c > 0xffff) return null;
      return `${a}.${b}.${(c >>> 8) & 255}.${c & 255}`;
    } else if (parsedParts.length === 2) {
      // a.b -> a.(b>>16).(b>>8).(b&255)
      const [a, b] = parsedParts;
      if (a > 255 || b > 0xffffff) return null;
      return `${a}.${(b >>> 16) & 255}.${(b >>> 8) & 255}.${b & 255}`;
    }
  }

  return null;
}

/**
 * Checks if an IPv4 address is in a private, loopback, link-local, or restricted range.
 */
export function isRestrictedIpv4(ip: string): boolean {
  const parts = ip.split('.').map(p => parseInt(p, 10));
  if (parts.length !== 4 || parts.some(p => isNaN(p) || p < 0 || p > 255)) {
    return true; // Invalid IPv4 -> unsafe
  }

  const [b0, b1, b2, b3] = parts;

  // 0.0.0.0/8 (Current network / broadcast)
  if (b0 === 0) return true;

  // 10.0.0.0/8 (Private RFC 1918)
  if (b0 === 10) return true;

  // 100.64.0.0/10 (Carrier-grade NAT RFC 6598: 100.64.0.0 to 100.127.255.255)
  if (b0 === 100 && (b1 >= 64 && b1 <= 127)) return true;

  // 127.0.0.0/8 (Loopback)
  if (b0 === 127) return true;

  // 169.254.0.0/16 (Link-local / Cloud metadata)
  if (b0 === 169 && b1 === 254) return true;

  // 172.16.0.0/12 (Private RFC 1918: 172.16.0.0 to 172.31.255.255)
  if (b0 === 172 && (b1 >= 16 && b1 <= 31)) return true;

  // 192.0.0.0/24 (IETF Protocol Assignments RFC 6890)
  if (b0 === 192 && b1 === 0 && b2 === 0) return true;

  // 192.0.2.0/24 (TEST-NET-1 RFC 5737)
  if (b0 === 192 && b1 === 0 && b2 === 2) return true;

  // 192.88.99.0/24 (6to4 Relay Anycast RFC 7526)
  if (b0 === 192 && b1 === 88 && b2 === 99) return true;

  // 192.168.0.0/16 (Private RFC 1918)
  if (b0 === 192 && b1 === 168) return true;

  // 198.18.0.0/15 (Network Benchmark Testing RFC 2544: 198.18.0.0 to 198.19.255.255)
  if (b0 === 198 && (b1 === 18 || b1 === 19)) return true;

  // 198.51.100.0/24 (TEST-NET-2 RFC 5737)
  if (b0 === 198 && b1 === 51 && b2 === 100) return true;

  // 203.0.113.0/24 (TEST-NET-3 RFC 5737)
  if (b0 === 203 && b1 === 0 && b2 === 113) return true;

  // 224.0.0.0/4 (Multicast Class D: 224.0.0.0 to 239.255.255.255)
  if (b0 >= 224 && b0 <= 239) return true;

  // 240.0.0.0/4 (Reserved Class E: 240.0.0.0 to 255.255.255.254)
  if (b0 >= 240) return true;

  // Alibaba Cloud Metadata IP: 100.100.100.200
  if (b0 === 100 && b1 === 100 && b2 === 100 && b3 === 200) return true;

  return false;
}

/**
 * Checks if an IPv6 address is in a private, loopback, link-local, ULA, or restricted range.
 * Handles bracketed IPv6 and IPv4-mapped IPv6 (::ffff:127.0.0.1, ::ffff:7f00:1, etc.).
 */
export function isRestrictedIpv6(ip: string): boolean {
  let cleanIp = ip.trim().toLowerCase();
  if (cleanIp.startsWith('[') && cleanIp.endsWith(']')) {
    cleanIp = cleanIp.slice(1, -1);
  }

  // Check for IPv4-mapped IPv6: ::ffff:192.0.2.128 or ::ffff:7f00:1 or 0:0:0:0:0:ffff:...
  const ipv4MappedMatch = cleanIp.match(/^(?:::ffff:|0:0:0:0:0:ffff:)([0-9a-f.:]+)$/i);
  if (ipv4MappedMatch) {
    const embedded = ipv4MappedMatch[1];
    if (net.isIPv4(embedded)) {
      return isRestrictedIpv4(embedded);
    }
    const parsedNumeric = parseNumericIpv4(embedded);
    if (parsedNumeric) {
      return isRestrictedIpv4(parsedNumeric);
    }
    // Could be hex representation e.g. ::ffff:7f00:1
    const hexParts = embedded.split(':');
    if (hexParts.length === 2) {
      const high = parseInt(hexParts[0], 16);
      const low = parseInt(hexParts[1], 16);
      if (!isNaN(high) && !isNaN(low)) {
        const b0 = (high >>> 8) & 255;
        const b1 = high & 255;
        const b2 = (low >>> 8) & 255;
        const b3 = low & 255;
        return isRestrictedIpv4(`${b0}.${b1}.${b2}.${b3}`);
      }
    }
    return true; // Malformed mapped address
  }

  // IPv4-compatible IPv6 (deprecated): ::192.168.1.1
  const ipv4CompatMatch = cleanIp.match(/^::([0-9.]+)/);
  if (ipv4CompatMatch && net.isIPv4(ipv4CompatMatch[1])) {
    return isRestrictedIpv4(ipv4CompatMatch[1]);
  }

  // Standard loopback and unspecified
  if (cleanIp === '::1' || cleanIp === '0:0:0:0:0:0:0:1' || /^0*(:0*)*:1$/.test(cleanIp)) {
    return true;
  }
  if (cleanIp === '::' || cleanIp === '0:0:0:0:0:0:0:0' || /^0*(:0*)*$/.test(cleanIp)) {
    return true;
  }

  // Unique Local Addresses (ULA) RFC 4193: fc00::/7 (fc00:: to fdff:...)
  if (/^f[cd][0-9a-f]{2}:/i.test(cleanIp) || cleanIp.startsWith('fc') || cleanIp.startsWith('fd')) {
    return true;
  }

  // Link-Local Unicast RFC 4291: fe80::/10 (fe80:: to febf:...)
  if (/^fe[89ab][0-9a-f]:/i.test(cleanIp) || cleanIp.startsWith('fe80:')) {
    return true;
  }

  // Site-Local (deprecated) RFC 3879: fec0::/10
  if (/^fe[c-f][0-9a-f]:/i.test(cleanIp) || cleanIp.startsWith('fec0:')) {
    return true;
  }

  // Multicast RFC 4291: ff00::/8
  if (cleanIp.startsWith('ff')) {
    return true;
  }

  // Documentation RFC 3849: 2001:db8::/32
  if (cleanIp.startsWith('2001:db8:') || cleanIp.startsWith('2001:0db8:')) {
    return true;
  }

  // Discard prefix RFC 6666: 100::/64
  if (cleanIp.startsWith('100::')) {
    return true;
  }

  return false;
}

/**
 * Checks if a hostname or raw IP is strictly forbidden.
 */
export function isForbiddenHost(host: string): boolean {
  const clean = host.toLowerCase().trim();

  // Pattern matching
  for (const pattern of FORBIDDEN_HOST_PATTERNS) {
    if (typeof pattern === 'string') {
      if (clean === pattern || clean === `[${pattern}]`) return true;
    } else if (pattern.test(clean)) {
      return true;
    }
  }

  // Check if hostname is an IPv4 or numeric IPv4
  const numericIpv4 = parseNumericIpv4(clean);
  if (numericIpv4) {
    return isRestrictedIpv4(numericIpv4);
  }

  if (net.isIPv4(clean)) {
    return isRestrictedIpv4(clean);
  }

  // Check if hostname is an IPv6
  if (net.isIPv6(clean) || clean.startsWith('[')) {
    return isRestrictedIpv6(clean);
  }

  return false;
}

/**
 * Synchronous static URL validator.
 * Validates protocol, hostname structure, numeric encodings, and raw IP ranges.
 */
export function isSafeTarget(target: string): boolean {
  try {
    if (!target || typeof target !== 'string') return false;
    const parsed = new URL(target.trim());

    // Only allow http and https protocols
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }

    // Explicit allowlist for internal demo test upstreams if needed
    if (parsed.hostname.startsWith('fortix-demo-api')) {
      return true;
    }

    // Check hostname
    if (isForbiddenHost(parsed.hostname)) {
      return false;
    }

    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Asynchronous deep target validator.
 * In addition to static checks, resolves the hostname via DNS and verifies that
 * all resolved IPv4 and IPv6 addresses are strictly public and unrestricted.
 */
export async function isSafeTargetAsync(target: string): Promise<boolean> {
  try {
    if (!isSafeTarget(target)) {
      return false;
    }

    const parsed = new URL(target.trim());
    const hostname = parsed.hostname.toLowerCase();

    // Whitelisted demo service
    if (hostname.startsWith('fortix-demo-api')) {
      return true;
    }

    // If hostname is already a verified raw IP address, static check is sufficient
    if (net.isIP(hostname) || parseNumericIpv4(hostname)) {
      return true;
    }

    // Check DNS cache
    const cached = DNS_CACHE.get(hostname);
    const now = Date.now();
    if (cached && now - cached.cachedAt < DNS_CACHE_TTL_MS) {
      return cached.isSafe;
    }

    // Perform DNS lookup for both IPv4 and IPv6 addresses
    try {
      const records = await dns.promises.lookup(hostname, { all: true, verbatim: true });
      if (!records || records.length === 0) {
        DNS_CACHE.set(hostname, { isSafe: false, resolvedIps: [], cachedAt: now });
        return false;
      }

      for (const record of records) {
        const address = record.address;
        if (record.family === 4 || net.isIPv4(address)) {
          if (isRestrictedIpv4(address)) {
            DNS_CACHE.set(hostname, { isSafe: false, resolvedIps: records.map(r => r.address), cachedAt: now });
            return false;
          }
        } else if (record.family === 6 || net.isIPv6(address)) {
          if (isRestrictedIpv6(address)) {
            DNS_CACHE.set(hostname, { isSafe: false, resolvedIps: records.map(r => r.address), cachedAt: now });
            return false;
          }
        } else {
          // Unknown IP family
          DNS_CACHE.set(hostname, { isSafe: false, resolvedIps: records.map(r => r.address), cachedAt: now });
          return false;
        }
      }

      DNS_CACHE.set(hostname, { isSafe: true, resolvedIps: records.map(r => r.address), cachedAt: now });
      return true;
    } catch (dnsErr) {
      // DNS resolution failed -> unsafe target
      DNS_CACHE.set(hostname, { isSafe: false, resolvedIps: [], cachedAt: now });
      return false;
    }
  } catch (e) {
    return false;
  }
}
