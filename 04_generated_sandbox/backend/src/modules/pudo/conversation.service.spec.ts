import { ConversationService, MESSAGES_PER_HOUR, NEW_THREADS_PER_DAY } from './conversation.service';

/**
 * CV1 — two people, about one load.
 *
 * Constructed over stubs on purpose: the lesson that hand-listed providers break whole suites applies to any
 * spec that compiles the module, and this service needs three facts from its neighbours, not their modules.
 */
describe('conversations about a load', () => {
  const loads: Record<string, Record<string, unknown>> = {};
  let notify: jest.Mock;
  let service: ConversationService;

  beforeEach(() => {
    loads.fr_1 = { freightId: 'fr_1', code: 'FR-001', status: 'available', postedByDid: 'did:shop', description: 'Maize', pickupLabel: 'Nakuru', destLabel: 'Nairobi' };
    loads.fr_taken = { freightId: 'fr_taken', code: 'FR-002', status: 'claimed', claimedBy: 'did:drv:other', postedByDid: 'did:shop', description: 'Tiles', pickupLabel: 'A', destLabel: 'B' };
    loads.fr_orphan = { freightId: 'fr_orphan', code: 'FR-003', status: 'available', description: 'Sand', pickupLabel: 'A', destLabel: 'B' };
    notify = jest.fn(async () => ({}));
    const dispatch = {
      requireFreightPublic: (id: string) => {
        if (!loads[id]) throw new Error('not found');
        return loads[id];
      },
    };
    const drivers = { canOperate: (did: string) => did.startsWith('did:drv'), get: () => ({ displayName: 'Amos K.' }) };
    const vendors = { has: (id: string) => id === 'ven_store', get: () => ({ did: 'did:store' }) };
    service = new ConversationService(dispatch as never, drivers as never, { notify } as never, vendors as never);
  });

  it('addresses a store’s own diverted load to the DID the store signs in as, not its store id', () => {
    // Found building the vendor screen: the load records `ven_…` as its shipper, the store signs in as a DID,
    // and compared raw the store would never have seen a question about its own freight.
    loads.fr_store = { freightId: 'fr_store', code: 'FR-010', status: 'available', shipperDid: 'ven_store', description: 'Order 88', pickupLabel: 'A', destLabel: 'B' };
    const { conversationId } = service.open('fr_store', 'did:drv:amos');
    service.send(conversationId, 'did:drv:amos', { body: 'Is it ready?' });
    expect(service.listFor('did:store').map((c) => c.conversationId)).toEqual([conversationId]);
    expect(notify).toHaveBeenCalledWith('did:store', expect.objectContaining({ kind: 'message' }));
  });

  it('opens ONE thread per load and asker — asking twice returns to the same place', () => {
    const a = service.open('fr_1', 'did:drv:amos');
    const b = service.open('fr_1', 'did:drv:amos');
    expect(b.conversationId).toBe(a.conversationId);
    expect(a).toMatchObject({ role: 'asker', freightCode: 'FR-001', freightLabel: 'Maize · Nakuru → Nairobi', unread: 0, blocked: false });
  });

  it('refuses the poster asking about their own load, a non-driver, an orphan load and a load already taken', () => {
    expect(() => service.open('fr_1', 'did:shop')).toThrow(/your own load/);
    expect(() => service.open('fr_1', 'did:consumer:x')).toThrow(/Only an active driver/);
    expect(() => service.open('fr_orphan', 'did:drv:amos')).toThrow(/without an owner/);
    expect(() => service.open('fr_taken', 'did:drv:amos')).toThrow(/no longer looking/);
    // …but the driver who took it can still talk to the poster about it.
    expect(service.open('fr_taken', 'did:drv:other').role).toBe('asker');
  });

  it('numbers every message on the server, and catches up after a sequence number rather than a clock', () => {
    const { conversationId } = service.open('fr_1', 'did:drv:amos');
    service.send(conversationId, 'did:drv:amos', { body: 'Is it bagged or loose?' });
    service.send(conversationId, 'did:shop', { body: 'Bagged, 50 kg sacks.' });
    service.send(conversationId, 'did:drv:amos', { quick: 'on_my_way' });

    const all = service.messagesFor(conversationId, 'did:shop').items;
    expect(all.map((m) => m.seq)).toEqual([1, 2, 3]);
    expect(all.map((m) => m.mine)).toEqual([false, true, false]);
    expect(service.messagesFor(conversationId, 'did:shop', 2).items).toEqual([expect.objectContaining({ seq: 3, kind: 'quick', quick: 'on_my_way' })]);
  });

  it('counts what each party has not read, and never moves a read marker backward or past the end', () => {
    const { conversationId } = service.open('fr_1', 'did:drv:amos');
    service.send(conversationId, 'did:drv:amos', { body: 'one' });
    service.send(conversationId, 'did:drv:amos', { body: 'two' });
    expect(service.listFor('did:shop')[0].unread).toBe(2);
    expect(service.listFor('did:drv:amos')[0].unread).toBe(0);
    expect(service.markRead(conversationId, 'did:shop', 99).unread).toBe(0);
    expect(service.markRead(conversationId, 'did:shop', 1).unread).toBe(0);
  });

  it('carries no identity or contact detail in anything a party reads', () => {
    const { conversationId } = service.open('fr_1', 'did:drv:amos');
    service.send(conversationId, 'did:drv:amos', { body: 'hello' });
    const payload = JSON.stringify([service.listFor('did:shop'), service.messagesFor(conversationId, 'did:shop')]);
    expect(payload).not.toMatch(/did:drv|did:shop/);
    expect(service.listFor('did:shop')[0].counterpartName).toBe('Amos K.');
  });

  it('pushes that a message arrived — never what it says', () => {
    const { conversationId } = service.open('fr_1', 'did:drv:amos');
    service.send(conversationId, 'did:drv:amos', { body: 'my number is 0712 000 000' });
    expect(notify).toHaveBeenCalledWith('did:shop', expect.objectContaining({ kind: 'message', title: 'New message about FR-001' }));
    expect(JSON.stringify(notify.mock.calls)).not.toMatch(/0712/);
  });

  it('tells a stranger nothing — not even that the conversation exists', () => {
    const { conversationId } = service.open('fr_1', 'did:drv:amos');
    expect(() => service.messagesFor(conversationId, 'did:drv:nosy')).toThrow(/not found/i);
    expect(() => service.send(conversationId, 'did:drv:nosy', { body: 'hi' })).toThrow(/not found/i);
  });

  it('closes the thread both ways when blocked, and only the person who blocked can open it again', () => {
    const { conversationId } = service.open('fr_1', 'did:drv:amos');
    service.send(conversationId, 'did:drv:amos', { body: 'before' });
    expect(service.block(conversationId, 'did:shop')).toMatchObject({ blocked: true, blockedByMe: true });
    expect(() => service.send(conversationId, 'did:drv:amos', { body: 'after' })).toThrow(/closed/);
    expect(() => service.send(conversationId, 'did:shop', { body: 'after' })).toThrow(/unblock it/);
    expect(() => service.unblock(conversationId, 'did:drv:amos')).toThrow(/Only the person/);
    // The messages stay.
    expect(service.messagesFor(conversationId, 'did:drv:amos').items).toHaveLength(1);
    service.unblock(conversationId, 'did:shop');
    expect(service.send(conversationId, 'did:drv:amos', { body: 'after' }).seq).toBe(2);
  });

  it('keeps a report with a copy of the message, and refuses reporting your own', () => {
    const { conversationId } = service.open('fr_1', 'did:drv:amos');
    service.send(conversationId, 'did:drv:amos', { body: 'send money first to this number' });
    expect(() => service.report(conversationId, 'did:drv:amos', 1, 'scam')).toThrow(/your own/);
    expect(() => service.report(conversationId, 'did:shop', 1, 'rude')).toThrow(/reason/);
    const { reportId } = service.report(conversationId, 'did:shop', 1, 'scam');
    expect(service.report(conversationId, 'did:shop', 1, 'scam').reportId).toBe(reportId); // once per message per reporter
    expect(service.listReports()[0]).toMatchObject({ reason: 'scam', reportedDid: 'did:drv:amos', snapshot: { body: 'send money first to this number' } });
  });

  it('refuses empty, overlong and unknown messages', () => {
    const { conversationId } = service.open('fr_1', 'did:drv:amos');
    expect(() => service.send(conversationId, 'did:drv:amos', { body: '   ' })).toThrow(/Write something/);
    expect(() => service.send(conversationId, 'did:drv:amos', { body: 'x'.repeat(1001) })).toThrow(/under 1000/);
    expect(() => service.send(conversationId, 'did:drv:amos', { quick: 'send_money' })).toThrow(/Unknown quick reply/);
  });

  it('limits what one person may send in an hour and start in a day — chat before a match means strangers', () => {
    const { conversationId } = service.open('fr_1', 'did:drv:amos');
    const now = Date.now();
    for (let i = 0; i < MESSAGES_PER_HOUR; i++) service.send(conversationId, 'did:drv:amos', { body: `m${i}` }, now);
    expect(() => service.send(conversationId, 'did:drv:amos', { body: 'one more' }, now)).toThrow(/one hour/);
    expect(service.send(conversationId, 'did:drv:amos', { body: 'later' }, now + 61 * 60 * 1000).seq).toBe(MESSAGES_PER_HOUR + 1);

    for (let i = 0; i < NEW_THREADS_PER_DAY; i++) {
      loads[`fr_x${i}`] = { ...loads.fr_1, freightId: `fr_x${i}` };
      service.open(`fr_x${i}`, 'did:drv:busy');
    }
    loads.fr_last = { ...loads.fr_1, freightId: 'fr_last' };
    expect(() => service.open('fr_last', 'did:drv:busy')).toThrow(/started 20 conversations today/);
  });
});
