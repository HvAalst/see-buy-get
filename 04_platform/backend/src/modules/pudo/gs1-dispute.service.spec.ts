import type { EntityService } from '../../foundation/entity/entity.service';
import { ssccOf } from '../../foundation/gs1/gs1';
import { Gs1DisputeService } from './gs1-dispute.service';
import type { MediaService } from './media.service';
import type { NotificationService } from './notification.service';
import type { BusinessClientService } from './business-client.service';
import { ShipperCodesService, clientCoder } from './shipper-codes.service';

const P = '6161234';
const t0 = Date.parse('2026-10-19T08:00:00.000Z');
const DAY = 86_400_000;
const NAMES: Record<string, string> = { acme: 'Acme Traders', sub: 'Acme Kisumu', genuine: 'Genuine Goods Ltd', other: 'Other Ltd', fwd: 'Swift Forwarders' };
const biz = (id: string, by = 'Owner') => ({ entityId: id, did: `did:${id}`, name: NAMES[id], by });
const amina = { name: 'Amina', key: 'k-amina' };
const baraka = { name: 'Baraka', key: 'k-baraka' };

function harness() {
  const codes = new ShipperCodesService();
  const told: Array<{ did: string; title: string; body: string }> = [];
  const anchored: string[] = [];
  const entities = { find: (id: string) => (NAMES[id] ? { entityId: id, did: `did:${id}`, name: NAMES[id] } : undefined) } as unknown as EntityService;
  // An image is the business's own when it was uploaded by it: here, a ref naming its DID.
  const media = { adopt: (ref: string, did: string) => ref.startsWith(`img:${did}:`), anchorGs1Dispute: (id: string) => anchored.push(id) } as unknown as MediaService;
  const notifications = { notify: (did: string, p: { title: string; body: string }) => (told.push({ did, title: p.title, body: p.body }), Promise.resolve()) } as unknown as NotificationService;
  // The forwarder's book: one client, Unga Millers.
  const book = [{ clientId: 'c1', entityId: 'fwd', name: 'Unga Millers' }];
  const clients = {
    list: (entityId: string) => book.filter((c) => c.entityId === entityId),
    require: (entityId: string, clientId: string) => {
      const c = book.find((x) => x.entityId === entityId && x.clientId === clientId);
      if (!c) throw new Error('No such client');
      return c;
    },
  } as unknown as BusinessClientService;
  return { codes, svc: new Gs1DisputeService(codes, entities, media, notifications, clients), told, anchored };
}
const licence = (id: string, n = 1) => `img:did:${id}:${n}`;

