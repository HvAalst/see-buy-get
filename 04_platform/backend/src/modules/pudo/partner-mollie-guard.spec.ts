import type { MolliePartnerChange } from '../../foundation/mollie/mollie.types';
import { MollieController } from './mollie.controller';
import { PartnerChecksService } from './partner-checks.service';
import { PartnerLedgerService } from './partner-ledger.service';
import { PartnerMemberService } from './partner-member.service';

/*
 * 2026-11-26 — THE COUNTERS' MOLLIE ACCOUNT, GUARDED (the owner: "Go ahead"; the weakness: any member of a partner could connect or
 * swap it, a personal account too, and the counters' money would go there). Held to here: every member who joined is emailed when it
 * is connected or disconnected — who did it and whose account it is — never a member who was taken out or never said yes; our staff get
 * a check on the partner's page once per connection, urgent where it is another company's; and Mollie's notice about a counter's
 * payment reaches the payment hub, before anything else is asked to look for it.
 */
const P = 'partner-bg-sofia';
const T0 = Date.parse('2026-11-26T10:00:00Z');
const partner = { entityId: P, name: 'Sofia Partner OOD', kind: 'partner', jurisdiction: 'BG', currency: 'EUR' };

function aMollie() {
  const listeners: Array<(c: MolliePartnerChange) => void> = [];
  return { onPartnerChange: (l: (c: MolliePartnerChange) => void) => void listeners.push(l), tell: (c: MolliePartnerChange) => listeners.forEach((l) => l(c)) };
}

describe('every member is told when the counters’ Mollie account changes', () => {
  it('by email, who did it and whose account — only members who joined and are still in', async () => {
    const mollie = aMollie();
    const mails: Array<{ address: string; headline: string; what: string }> = [];
    const mail = { send: async (_k: string, to: { address: string }, p: { headline: string; what: string }) => (mails.push({ address: to.address, headline: p.headline, what: p.what }), true) };
    const persons = { onNumberLeft: () => undefined, findByDid: (did: string) => ({ personDid: did }), emailOf: (p: { personDid: string }) => `${p.personDid.split(':').pop()}@example.test` };
    const entities = { get: () => partner };
    const svc = new PartnerMemberService(entities as never, persons as never, {} as never, mollie as never, mail as never);
    const members = (svc as unknown as { members: Map<string, Record<string, unknown>> }).members;
    members.set('m1', { memberId: 'm1', entityId: P, personDid: 'did:person:elena', joinedAt: '2026-11-20T00:00:00Z', name: 'Elena Petrova' });
    members.set('m2', { memberId: 'm2', entityId: P, personDid: 'did:person:georgi', joinedAt: '2026-11-20T00:00:00Z', name: 'Georgi Ivanov' });
    members.set('m3', { memberId: 'm3', entityId: P, personDid: 'did:person:gone', joinedAt: '2026-11-20T00:00:00Z', removedAt: '2026-11-22T00:00:00Z', name: 'Gone' });
    members.set('m4', { memberId: 'm4', entityId: P, name: 'Invited only' });
    members.set('m5', { memberId: 'm5', entityId: 'partner-other', personDid: 'did:person:other', joinedAt: '2026-11-20T00:00:00Z', name: 'Other' });
    mollie.tell({ entityId: P, change: 'connected', by: 'Elena Petrova', organization: { id: 'org_x', name: 'Elena Petrova EOOD', registrationNumber: '999999999', address: {} }, at: new Date(T0).toISOString() });
    await Promise.resolve();
    expect(mails.map((m) => m.address).sort()).toEqual(['elena@example.test', 'georgi@example.test']);
    expect(mails[0]).toMatchObject({ headline: "Sofia Partner OOD: the counters' Mollie account was connected", what: 'Elena Petrova connected Elena Petrova EOOD, registration 999999999. From now on the money your counters take goes into it.' });
    mails.length = 0;
    mollie.tell({ entityId: P, change: 'disconnected', by: 'Georgi Ivanov', at: new Date(T0 + 1000).toISOString() });
    await Promise.resolve();
    expect(mails).toHaveLength(2);
    expect(mails[0].what).toBe('Georgi Ivanov disconnected a Mollie account. Your counters take test money until an account is connected again.');
  });
});

