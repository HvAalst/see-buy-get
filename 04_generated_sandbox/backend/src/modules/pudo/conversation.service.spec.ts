import { ConversationService, MESSAGES_PER_HOUR, NEW_THREADS_PER_DAY } from './conversation.service';

/**
 * Conversations — two people, about one load.
 *
 * Constructed over stubs on purpose: the lesson that hand-listed providers break whole suites applies to any
 * spec that compiles the module, and this service needs a few facts from its neighbours, not their modules.
 */
describe('conversations about a load', () => {
  const loads: Record<string, Record<string, unknown>> = {};
  const proposals = new Map<string, Record<string, unknown>>();
  const managers: Record<string, string | undefined> = {};
  let notify: jest.Mock;
  let dispatch: Record<string, jest.Mock | ((...a: never[]) => unknown)>;
  let service: ConversationService;

  beforeEach(() => {
    proposals.clear();
    loads.fr_1 = { freightId: 'fr_1', code: 'FR-001', status: 'available', postedByDid: 'did:shop', description: 'Maize', pickupLabel: 'Nakuru', destLabel: 'Nairobi' };
    loads.fr_neg = { freightId: 'fr_neg', code: 'FR-004', status: 'available', commitMode: 'negotiate', postedByDid: 'did:shop', description: 'Cement', pickupLabel: 'A', destLabel: 'B' };
    loads.fr_paid = { freightId: 'fr_paid', code: 'FR-005', status: 'available', commitMode: 'negotiate', shipperDid: 'ven_store', description: 'Order', pickupLabel: 'A', destLabel: 'B' };
    loads.fr_taken = { freightId: 'fr_taken', code: 'FR-002', status: 'claimed', claimedBy: 'did:drv:other', postedByDid: 'did:shop', description: 'Tiles', pickupLabel: 'A', destLabel: 'B' };
    loads.fr_orphan = { freightId: 'fr_orphan', code: 'FR-003', status: 'available', description: 'Sand', pickupLabel: 'A', destLabel: 'B' };
    notify = jest.fn(async () => ({}));
    let n = 0;
    dispatch = {
      requireFreightPublic: (id: string) => {
        if (!loads[id]) throw new Error('not found');
        return loads[id];
      },
      propose: jest.fn((input: { freightId: string; driverDid: string; price: number }) => {
        const p = { proposalId: `prp_${++n}`, freightId: input.freightId, driverDid: input.driverDid, price: input.price, status: 'open' };
        proposals.set(p.proposalId, p);
        return p;
      }),
      requireProposalPublic: (id: string) => {
        const p = proposals.get(id);
        if (!p) throw new Error('Proposal not found');
        return p;
      },
      acceptProposal: jest.fn((id: string) => {
        const p = proposals.get(id)!;
        p.status = 'accepted';
        return { proposal: p, freight: {} };
      }),
      declineProposal: jest.fn((id: string) => {
        const p = proposals.get(id)!;
        p.status = 'declined';
        return p;
      }),
    };
    // Amos drives for Kilima Logistics; Grace drives for herself.
    managers['did:drv:amos'] = 'did:fleet:kilima';
    const drivers = { canOperate: (did: string) => did.startsWith('did:drv'), get: (did: string) => ({ displayName: 'Amos K.', managerDid: managers[did] }) };
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
    const { conversationId } = service.open('fr_neg', 'did:drv:amos');
    service.send(conversationId, 'did:drv:amos', { body: 'hello' });
    service.proposePrice(conversationId, 'did:drv:amos', { price: 4500, from: { lat: -1.3, lng: 36.8 } });
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

  describe('CV2 — the deal, in the thread', () => {
    const FROM = { lat: -1.3, lng: 36.8 };

    it('says what a thread allows: a price where the load is negotiated, a settlement where the network does not pay', () => {
      expect(service.open('fr_neg', 'did:drv:amos')).toMatchObject({ negotiable: true, settlesOffPlatform: true });
      expect(service.open('fr_paid', 'did:drv:amos')).toMatchObject({ negotiable: true, settlesOffPlatform: false });
      expect(service.open('fr_1', 'did:drv:amos')).toMatchObject({ negotiable: false, settlesOffPlatform: true });
    });

    it('makes a driver’s price through the load’s own negotiation, so the thread and the price screen are one fact', () => {
      const { conversationId } = service.open('fr_neg', 'did:drv:amos');
      const offer = service.proposePrice(conversationId, 'did:drv:amos', { price: 4500, note: 'Empty past your gate on Thursday', from: FROM });
      expect(dispatch.propose).toHaveBeenCalledWith(expect.objectContaining({ freightId: 'fr_neg', driverDid: 'did:drv:amos', price: 4500, from: FROM }), expect.any(Number));
      expect(offer).toMatchObject({ kind: 'proposal', body: 'Empty past your gate on Thursday', proposal: { price: 4500, status: 'open' } });
      expect(notify).toHaveBeenCalledWith('did:shop', expect.objectContaining({ title: 'New price offered on FR-004' }));
      // The push names neither the amount nor the note.
      expect(JSON.stringify(notify.mock.calls)).not.toMatch(/4500|Thursday/);
      expect(() => service.proposePrice(conversationId, 'did:shop', { price: 1, from: FROM })).toThrow(/Only the driver who asked/);
    });

    it('lets only the poster accept — and accepting is the negotiation’s accept, shown on the offer it answers', () => {
      const { conversationId } = service.open('fr_neg', 'did:drv:amos');
      const { proposal } = service.proposePrice(conversationId, 'did:drv:amos', { price: 4500, from: FROM });
      expect(() => service.decideProposal(conversationId, 'did:drv:amos', proposal!.proposalId, 'accept')).toThrow(/Only the poster/);

      const decision = service.decideProposal(conversationId, 'did:shop', proposal!.proposalId, 'accept');
      expect(dispatch.acceptProposal).toHaveBeenCalledWith(proposal!.proposalId, expect.any(Number));
      expect(decision).toMatchObject({ kind: 'decision', decision: { decision: 'accepted', price: 4500 } });
      // The offer itself cannot change, so where it stands is read live.
      expect(service.messagesFor(conversationId, 'did:drv:amos').items[0].proposal?.status).toBe('accepted');
    });

    it('refuses deciding a price from ANOTHER driver on the same load inside this thread', () => {
      const amos = service.open('fr_neg', 'did:drv:amos');
      const grace = service.open('fr_neg', 'did:drv:grace');
      const { proposal } = service.proposePrice(grace.conversationId, 'did:drv:grace', { price: 4000, from: FROM });
      expect(() => service.decideProposal(amos.conversationId, 'did:shop', proposal!.proposalId, 'decline')).toThrow(/No such price/);
      expect(service.decideProposal(grace.conversationId, 'did:shop', proposal!.proposalId, 'decline').decision?.decision).toBe('declined');
    });

    it('writes down an off-platform settlement as a record, agreed once and only by the other side', () => {
      const { conversationId } = service.open('fr_neg', 'did:drv:amos');
      const card = service.recordSettlement(conversationId, 'did:shop', { amount: 4500, method: 'mobile_money', when: 'on_delivery', note: 'to the till number on the receipt' });
      expect(card).toMatchObject({ kind: 'settlement', settlement: { amount: 4500, method: 'mobile_money', when: 'on_delivery', agreed: false } });
      expect(() => service.agreeSettlement(conversationId, 'did:shop', card.seq)).toThrow(/not the one who wrote it/);
      expect(service.agreeSettlement(conversationId, 'did:drv:amos', card.seq)).toMatchObject({ kind: 'settlement_agreed', refSeq: card.seq });
      expect(() => service.agreeSettlement(conversationId, 'did:drv:amos', card.seq)).toThrow(/already agreed/);
      expect(service.messagesFor(conversationId, 'did:shop').items[0].settlement?.agreed).toBe(true);
    });

    it('refuses a private settlement on a load the network pays — that is how a driver gets paid twice', () => {
      const { conversationId } = service.open('fr_paid', 'did:drv:amos');
      expect(() => service.recordSettlement(conversationId, 'did:drv:amos', { amount: 100, method: 'cash', when: 'on_pickup' })).toThrow(/paid through the network/);
    });

    it('refuses a settlement with no amount, or a method and a moment it does not know', () => {
      const { conversationId } = service.open('fr_neg', 'did:drv:amos');
      expect(() => service.recordSettlement(conversationId, 'did:shop', { amount: 0, method: 'cash', when: 'on_pickup' })).toThrow(/above zero/);
      expect(() => service.recordSettlement(conversationId, 'did:shop', { amount: 10, method: 'crypto', when: 'on_pickup' })).toThrow(/How it is paid/);
      expect(() => service.recordSettlement(conversationId, 'did:shop', { amount: 10, method: 'cash', when: 'someday' })).toThrow(/When it is paid/);
    });

    it('keeps a blocked thread closed to prices and settlements too', () => {
      const { conversationId } = service.open('fr_neg', 'did:drv:amos');
      service.block(conversationId, 'did:shop');
      expect(() => service.proposePrice(conversationId, 'did:drv:amos', { price: 1, from: FROM })).toThrow(/closed/);
      expect(() => service.recordSettlement(conversationId, 'did:shop', { amount: 1, method: 'cash', when: 'on_pickup' })).toThrow(/unblock it/);
    });
  });

  describe('CV3 — sharing, by the driver’s choice and the parties’ choice', () => {
    it('lets only the driver share with THEIR fleet manager, who can read and never write', () => {
      const { conversationId } = service.open('fr_1', 'did:drv:amos');
      service.send(conversationId, 'did:drv:amos', { body: 'Is the gate open at 6?' });
      expect(service.listFor('did:drv:amos')[0]).toMatchObject({ shareable: true, sharedWithManager: false });
      expect(() => service.setShared(conversationId, 'did:shop', true)).toThrow(/Only the driver/);
      expect(() => service.messagesFor(conversationId, 'did:fleet:kilima')).toThrow(/not found/i);

      expect(service.setShared(conversationId, 'did:drv:amos', true).sharedWithManager).toBe(true);
      expect(service.listShared('did:fleet:kilima')).toEqual([expect.objectContaining({ conversationId, role: 'manager', unread: 0, counterpartName: 'Amos K.' })]);
      expect(service.messagesFor(conversationId, 'did:fleet:kilima').items.map((m) => m.body)).toEqual(['Is the gate open at 6?']);
      // A shared reader is neither party, so each message says which ROLE it came from.
      expect(service.messagesFor(conversationId, 'did:fleet:kilima').items[0]).toMatchObject({ mine: false, from: 'driver' });
      // Reading, never writing — and never another fleet's.
      expect(() => service.send(conversationId, 'did:fleet:kilima', { body: 'hi' })).toThrow(/not found/i);
      expect(() => service.messagesFor(conversationId, 'did:fleet:other')).toThrow(/not found/i);
      expect(service.listShared('did:fleet:other')).toEqual([]);
    });

    it('ends the share when the driver turns it off — or leaves the fleet', () => {
      const { conversationId } = service.open('fr_1', 'did:drv:amos');
      service.setShared(conversationId, 'did:drv:amos', true);
      service.setShared(conversationId, 'did:drv:amos', false);
      expect(service.listShared('did:fleet:kilima')).toEqual([]);

      service.setShared(conversationId, 'did:drv:amos', true);
      managers['did:drv:amos'] = 'did:fleet:newco'; // Amos moves to another fleet
      expect(() => service.messagesFor(conversationId, 'did:fleet:kilima')).toThrow(/not found/i);
      expect(service.listShared('did:fleet:kilima')).toEqual([]);
    });

    it('refuses a driver who drives for themselves — there is nobody to share with', () => {
      const { conversationId } = service.open('fr_1', 'did:drv:grace');
      expect(service.listFor('did:drv:grace')[0].shareable).toBe(false);
      expect(() => service.setShared(conversationId, 'did:drv:grace', true)).toThrow(/drive for yourself/);
    });

    it('shares a FIXED, fingerprinted copy of the chosen messages — roles, not identities — and tells the other side', () => {
      const { conversationId } = service.open('fr_neg', 'did:drv:amos');
      service.send(conversationId, 'did:drv:amos', { body: 'I will collect at 6' });
      service.send(conversationId, 'did:shop', { body: 'Gate opens at 7, not 6' });
      service.recordSettlement(conversationId, 'did:shop', { amount: 4500, method: 'cash', when: 'on_delivery' });

      const shared = service.shareDisputeReport(conversationId, 'did:drv:amos', [3, 1, 3], 'Paid less than agreed');
      expect(shared.seqCount).toBe(2);
      expect(shared.fingerprint).toMatch(/^[0-9a-f]{64}$/);

      const [report] = service.listDisputeReports();
      // Never a key named `hash`: the global response mask strips that name at every depth, which once delivered
      // the report to the console without its fingerprint and crashed the screen.
      expect(Object.keys(report)).not.toContain('hash');
      expect(Object.keys(shared)).not.toContain('hash');
      expect(report).toMatchObject({ sharedBy: 'driver', note: 'Paid less than agreed', posterDid: 'did:shop', askerDid: 'did:drv:amos' });
      expect(report.messages.map((m) => [m.seq, m.from])).toEqual([[1, 'driver'], [3, 'poster']]);
      expect(JSON.stringify(report.messages)).not.toMatch(/did:/);
      expect(report.messages[1].settlement).toEqual({ amount: 4500, method: 'cash', when: 'on_delivery' });

      // The other side is told, in the thread.
      const told = service.messagesFor(conversationId, 'did:shop').items.at(-1);
      expect(told).toMatchObject({ kind: 'report_shared', mine: false, seqCount: 2 });
    });

    it('allows a report in a blocked thread, and refuses a stranger, nothing chosen, or a message that is not there', () => {
      const { conversationId } = service.open('fr_1', 'did:drv:amos');
      service.send(conversationId, 'did:drv:amos', { body: 'send the money now' });
      service.block(conversationId, 'did:shop');
      expect(service.shareDisputeReport(conversationId, 'did:shop', [1]).seqCount).toBe(1);
      expect(() => service.shareDisputeReport(conversationId, 'did:drv:nosy', [1])).toThrow(/not found/i);
      expect(() => service.shareDisputeReport(conversationId, 'did:shop', [])).toThrow(/Choose the messages/);
      expect(() => service.shareDisputeReport(conversationId, 'did:shop', [99])).toThrow(/not in this conversation/);
    });
  });

  describe('CV4 — voice messages', () => {
    const recording = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(60, 7)]);
    const WEBM = `data:audio/webm;codecs=opus;base64,${recording.toString('base64')}`;

    it('keeps a real recording as a voice message — and the push says only that one arrived', () => {
      const { conversationId } = service.open('fr_1', 'did:drv:amos');
      const sent = service.sendVoice(conversationId, 'did:drv:amos', { dataUrl: WEBM, durationSec: 7 });
      expect(sent).toMatchObject({ kind: 'voice', mine: true, voice: { durationSec: 7 } });

      const played = service.voiceFor(conversationId, sent.voice!.voiceId, 'did:shop');
      expect(played.contentType).toBe('audio/webm');
      expect(played.bytes.equals(recording)).toBe(true);

      expect(notify).toHaveBeenCalledWith('did:shop', expect.objectContaining({ title: 'New voice message about FR-001' }));
      expect(JSON.stringify(notify.mock.calls)).not.toContain(recording.toString('base64').slice(0, 20));
      // Listing the thread never carries audio.
      expect(JSON.stringify(service.messagesFor(conversationId, 'did:shop'))).not.toContain(recording.toString('base64').slice(0, 20));
    });

    it('refuses text dressed up as audio, a message outside 1–120 seconds, and a closed thread', () => {
      const { conversationId } = service.open('fr_1', 'did:drv:amos');
      const fake = `data:audio/webm;base64,${Buffer.from('<script>alert(1)</script>padding').toString('base64')}`;
      expect(() => service.sendVoice(conversationId, 'did:drv:amos', { dataUrl: fake, durationSec: 3 })).toThrow(/not a real recording/);
      expect(() => service.sendVoice(conversationId, 'did:drv:amos', { dataUrl: WEBM, durationSec: 500 })).toThrow(/1 to 120 seconds/);
      service.block(conversationId, 'did:shop');
      expect(() => service.sendVoice(conversationId, 'did:drv:amos', { dataUrl: WEBM, durationSec: 3 })).toThrow(/closed/);
    });

    it('plays only for the thread’s readers — not a stranger, not another conversation; a shared manager may', () => {
      const a = service.open('fr_1', 'did:drv:amos');
      const other = service.open('fr_neg', 'did:drv:amos');
      const { voice } = service.sendVoice(a.conversationId, 'did:drv:amos', { dataUrl: WEBM, durationSec: 4 });
      expect(() => service.voiceFor(a.conversationId, voice!.voiceId, 'did:drv:nosy')).toThrow(/not found/i);
      expect(() => service.voiceFor(other.conversationId, voice!.voiceId, 'did:drv:amos')).toThrow(/not found/i);
      expect(() => service.voiceFor(a.conversationId, voice!.voiceId, 'did:fleet:kilima')).toThrow(/not found/i);
      service.setShared(a.conversationId, 'did:drv:amos', true);
      expect(service.voiceFor(a.conversationId, voice!.voiceId, 'did:fleet:kilima').bytes.length).toBe(recording.length);
    });

    it('carries a voice message into a shared report, and lets the operator play exactly that one', () => {
      const { conversationId } = service.open('fr_1', 'did:drv:amos');
      const { voice } = service.sendVoice(conversationId, 'did:drv:amos', { dataUrl: WEBM, durationSec: 9 });
      const { reportId } = service.shareDisputeReport(conversationId, 'did:shop', [1]);
      expect(service.listDisputeReports()[0].messages[0]).toMatchObject({ kind: 'voice', voiceId: voice!.voiceId, durationSec: 9, from: 'driver' });
      expect(service.voiceForReport(reportId, voice!.voiceId).contentType).toBe('audio/webm');
      expect(() => service.voiceForReport(reportId, 'vn_not_in_it')).toThrow(/not found in that report/);
    });
  });
});
