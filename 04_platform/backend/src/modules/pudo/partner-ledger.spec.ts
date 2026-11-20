import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GlosEvent } from '../../foundation/events/glos-events';
import { PartnerLedgerService } from './partner-ledger.service';
import { WalletGateService } from './wallet-gate.service';
import { STAFF_AREAS } from '../../foundation/auth/staff-areas.table';

/*
 * 2026-11-20 — WHAT THE PARTNER OWES, STEP BY STEP (the payments plan, 3a; the owner: "Option A, but fully automated", "the
 * partner's own list", the hands see it "named"). What is held to here: in a Partnered country, with its partner switched on,
 * every step no company of ours pays for — a shop's work, a hub's sort, receiving or passing a bag on, a driver's road — is owed
 * by the partner to whoever is paid for it (a fleet for its driver), in the partner's money, on the hand's own row with the
 * partner's name, and never on our books; nothing anywhere else, or for nothing; and every rate of such a step is the
 * partner's own list.
 */
const PARTNER = { entityId: 'partner-et-addis-courier', name: 'Addis Courier PLC', kind: 'partner', jurisdiction: 'ET', currency: 'ETB', status: 'active' };

function aWorld(opts: { level?: string; partnerOn?: boolean } = {}) {
  const country = { level: opts.level ?? 'partnered' };
  const presence = { resolve: (c: string) => ({ level: c === 'ET' ? country.level : 'established' }) };
  const entities = {
    partnerFor: (c: string) => (c === 'ET' && opts.partnerOn !== false ? PARTNER : undefined),
    amountsFor: (id?: string) => (id === PARTNER.entityId ? { currency: 'ETB' } : { currency: 'KES' }),
    get: (id: string) => (id === PARTNER.entityId ? PARTNER : { entityId: id, name: id, kind: 'sister' }),
  };
  const told: Array<[string, Record<string, unknown>]> = [];
  const events = { publish: async (name: string, payload: Record<string, unknown>) => void told.push([name, payload]) };
  const ledger = new PartnerLedgerService(presence as never, entities as never, events as never);
  const posted: unknown[] = [];
  const books = { post: (e: unknown) => (posted.push(e), { entryId: `je_${posted.length}` }), entry: () => ({ currency: 'KES' }) };
  const agents = { get: (did: string) => ({ did }), entityIdOrNone: (a: { did: string }) => (a.did.includes('ours') ? 'sbg-et' : undefined), countryOf: (a: { did: string }) => (a.did.includes('kampala') ? 'UG' : 'ET') };
  const drivers = { payeeOrNone: (id: string) => ({ payeeDid: id.includes('fleet-driver') ? 'did:glos:fleet-addis' : id }), countryOfWork: () => 'ET' };
  const gate = new WalletGateService({} as never, agents as never, events as never, books as never, entities as never, {} as never, drivers as never, ledger);
  return { gate, ledger, told, posted, country };
}

