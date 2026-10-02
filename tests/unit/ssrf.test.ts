import { describe, it, expect } from 'vitest';
import { 
  isSafeTarget, 
  isSafeTargetAsync, 
  isForbiddenHost, 
  isRestrictedIpv4, 
  isRestrictedIpv6, 
  parseNumericIpv4 
} from '../../src/gateway/ssrf.js';

describe('SSRF Guard: IP Parsing & Encoding Decoders', () => {
  it('correctly parses decimal integer IPs', () => {
    expect(parseNumericIpv4('2130706433')).toBe('127.0.0.1'); // 0x7F000001
    expect(parseNumericIpv4('2852039166')).toBe('169.254.169.254'); // 0xA9FEA9FE
    expect(parseNumericIpv4('0')).toBe('0.0.0.0');
    expect(parseNumericIpv4('167772161')).toBe('10.0.0.1'); // 0x0A000001
  });

  it('correctly parses hex and octal single-number representations', () => {
    expect(parseNumericIpv4('0x7f000001')).toBe('127.0.0.1');
    expect(parseNumericIpv4('017700000001')).toBe('127.0.0.1');
  });

  it('correctly parses dotted hex and dotted octal notations', () => {
    expect(parseNumericIpv4('0177.0.0.1')).toBe('127.0.0.1');
    expect(parseNumericIpv4('0x7f.0.0.1')).toBe('127.0.0.1');
    expect(parseNumericIpv4('0x7f.0x0.0x0.0x1')).toBe('127.0.0.1');
    expect(parseNumericIpv4('127.0.0.1')).toBe('127.0.0.1');
  });

  it('correctly parses shortened 2-part and 3-part dotted notations', () => {
    expect(parseNumericIpv4('127.1')).toBe('127.0.0.1');
    expect(parseNumericIpv4('10.1')).toBe('10.0.0.1');
    expect(parseNumericIpv4('172.16.1')).toBe('172.16.0.1');
  });
});

describe('SSRF Guard: IPv4 Range Restrictions', () => {
  it('blocks loopback range 127.0.0.0/8', () => {
    expect(isRestrictedIpv4('127.0.0.1')).toBe(true);
    expect(isRestrictedIpv4('127.0.0.2')).toBe(true);
    expect(isRestrictedIpv4('127.255.255.255')).toBe(true);
  });

  it('blocks 0.0.0.0/8 and 255.255.255.255', () => {
    expect(isRestrictedIpv4('0.0.0.0')).toBe(true);
    expect(isRestrictedIpv4('0.1.2.3')).toBe(true);
    expect(isRestrictedIpv4('255.255.255.255')).toBe(true);
  });

  it('blocks RFC 1918 private subnets', () => {
    // 10.0.0.0/8
    expect(isRestrictedIpv4('10.0.0.1')).toBe(true);
    expect(isRestrictedIpv4('10.255.255.255')).toBe(true);
    // 172.16.0.0/12
    expect(isRestrictedIpv4('172.16.0.1')).toBe(true);
    expect(isRestrictedIpv4('172.31.255.255')).toBe(true);
    // 192.168.0.0/16
    expect(isRestrictedIpv4('192.168.0.1')).toBe(true);
    expect(isRestrictedIpv4('192.168.254.254')).toBe(true);
  });

  it('blocks Cloud Metadata & Link-Local 169.254.0.0/16 and Alibaba 100.100.100.200', () => {
    expect(isRestrictedIpv4('169.254.169.254')).toBe(true);
    expect(isRestrictedIpv4('169.254.1.1')).toBe(true);
    expect(isRestrictedIpv4('100.100.100.200')).toBe(true);
  });

  it('blocks Carrier-Grade NAT, multicast and benchmark ranges', () => {
    expect(isRestrictedIpv4('100.64.0.1')).toBe(true); // CGNAT
    expect(isRestrictedIpv4('224.0.0.1')).toBe(true);  // Multicast
    expect(isRestrictedIpv4('240.0.0.1')).toBe(true);  // Reserved Class E
    expect(isRestrictedIpv4('198.18.0.1')).toBe(true); // Benchmark
  });

  it('permits legitimate public IPv4 addresses', () => {
    expect(isRestrictedIpv4('8.8.8.8')).toBe(false);
    expect(isRestrictedIpv4('1.1.1.1')).toBe(false);
    expect(isRestrictedIpv4('93.184.216.34')).toBe(false); // example.com
    expect(isRestrictedIpv4('140.82.121.4')).toBe(false);  // github.com
  });
});

