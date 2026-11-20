import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { STAFF_AREAS } from '../../foundation/auth/staff-areas.table';
import { PartnerLedgerService, type PartnerOwedLine } from './partner-ledger.service';
import { PartnerChecksService, findFlags, readReview, reviewInput, reviewRequest, REVIEW_MODEL, type CheckWorld } from './partner-checks.service';

/*
 * 2026-11-20 — CHECKS ON THE PARTNER'S FIGURES (the payments plan, 3b; the owner: "We also need AI anti fraud scrutiny on the
 * figures"). What is held to here: the fixed rules — a step owed twice, pay for a parcel the hand never held, a shop's own
 * parcels, amounts off the partner's list, unusual volumes — each finding once, with its figures, for staff to look at and
 * close by name; and the daily AI review, which is shown tokens and never a name, a phone number or an id, whose answer is read
 * back with its tokens put back, which says when it is not set up or did not finish, and which staff may ask for once an hour.
 */
const P = 'partner-et-addis-courier';
const T0 = Date.parse('2026-11-20T10:00:00Z');
const H = 3_600_000;
const D = 24 * H;
let seq = 0;
const line = (over: Partial<PartnerOwedLine>): PartnerOwedLine => ({
  lineId: `po_${++seq}`,
  partnerEntityId: P,
  partnerName: 'Addis Courier PLC',
  country: 'ET',
  payeeId: 'did:glos:shop-bole',
  payeeKind: 'shop',
  amount: 40,
  currency: 'ETB',
  reference: 'PUD-1',
  refType: 'parcel',
  step: 'labour',
  work: 'take_in',
  listed: 40,
  at: new Date(T0).toISOString(),
  ...over,
});
const heldBy = (...holders: Array<[string, string]>) => ({ custody: holders.map(([holderKind, holderId]) => ({ holderKind, holderId })) });
const world = (parcels: Record<string, ReturnType<CheckWorld['parcel']>> = {}, phones: Record<string, string> = {}): CheckWorld => ({
  parcel: (id) => parcels[id],
  shopPhoneHash: (did) => phones[did],
  hubName: (mdpId) => (mdpId === 'mdp_addis' ? 'Addis Sort' : undefined),
});
const rules = (lines: PartnerOwedLine[], w: CheckWorld = world({ 'PUD-1': heldBy(['shop', 'did:glos:shop-bole']) }), now = T0) => findFlags(lines, w, now);

