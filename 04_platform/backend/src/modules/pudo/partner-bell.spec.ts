import { ROLE_SCOPES } from '../../foundation/auth/actor-scopes';
import type { IntrospectionResult } from '../../foundation/auth/auth.types';
import { GlosError } from '../../foundation/http/glos-error';
import { OutboxPushSender } from './push-sender';
import { NotificationService } from './notification.service';
import { NotificationsController } from './notifications.controller';
import { PartnerMemberService } from './partner-member.service';
import { PartnerStatementService } from './partner-statement.service';
import type { PartnerOwedLine } from './partner-ledger.service';
import { WELCOME } from './welcome';
import { PartnerAppController } from './partner-app.controller';

/*
 * 2026-11-26 — THE PARTNER APP'S BELL (the owner: "wire in the notification bell as well"). The partner company's own inbox, read by
 * its people — like a business's: whoever is still in it reads the same one, a notice one of them read is read and says by whom, and
 * nothing is sent to a device. Its first read finds its welcome. It hears: its counters' Mollie account connected or disconnected; a
 * week's statement standing (what a company of ours owes it) and paid; payouts waiting because its account is short (the payout spec).
 * Each opens its Money section, on one tap.
 */
const P = { entityId: 'partner-bg-sofia', did: 'did:glos:partner-bg-sofia', name: 'Sofia Partner OOD', kind: 'partner', status: 'active', currency: 'EUR', jurisdiction: 'BG' };
const elena = { role: 'partner', did: P.did, tenant: P.entityId, personDid: 'did:person:elena', actorName: 'Elena Petrova' } as IntrospectionResult;

describe('the partner’s own inbox', () => {
  const build = (stillIn = true) => {
    const notifications = new NotificationService(new OutboxPushSender());
    const members = {
      requireMember: (a: IntrospectionResult) => {
        if (!stillIn || a.role !== 'partner') throw new GlosError('FORBIDDEN', 'This needs a Partner app sign-in');
        return { member: { name: a.actorName }, entity: P };
      },
    };
    return { notifications, controller: new NotificationsController(notifications, members as never) };
  };

  it('is the partner role’s own to read', () => {
    expect(ROLE_SCOPES.partner).toEqual(['partner:read:own', 'notification:manage:self']);
  });

  it('read by its people: welcomed once, the same inbox for each, read by name; nothing sent to a device', () => {
    const { notifications, controller } = build();
    const first = controller.inbox(elena);
    expect(first.items).toEqual([expect.objectContaining({ kind: 'welcome', title: WELCOME.partner.title, ownerDid: P.did })]);
    expect(controller.inbox({ ...elena, personDid: 'did:person:georgi', actorName: 'Georgi Ivanov' } as IntrospectionResult).items).toHaveLength(1);
    controller.markRead(first.items[0].id, elena);
    expect(notifications.inboxFor(P.did)[0]).toMatchObject({ readBy: 'Elena Petrova' });
    expect(() => controller.subscribe({ endpoint: 'https://push.example/1', keys: { p256dh: 'k', auth: 'a' } } as never, elena)).toThrow('A partner’s notices are read in the Partner app');
  });

  it('a person taken out of the partner reads none of it, on their next click', () => {
    const { controller } = build(false);
    expect(() => controller.inbox(elena)).toThrow('This needs a Partner app sign-in');
    expect(() => controller.markAllRead(elena)).toThrow('This needs a Partner app sign-in');
  });
});