describe('what the partner owes, step by step', () => {
  it('a shop’s step under the partner’s promise: owed by the partner, in its money, named on the shop’s own row — none of it on our books', () => {
    const w = aWorld();
    const row = w.gate.payLabour('did:glos:shop-addis', 40, 'PUD-1', 'parcel');
    expect(row).toMatchObject({ type: 'LABOR_PAYOUT', sign: '+', amount: 40, currency: 'ETB', did: 'did:glos:shop-addis', reference: 'PUD-1', owedBy: { entityId: PARTNER.entityId, name: 'Addis Courier PLC' } });
    expect(row?.entryId).toBeUndefined();
    expect(w.posted).toEqual([]);
    const view = w.ledger.ledgerOf(PARTNER.entityId);
    expect(view).toMatchObject({ partnerName: 'Addis Courier PLC', currency: 'ETB', owed: 40, byPayee: [{ payeeId: 'did:glos:shop-addis', payeeKind: 'shop', amount: 40, steps: 1 }] });
    expect(view.lines[0]).toMatchObject({ step: 'labour', reference: 'PUD-1', amount: 40, currency: 'ETB' });
    expect(w.told.map(([name]) => name)).toContain(GlosEvent.Pudo.PartnerOwed);
  });

  it('a hub’s sort and a bag passed on, a courier’s road and a fleet driver’s — each owed to whoever is paid for it', () => {
    const w = aWorld();
    w.gate.sortLabour('mdp_addis', 25, 'PUD-1', undefined, undefined, 'ET');
    w.gate.passOnLabour('mdp_addis', 15, 'BAG-1', undefined, 'ET');
    w.gate.receivingLabour('mdp_addis', 10, 'ARR-1', undefined, undefined, 'ET');
    w.gate.driverPayout('did:glos:courier-addis', 300);
    w.gate.driverPayout('did:glos:fleet-driver-1', 200);
    const view = w.ledger.ledgerOf(PARTNER.entityId);
    expect(view.owed).toBe(550);
    expect(view.byPayee).toEqual([
      { payeeId: 'did:glos:courier-addis', payeeKind: 'driver', amount: 300, steps: 1 },
      { payeeId: 'did:glos:fleet-addis', payeeKind: 'fleet', amount: 200, steps: 1 },
      { payeeId: 'mdp_addis', payeeKind: 'hub', amount: 50, steps: 3 },
    ]);
    expect(view.lines.map((l) => l.step).sort()).toEqual(['haul', 'haul', 'pass_on', 'receiving', 'sort']);
    expect(w.posted).toEqual([]);
  });

  it('nothing where no partner contracts — a country only Matched, a partner still switched off — and nothing for nothing', () => {
    const matched = aWorld({ level: 'matched' });
    expect(matched.gate.payLabour('did:glos:shop-addis', 40, 'PUD-1', 'parcel')).toBeNull();
    expect(matched.gate.driverPayout('did:glos:courier-addis', 300)).toBeNull();
    expect(matched.gate.sortLabour('mdp_addis', 25, 'PUD-1', undefined, undefined, 'ET').owedBy).toBeUndefined();
    expect(matched.ledger.owedTo(['did:glos:shop-addis', 'mdp_addis', 'did:glos:courier-addis'])).toEqual({ lines: [] });
    const off = aWorld({ partnerOn: false });
    expect(off.gate.payLabour('did:glos:shop-addis', 40, 'PUD-1', 'parcel')).toBeNull();
    const w = aWorld();
    expect(w.gate.payLabour('did:glos:shop-addis', 0, 'PUD-1', 'parcel')).toBeNull();
    expect(w.ledger.owe({ country: 'ET', payeeId: 'did:glos:shop-addis', payeeKind: 'shop', amount: 0, reference: 'PUD-1', refType: 'parcel', step: 'labour' })).toBeUndefined();
    expect(w.ledger.owe({ country: 'ET', payeeId: '', payeeKind: 'shop', amount: 5, reference: 'PUD-1', refType: 'parcel', step: 'labour' })).toBeUndefined();
    expect(w.gate.payLabour('did:glos:shop-kampala', 40, 'PUD-2', 'parcel')).toBeNull();
    expect(w.ledger.ledgerOf(PARTNER.entityId).owed).toBe(0);
  });

  it('a step a company of ours sold is paid as before, on our books — never owed by the partner', () => {
    const w = aWorld();
    const row = w.gate.payLabour('did:glos:shop-addis', 40, 'PUD-3', 'parcel', 'sbg-ke');
    expect(row?.owedBy).toBeUndefined();
    expect(w.posted).toHaveLength(1);
    expect(w.ledger.ledgerOf(PARTNER.entityId).owed).toBe(0);
  });

  it('a step undone — a parcel voided or called off at the shop — is taken back as a line of its own, once, and never what was not owed', () => {
    const w = aWorld();
    w.gate.payLabour('did:glos:shop-addis', 40, 'PUD-1', 'parcel');
    const back = w.gate.clawbackLabour('did:glos:shop-addis', 40, 'PUD-1');
    expect(back).toMatchObject({ type: 'LABOR_PAYOUT', sign: '-', amount: 40, currency: 'ETB', did: 'did:glos:shop-addis', reference: 'PUD-1', owedBy: { entityId: PARTNER.entityId, name: 'Addis Courier PLC' } });
    expect(back?.entryId).toBeUndefined();
    expect(w.posted).toEqual([]);
    const view = w.ledger.ledgerOf(PARTNER.entityId);
    expect(view.owed).toBe(0);
    expect(view.byPayee).toEqual([]);
    expect(view.lines.map((l) => [l.amount, l.takenBack ?? false]).sort()).toEqual([[-40, true], [40, false]]);
    // Once only; never another parcel (while one is still owed), nor another amount.
    expect(w.gate.clawbackLabour('did:glos:shop-addis', 40, 'PUD-1')).toBeNull();
    w.gate.payLabour('did:glos:shop-addis', 40, 'PUD-2', 'parcel');
    expect(w.gate.clawbackLabour('did:glos:shop-addis', 40, 'PUD-9')).toBeNull();
    expect(w.gate.clawbackLabour('did:glos:shop-addis', 25, 'PUD-2')).toBeNull();
    expect(w.ledger.ledgerOf(PARTNER.entityId).byPayee).toEqual([{ payeeId: 'did:glos:shop-addis', payeeKind: 'shop', amount: 40, steps: 1 }]);
    // A country moved off Partnered since still takes back what its partner owed.
    w.country.level = 'matched';
    expect(w.gate.clawbackLabour('did:glos:shop-addis', 40, 'PUD-2')?.sign).toBe('-');
    expect(w.ledger.owedTo(['did:glos:shop-addis']).totals).toEqual([{ partnerName: 'Addis Courier PLC', currency: 'ETB', amount: 0 }]);
  });

  it('a void takes back the very work undone: the take-in, never the shelving of the same amount (3b)', () => {
    const w = aWorld();
    w.gate.payLabour('did:glos:shop-addis', 40, 'PUD-5', 'parcel', undefined, 'take_in');
    w.gate.payLabour('did:glos:shop-addis', 40, 'PUD-5', 'parcel', undefined, 'shelving');
    w.gate.clawbackLabour('did:glos:shop-addis', 40, 'PUD-5', undefined, 'shelving');
    const lines = w.ledger.ledgerOf(PARTNER.entityId).lines;
    expect(lines.filter((l) => l.takenBack).map((l) => l.work)).toEqual(['shelving']);
    expect(lines.map((l) => l.work).sort()).toEqual(['shelving', 'shelving', 'take_in']);
  });

  it('never a road a company of ours was paid for, nor staff’s own settlement, nor a shop a company of ours stands behind', () => {
    const w = aWorld();
    expect(w.gate.driverPayout('did:glos:courier-addis', 300, { ours: true })).toBeNull();
    expect(w.gate.owedByPartner('did:glos:shop-ours', 40, 'PUD-1', 'parcel')).toBeNull();
    expect(w.ledger.ledgerOf(PARTNER.entityId).owed).toBe(0);
    expect(w.told).toEqual([]);
  });

  it('a hand reads its own, the partner named, its total in the partner’s money', () => {
    const w = aWorld();
    w.gate.payLabour('did:glos:shop-addis', 40, 'PUD-1', 'parcel');
    w.gate.payLabour('did:glos:shop-addis', 12.5, 'PUD-2', 'parcel');
    w.gate.payLabour('did:glos:shop-bole', 40, 'PUD-3', 'parcel');
    const mine = w.ledger.owedTo(['did:glos:shop-addis']);
    expect(mine.lines.map((l) => l.reference).sort()).toEqual(['PUD-1', 'PUD-2']);
    expect(mine.totals).toEqual([{ partnerName: 'Addis Courier PLC', currency: 'ETB', amount: 52.5 }]);
  });
});