describe('the fixed rules', () => {
  it('a step owed twice: the same work for the same parcel — urgent, with how many times; not once taken back', () => {
    const a = line({});
    const b = line({ at: new Date(T0 + H).toISOString() });
    expect(rules([a, b]).filter((f) => f.rule === 'twice')).toEqual([{ key: 'twice|did:glos:shop-bole|take_in|PUD-1', rule: 'twice', payeeId: 'did:glos:shop-bole', payeeKind: 'shop', lineIds: [a.lineId, b.lineId], facts: { work: 'take_in', reference: 'PUD-1', times: 2 }, severity: 'urgent' }]);
    const back = line({ amount: -40, undoes: b.lineId, at: new Date(T0 + 2 * H).toISOString() });
    expect(rules([a, b, back]).filter((f) => f.rule === 'twice')).toEqual([]);
    // Two different works on one parcel are not a step owed twice.
    expect(rules([a, line({ work: 'shelving' })]).filter((f) => f.rule === 'twice')).toEqual([]);
  });

  it('a bag’s code comes round again: twice within a day is owed twice, a trip three days later is not', () => {
    const road = (at: number) => line({ payeeId: 'did:glos:courier', payeeKind: 'driver', step: 'haul', work: 'road', reference: 'BAG-7', refType: 'bag', listed: undefined, amount: 300, at: new Date(at).toISOString() });
    expect(rules([road(T0), road(T0 + 2 * H)]).find((f) => f.rule === 'twice')).toMatchObject({ key: 'twice|did:glos:courier|road|BAG-7|2026-11-20', facts: { times: 2 } });
    expect(rules([road(T0 - 3 * D), road(T0)]).filter((f) => f.rule === 'twice')).toEqual([]);
  });

  it('paid for a parcel it never held — by a shop or at a hub, or a parcel not on record — and nothing where the chain names it', () => {
    const w = world({ 'PUD-1': heldBy(['shop', 'did:glos:shop-piassa']), 'PUD-2': heldBy(['shop', 'did:glos:shop-bole'], ['hub', 'Addis Sort']), 'PUD-3': heldBy(['shop', 'did:glos:shop-bole']) });
    const found = rules([line({}), line({ reference: 'PUD-2' }), line({ reference: 'PUD-9' }), line({ payeeId: 'mdp_addis', payeeKind: 'hub', step: 'sort', work: 'sort', refType: 'mdp', reference: 'PUD-2' }), line({ payeeId: 'mdp_addis', payeeKind: 'hub', step: 'sort', work: 'sort', refType: 'mdp', reference: 'PUD-3' })], w).filter((f) => f.rule === 'never_held');
    expect(found.map((f) => [f.payeeId, f.facts.reference, f.facts.missing ?? false, f.severity])).toEqual([
      ['did:glos:shop-bole', 'PUD-1', false, 'urgent'],
      ['did:glos:shop-bole', 'PUD-9', true, 'urgent'],
      ['mdp_addis', 'PUD-3', false, 'urgent'],
    ]);
    // A parcel whose chain was never kept: no finding made of an absence.
    expect(rules([line({})], world({ 'PUD-1': {} })).filter((f) => f.rule === 'never_held')).toEqual([]);
  });

  it('a shop’s own parcels — on its own number, or sent to the number they came from — once a day per shop, counted', () => {
    const w = world(
      { 'PUD-1': { ...heldBy(['shop', 'did:glos:shop-bole']), senderPhoneHash: 'ph-shop' }, 'PUD-2': { ...heldBy(['shop', 'did:glos:shop-bole']), senderPhoneHash: 'ph-a', receiverPhoneHash: 'ph-a' }, 'PUD-3': { ...heldBy(['shop', 'did:glos:shop-bole']), senderPhoneHash: 'ph-a', receiverPhoneHash: 'ph-b' } },
      { 'did:glos:shop-bole': 'ph-shop' },
    );
    const found = rules([line({}), line({ reference: 'PUD-2' }), line({ reference: 'PUD-3' }), line({ work: 'release', reference: 'PUD-1' })], w).filter((f) => f.rule === 'own_parcels');
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ key: 'own_parcels|did:glos:shop-bole|2026-11-20', payeeKind: 'shop', facts: { day: '2026-11-20', count: 2, parcels: ['PUD-1', 'PUD-2'] }, severity: 'look' });
    expect(found[0].lineIds).toHaveLength(3);
  });

  it('off the partner’s list: more than twice its own figure for the work, when it was owed — said with both figures', () => {
    const over = line({ amount: 81 });
    expect(rules([over, line({ reference: 'PUD-1', work: 'shelving', amount: 80 })]).filter((f) => f.rule === 'off_list')).toEqual([
      { key: `off_list|${over.lineId}`, rule: 'off_list', payeeId: 'did:glos:shop-bole', payeeKind: 'shop', lineIds: [over.lineId], facts: { work: 'take_in', reference: 'PUD-1', amount: 81, listed: 40, currency: 'ETB' }, severity: 'look' },
    ]);
    // No list figure (a road, a hub's receiving): nothing to read it against.
    expect(rules([line({ work: 'road', listed: undefined, amount: 9999 })]).filter((f) => f.rule === 'off_list')).toEqual([]);
  });

  it('unusual volume: three times a hand’s usual and at least ten — or thirty on a first day', () => {
    const days = (n: number, perDay: number, dayAt: number) => Array.from({ length: perDay }, (_, i) => line({ reference: `P-${n}-${i}`, at: new Date(dayAt + i * 60_000).toISOString() }));
    const history = [1, 2, 3, 4, 5, 6, 7].flatMap((n) => days(n, 5, T0 - n * D));
    const today = (perDay: number) => days(0, perDay, T0 - 5 * H);
    expect(rules([...history, ...today(15)], world()).find((f) => f.rule === 'volume')).toMatchObject({ key: 'volume|did:glos:shop-bole|2026-11-20', facts: { day: '2026-11-20', count: 15, usual: 5 }, severity: 'look' });
    expect(rules([...history, ...today(14)], world()).filter((f) => f.rule === 'volume')).toEqual([]);
    expect(rules(today(30), world()).find((f) => f.rule === 'volume')?.facts).toEqual({ day: '2026-11-20', count: 30 });
    expect(rules(today(29), world()).filter((f) => f.rule === 'volume')).toEqual([]);
  });
});