describe('a GS1 prefix shared, refused and disputed (round 18)', () => {
  it('a prefix is shared only under different extension digits — and nobody prints a number another already printed', () => {
    const { codes } = harness();
    codes.set('acme', { companyPrefix: P, extensionDigit: 4 }, 'Wanjiku');
    // A group's companies under the parent's prefix, each its own digit.
    expect(codes.set('sub', { companyPrefix: P, extensionDigit: 5 }, 'Otieno')).toMatchObject({ extensionDigit: 5 });
    expect(() => codes.set('other', { companyPrefix: P, extensionDigit: 4 }, 'X')).toThrow(/Another business prints SSCCs under this prefix with extension digit 4/);
    // Its own digit again is no refusal.
    expect(codes.set('acme', { companyPrefix: P, extensionDigit: 4 }, 'Wanjiku')).toMatchObject({ extensionDigit: 4 });
    expect(codes.issue('frt_a', 'acme', 3)!.codes).toEqual([0, 1, 2].map((n) => ssccOf(P, 4, n)));
    // Given up, the digit is free — but its numbers stay printed: the next business carries on past them.
    codes.set('acme', null, 'Wanjiku');
    codes.set('other', { companyPrefix: P, extensionDigit: 4 }, 'X');
    expect(codes.issue('frt_o', 'other', 1)!.codes[0]).toBe(ssccOf(P, 4, 3));
    expect(codes.left('other')).toBe(1_000_000_000 - 4);
  });

  it('a business says the prefix is its own: those using it are told, send theirs in a week, two different staff decide — and it moves', () => {
    const { codes, svc, told, anchored } = harness();
    codes.set('acme', { companyPrefix: P, extensionDigit: 4 }, 'Wanjiku');
    codes.issue('frt_a', 'acme', 2);
    expect(() => codes.set('genuine', { companyPrefix: P, extensionDigit: 4 }, 'Grace')).toThrow(/show us your GS1 licence/);

    // Refused without its own licence, and while nobody else uses the prefix.
    expect(() => svc.open(biz('genuine'), { companyPrefix: P, extensionDigit: 4, licenceRef: licence('acme') }, t0)).toThrow(/photograph or a screenshot of your GS1 licence/);
    expect(() => svc.open(biz('genuine'), { companyPrefix: '6169999', extensionDigit: 4, licenceRef: licence('genuine') }, t0)).toThrow(/Nobody else uses this prefix: set it in Business details/);
    const opened = svc.open(biz('genuine', 'Grace'), { companyPrefix: P, extensionDigit: 4, licenceRef: licence('genuine'), note: ' GS1 Kenya licence 2019 ' }, t0);
    expect(opened).toMatchObject({ side: 'claimant', state: 'open', holderNames: ['Acme Traders'], licenceSent: true, answerBy: new Date(t0 + 7 * DAY).toISOString() });
    expect(told).toEqual([expect.objectContaining({ did: 'did:acme', title: `Another business says the GS1 prefix ${P} is its own` })]);
    expect(told[0].body).toMatch(/Genuine Goods Ltd .* Until then nothing changes/);
    expect(() => svc.open(biz('genuine'), { companyPrefix: P, extensionDigit: 4, licenceRef: licence('genuine', 2) }, t0)).toThrow(/already open/);
    // The one using it reads its side; nothing has changed for it.
    expect(svc.forBusiness('acme')).toEqual([expect.objectContaining({ side: 'holder', claimantName: 'Genuine Goods Ltd', licenceSent: false })]);
    expect(codes.of('acme')).toMatchObject({ companyPrefix: P });

    // Staff wait for the one using it — a week — unless it has sent its licence.
    const id = opened.disputeId;
    expect(() => svc.propose(id, amina, { to: 'claimant', what: 'Read both', reason: 'Licence names Genuine' }, t0 + DAY)).toThrow(/until .* to send their licence/);
    svc.sendLicence(biz('acme'), id, { licenceRef: licence('acme') }, t0 + DAY);
    svc.sendLicence(biz('acme'), id, { licenceRef: licence('acme', 2), note: 'The clearer one' }, t0 + DAY);
    expect(svc.list(t0 + DAY)[0]).toMatchObject({ mayDecide: true, holders: [expect.objectContaining({ licenceRef: licence('acme', 2), earlier: [licence('acme')], note: 'The clearer one', digitNow: 4 })] });
    expect(() => svc.propose(id, amina, { to: 'claimant', what: ' ', reason: 'x' }, t0 + DAY)).toThrow(/Say what you checked/);
    svc.propose(id, amina, { to: 'claimant', what: 'Both licences read; GS1 Kenya register names Genuine Goods for 6161234', reason: 'The GS1 licence for this prefix is in Genuine Goods Ltd’s name' }, t0 + DAY);
    // To the businesses, a proposal is still open; the one who proposed cannot approve it.
    expect(svc.forBusiness('genuine')[0].state).toBe('open');
    expect(() => svc.approve(id, { name: 'Amina again', key: 'k-amina' }, t0 + DAY)).toThrow(/A second member of staff has to approve/);
    expect(svc.approve(id, baraka, t0 + DAY)).toMatchObject({ state: 'decided', decided: { to: 'claimant', proposedBy: 'Amina', by: 'Baraka' } });

    // It moves: the one using it stops, the claimant prints past every number printed there, nobody else takes it up.
    expect(codes.of('acme')).toBeUndefined();
    expect(codes.codesFor('frt_a')!.codes).toHaveLength(2);
    expect(codes.of('genuine')).toMatchObject({ companyPrefix: P, extensionDigit: 4 });
    expect(codes.issue('frt_g', 'genuine', 1)!.codes[0]).toBe(ssccOf(P, 4, 2));
    expect(() => codes.set('acme', { companyPrefix: P, extensionDigit: 7 }, 'Wanjiku')).toThrow(/SeeBuyGet staff decided/);
    expect(told.filter((x) => x.title.includes('is yours') || x.title.includes('another business'))).toEqual([
      expect.objectContaining({ did: 'did:genuine', body: expect.stringContaining('Their reason: The GS1 licence for this prefix is in Genuine Goods Ltd’s name') }),
      expect.objectContaining({ did: 'did:acme', body: expect.stringContaining('the loads you posted keep the codes they were given') }),
    ]);
    expect(svc.forBusiness('acme')[0].decided).toMatchObject({ mine: false });
    expect(svc.forBusiness('genuine')[0].decided).toMatchObject({ mine: true });
    expect(anchored).toEqual([id]);
    expect(() => svc.sendLicence(biz('acme'), id, { licenceRef: licence('acme', 3) }, t0 + 2 * DAY)).toThrow(/over/);
    // The way back: the one decided against may dispute it again — against the one it was decided for, even while
    // that one prints nothing under it.
    codes.set('genuine', null, 'Grace');
    expect(svc.open(biz('acme'), { companyPrefix: P, extensionDigit: 4, licenceRef: licence('acme', 4) }, t0 + 3 * DAY)).toMatchObject({ side: 'claimant', holderNames: ['Genuine Goods Ltd'] });
  });

  it('decided for those using it: nothing they print changes, and the claimant may not take the prefix up under any digit', () => {
    const { codes, svc, told } = harness();
    codes.set('acme', { companyPrefix: P, extensionDigit: 4 }, 'Wanjiku');
    codes.set('sub', { companyPrefix: P, extensionDigit: 5 }, 'Otieno');
    const { disputeId } = svc.open(biz('genuine'), { companyPrefix: P, extensionDigit: 4, licenceRef: licence('genuine') }, t0);
    expect(svc.list(t0)[0].holders.map((h) => h.name)).toEqual(['Acme Traders', 'Acme Kisumu']);
    // Nobody sent theirs: after the week, staff decide on what they have.
    svc.propose(disputeId, amina, { to: 'holders', what: 'Licence sent is for 6161235', reason: 'Your licence is for another prefix' }, t0 + 7 * DAY);
    // Not approved as it stands: back to be looked at again, and proposed again.
    expect(svc.sendBack(disputeId, baraka, 'Ask GS1 Kenya first', t0 + 7 * DAY)).toMatchObject({ state: 'open', sentBack: { by: 'Baraka', why: 'Ask GS1 Kenya first' } });
    svc.propose(disputeId, amina, { to: 'holders', what: 'GS1 Kenya confirmed Acme', reason: 'Your licence is for another prefix' }, t0 + 8 * DAY);
    svc.approve(disputeId, baraka, t0 + 8 * DAY);
    expect(codes.of('acme')).toMatchObject({ extensionDigit: 4 });
    expect(codes.of('sub')).toMatchObject({ extensionDigit: 5 });
    expect(() => codes.set('genuine', { companyPrefix: P, extensionDigit: 8 }, 'Grace')).toThrow(/SeeBuyGet staff decided/);
    expect(told.at(-3)).toMatchObject({ did: 'did:genuine', title: `The GS1 prefix ${P} stays with the business using it` });
  });

  it('the claimant takes it back: nothing changes, those using it are told — and only the claimant can', () => {
    const { codes, svc, told, anchored } = harness();
    codes.set('acme', { companyPrefix: P, extensionDigit: 4 }, 'Wanjiku');
    const { disputeId } = svc.open(biz('genuine'), { companyPrefix: P, extensionDigit: 4, licenceRef: licence('genuine') }, t0);
    expect(() => svc.withdraw(biz('acme'), disputeId, t0)).toThrow(/No such dispute/);
    expect(svc.withdraw(biz('genuine'), disputeId, t0 + DAY)).toMatchObject({ state: 'withdrawn' });
    expect(told.at(-1)).toMatchObject({ did: 'did:acme', title: expect.stringContaining('was withdrawn') });
    expect(anchored).toEqual([disputeId]);
    expect(() => svc.propose(disputeId, amina, { to: 'claimant', what: 'x', reason: 'y' }, t0 + 9 * DAY)).toThrow(/not waiting to be decided/);
    // Withdrawn, a new one may be opened.
    expect(svc.open(biz('genuine'), { companyPrefix: P, extensionDigit: 4, licenceRef: licence('genuine', 2) }, t0 + 2 * DAY).state).toBe('open');
  });
  it('a forwarder’s client prints under its own prefix, entered on its record — and the same refusals hold for it (round 20)', () => {
    const { codes } = harness();
    const unga = clientCoder('fwd', 'c1');
    codes.set(unga, { companyPrefix: P, extensionDigit: 4 }, 'Forwarder owner');
    expect(codes.issue('frt_u', unga, 2)!.codes).toEqual([0, 1].map((n) => ssccOf(P, 4, n)));
    // The client prints under digit 4: no business may take it, and the client takes no business's.
    expect(() => codes.set('acme', { companyPrefix: P, extensionDigit: 4 }, 'Wanjiku')).toThrow(/Another business prints SSCCs under this prefix with extension digit 4/);
    codes.set('acme', { companyPrefix: P, extensionDigit: 5 }, 'Wanjiku');
    expect(() => codes.set(clientCoder('fwd', 'c2'), { companyPrefix: P, extensionDigit: 5 }, 'X')).toThrow(/extension digit 5/);
    // The forwarder's own prefix is apart from its client's.
    expect(codes.of('fwd')).toBeUndefined();
    expect(codes.holdersOf(P, 'genuine').sort()).toEqual(['acme', unga].sort());
  });

  it('a client’s prefix disputed: its forwarder is told, answers for it, and the decision moves the client’s codes', () => {
    const { codes, svc, told } = harness();
    const unga = clientCoder('fwd', 'c1');
    codes.set(unga, { companyPrefix: P, extensionDigit: 4 }, 'Forwarder owner');
    const { disputeId } = svc.open(biz('genuine'), { companyPrefix: P, extensionDigit: 4, licenceRef: licence('genuine') }, t0);
    expect(told).toEqual([expect.objectContaining({ did: 'did:fwd', body: expect.stringContaining('the one you entered for your client Unga Millers') })]);
    expect(svc.forBusiness('fwd')).toEqual([expect.objectContaining({ side: 'holder', forClient: 'Unga Millers', claimantName: 'Genuine Goods Ltd', holderNames: ['Unga Millers'] })]);
    svc.sendLicence(biz('fwd'), disputeId, { licenceRef: licence('fwd') }, t0 + DAY);
    expect(svc.list(t0 + DAY)[0]).toMatchObject({ mayDecide: true, holders: [expect.objectContaining({ name: 'Unga Millers', licenceRef: licence('fwd'), digitNow: 4, forwarder: 'Swift Forwarders' })] });
    svc.propose(disputeId, amina, { to: 'claimant', what: 'Licences read', reason: 'The licence is Genuine’s' }, t0 + DAY);
    svc.approve(disputeId, baraka, t0 + DAY);
    expect(codes.of(unga)).toBeUndefined();
    expect(told.at(-1)).toMatchObject({ did: 'did:fwd', title: `The GS1 prefix ${P} is another business's` });
  });

  it('a forwarder says a prefix another business uses is its CLIENT’s — and the client is given it', () => {
    const { codes, svc, told } = harness();
    codes.set('acme', { companyPrefix: P, extensionDigit: 4 }, 'Wanjiku');
    expect(() => svc.open(biz('fwd'), { companyPrefix: P, extensionDigit: 4, licenceRef: licence('fwd'), forClientId: 'nobody' }, t0)).toThrow(/No such client/);
    const opened = svc.open(biz('fwd'), { companyPrefix: P, extensionDigit: 4, licenceRef: licence('fwd'), forClientId: 'c1' }, t0);
    expect(opened).toMatchObject({ side: 'claimant', forClient: 'Unga Millers', holderNames: ['Acme Traders'] });
    expect(svc.list(t0)[0].claimant).toMatchObject({ name: 'Unga Millers', licenceRef: licence('fwd') });
    svc.sendLicence(biz('acme'), opened.disputeId, { licenceRef: licence('acme') }, t0 + DAY);
    svc.propose(opened.disputeId, amina, { to: 'claimant', what: 'Licences read', reason: 'The licence names Unga Millers' }, t0 + DAY);
    svc.approve(opened.disputeId, baraka, t0 + DAY);
    expect(codes.of(clientCoder('fwd', 'c1'))).toMatchObject({ companyPrefix: P, extensionDigit: 4 });
    expect(codes.of('acme')).toBeUndefined();
    expect(svc.forBusiness('fwd')[0].decided).toMatchObject({ mine: true });
    // Told as the client's, never the forwarder's own.
    expect(told.find((x) => x.did === 'did:fwd' && x.title.startsWith(`The GS1 prefix ${P} is`))).toMatchObject({ title: `The GS1 prefix ${P} is your client Unga Millers's`, body: expect.stringContaining("Unga Millers's labels carry it from now on") });
  });
});
