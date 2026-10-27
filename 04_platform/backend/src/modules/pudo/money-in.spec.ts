import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * NO ROUTE CREATES MONEY. A CONFIRMED PAYMENT DOES.
 *
 * Rule 5 of the money model, decided 2026-08-14: *money is created only by an observed external event,
 * with a provider reference, verified and idempotent.* The outbound half has obeyed it since the payout
 * rail shipped. The inbound half did not, for a year: `POST agents/:did/top-up` called `gate.topUp` with
 * whatever number was in the body, and the books recorded cash the network could not prove it held.
 *
 * Fixing the two routes is not enough, because the next person to add a crediting route will not have read
 * this. So this is the census, in the shape of `route-owners.spec.ts`: it reads the controller and refuses
 * a handler that calls a method which puts money on somebody's balance. The only callers of those methods
 * are the registered `FundingPayer`s, and the only caller of THOSE is `FundingService.confirm` — which is
 * reached from a signed provider callback, or from a member of staff naming a statement line.
 *
 * It reads the source rather than the behaviour deliberately. A behavioural test proves this route is
 * honest today; this one refuses the route somebody adds next year.
 */
const CONTROLLER = join(__dirname, 'pudo.controller.ts');
const SOURCE = readFileSync(CONTROLLER, 'utf8');

/**
 * The methods that put money on a balance. Every one of them is reachable only through a confirmed
 * funding — adding a new one means adding it here, by somebody who read this.
 */
const CREDITS_MONEY = [
  'this.gate.topUp(',
  'this.gate.reverseTopUp(',
  'this.vendors.topUp(',
  'this.vendors.topUpConfirmed(',
  'this.vendors.reverseTopUp(',
  // A person's prepayment for one load to their door (2026-10-27): only FundingService.confirm reaches it.
  'this.doors.paid(',
  'this.doors.reversed(',
];

/** The body with comments stripped: a method named in a comment is prose, not a call. */
const code = (body: string) => body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

interface Route {
  key: string;
  body: string;
}

function routes(): Route[] {
  const lines = SOURCE.split('\n');
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

const found = routes();

describe('money is created by a confirmed payment, never by a request', () => {
  it('read the controller at all — a guard that saw nothing proves nothing', () => {
    expect(found.length).toBeGreaterThan(300);
    expect(found.some((r) => r.key === 'POST agents/:did/top-up')).toBe(true);
    expect(found.some((r) => r.key === 'POST vendors/:id/top-up')).toBe(true);
  });

  it('has no route that credits a balance directly', () => {
    const crediting = found.filter((r) => CREDITS_MONEY.some((m) => code(r.body).includes(m))).map((r) => r.key);
    expect(crediting).toEqual([]);
  });

  it('nor does the Send app: a person asks to be prompted for a payment, and the rail says when it came', () => {
    const identity = readFileSync(join(__dirname, 'identity.controller.ts'), 'utf8');
    expect(identity).toContain("@Post('parcels/:id/door')");
    expect(identity).not.toMatch(/\.paid\(|\.reversed\(/);
  });

  it('turns a top-up into a request for payment, not a payment', () => {
    // Both money-in routes must ASK. `funding.open` writes no journal entry — see funding.service.ts.
    for (const key of ['POST agents/:did/top-up', 'POST vendors/:id/top-up']) {
      const route = found.find((r) => r.key === key);
      expect(code(route!.body)).toContain('this.funding.open(');
    }
  });

  it('keeps the activation deposit with the people who hand over the kit', () => {
    // Not a payment rail's business — taken once, in person, by staff. But not the shop's own word either.
    const deposit = SOURCE.slice(SOURCE.indexOf("@Post('agents/:did/deposit')") - 200, SOURCE.indexOf("@Post('agents/:did/deposit')"));
    expect(deposit).toContain("@Roles('operator')");
  });
});

/**
 * And the other end of the same rule: the services that DO credit are reachable from one place.
 *
 * Read from the sources rather than asserted behaviourally, because the failure being guarded against is
 * somebody wiring a second caller — a seed script, a new service, a convenience helper — and behaviour
 * tests only ever see the callers that exist.
 */
describe('the credit path has one way in', () => {
  const PAYERS = readFileSync(join(__dirname, 'funding-payers.ts'), 'utf8');

  it('registers both payers against the funding service', () => {
    expect(PAYERS).toContain("this.funding.register('agent'");
    expect(PAYERS).toContain("this.funding.register('vendor'");
  });

  it('says in the crediting methods themselves that a rail calls them', () => {
    // A comment is not a guard. It is here because the next person to read `topUp` needs to know why it
    // is not the obvious entry point, and the census above is what actually holds the line.
    expect(PAYERS).toContain("this.funding.register('person'");
    for (const file of ['wallet-gate.service.ts', 'vendor.service.ts', 'person-door.service.ts']) {
      expect(readFileSync(join(__dirname, file), 'utf8')).toContain('A PAYMENT RAIL CALLS THIS');
    }
  });
});