describe('what the AI review is shown, and how its answer is read', () => {
  const lines = [line({}), line({ payeeId: 'mdp_addis', payeeKind: 'hub', step: 'sort', work: 'sort', refType: 'mdp', reference: 'PUD-1', amount: 25, listed: 25 }), line({ payeeId: 'did:glos:courier-abebe', payeeKind: 'driver', step: 'haul', work: 'road', reference: 'BAG-7', refType: 'bag', amount: 300, listed: undefined })];

  it('tokens only: never a name, a phone number or an id — the figures, the hours, and what was raised already', () => {
    const input = reviewInput(lines, [{ rule: 'twice', payeeId: 'mdp_addis' }], { take_in: 40 }, 'ETB');
    for (const id of ['did:glos', 'shop-bole', 'mdp_addis', 'courier-abebe', 'PUD-1', 'BAG-7', 'Addis Courier']) expect(input.text).not.toContain(id);
    const shown = JSON.parse(input.text);
    expect(shown.rows).toEqual([
      ['2026-11-20', 10, 'H1', 'shop', 'take_in', 'R1', 40, 40, false],
      ['2026-11-20', 10, 'H2', 'hub', 'sort', 'R1', 25, 25, false],
      ['2026-11-20', 10, 'H3', 'driver', 'road', 'R2', 300, null, false],
    ]);
    expect(shown).toMatchObject({ currency: 'ETB', list: { take_in: 40 }, truncated: false, alreadyFlagged: [{ rule: 'twice', hand: 'H2' }] });
    expect(input.hands.get('H3')).toBe('did:glos:courier-abebe');
    expect(input.refs.get('R2')).toBe('BAG-7');
  });

  it('one request a day: the adviser’s model, held to the schema, the figures as the only message', () => {
    const request = reviewRequest('{"rows":[]}');
    expect(request).toMatchObject({ model: REVIEW_MODEL, messages: [{ role: 'user', content: '{"rows":[]}' }], output_config: { effort: 'medium', format: { type: 'json_schema' } } });
    expect(REVIEW_MODEL).toBe('claude-opus-5-5');
    expect(JSON.stringify(request.output_config)).toContain('"required":["hand","reason","severity"]');
  });

  it('its answer read back with the tokens put back; a token it made up dropped; a refusal, a cut-off or nonsense said as that', () => {
    const { hands, refs } = reviewInput(lines, [], {}, 'ETB');
    const text = (flags: unknown) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ flags }) }] }) as never;
    expect(readReview(text([{ hand: 'H3', reason: 'H3 was paid 300 for R2 at 03:00.', severity: 'urgent' }, { hand: 'H9', reason: 'made up', severity: 'look' }]), hands, refs)).toEqual({
      flags: [{ payeeId: 'did:glos:courier-abebe', reason: 'did:glos:courier-abebe was paid 300 for BAG-7 at 03:00.', severity: 'urgent' }],
    });
    expect(readReview({ stop_reason: 'refusal', content: [] } as never, hands)).toEqual({ why: 'refused' });
    expect(readReview({ stop_reason: 'max_tokens', content: [] } as never, hands)).toEqual({ why: 'cut_short' });
    expect(readReview({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'not json' }] } as never, hands)).toEqual({ why: 'unreadable' });
    expect(readReview(text([]), hands)).toEqual({ flags: [] });
  });
});

