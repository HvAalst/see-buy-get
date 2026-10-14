import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * EVERY DOOR THAT HANDS PARCELS OR A BAG TO A DRIVER ASKS WHAT THE COUNTER WAS SHOWN — the user, 2026-10-15: "only
 * drivers can do what drivers can do".
 *
 * A badge number on its own handed parcels over: anybody who had one could say it at a counter. `FleetService.badgeShown`
 * turns what a counter scanned into the badge it proves — a driver of ours proves it with the pass on their own phone
 * (pudo.service.spec.ts, "a counter hands parcels to the driver, not to a number"). That is only true while every
 * door that hands goods to a driver asks it, so this reads the controller the way a reviewer would: the next route
 * that hands a driver something cannot be written straight onto the badge in the body.
 */
const SOURCE = readFileSync(join(__dirname, 'pudo.controller.ts'), 'utf8');

/** What hands goods to a driver by badge. Each call in a route body must have badgeShown (or the driver's own badge) before it. */
const HANDS_OVER = ['this.parcels.handover(', 'this.mdps.loadBag('];

interface Route {
  key: string;
  body: string;
}

function routes(): Route[] {
  const lines = SOURCE.split(/\r?\n/);
  const out: Route[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*@(Get|Post|Patch|Put|Delete)\('([^']*)'\)/);
    if (!m) continue;
    let end = i + 1;
    while (end < lines.length && !/^ {2}\}\s*$/.test(lines[end])) end++;
    out.push({ key: `${m[1].toUpperCase()} ${m[2]}`, body: lines.slice(i + 1, end).join('\n') });
  }
  return out;
}

/** The body with comments removed, so a check named in a comment does not count as a check. */
const code = (body: string) => body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const handing = routes().filter((r) => HANDS_OVER.some((call) => code(r.body).includes(call)));

describe('who a counter hands goods to', () => {
  it('read the controller at all — a guard that saw nothing proves nothing', () => {
    expect(handing.map((r) => r.key).sort()).toEqual(['POST parcels/handover', 'POST totes/:code/load']);
  });

  it('asks what the counter was shown before every handing-over, on every path through the route', () => {
    const open: string[] = [];
    for (const r of handing) {
      const body = code(r.body);
      for (const call of HANDS_OVER) {
        let at = body.indexOf(call);
        while (at >= 0) {
          // The statement the call sits in, and what came before it in the route.
          const before = body.slice(0, at);
          const statement = body.slice(before.lastIndexOf('\n'), body.indexOf('\n', at) < 0 ? undefined : body.indexOf('\n', at));
          const proven = statement.includes('badgeShown(') || /const driverBadgeId = this\.fleet\.badgeShown\(/.test(before) || /return this\.mdps\.loadBag\(code, own\)/.test(statement);
          if (!proven) open.push(`${r.key}: ${statement.trim()}`);
          at = body.indexOf(call, at + 1);
        }
      }
    }
    expect(open).toEqual([]);
  });

  it('never hands over on the badge as it came in the body', () => {
    const raw = handing.filter((r) => /(handover|loadBag)\([^)]*dto\.driverBadgeId\)/.test(code(r.body).replace(/badgeShown\(dto\.driverBadgeId\)/g, ''))).map((r) => r.key);
    expect(raw).toEqual([]);
  });

  it('a driver loading a bag themselves loads it onto their own badge', () => {
    const load = handing.find((r) => r.key === 'POST totes/:code/load')!;
    const body = code(load.body);
    expect(body).toMatch(/actor\?\.role === 'driver'/);
    expect(body).toMatch(/this\.drivers\.get\(actor\.did\)\.badgeId/);
    expect(body).toMatch(/!== own\) throw/);
  });
});