describe('what the partner hears in its bell', () => {
  const rang = (): { list: Array<{ owner: string; kind: string; title: string; body: string; link?: string }>; notify: (o: string, n: { kind: string; title: string; body: string; link?: string }) => Promise<void> } => {
    const list: Array<{ owner: string; kind: string; title: string; body: string; link?: string }> = [];
    return { list, notify: async (owner, n) => void list.push({ owner, kind: n.kind, title: n.title, body: n.body, link: n.link }) };
  };

  it('its counters’ Mollie account connected or disconnected — by whom, whose — opening Money', async () => {
    const bell = rang();
    let told: ((c: unknown) => void) | undefined;
    const mollie = { onPartnerChange: (l: (c: unknown) => void) => (told = l) };
    const persons = { onNumberLeft: () => undefined };
    new PartnerMemberService({ get: () => P } as never, persons as never, {} as never, mollie as never, undefined, bell as never);
    told?.({ entityId: P.entityId, change: 'connected', by: 'Elena Petrova', organization: { id: 'org_1', name: 'Sofia Partner OOD', registrationNumber: '204567890', address: {} }, at: '2026-11-26T09:00:00.000Z' });
    await Promise.resolve();
    expect(bell.list).toEqual([
      { owner: P.did, kind: 'security', title: "Sofia Partner OOD: the counters' Mollie account was connected", body: 'Elena Petrova connected Sofia Partner OOD, registration 204567890. From now on the money your counters take goes into it. If that is not your company’s own account, disconnect it in the Partner app, under Money, and tell SeeBuyGet straight away.', link: '/?go=money' },
    ]);
  });

  it('a week’s statement that stands, once, and the same week paid — with the transfer’s reference — opening Money', () => {
    const NOW = Date.parse('2026-11-30T09:00:00Z');
    const line = (at: string, amount: number): PartnerOwedLine => ({ lineId: `po_${at}`, partnerEntityId: P.entityId, partnerName: P.name, country: 'BG', payeeId: 'did:shop:sofia', payeeKind: 'shop', amount, currency: 'EUR', reference: 'PUD-1', refType: 'parcel', step: 'labour', at, boughtBy: [{ entityId: 'sbg-nl', amount }] });
    const lines = [line('2026-11-24T10:00:00.000Z', 25), line('2026-11-25T10:00:00.000Z', 15)];
    const entities = { get: (id: string) => (id === P.entityId ? P : { entityId: id, name: 'SeeBuyGet Nederland', kind: 'sister', currency: 'EUR' }), list: () => [P, { entityId: 'sbg-nl', kind: 'sister', status: 'active' }] };
    const books = { post: () => ({ entryId: 'je_1' }) };
    const bell = rang();
    const svc = new PartnerStatementService({ linesOf: () => lines } as never, entities as never, books as never, undefined, bell as never);
    svc.closeWeeks(NOW);
    svc.closeWeeks(NOW);
    expect(bell.list).toEqual([
      { owner: P.did, kind: 'partner_money', title: 'SeeBuyGet Nederland owes you EUR 40.00 for the week of 2026-11-22 to 2026-11-28', body: 'For 2 steps your people did on parcels it sold. It is paid by bank transfer, and you are told here when.', link: '/?go=money' },
    ]);
    const week = svc.statementsOf(P.entityId, NOW).statements.find((x) => x.closed)!;
    svc.markPaid(P.entityId, week.statementId, { by: 'Amina', reference: 'NL12INGB-0042' }, NOW);
    expect(bell.list[1]).toEqual({ owner: P.did, kind: 'partner_money', title: 'SeeBuyGet Nederland paid you EUR 40.00 for the week of 2026-11-22 to 2026-11-28', body: 'By bank transfer, reference NL12INGB-0042.', link: '/?go=money' });
  });
});

describe('the Partner app’s Money says who connected the account, and what real money waits for', () => {
  const controller = (record: { registrationNumber?: string } | undefined, connection: Record<string, unknown>) => {
    const entity = { ...P, ...(record ? { record } : {}) };
    const members = { requireMember: () => ({ member: { name: 'Elena Petrova' }, entity }) };
    const mollie = { partnerView: () => ({ available: true, via: 'oauth', connected: { via: 'oauth', testmode: connection.testmode, connectedAt: connection.connectedAt } }), connection: () => connection };
    const none = {} as never;
    return new PartnerAppController(members as never, none, none, none, none, none, none, undefined, undefined, mollie as never);
  };
  const c = { connectedBy: 'Elena Petrova', connectedAt: '2026-11-26T09:00:00.000Z', organization: { id: 'org_1', name: 'Sofia Partner OOD', registrationNumber: '204567890' } };

  it('who connected it, for every member; a live account and no registration on record: real money waits', () => {
    expect(controller(undefined, { ...c, testmode: false }).myMollie(elena)).toMatchObject({ connectedBy: 'Elena Petrova', needsRegistration: true });
    expect(controller({ registrationNumber: '204567890' }, { ...c, testmode: false }).myMollie(elena)).not.toHaveProperty('needsRegistration');
    expect(controller(undefined, { ...c, testmode: true }).myMollie(elena)).not.toHaveProperty('needsRegistration');
  });
});