describe('kept for staff', () => {
  function aService(claude?: { configured: () => boolean; create: (r: unknown) => Promise<unknown> }) {
    const presence = { resolve: (c: string) => ({ level: c === 'ET' ? 'partnered' : 'established' }) };
    const partner = { entityId: P, name: 'Addis Courier PLC', kind: 'partner', jurisdiction: 'ET', currency: 'ETB' };
    const entities = { partnerFor: () => partner, amountsFor: () => ({ currency: 'ETB', labourFee: 40, shelvingFee: 30, releaseFee: 20, handoverFee: 10, mdpSortFee: 25, mdpPassOnFee: 15, toteLoadFee: 5 }), get: () => partner };
    const ledger = new PartnerLedgerService(presence as never, entities as never);
    const parcels = { get: (id: string) => (id === 'PUD-1' ? heldBy(['shop', 'did:glos:shop-bole']) : (() => { throw new Error('no parcel'); })()) };
    const agents = { get: () => ({ phoneHash: 'ph-shop' }) };
    const mdps = { require: () => ({ name: 'Addis Sort' }) };
    const checks = new PartnerChecksService(ledger, entities as never, parcels as never, agents as never, mdps as never, claude as never);
    const owe = (reference: string, at: number) => ledger.owe({ country: 'ET', payeeId: 'did:glos:shop-bole', payeeKind: 'shop', amount: 40, reference, refType: 'parcel', step: 'labour', work: 'take_in' }, at);
    return { checks, ledger, owe };
  }

  it('each finding once; looked at by name, with what was found; reopened only when something new is in it', () => {
    const { checks, ledger, owe } = aService();
    owe('PUD-1', T0);
    owe('PUD-1', T0 + H);
    // Each line keeps which work it was and what the partner's list said for it then: what "off the list" is read against.
    expect(ledger.linesOf(P)[0]).toMatchObject({ work: 'take_in', listed: 40 });
    const first = checks.check(P, T0 + 2 * H);
    expect(first.map((f) => f.rule)).toEqual(['twice']);
    expect(checks.check(P, T0 + 3 * H)).toEqual([]);
    const flag = checks.checksOf(P).open[0];
    expect(flag).toMatchObject({ rule: 'twice', payeeId: 'did:glos:shop-bole', facts: { times: 2 }, severity: 'urgent' });
    expect(checks.markLooked(P, flag.flagId, 'Amina Otieno', '  The shop scanned it twice on a bad line.  ', T0 + 4 * H).looked).toEqual({ by: 'Amina Otieno', at: new Date(T0 + 4 * H).toISOString(), note: 'The shop scanned it twice on a bad line.' });
    expect(checks.checksOf(P)).toMatchObject({ open: [], looked: [{ flagId: flag.flagId }] });
    expect(() => checks.markLooked(P, 'pf_nothing', 'Amina Otieno')).toThrow(/no such finding/);
    // A third time: something new in it — open again, with the figure it has now.
    owe('PUD-1', T0 + 5 * H);
    expect(checks.check(P, T0 + 6 * H)).toHaveLength(1);
    expect(checks.checksOf(P).open[0]).toMatchObject({ flagId: flag.flagId, facts: { times: 3 } });
    expect(checks.checksOf(P).open[0].looked).toBeUndefined();
  });

  it('the AI review not set up: said so, and nothing is sent', async () => {
    const asked: unknown[] = [];
    const { checks, owe } = aService({ configured: () => false, create: async (r) => void asked.push(r) });
    owe('PUD-1', T0);
    expect(await checks.review(P, T0 + H)).toMatchObject({ state: 'off', flags: 0, day: '2026-11-20' });
    expect(asked).toEqual([]);
    expect(checks.checksOf(P)).toMatchObject({ aiReady: false, review: { state: 'off' } });
  });

  it('the AI review: tokens sent, its findings kept for staff in its own words — once a day, and staff may ask again only after an hour', async () => {
    const asked: Array<{ messages: Array<{ content: string }> }> = [];
    const { checks, owe } = aService({
      configured: () => true,
      create: async (r) => {
        asked.push(r as never);
        return { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ flags: [{ hand: 'H1', reason: 'H1 took in R1 and R2 at 02:00, when shops are shut.', severity: 'look' }] }) }] };
      },
    });
    owe('PUD-1', T0);
    owe('PUD-2', T0);
    await checks.due(T0 + H);
    expect(asked).toHaveLength(1);
    expect(asked[0].messages[0].content).not.toContain('did:glos');
    expect(asked[0].messages[0].content).not.toContain('PUD-');
    const view = checks.checksOf(P);
    expect(view.review).toMatchObject({ state: 'done', flags: 1, rows: 2 });
    expect(view.open.find((f) => f.rule === 'ai')).toMatchObject({ payeeId: 'did:glos:shop-bole', payeeKind: 'shop', reason: 'did:glos:shop-bole took in PUD-1 and PUD-2 at 02:00, when shops are shut.', severity: 'look' });
    // The same day again: no second review.
    await checks.due(T0 + 2 * H);
    expect(asked).toHaveLength(1);
    // Asked by staff: refused within the hour, run after it.
    await expect(checks.review(P, T0 + H + 30 * 60_000, { asked: true })).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    await checks.review(P, T0 + 3 * H, { asked: true });
    expect(asked).toHaveLength(2);
  });

  it('a review that does not reach the model is said as that — never a provider’s words in front of staff', async () => {
    const { checks, owe } = aService({ configured: () => true, create: async () => Promise.reject(new Error('socket hang up at api.example')) });
    owe('PUD-1', T0);
    const row = await checks.review(P, T0 + H);
    expect(row).toMatchObject({ state: 'failed', why: 'unreachable', flags: 0 });
    expect(JSON.stringify(checks.checksOf(P))).not.toContain('socket');
  });
});

