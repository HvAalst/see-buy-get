import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * EVERY ROUTE THAT NAMES A PARTICIPANT ASKS WHO IS CALLING — BEFORE IT DOES ANYTHING.
 *
 * A route with no @Roles or @Scopes label takes any valid token (see AuthGuard), and a route under
 * `fleet/drivers/:did` or `agents/:did` acts on whoever the path names. Put together, that let any account —
 * a shopper who signed up with a phone number — end any driver's shift, move their dot on the map, set the
 * least a job must pay them, reprice or close any shop, and credit any shop's float. Nothing in the suite
 * noticed, because every handler test called the handler AS the right person.
 *
 * So this reads the controller the way a reviewer would, and refuses a participant route that:
 *   - carries no owner check at all, or
 *   - calls a service before its owner check (the check has to run first, or the damage is done already).
 * A plain read of the record (`this.drivers.get(`) may come first — it is how a check finds the fleet.
 *
 * `actingDid(actor, did)` counts: for anybody but staff it IGNORES the path and acts on the caller's own id,
 * so it cannot reach somebody else's record by construction.
 */
const SOURCE = readFileSync(join(__dirname, 'pudo.controller.ts'), 'utf8');

const PREFIXES = ['fleet/drivers/:did', 'agents/:did', 'fleet/managers/:did', 'drivers/:did'];

/** The owner checks this controller has. A new one is added here on purpose, by somebody who read it. */
const GUARDS = [
  'this.assertDriverReader(',
  'this.assertDriverActs(',
  'this.assertDriverSelf(', // the driver ONLY — not staff, not a fleet office: saying yes to a fleet is nobody else's to say
  'this.assertDriverOwner(',
  'this.assertDriverInFleet(',
  'this.isFleetOffice(',
  'this.assertAgentOwner(',
  'this.assertAgentActs(',
  'this.assertAgentSelf(', // round 40 — the shop ONLY: its renewed licence is never sent by the staff who read it
  'this.assertFleetSelf(',
  'actingDid(actor',
];

/** Reads that may come before a check: they find the record the check is about, and change nothing. */
const PLAIN_READS = ['this.drivers.get(', 'this.agents.get(', 'this.managers.get('];

/**
 * THE EXCEPTIONS, EACH WITH ITS REASON, keyed by method and path. Adding one is a decision somebody has to
 * write down — and a reason may not outlive its route (the last test).
 */
const EXEMPT: Record<string, string> = {
  'POST fleet/drivers/:did/licence-renewal':
    'the driver ONLY — staff and their fleet’s office are refused on purpose (the checker must not supply the thing checked), so it checks inline rather than with a helper that lets either through',
  'GET fleet/managers/:did':
    'scoped by ManagerService.viewFor: a stranger is given the public fields only, the owner and staff the whole record',
  'GET agents/:did/rating':
    'a shop’s rating is public by design — it is what somebody choosing where to collect a parcel reads',
};

interface Route {
  key: string;
  decorators: string;
  body: string;
}

function routes(): Route[] {
  const lines = SOURCE.split('\n');
  const out: Route[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*@(Get|Post|Patch|Put|Delete)\('([^']*)'\)/);
    if (!m || !PREFIXES.some((p) => m[2] === p || m[2].startsWith(`${p}/`))) continue;
    let top = i;
    while (top > 0 && /^\s*@/.test(lines[top - 1])) top--;
    let end = i + 1;
    while (end < lines.length && !/^ {2}\}\s*$/.test(lines[end])) end++;
    out.push({ key: `${m[1].toUpperCase()} ${m[2]}`, decorators: lines.slice(top, i + 1).join('\n'), body: lines.slice(i + 1, end).join('\n') });
  }
  return out;
}

/** The body with comments removed, so a guard named in a comment does not count as a guard. */
const code = (body: string) => body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const found = routes();

describe('who may call a route that names a participant', () => {
  it('read the controller at all — a guard that saw nothing proves nothing', () => {
    expect(found.length).toBeGreaterThan(60);
    expect(found.some((r) => r.key === 'POST fleet/drivers/:did/end-session')).toBe(true);
    expect(found.some((r) => r.key === 'POST agents/:did/top-up')).toBe(true);
  });

  it('checks who is calling on every one of them, or says in writing why not', () => {
    const unguarded = found
      .filter((r) => !EXEMPT[r.key])
      .filter((r) => !/@Roles\('operator'\)/.test(r.decorators))
      .filter((r) => !GUARDS.some((g) => code(r.body).includes(g)))
      .map((r) => r.key);
    expect(unguarded).toEqual([]);
  });

  it('checks BEFORE acting — no service is called ahead of the owner check', () => {
    const late: string[] = [];
    for (const r of found) {
      if (EXEMPT[r.key] || /@Roles\('operator'\)/.test(r.decorators)) continue;
      const body = code(r.body);
      if (body.includes('actingDid(actor')) continue; // acts on the caller's own id by construction
      const at = Math.min(...GUARDS.map((g) => body.indexOf(g)).filter((n) => n >= 0));
      const before = body.slice(0, at);
      const calls = [...before.matchAll(/this\.[a-zA-Z]+\.[a-zA-Z]+\(/g)].map((c) => c[0]);
      if (calls.some((c) => !PLAIN_READS.includes(c))) late.push(`${r.key}: ${calls.join(', ')}`);
    }
    expect(late).toEqual([]);
  });

  it('keeps no exception for a route that no longer exists', () => {
    const live = new Set(found.map((r) => r.key));
    expect(Object.keys(EXEMPT).filter((k) => !live.has(k))).toEqual([]);
  });
});
