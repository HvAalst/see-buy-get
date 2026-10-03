import { isIP } from 'net';

/**
 * WHERE STAFF MAY SIGN IN FROM — an optional fence, set per deployment.
 *
 * `GLOS_STAFF_NETWORKS` is a comma-separated list of addresses and IPv4 ranges ("196.201.214.0/24, 41.90.3.7").
 * When it is set, staff sign-in and every request made with a staff token are refused from anywhere else; when it is
 * not, nothing changes. It sits behind the console's own entrance (its own address, and a gate in front of it at the
 * edge) as the last line: a staff password and code typed on a café laptop still open nothing.
 *
 * Only `operator` — the people who work for the network. A company administrator signs in from their own office.
 */
export function staffNetworks(): string[] {
  return (process.env.GLOS_STAFF_NETWORKS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function staffNetworkAllows(ip: string | undefined, networks: string[] = staffNetworks()): boolean {
  if (!networks.length) return true;
  const addr = normalise(ip);
  if (!addr) return false;
  return networks.some((n) => matches(addr, n));
}

/** Express gives "::ffff:10.0.0.1" for an IPv4 caller on a dual-stack socket. */
function normalise(ip: string | undefined): string | null {
  if (!ip) return null;
  const v = ip.trim().replace(/^::ffff:/i, '');
  return isIP(v) ? v : null;
}

function matches(addr: string, rule: string): boolean {
  const [base, bitsText] = rule.split('/');
  if (bitsText === undefined) return normalise(base) === addr;
  if (isIP(base) !== 4 || isIP(addr) !== 4) return false; // ranges are IPv4 only; an IPv6 office is listed by address
  const bits = Number(bitsText);
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (toInt(base) & mask) === (toInt(addr) & mask);
}

function toInt(ip: string): number {
  return ip.split('.').reduce((n, part) => ((n << 8) | Number(part)) >>> 0, 0);
}