describe('our staff check it on the partner’s page', () => {
  const build = (same: 'yes' | 'no' | 'unknown', connectedAt = new Date(T0).toISOString()) => {
    const mollie = aMollie();
    const presence = { resolve: () => ({ level: 'partnered' }) };
    const entities = { partnerFor: () => partner, amountsFor: () => ({ currency: 'EUR' }), get: () => partner };
    const ledger = new PartnerLedgerService(presence as never, entities as never);
    let check: Record<string, unknown> | undefined = { organizationName: 'Elena Petrova EOOD', registrationNumber: '999999999', connectedBy: 'Elena Petrova', connectedAt, same };
    const hub = { kept: () => [], owners: () => [P], collectCheck: () => check };
    const checks = new PartnerChecksService(ledger, entities as never, {} as never, {} as never, {} as never, undefined, hub as never, { payoutsOf: () => [] } as never, { changesOf: () => [] } as never, mollie as never);
    return { checks, mollie, setCheck: (c: Record<string, unknown> | undefined) => (check = c) };
  };

  it('once per connection, at the moment it is connected: urgent where it is another company’s, to look at otherwise', () => {
    const { checks, mollie } = build('no');
    mollie.tell({ entityId: P, change: 'connected', by: 'Elena Petrova', at: new Date(T0).toISOString() });
    expect(checks.checksOf(P).open).toEqual([
      expect.objectContaining({ rule: 'mollie_account', payeeId: P, severity: 'urgent', facts: { organizationName: 'Elena Petrova EOOD', registrationNumber: '999999999', connectedBy: 'Elena Petrova', day: '2026-11-26', same: 'no' } }),
    ]);
    // Checked again: the same finding, not a second one.
    expect(checks.check(P, T0 + 3_600_000)).toEqual([]);
    expect(checks.checksOf(P).open).toHaveLength(1);
    expect(build('unknown').checks.check(P, T0)[0]).toMatchObject({ rule: 'mollie_account', severity: 'look', facts: { same: 'unknown' } });
    expect(build('yes').checks.check(P, T0)[0]).toMatchObject({ rule: 'mollie_account', severity: 'look' });
  });

  it('connected again later: a new check; nothing connected: none', () => {
    const w = build('yes');
    w.checks.check(P, T0);
    w.setCheck({ organizationName: 'Sofia Partner OOD', connectedBy: 'Georgi Ivanov', connectedAt: new Date(T0 + 86_400_000).toISOString(), same: 'yes' });
    expect(w.checks.check(P, T0 + 86_400_000)).toHaveLength(1);
    expect(w.checks.checksOf(P).open).toHaveLength(2);
    w.setCheck(undefined);
    expect(w.checks.check(P, T0 + 2 * 86_400_000)).toEqual([]);
  });
});

describe('Mollie’s notice about a counter’s payment', () => {
  const controller = (hubAnswer: boolean, bookingAnswer = false) => {
    const said: string[] = [];
    const hub = { onMollieNotice: async (id: string) => (said.push(`hub:${id}`), hubAnswer) };
    const direct = { onWebhook: async (id: string) => void said.push(`direct:${id}`) };
    const bookings = { onWebhook: async (id: string) => (said.push(`booking:${id}`), bookingAnswer) };
    const c = new MollieController({} as never, {} as never, {} as never, direct as never, {} as never, bookings as never, hub as never);
    return { c, said };
  };

  it('reaches the payment hub; a load paid direct is asked only where the hub did not know it; a booking first, as before', async () => {
    const ours = controller(true);
    expect(await ours.c.webhook({ id: 'tr_counter' })).toEqual({ ok: true });
    expect(ours.said).toEqual(['booking:tr_counter', 'hub:tr_counter']);
    const load = controller(false);
    await load.c.webhook({ id: 'tr_load' });
    expect(load.said).toEqual(['booking:tr_load', 'hub:tr_load', 'direct:tr_load']);
    const booking = controller(false, true);
    await booking.c.webhook({ id: 'tr_booking' });
    expect(booking.said).toEqual(['booking:tr_booking']);
  });
});
