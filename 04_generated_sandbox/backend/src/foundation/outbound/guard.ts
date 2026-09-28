import { lookup } from 'dns/promises';
import { isSandbox } from '../runtime/sandbox';
import { GlosError } from '../http/glos-error';

/**
 * WHERE THIS SERVER IS ALLOWED TO REACH.
 *
 * Delivering a bundle to somebody's own storage means this server making an HTTP request to an address
 * THEY typed. That is server-side request forgery in its textbook form, and it is the first time
 * anything in this backend has done it — the vendor callback has been built, signed and queued for
 * months and has never actually been posted, so nothing until now has had to answer this question.
 *
 * What an attacker gets from a naive version: `http://169.254.169.254/latest/meta-data/` is the cloud
 * metadata service and hands out instance credentials; `http://127.0.0.1:3000/` is us; `http://10.x` is
 * whatever else runs in the same network. So the host is RESOLVED and every address it resolves to is
 * checked — a name is not an address, and `evil.example.com` resolving to 127.0.0.1 is the oldest
 * trick here.
 *
 * TWO THINGS THIS DELIBERATELY DOES NOT DO, said plainly rather than implied:
 *
 *   DNS REBINDING is not fully closed. We resolve, we check, and then fetch resolves again — a name
 *   that answers differently between the two calls slips through. Closing it properly means connecting
 *   to the pinned address with the Host header set by hand, which needs a custom agent. The exposure is
 *   narrowed instead by never returning the response body (see below), so a rebind buys a blind PUT
 *   rather than a read of anything.
 *
 *   THE RESPONSE BODY NEVER REACHES THE USER. Only a status code and our own words. An error that
 *   echoed what the far end said would turn this into a reader for any address it can reach, which is
 *   the half of SSRF that actually extracts secrets.
 */

/** Ranges nothing on this network may be asked to talk to. */
const BLOCKED_V4: Array<[string, number]> = [
  ['0.0.0.0', 8], // "this host"
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8], // loopback — us
  ['169.254.0.0', 16], // link-local, and the cloud metadata service that lives in it
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // protocol assignments
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved
];

function v4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const b = Number(p);
    if (!Number.isInteger(b) || b < 0 || b > 255) return null;
    n = (n << 8) | b;
  }
  return n >>> 0;
}

/** True for an address no outbound request may go to. */
export function isBlockedAddress(ip: string): boolean {
  const plain = ip.startsWith('::ffff:') ? ip.slice(7) : ip; // IPv4-mapped IPv6
  const asV4 = v4ToInt(plain);
  if (asV4 !== null) {
    return BLOCKED_V4.some(([base, bits]) => {
      const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
      return (asV4 & mask) === ((v4ToInt(base) as number) & mask);
    });
  }
  const v6 = plain.toLowerCase();
  if (v6 === '::' || v6 === '::1') return true; // unspecified, loopback
  if (/^f[cd]/.test(v6)) return true; // fc00::/7 unique-local
  if (/^fe[89ab]/.test(v6)) return true; // fe80::/10 link-local
  if (v6.startsWith('ff')) return true; // multicast
  return false;
}

/**
 * Check a destination URL before anything is sent to it.
 *
 * Throws a GlosError the person can act on — this runs when they SAVE a destination and again before
 * every delivery, because a hostname that was fine in January can point somewhere else in June.
 */
export async function assertReachable(raw: string): Promise<{ host: string; addresses: string[] }> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new GlosError('INVALID_INPUT', 'That is not a web address');
  }

  const sandbox = isSandbox();
  if (url.protocol !== 'https:' && !(sandbox && url.protocol === 'http:')) {
    throw new GlosError('INVALID_INPUT', 'A destination has to be https — your documents are not going over plain http');
  }

  let addresses: string[];
  try {
    const found = await lookup(url.hostname, { all: true });
    addresses = found.map((a) => a.address);
  } catch {
    throw new GlosError('INVALID_INPUT', `Nothing answers for ${url.hostname} — check the address`);
  }
  if (addresses.length === 0) throw new GlosError('INVALID_INPUT', `Nothing answers for ${url.hostname} — check the address`);

  /*
   * The exemption is gated on the sandbox, and that gate is the point rather than a convenience: a
   * loopback exemption left switched on in production is how "let anything on the box do it" happens.
   * Everything BUT loopback stays blocked even here, so a sandbox cannot reach the metadata service.
   */
  const allowLoopback = sandbox;
  for (const address of addresses) {
    const loopback = address === '::1' || address.replace('::ffff:', '').startsWith('127.');
    if (loopback && allowLoopback) continue;
    if (isBlockedAddress(address)) {
      throw new GlosError('INVALID_INPUT', `${url.hostname} resolves to an address inside a private network, which this server will not send your documents to`);
    }
  }

  return { host: url.host, addresses };
}
