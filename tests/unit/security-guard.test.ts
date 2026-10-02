import { describe, it, expect, beforeEach } from 'vitest';
import { SecurityGuard, securityGuard } from '../../src/services/SecurityGuard.js';

describe('SecurityGuard Service: Strict DNS & SSRF Validation', () => {
  let guard: SecurityGuard;

  beforeEach(() => {
    guard = new SecurityGuard();
    guard.clearCache();
  });

  describe('Direct IPv4 Validation & Classification', () => {
    it('allows valid public IPv4 addresses', () => {
      const publicIps = ['93.184.216.34', '8.8.8.8', '1.1.1.1', '140.82.121.3'];
      for (const ip of publicIps) {
        const result = guard.validateIp(ip);
        expect(result.isRestricted).toBe(false);
      }
    });

    it('blocks loopback IPv4 addresses (127.0.0.0/8)', () => {
      const loopbacks = ['127.0.0.1', '127.0.0.2', '127.100.50.1', '127.255.255.254'];
      for (const ip of loopbacks) {
        const result = guard.validateIp(ip);
        expect(result.isRestricted).toBe(true);
        expect(result.type).toBe('loopback');
      }
    });

    it('blocks private RFC 1918 IPv4 ranges (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16)', () => {
      const privates = [
        '10.0.0.1',
        '10.254.254.254',
        '172.16.0.1',
        '172.20.10.5',
        '172.31.255.254',
        '192.168.0.1',
        '192.168.1.254',
      ];
      for (const ip of privates) {
        const result = guard.validateIp(ip);
        expect(result.isRestricted).toBe(true);
        expect(result.type).toBe('private');
      }
    });

    it('blocks Link-Local and Cloud Metadata IPv4 (169.254.0.0/16, Alibaba 100.100.100.200)', () => {
      const metadataIps = ['169.254.169.254', '169.254.1.1', '100.100.100.200'];
      for (const ip of metadataIps) {
        const result = guard.validateIp(ip);
        expect(result.isRestricted).toBe(true);
      }
    });

    it('blocks Carrier-Grade NAT (100.64.0.0/10)', () => {
      const cgnatIps = ['100.64.0.1', '100.100.0.1', '100.127.255.254'];
      for (const ip of cgnatIps) {
        const result = guard.validateIp(ip);
        expect(result.isRestricted).toBe(true);
      }
    });

    it('blocks broadcast, multicast, and reserved IPv4 (0.0.0.0/8, 224.0.0.0/4, 240.0.0.0/4)', () => {
      const reserved = ['0.0.0.0', '224.0.0.1', '239.255.255.250', '240.0.0.1', '255.255.255.255'];
      for (const ip of reserved) {
        const result = guard.validateIp(ip);
        expect(result.isRestricted).toBe(true);
      }
    });
  });

  describe('Alternate Numeric & Encoded IPv4 Decoders', () => {
    it('decodes 32-bit decimal integer representations', () => {
      // 2130706433 -> 127.0.0.1
      expect(guard.parseNumericOrEncodedIp('2130706433')).toBe('127.0.0.1');
      // 2852039166 -> 169.254.169.254
      expect(guard.parseNumericOrEncodedIp('2852039166')).toBe('169.254.169.254');
      // 3232235521 -> 192.168.0.1
      expect(guard.parseNumericOrEncodedIp('3232235521')).toBe('192.168.0.1');

      expect(guard.validateIp('2130706433').isRestricted).toBe(true);
      expect(guard.validateIp('2852039166').isRestricted).toBe(true);
    });

    it('decodes hexadecimal integer representations', () => {
      // 0x7f000001 -> 127.0.0.1
      expect(guard.parseNumericOrEncodedIp('0x7f000001')).toBe('127.0.0.1');
      // 0xa9fea9fe -> 169.254.169.254
      expect(guard.parseNumericOrEncodedIp('0xa9fea9fe')).toBe('169.254.169.254');
      // 0x0a000001 -> 10.0.0.1
      expect(guard.parseNumericOrEncodedIp('0x0a000001')).toBe('10.0.0.1');

      expect(guard.validateIp('0x7f000001').isRestricted).toBe(true);
      expect(guard.validateIp('0xa9fea9fe').isRestricted).toBe(true);
    });

    it('decodes octal integer representations', () => {
      // 017700000001 -> 127.0.0.1
      expect(guard.parseNumericOrEncodedIp('017700000001')).toBe('127.0.0.1');
      expect(guard.validateIp('017700000001').isRestricted).toBe(true);
    });

    it('decodes dotted octal, dotted hex, and shortened notation', () => {
      expect(guard.parseNumericOrEncodedIp('0177.0.0.1')).toBe('127.0.0.1');
      expect(guard.parseNumericOrEncodedIp('0x7f.0.0.1')).toBe('127.0.0.1');
      expect(guard.parseNumericOrEncodedIp('127.1')).toBe('127.0.0.1');
      expect(guard.parseNumericOrEncodedIp('10.1')).toBe('10.0.0.1');
      expect(guard.parseNumericOrEncodedIp('127.0.1')).toBe('127.0.0.1');

      expect(guard.validateIp('0177.0.0.1').isRestricted).toBe(true);
      expect(guard.validateIp('0x7f.0.0.1').isRestricted).toBe(true);
      expect(guard.validateIp('127.1').isRestricted).toBe(true);
      expect(guard.validateIp('10.1').isRestricted).toBe(true);
    });
  });

  describe('IPv6, IPv4-Mapped IPv6 & ULA/Link-Local Detection', () => {
    it('blocks standard IPv6 loopback (::1) and unspecified (::)', () => {
      expect(guard.validateIp('::1').isRestricted).toBe(true);
      expect(guard.validateIp('[::1]').isRestricted).toBe(true);
      expect(guard.validateIp('0:0:0:0:0:0:0:1').isRestricted).toBe(true);
      expect(guard.validateIp('::').isRestricted).toBe(true);
    });

    it('blocks IPv4-mapped IPv6 pointing to loopback or private ranges', () => {
      expect(guard.validateIp('::ffff:127.0.0.1').isRestricted).toBe(true);
      expect(guard.validateIp('::ffff:169.254.169.254').isRestricted).toBe(true);
      expect(guard.validateIp('::ffff:10.0.0.1').isRestricted).toBe(true);
      expect(guard.validateIp('::ffff:7f00:1').isRestricted).toBe(true);
      expect(guard.validateIp('0:0:0:0:0:ffff:127.0.0.1').isRestricted).toBe(true);
    });

    it('blocks IPv6 Unique Local Addresses (ULA) and Link-Local (fc00::/7, fe80::/10)', () => {
      expect(guard.validateIp('fc00::1').isRestricted).toBe(true);
      expect(guard.validateIp('fd12:3456:789a::1').isRestricted).toBe(true);
      expect(guard.validateIp('fe80::1').isRestricted).toBe(true);
      expect(guard.validateIp('fe80::200:5efe:10.0.0.1').isRestricted).toBe(true);
    });

    it('blocks documentation (2001:db8::/32) and multicast (ff00::/8)', () => {
      expect(guard.validateIp('2001:db8::1').isRestricted).toBe(true);
      expect(guard.validateIp('ff02::1').isRestricted).toBe(true);
    });
  });

  describe('Forbidden Internal Hostnames & Cloud Endpoints', () => {
    it('blocks localhost, internal domains, and metadata endpoints', () => {
      const forbidden = [
        'localhost',
        'sub.localhost',
        'service.local',
        'api.internal',
        'auth.lan',
        'db.corp',
        'metadata.google.internal',
        'instance-data.ec2.internal',
        'kubernetes.default',
        'kubernetes.default.svc.cluster.local',
        'host.docker.internal',
        'gateway.docker.internal',
      ];

      for (const host of forbidden) {
        expect(guard.isForbiddenHostname(host)).toBe(true);
      }
    });

    it('allows legitimate public internet hostnames', () => {
      const allowed = ['api.github.com', 'stripe.com', 'api.openai.com', 'fortix.io', 'example.com'];
      for (const host of allowed) {
        expect(guard.isForbiddenHostname(host)).toBe(false);
      }
    });
  });

  describe('Strict DNS Resolution Validation with Mock Resolvers', () => {
    it('allows target when DNS resolves strictly to public IPs', async () => {
      const mockResolver = async () => [
        { address: '93.184.216.34', family: 4 },
        { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 },
      ];

      const testGuard = new SecurityGuard({ customResolver: mockResolver });
      const result = await testGuard.validateTarget('https://example.com/api/v1');

      expect(result.isValid).toBe(true);
      expect(result.resolvedIps).toEqual(['93.184.216.34', '2606:2800:220:1:248:1893:25c8:1946']);
    });

    it('blocks target when DNS resolves to private IPv4 (e.g. 127.0.0.1 or 10.0.0.1)', async () => {
      const mockResolver = async () => [
        { address: '127.0.0.1', family: 4 },
      ];

      const testGuard = new SecurityGuard({ customResolver: mockResolver });
      const result = await testGuard.validateTarget('https://internal-spoof.com/data');

      expect(result.isValid).toBe(false);
      expect(result.errorCode).toBe('RESTRICTED_IP');
      expect(result.reason).toContain('DNS resolved hostname');
    });

    it('blocks target if ANY multi-homed IP resolves to a private or restricted address', async () => {
      const mockResolver = async () => [
        { address: '93.184.216.34', family: 4 }, // public
        { address: '192.168.1.50', family: 4 },  // private backdoor
      ];

      const testGuard = new SecurityGuard({ customResolver: mockResolver });
      const result = await testGuard.validateTarget('https://mixed-dns.com/api');

      expect(result.isValid).toBe(false);
      expect(result.errorCode).toBe('RESTRICTED_IP');
    });

    it('blocks target if DNS resolves to IPv4-mapped loopback or private IPv6', async () => {
      const mockResolver = async () => [
        { address: '::ffff:127.0.0.1', family: 6 },
      ];

      const testGuard = new SecurityGuard({ customResolver: mockResolver });
      const result = await testGuard.validateTarget('https://v6-mapped-attack.org');

      expect(result.isValid).toBe(false);
      expect(result.errorCode).toBe('RESTRICTED_IP');
    });

    it('handles DNS resolution timeout gracefully', async () => {
      const hangingResolver = async () => {
        await new Promise(resolve => setTimeout(resolve, 500));
        return [{ address: '93.184.216.34', family: 4 }];
      };

      const testGuard = new SecurityGuard({
        customResolver: hangingResolver,
        dnsTimeoutMs: 50,
      });

      const result = await testGuard.validateTarget('https://slow-dns.com');
      expect(result.isValid).toBe(false);
      expect(result.errorCode).toBe('DNS_TIMEOUT');
    });

    it('handles empty DNS records', async () => {
      const emptyResolver = async () => [];

      const testGuard = new SecurityGuard({ customResolver: emptyResolver });
      const result = await testGuard.validateTarget('https://non-existent-domain-404.org');

      expect(result.isValid).toBe(false);
      expect(result.errorCode).toBe('DNS_RESOLUTION_FAILED');
    });
  });

  describe('Full URL Validation & Bypass Prevention', () => {
    it('blocks dangerous URL schemes (file://, gopher://, ftp://)', async () => {
      const dangerousSchemes = [
        'file:///etc/passwd',
        'gopher://127.0.0.1:70/',
        'ftp://10.0.0.1/resource',
        'javascript:alert(1)',
      ];

      for (const url of dangerousSchemes) {
        const result = await guard.validateTarget(url);
        expect(result.isValid).toBe(false);
      }
    });

    it('blocks bypass attempts using decimal, octal, and hex integer URLs directly', async () => {
      const bypassUrls = [
        'http://2130706433/admin',         // 127.0.0.1 decimal
        'http://0x7f000001/status',        // 127.0.0.1 hex
        'http://017700000001/config',      // 127.0.0.1 octal
        'http://2852039166/latest/meta',   // 169.254.169.254 decimal
        'http://0xa9fea9fe/meta',          // 169.254.169.254 hex
        'http://0177.0.0.1/sensitive',     // dotted octal
        'http://0x7f.0.0.1/private',       // dotted hex
        'http://127.1/debug',              // shortened 127.0.0.1
        'http://10.1/debug',               // shortened 10.0.0.1
      ];

      for (const url of bypassUrls) {
        const result = await guard.validateTarget(url);
        expect(result.isValid).toBe(false);
      }
    });

    it('blocks IPv6 bracketed bypass URLs directly', async () => {
      const ipv6Urls = [
        'http://[::1]:8080/internal',
        'http://[0:0:0:0:0:0:0:1]/api',
        'http://[::ffff:127.0.0.1]/secret',
        'http://[::ffff:169.254.169.254]/meta',
        'http://[fc00::1]/private',
        'http://[fe80::1]/linklocal',
      ];

      for (const url of ipv6Urls) {
        const result = await guard.validateTarget(url);
        expect(result.isValid).toBe(false);
      }
    });

    it('uses the global singleton instance seamlessly', async () => {
      const result = await securityGuard.validateTarget('http://127.0.0.1:9000/test');
      expect(result.isValid).toBe(false);
      expect(result.errorCode).toBe('RESTRICTED_IP');
    });
  });
});