describe('wired', () => {
  const read = (...p: string[]) => readFileSync(join(__dirname, ...p), 'utf8');

  it('read and closed by staff who keep the money; the checks run in the app', () => {
    for (const route of ['GET sbg/entities/:entityId/partner-checks', 'POST sbg/entities/:entityId/partner-checks/:flagId/looked', 'POST sbg/entities/:entityId/partner-checks/review']) expect(STAFF_AREAS[route]).toBe('money');
    const doors = read('partner-ledger.controller.ts');
    expect(doors).toMatch(/@Roles\('operator'\)\s*@Get\('entities\/:entityId\/partner-checks'\)/);
    expect(doors).toMatch(/@Roles\('operator'\)\s*@Post\('entities\/:entityId\/partner-checks\/:flagId\/looked'\)[\s\S]{0,300}auditActor\(actor\)/);
    expect(doors).toMatch(/@Roles\('operator'\)\s*@Post\('entities\/:entityId\/partner-checks\/review'\)[\s\S]{0,300}\{ asked: true \}/);
    expect(read('pudo.module.ts')).toMatch(/PartnerLedgerService, PartnerChecksService,/);
  });

  it('every shop step says which work it was, and a driver’s road and bag the bag it was for', () => {
    const parcels = read('parcel.service.ts');
    expect(parcels).toMatch(/payShelving[\s\S]{0,1500}this\.gate\.payLabour\(agentDid, pay, parcel\.parcelId, 'parcel', parcel\.sellerEntityId, 'shelving'\);/);
    expect(parcels).toMatch(/payRelease[\s\S]{0,400}this\.gate\.payLabour\(agentDid, pay, parcel\.parcelId, 'parcel', parcel\.sellerEntityId, 'release'\);/);
    expect(parcels.match(/'parcel', parcel\.sellerEntityId, 'take_in'\);/g)).toHaveLength(4);
    expect(parcels).toMatch(/manifestId, 'manifest', undefined, 'handover'\);/);
    expect(parcels).toMatch(/this\.gate\.owedByPartner\(input\.agentDid, pay, parcel\.parcelId, 'parcel', 'take_in'\)/);
    expect(parcels.match(/this\.gate\.clawbackLabour\([^;]*'take_in'\);/g)).toHaveLength(2);
    expect(parcels).toMatch(/this\.gate\.clawbackLabour\([^;]*'shelving'\);/);
    for (const f of ['return.service.ts', 'unclaimed.service.ts', 'business-door.service.ts']) expect(read(f)).toMatch(/this\.gate\.payLabour\([^;]*'holding'\);/);
    const hubs = read('mdp.service.ts');
    expect(hubs).toMatch(/this\.gate\.driverPayout\(driverDid, left, \{ work: 'road', reference: tote\.code \}\);/);
    expect(hubs.match(/this\.gate\.payBagLoad\([^;]*tote\.code\)/g)).toHaveLength(2);
  });
});