describe('SSRF Guard: IPv6 & IPv4-Mapped Restrictions', () => {
  it('blocks IPv6 loopback and unspecified addresses', () => {
    expect(isRestrictedIpv6('::1')).toBe(true);
    expect(isRestrictedIpv6('0:0:0:0:0:0:0:1')).toBe(true);
    expect(isRestrictedIpv6('[::1]')).toBe(true);
    expect(isRestrictedIpv6('::')).toBe(true);
  });

  it('blocks IPv4-mapped IPv6 loopback and private subnets', () => {
    expect(isRestrictedIpv6('::ffff:127.0.0.1')).toBe(true);
    expect(isRestrictedIpv6('[::ffff:127.0.0.1]')).toBe(true);
    expect(isRestrictedIpv6('::ffff:7f00:1')).toBe(true);
    expect(isRestrictedIpv6('::ffff:169.254.169.254')).toBe(true);
    expect(isRestrictedIpv6('::ffff:10.0.0.1')).toBe(true);
    expect(isRestrictedIpv6('::ffff:192.168.1.1')).toBe(true);
    expect(isRestrictedIpv6('0:0:0:0:0:ffff:127.0.0.1')).toBe(true);
  });

  it('blocks IPv6 ULA (fc00::/7) and Link-Local (fe80::/10)', () => {
    expect(isRestrictedIpv6('fc00::1')).toBe(true);
    expect(isRestrictedIpv6('fd12:3456:789a::1')).toBe(true);
    expect(isRestrictedIpv6('fe80::1')).toBe(true);
    expect(isRestrictedIpv6('fe80::200:5efe:10.0.0.1')).toBe(true);
  });

  it('blocks IPv6 multicast and documentation prefixes', () => {
    expect(isRestrictedIpv6('ff02::1')).toBe(true);
    expect(isRestrictedIpv6('2001:db8::1')).toBe(true);
  });

  it('permits legitimate global unicast IPv6 addresses', () => {
    expect(isRestrictedIpv6('2606:4700:4700::1111')).toBe(false); // Cloudflare DNS
    expect(isRestrictedIpv6('2001:4860:4860::8888')).toBe(false); // Google DNS
  });
});