describe('wired', () => {
  const read = (...p: string[]) => readFileSync(join(__dirname, ...p), 'utf8');

  it('every rate of such a step is the partner’s own list: a shop’s, a driver’s, a hub’s', () => {
    expect(read('parcel.service.ts')).toMatch(/return this\.entities\.amountsFor\(own \?\? sellerEntityId \?\? this\.partners\?\.ratesEntityAt\(country\)\);/);
    expect(read('driver.service.ts')).toMatch(/this\.entities\.amountsFor\(this\.payeeOrNone\(did\)\.entityId \?\? this\.partners\?\.ratesEntityAt\(this\.countryOfWork\(did\)\)\)/);
    const hubs = read('mdp.service.ts');
    expect(hubs).toMatch(/const list = this\.entities\.amountsFor\(entityId \?\? this\.partners\?\.ratesEntityAt\(this\.countryOf\(mdp\)\)\);/);
    expect(hubs).toMatch(/pricePerParcel: input\.pricePerParcel \?\? this\.entities\.amountsFor\(entity\?\.entityId \?\? this\.partners\?\.ratesEntityAt\(country\)\)\.mdpSortFee/);
  });

  it('a load billed by a company of ours, and staff’s own settlement, say so: never the partner’s to owe', () => {
    expect(read('dispatch.service.ts')).toMatch(/this\.gate\.driverPayout\(f\.claimedBy, f\.lockedPrice, \{ ours: true \}\)/);
    expect(read('pudo.controller.ts')).toMatch(/return this\.gate\.driverPayout\(dto\.driverId, dto\.amount, \{ ours: true \}\);/);
  });

  it('every hub step says the hub’s country, so the partner there is found', () => {
    const hubs = read('mdp.service.ts');
    expect(hubs.match(/this\.gate\.sortLabour\([^;]*this\.countryOf\(hub\)\);/g)).toHaveLength(2);
    expect(hubs).toMatch(/this\.gate\.passOnLabour\([^;]*this\.countryOf\(mdp\)\);/);
    expect(read('hub-arrival.service.ts')).toMatch(/this\.gate\.receivingLabour\([^;]*this\.mdps\.countryOf\(hub\)\);/);
  });

  it('4c — what a payout has paid is marked: each line paid, and per partner what of the total the hand has been paid', () => {
    const w = aWorld();
    w.gate.payLabour('did:glos:shop-addis', 40, 'PUD-1', 'parcel');
    w.gate.payLabour('did:glos:shop-addis', 25, 'PUD-2', 'parcel');
    const [second, first] = w.ledger.owedTo(['did:glos:shop-addis']).lines;
    const paid = new Set([first.lineId]);
    const mine = w.ledger.owedTo(['did:glos:shop-addis'], paid);
    expect(mine.lines.find((l) => l.lineId === first.lineId)?.paid).toBe(true);
    expect(mine.lines.find((l) => l.lineId === second.lineId)?.paid).toBeUndefined();
    expect(mine.totals).toEqual([{ partnerName: 'Addis Courier PLC', currency: 'ETB', amount: 65, paid: first.amount }]);
    // Our staff, and the partner, read the same marks on its record.
    expect(w.ledger.ledgerOf(PARTNER.entityId, { paidLineIds: paid }).lines.filter((l) => l.paid).map((l) => l.lineId)).toEqual([first.lineId]);
    // Nothing paid: nothing said of it.
    expect(w.ledger.owedTo(['did:glos:shop-addis']).totals?.[0].paid).toBeUndefined();
  });

  it('its record is read by staff who keep the money; a hand reads its own', () => {
    expect(STAFF_AREAS['GET sbg/entities/:entityId/partner-owed']).toBe('money');
    expect(STAFF_AREAS['GET sbg/partner-owed/mine']).toBe('none');
    const doors = read('partner-ledger.controller.ts');
    expect(doors).toMatch(/@Roles\('operator'\)\s*(@ApiQuery\([^\n]*\)\s*)?@Get\('entities\/:entityId\/partner-owed'\)/);
    expect(doors).toMatch(/@Roles\('agent', 'mdp', 'driver', 'fleet_manager'\)\s*@Get\('partner-owed\/mine'\)/);
  });
});