describe('SSRF Guard: isSafeTarget Static Validator', () => {
  it('allows valid external public HTTP/HTTPS endpoints', () => {
    expect(isSafeTarget('https://api.github.com/repos')).toBe(true);
    expect(isSafeTarget('https://api.stripe.com/v1/charges')).toBe(true);
    expect(isSafeTarget('https://example.com/api/v2/items')).toBe(true);
    expect(isSafeTarget('http://93.184.216.34:80/status')).toBe(true);
  });

  it('allows whitelisted demo services', () => {
    expect(isSafeTarget('http://fortix-demo-api:4000/api/users')).toBe(true);
  });

  it('blocks forbidden protocols', () => {
    expect(isSafeTarget('file:///etc/passwd')).toBe(false);
    expect(isSafeTarget('gopher://127.0.0.1:70/')).toBe(false);
    expect(isSafeTarget('ftp://example.com/')).toBe(false);
    expect(isSafeTarget('dict://127.0.0.1:11211/')).toBe(false);
    expect(isSafeTarget('javascript:alert(1)')).toBe(false);
    expect(isSafeTarget('')).toBe(false);
  });

  it('blocks standard localhost and private IPs', () => {
    expect(isSafeTarget('http://localhost:8080/')).toBe(false);
    expect(isSafeTarget('http://localhost.localdomain/')).toBe(false);
    expect(isSafeTarget('http://127.0.0.1:3000/')).toBe(false);
    expect(isSafeTarget('http://10.0.0.5:9000/')).toBe(false);
    expect(isSafeTarget('http://192.168.1.1/admin')).toBe(false);
    expect(isSafeTarget('http://172.16.0.2:80/')).toBe(false);
  });

  it('blocks encoded localhost bypass vectors', () => {
    // Decimal integer
    expect(isSafeTarget('http://2130706433:8080/')).toBe(false);
    // Hexadecimal integer
    expect(isSafeTarget('http://0x7f000001/')).toBe(false);
    // Dotted hex
    expect(isSafeTarget('http://0x7f.0.0.1/')).toBe(false);
    // Dotted octal
    expect(isSafeTarget('http://0177.0.0.1/')).toBe(false);
    // Shortened form
    expect(isSafeTarget('http://127.1/')).toBe(false);
    expect(isSafeTarget('http://10.1/')).toBe(false);
  });

  it('blocks cloud metadata endpoints and aliases', () => {
    expect(isSafeTarget('http://169.254.169.254/latest/meta-data/')).toBe(false);
    expect(isSafeTarget('http://2852039166/latest/meta-data/')).toBe(false);
    expect(isSafeTarget('http://metadata.google.internal/computeMetadata/v1/')).toBe(false);
    expect(isSafeTarget('http://metadata.internal/')).toBe(false);
    expect(isSafeTarget('http://metadata/')).toBe(false);
    expect(isSafeTarget('http://instance-data/latest/meta-data')).toBe(false);
    expect(isSafeTarget('http://100.100.100.200/')).toBe(false);
  });

  it('blocks internal suffixes and container names', () => {
    expect(isSafeTarget('http://service.local/api')).toBe(false);
    expect(isSafeTarget('http://db.internal:5432/')).toBe(false);
    expect(isSafeTarget('http://nas.lan/')).toBe(false);
    expect(isSafeTarget('http://secret.corp/')).toBe(false);
    expect(isSafeTarget('http://host.docker.internal:8080')).toBe(false);
    expect(isSafeTarget('http://docker.for.mac.localhost/')).toBe(false);
    expect(isSafeTarget('http://kubernetes.default.svc/')).toBe(false);
  });

  it('blocks IPv6 and IPv4-mapped IPv6 targets', () => {
    expect(isSafeTarget('http://[::1]:8080/')).toBe(false);
    expect(isSafeTarget('http://[::]/')).toBe(false);
    expect(isSafeTarget('http://[::ffff:127.0.0.1]/')).toBe(false);
    expect(isSafeTarget('http://[::ffff:7f00:1]/')).toBe(false);
    expect(isSafeTarget('http://[::ffff:169.254.169.254]/')).toBe(false);
    expect(isSafeTarget('http://[fc00::1]/')).toBe(false);
    expect(isSafeTarget('http://[fe80::1]/')).toBe(false);
  });
});

describe('SSRF Guard: isSafeTargetAsync DNS Resolution', () => {
  it('resolves and verifies public hostnames asynchronously', async () => {
    const isSafe = await isSafeTargetAsync('https://example.com/api');
    expect(isSafe).toBe(true);
  });

  it('rejects forbidden static hosts before DNS lookup', async () => {
    const isSafe = await isSafeTargetAsync('http://127.0.0.1:8080');
    expect(isSafe).toBe(false);
  });

  it('rejects invalid URL strings', async () => {
    const isSafe = await isSafeTargetAsync('invalid_target_string');
    expect(isSafe).toBe(false);
  });
});
