import { createHash } from 'crypto';
import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import type { IntrospectionResult } from '../../foundation/auth/auth.types';
import { renderMail } from '../../foundation/mail/mail.templates';
import { ConsignmentNoteService } from './consignment-note.service';
import { DocumentLink, DocumentLinkService, LINK_DAYS, LINK_MAX_OPENS, linkUrl } from './document-link.service';
import type { Freight } from './dispatch.types';
import { NoteArchiveService } from './note-archive.service';
import { boardDocId } from './note-archive.types';
import { NoteBundleService } from './note-bundle.service';

/*
 * A LINK TO A DOCUMENT, IN THE EMAIL. The user, 2026-10-07: "Use ZeptoMail to send, keep the files on our own server,
 * and put a link in the email. No own mail server, and attachments only as an occasional extra."
 *
 * The link opens a document with nobody signed in, so everything here is about what KIND of key it is: one that
 * cannot be guessed, that is kept nowhere, that opens one document as one party reads it, that stops, that is
 * counted, and that the party it was made for can cancel.
 */

const SHOP = 'did:shop:a1';
const DRIVER = 'did:drv:amos';
const FLEET = 'did:fleet:kilima';
const STRANGER = 'did:shop:other';
const as = (role: string, did: string) => ({ active: true, role, did }) as unknown as IntrospectionResult;
const asShop = as('pudo', SHOP);
const asDriver = as('driver', DRIVER);
const asFleet = as('fleet_manager', FLEET);
const asStranger = as('pudo', STRANGER);
const asStaff = as('operator', 'did:glos:ops');
const DAY = 86_400_000;
const RECEIVER = 'Wanjiru at the gate';
/** What lies between two files in a bundle. The archive is written uncompressed, so a file's own bytes are there to read. */
const between = (zip: Buffer, from: string, to: string, back = 0) => {
  const start = zip.indexOf(Buffer.from(from));
  return zip.subarray(start, zip.indexOf(Buffer.from(to), start) - back);
};
/** A file's name in the archive is preceded by its thirty-byte header — which holds the checksum of what follows. */
const HEADER = 30;
const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
};

describe('a link to a document, in the email', () => {
  const made: NoteArchiveService[] = [];
  afterEach(() => {
    for (const a of made.splice(0)) a.onModuleDestroy();
  });

  /** A real note builder, a real archive listening on a real bus, a real bundle — and the mail that would have gone. */
  function setUp(opts: { email?: string | undefined } = { email: 'mama.sarah@kilima.co.ke' }) {
    const freights: Record<string, Freight> = {};
    const load = (over: Partial<Freight> = {}): Freight =>
      ({
        freightId: 'fr_1',
        code: 'FRT-010',
        description: 'Maize, 20 sacks',
        pickupLocation: { lat: -0.3, lng: 36.1 },
        pickupLabel: 'Mama Sarah Shop',
        destLabel: 'Riverside Corner',
        weightKg: 800,
        cargoClass: 'P4',
        natureCode: 'GEN',
        requiredCapabilities: [],
        requiredEquipment: [],
        status: 'delivered',
        postedByDid: SHOP,
        shipperDid: SHOP,
        claimedBy: DRIVER,
        claimedAt: '2026-09-14T08:00:00Z',
        createdAt: '2026-09-14T07:30:00Z',
        pickedUpAt: '2026-09-14T09:00:00Z',
        deliveredAt: '2026-09-14T12:04:00Z',
        lockedPrice: 350,
        pickupCountry: 'KE',
        destCountry: 'KE',
        ...over,
      }) as Freight;
    const bus = new EventBus();
    const sent: Array<{ template: string; to: { address: string }; params: Record<string, unknown> }> = [];
    const notes = new ConsignmentNoteService(
      { requireFreightPublic: (id: string) => freights[id] ?? (() => { throw new Error('not found'); })() } as never,
      { get: (did: string) => ({ displayName: 'Amos K.', managerDid: did === DRIVER ? FLEET : undefined, jurisdiction: 'KE' }) } as never,
      { get: () => ({ companyName: 'Kilima Logistics', depotAddress: '1 Depot Rd', jurisdiction: 'KE', did: FLEET }) } as never,
      { get: (did: string) => ({ shopName: did === SHOP ? 'Mama Sarah Shop' : 'Riverside Corner', landmark: 'Next to the market', country: 'KE', did }) } as never,
      { has: () => false, get: () => ({}) } as never,
      bus,
      { papersOnNote: () => [], noteParties: () => null } as never,
      { emailForDid: (did: string) => (did === SHOP ? opts.email : undefined) } as never,
      { send: async (template: string, to: { address: string }, params: Record<string, unknown>) => (sent.push({ template, to, params }), true) } as never,
    );
    notes.onModuleInit();
    const archive = new NoteArchiveService({ requireFreightPublic: (id: string) => freights[id] } as never, notes, {} as never, {} as never, bus);
    archive.onModuleInit();
    made.push(archive);
    const bundles = new NoteBundleService(archive, notes, { get: () => undefined, blob: () => { throw new Error('no photograph'); } } as never);
    const links = new DocumentLinkService(archive, bundles, notes);
    links.onModuleInit();
    const kept = () => [...(links as unknown as { links: Map<string, DocumentLink> }).links.values()];

    /** The goods are taken over, then handed over: two frozen copies, and the receipt goes. */
    const deliver = async (id = 'fr_1', over: Partial<Freight> = {}) => {
      // On the road first — nothing delivered, nobody's name at the door — so the two copies are two documents.
      freights[id] = load({ freightId: id, status: 'in_transit', deliveredAt: undefined, ...over });
      await bus.publish(GlosEvent.Pudo.FreightPickedUp, { freightId: id }, { source: 'test' });
      await flush();
      freights[id] = load({ freightId: id, proofOfDelivery: { receiverName: RECEIVER, photoRef: 'med_pod', confirmed: [], at: '2026-09-14T12:04:00Z' } as never, ...over });
      await bus.publish(GlosEvent.Pudo.FreightDelivered, { freightId: id }, { source: 'test' });
      await flush();
    };
    const tokenOf = (url: unknown) => String(url).split('#doc=')[1];
    return { freights, load, bus, sent, notes, archive, bundles, links, kept, deliver, tokenOf, docId: boardDocId('fr_1') };
  }

  describe('the receipt for a delivered load', () => {
    it('carries a link to the note, and the link opens the whole of it — the file, not a page about the file', async () => {
      const { sent, links, bundles, deliver, tokenOf, archive, docId } = setUp();
      const before = Date.now();
      await deliver();
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({ template: 'freight-delivered', to: { address: 'mama.sarah@kilima.co.ke' }, params: { code: 'FRT-010', noteNumber: 'CMR-FRT-010' } });
      // After the `#`: the part of an address a browser sends to no server.
      expect(sent[0].params.noteUrl).toMatch(/^http:\/\/localhost:5180\/#doc=[A-Za-z0-9_-]{43}$/);
      const until = Date.parse(String(sent[0].params.noteUntil));
      expect(until).toBeGreaterThanOrEqual(before + LINK_DAYS * DAY);
      expect(until).toBeLessThanOrEqual(Date.now() + LINK_DAYS * DAY);

      const token = tokenOf(sent[0].params.noteUrl);
      expect(links.look(token)).toEqual({
        state: 'ready',
        expiresAt: sent[0].params.noteUntil,
        number: 'CMR-FRT-010',
        from: 'Mama Sarah Shop',
        to: 'Riverside Corner',
        deliveredAt: '2026-09-14T12:04:00Z',
        opensLeft: LINK_MAX_OPENS,
        documentUntil: archive.document(docId, asShop).retention.documentUntil,
      });
      const file = links.fetch(token);
      expect(file.filename).toBe('CMR-FRT-010.zip');
      expect(file.bytes.subarray(0, 2).toString('latin1')).toBe('PK');
      for (const inside of ['README.txt', 'consignment-note.html', 'copies/01-taken_over.html', 'copies/02-delivered.json', 'manifest.json']) expect(file.bytes.includes(Buffer.from(inside))).toBe(true);
      // Each copy is ITS OWN moment: the one frozen at taking over does not know who was at the door.
      const takenOver = between(file.bytes, 'copies/01-taken_over.json', 'copies/02-delivered.html');
      // (The manifest's `exportedAt` is the first thing in the file that is about the export and not the note; the
      // README names the other files in its own words, so it cannot serve as a marker.)
      const delivered = between(file.bytes, 'copies/02-delivered.json', '"exportedAt"');
      expect([takenOver.length > 500, delivered.length > 500]).toEqual([true, true]);
      expect([takenOver.includes(Buffer.from(RECEIVER)), delivered.includes(Buffer.from(RECEIVER))]).toEqual([false, true]);
      // The same file the shop gets signed in — every copy, byte for byte — not a lesser one.
      const signedIn = bundles.one(docId, asShop);
      // Up to the manifest's own header: the manifest says when it was exported, so its checksum is each export's own.
      const copies = (zip: Buffer) => between(zip, 'copies/01-taken_over.html', 'manifest.json', HEADER);
      expect(copies(file.bytes).length).toBeGreaterThan(2000);
      expect(copies(file.bytes).equals(copies(signedIn.bytes))).toBe(true);
      expect(file.bytes.length).toBe(signedIn.bytes.length);
    });

    it('says in the email what the button is: it works without signing in, until when, and for whoever has the email', async () => {
      const { sent, deliver } = setUp();
      await deliver();
      const mail = renderMail('freight-delivered', sent[0].params as never);
      expect(mail.html).toContain(`<a href="${String(sent[0].params.noteUrl)}"`);
      expect(mail.html).toContain('>Get the consignment note</a>');
      expect(mail.text).toContain(`Get the consignment note: ${String(sent[0].params.noteUrl)}`);
      expect(mail.text).toMatch(/This button works without signing in\nUntil \d{1,2} [A-Z][a-z]{2} \d{4}, \d{2}:\d{2} UTC, it opens the note for whoever has this email — so forward it only to somebody who should have the note\. You can see how often it was opened, and cancel it, on the note itself: in the Shop app, Records, then Notes. The note stays there after the button stops./);
      // One button: the note. The app is named in words.
      expect(mail.html.match(/<a href=/g)).toHaveLength(2); // the button, and the help link at the foot
      expect(mail.html).not.toContain('Open the Shop app');
      // The note is not IN the email: nothing is attached but the logo.
      expect(mail.images.map((i) => i.name)).toEqual(['seebuyget.png']);
    });

    it('goes all the same when no link can be made, and says where the note is instead', async () => {
      // No document to link to at the moment the receipt is written: the link-maker answers with nothing.
      const noDoc = setUp();
      noDoc.notes.registerReceiptLink(() => undefined);
      await noDoc.deliver();
      expect(noDoc.sent[0].params).not.toHaveProperty('noteUrl');
      const mail = renderMail('freight-delivered', noDoc.sent[0].params as never);
      expect(mail.text).toMatch(/is on the load in the Shop app under Freight\. Open it there to print or save it for your books\./);
      expect(mail.html).toContain('>Open the Shop app</a>');
      expect(mail.html).not.toContain('#doc=');
      // A link-maker that fails is not a receipt that fails.
      const broken = setUp();
      broken.notes.registerReceiptLink(() => {
        throw new Error('store is down');
      });
      await broken.deliver();
      expect(broken.sent).toHaveLength(1);
      expect(broken.sent[0].params).not.toHaveProperty('noteUrl');
      // And the link-maker itself answers with nothing — not an error — for a load whose note was never frozen.
      const never = setUp();
      never.freights.fr_1 = never.load();
      await never.bus.publish(GlosEvent.Pudo.FreightDelivered, { freightId: 'fr_1' }, { source: 'test' });
      await flush();
      expect(never.sent).toHaveLength(1);
      expect(never.links.issue(boardDocId('fr_never'), SHOP)).toBeUndefined();
    });

    it('makes no link for a shipper with no email: there is nobody to send it to', async () => {
      const { sent, kept, deliver } = setUp({ email: undefined });
      await deliver();
      expect(sent).toHaveLength(0);
      expect(kept()).toHaveLength(0);
    });
  });

  describe('the key', () => {
    it('is kept nowhere: the store holds its fingerprint, and reading the store opens nothing', async () => {
      const { sent, kept, links, deliver, tokenOf } = setUp();
      await deliver();
      const token = tokenOf(sent[0].params.noteUrl);
      const stored = kept();
      expect(stored).toHaveLength(1);
      expect(JSON.stringify(stored)).not.toContain(token);
      expect(stored[0].tokenHash).toBe(createHash('sha256').update(token).digest('hex'));
      expect(stored[0]).toMatchObject({ docId: boardDocId('fr_1'), forDid: SHOP, opened: 0, sentTo: 'm…@kilima.co.ke' });
      // Not the address either: who a shop's email goes to is not something a record of a link should hold.
      expect(JSON.stringify(stored)).not.toContain('mama.sarah');
      // Nothing in the record, used as a key, opens anything.
      // Asked of the SAME store that holds the record — the first version of this asked an empty one, and proved nothing.
      for (const notAKey of [stored[0].tokenHash, stored[0].linkId, stored[0].docId, stored[0].tokenHash.slice(0, 43)]) {
        expect(() => links.look(notAKey)).toThrow('This is not a link we made');
        expect(() => links.fetch(notAKey)).toThrow('This is not a link we made');
      }
      expect(links.look(token).state).toBe('ready');
    });

    it('has no part that is the same from one key to the next', () => {
      const { links, load, freights, archive } = setUp();
      freights.fr_1 = load();
      archive.freezeFreight('fr_1', 'taken_over', 'The carrier took the goods over');
      const keys = Array.from({ length: 64 }, () => Buffer.from(links.issue(boardDocId('fr_1'), SHOP)!.token, 'base64url'));
      expect(new Set(keys.map((k) => k.toString('hex'))).size).toBe(64);
      // Every one of the 32 bytes moves. A key padded out from a few random bytes would have columns that never change.
      for (let i = 0; i < 32; i++) expect([i, new Set(keys.map((k) => k[i])).size > 16]).toEqual([i, true]);
    });

    it('is 256 bits that nobody can guess, and anything else is simply not a link — with nothing to tell one miss from another', async () => {
      const { links, sent, deliver, tokenOf, archive } = setUp();
      await deliver();
      const token = tokenOf(sent[0].params.noteUrl);
      expect(Buffer.from(token, 'base64url')).toHaveLength(32);
      const second = links.issue(boardDocId('fr_1'), SHOP)!;
      expect(second.token).not.toBe(token);
      const flipped = (token[0] === 'A' ? 'B' : 'A') + token.slice(1);
      const misses = ['', 'x', token.slice(1), token + 'A', token.toLowerCase() === token ? token.toUpperCase() : token.toLowerCase(), flipped, ' ' + token, `${token}\n`, boardDocId('fr_1'), '../../etc/passwd', 'A'.repeat(43)];
      for (const miss of misses) {
        expect(() => links.look(miss)).toThrow('This is not a link we made');
        expect(() => links.fetch(miss)).toThrow('This is not a link we made');
      }
      expect(() => links.look(undefined as never)).toThrow('This is not a link we made');
      expect(() => links.look({ toString: () => token } as never)).toThrow('This is not a link we made');
      expect(archive.document(boardDocId('fr_1'), asShop).number).toBe('CMR-FRT-010');
    });

    it('is not used up by being looked at — a mail scanner follows every link before the reader does', async () => {
      const { links, sent, kept, deliver, tokenOf } = setUp();
      await deliver();
      const token = tokenOf(sent[0].params.noteUrl);
      for (let i = 0; i < 200; i++) links.look(token);
      expect(kept()[0]).toMatchObject({ opened: 0 });
      expect(kept()[0].lastOpenedAt).toBeUndefined();
      expect(links.look(token)).toMatchObject({ state: 'ready', opensLeft: LINK_MAX_OPENS });
    });

    it('goes in the part of the address a browser sends to no server', () => {
      expect(linkUrl('abc')).toBe('http://localhost:5180/#doc=abc');
      const was = process.env.SBG_PUBLIC_URL;
      process.env.SBG_PUBLIC_URL = 'https://seebuyget.com/';
      expect(linkUrl('abc')).toBe('https://seebuyget.com/#doc=abc');
      expect(new URL(linkUrl('abc')).search).toBe('');
      if (was === undefined) delete process.env.SBG_PUBLIC_URL;
      else process.env.SBG_PUBLIC_URL = was;
    });
  });

  describe('what it opens', () => {
    it('is one document, as the party it was made for reads it — and it cannot be made for anybody who is not a party', async () => {
      const { links, deliver, archive } = setUp();
      await deliver();
      const docId = boardDocId('fr_1');
      // The parties of this note: the shop that sent it, the driver, the driver's fleet. Nobody else.
      for (const party of [SHOP, DRIVER, FLEET]) expect(links.issue(docId, party)).toBeDefined();
      for (const not of [STRANGER, '', 'did:glos:ops', undefined as never]) expect(links.issue(docId, not)).toBeUndefined();
      expect(links.issue(boardDocId('fr_other'), SHOP)).toBeUndefined();
      expect(links.issue('', SHOP)).toBeUndefined();
      expect([archive.hasFor(docId, SHOP), archive.hasFor(docId, STRANGER), archive.hasFor(docId, ''), archive.hasFor('nope', SHOP)]).toEqual([true, false, false, false]);
      // Reading "as a party" is never reading as staff do: a party that is not one is told there is no such note.
      expect(() => archive.documentAsParty(docId, STRANGER)).toThrow('No such consignment note in the archive');
      expect(() => archive.versionAsParty(docId, 0, 'did:glos:ops')).toThrow('No such consignment note in the archive');
      expect(() => archive.documentAsParty(docId, '')).toThrow('No such consignment note in the archive');
    });

    it('hands over the file as it stands WHEN IT IS ASKED FOR: what was signed after the email went is in it', async () => {
      const { links, freights, load, bus, deliver, sent, tokenOf, archive } = setUp();
      await deliver();
      const token = tokenOf(sent[0].params.noteUrl);
      const first = links.fetch(token);
      // A claim is filed a day later: a third copy is frozen. The link sent at delivery hands that over too.
      freights.fr_1 = load({ claim: { reason: 'damaged', note: 'Two sacks torn', at: '2026-09-15T08:00:00Z' } as never });
      await bus.publish(GlosEvent.Pudo.FreightClaimOpened, { freightId: 'fr_1' }, { source: 'test' });
      await flush();
      expect(archive.document(boardDocId('fr_1'), asShop).versions.map((v) => v.stage)).toEqual(['taken_over', 'delivered', 'claimed']);
      const later = links.fetch(token);
      expect(first.bytes.includes(Buffer.from('copies/03-claimed.html'))).toBe(false);
      expect(later.bytes.includes(Buffer.from('copies/03-claimed.html'))).toBe(true);
      expect(later.bytes.length).toBeGreaterThan(first.bytes.length);
    });
  });

  describe('how it stops', () => {
    it('stops on its date, to the millisecond, and then says only that it has stopped', async () => {
      const { links, sent, deliver, tokenOf } = setUp();
      await deliver();
      const token = tokenOf(sent[0].params.noteUrl);
      const until = Date.parse(String(sent[0].params.noteUntil));
      expect(links.look(token, until - 1).state).toBe('ready');
      expect(links.fetch(token, until - 1).filename).toBe('CMR-FRT-010.zip');
      // Stopped: not the number, not the route — a link that opens nothing says nothing about what it opened.
      expect(links.look(token, until)).toEqual({ state: 'expired', expiresAt: sent[0].params.noteUntil });
      expect(() => links.fetch(token, until)).toThrow('This link has stopped working: its time is up');
      expect(() => links.fetch(token, until + 365 * DAY)).toThrow('This link has stopped working: its time is up');
    });

    it('hands the file over a set number of times and no more, and counts only a file that was really handed over', async () => {
      const { links, bundles, kept, sent, deliver, tokenOf } = setUp();
      await deliver();
      const token = tokenOf(sent[0].params.noteUrl);
      const at = Date.parse('2026-09-20T10:00:00Z');
      // A file that could not be built is not an opening.
      const real = bundles.oneAsParty.bind(bundles);
      bundles.oneAsParty = () => {
        throw new Error('disk full');
      };
      expect(() => links.fetch(token, at)).toThrow('disk full');
      expect(kept()[0]).toMatchObject({ opened: 0 });
      bundles.oneAsParty = real;

      for (let i = 1; i <= LINK_MAX_OPENS; i++) {
        links.fetch(token, at + i * 1000);
        expect(links.look(token, at + i * 1000 + 1)).toMatchObject(i < LINK_MAX_OPENS ? { state: 'ready', opensLeft: LINK_MAX_OPENS - i } : { state: 'used_up' });
      }
      expect(kept()[0]).toMatchObject({ opened: LINK_MAX_OPENS, lastOpenedAt: new Date(at + LINK_MAX_OPENS * 1000).toISOString() });
      expect(() => links.fetch(token, at + 60_000)).toThrow('This link has been opened as often as one link can be');
      expect(kept()[0].opened).toBe(LINK_MAX_OPENS);
      expect(links.look(token, at + 60_000)).toEqual({ state: 'used_up', expiresAt: sent[0].params.noteUntil });
    });

    it('opens nothing once the document itself has passed the end of its keeping', async () => {
      const { links, archive, sent, deliver, tokenOf } = setUp();
      await deliver();
      const token = tokenOf(sent[0].params.noteUrl);
      const doc = archive.document(boardDocId('fr_1'), asShop);
      const gone = Date.parse(doc.retention.documentUntil!) + DAY;
      // A second link made the day before the document goes: its own date is a month away, and it still opens nothing.
      const late = links.issue(boardDocId('fr_1'), SHOP, { now: gone - 2 * DAY })!;
      expect(links.look(late.token, gone - 2 * DAY).state).toBe('ready');
      expect(archive.sweepExpired(gone).deleted).toBe(1);
      expect(links.look(late.token, gone)).toEqual({ state: 'gone', expiresAt: late.link.expiresAt });
      expect(() => links.fetch(late.token, gone)).toThrow('The document this link opened is no longer kept');
      // The first link is past its date too; what became of the document is what is said.
      expect(links.look(token, gone).state).toBe('gone');
    });
  });

  describe('the party it was made for', () => {
    it('sees it on the document: where it went, how often it was opened, whether it still opens — newest first', async () => {
      const { links, sent, deliver, tokenOf } = setUp();
      await deliver();
      const docId = boardDocId('fr_1');
      const token = tokenOf(sent[0].params.noteUrl);
      const at = Date.now() + 60_000;
      links.fetch(token, at);
      links.fetch(token, at + 5_000);
      const second = links.issue(docId, SHOP, { sentTo: 'books@kilima.co.ke', now: at + 10_000 })!;
      const rows = links.listFor(docId, asShop, at + 20_000);
      expect(rows).toEqual([
        { linkId: second.link.linkId, state: 'ready', sentTo: 'b…@kilima.co.ke', createdAt: second.link.createdAt, expiresAt: second.link.expiresAt, opened: 0 },
        { linkId: expect.stringMatching(/^dl_[0-9a-f]{16}$/), state: 'ready', sentTo: 'm…@kilima.co.ke', createdAt: expect.any(String), expiresAt: sent[0].params.noteUntil, opened: 2, lastOpenedAt: new Date(at + 5_000).toISOString() },
      ]);
      // What the owner is shown opens nothing either.
      expect(JSON.stringify(rows)).not.toContain(token);
      expect(JSON.stringify(rows)).not.toMatch(/tokenHash|forDid|mama\.sarah|books@/);
      expect(links.listFor(docId, asShop, Date.parse(String(sent[0].params.noteUntil)))[1].state).toBe('expired');
    });

    it('is the only one who sees it or cancels it — the other parties to the note do not learn where the shop sent its copy', async () => {
      const { links, sent, deliver, tokenOf } = setUp();
      await deliver();
      const docId = boardDocId('fr_1');
      const token = tokenOf(sent[0].params.noteUrl);
      const [{ linkId }] = links.listFor(docId, asShop);
      // The carrier is a party to the note, and reads the note. Not the shop's links.
      expect(links.listFor(docId, asDriver)).toEqual([]);
      expect(links.listFor(docId, asFleet)).toEqual([]);
      expect(() => links.cancel(docId, linkId, asDriver)).toThrow('No such link on this document');
      expect(() => links.cancel(docId, linkId, asFleet)).toThrow('No such link on this document');
      // Somebody who is no party is told there is no such note at all.
      expect(() => links.listFor(docId, asStranger)).toThrow('No such consignment note in the archive');
      expect(() => links.cancel(docId, linkId, asStranger)).toThrow('No such consignment note in the archive');
      expect(() => links.listFor(docId, undefined)).toThrow();
      // A link is cancelled on ITS document: the right link under another document's address is no link.
      expect(() => links.cancel(boardDocId('fr_other'), linkId, asStaff)).toThrow('No such consignment note in the archive');
      expect(() => links.cancel(docId, 'dl_0000000000000000', asShop)).toThrow('No such link on this document');
      expect(links.look(token).state).toBe('ready');
      // …and that holds for a second note the same shop IS a party to: each note lists its own links and no other's,
      // and a link is not cancelled from the wrong note, by its owner or by staff.
      await deliver('fr_2', { code: 'FRT-011' });
      const otherDoc = boardDocId('fr_2');
      const [other] = links.listFor(otherDoc, asShop);
      expect(sent).toHaveLength(2);
      expect(other.linkId).not.toBe(linkId);
      expect(links.listFor(docId, asShop).map((r) => r.linkId)).toEqual([linkId]);
      expect(links.listFor(otherDoc, asStaff).map((r) => r.linkId)).toEqual([other.linkId]);
      expect(() => links.cancel(otherDoc, linkId, asShop)).toThrow('No such link on this document');
      expect(() => links.cancel(otherDoc, linkId, asStaff)).toThrow('No such link on this document');
      expect(links.look(token).state).toBe('ready');
      expect(links.look(tokenOf(sent[1].params.noteUrl))).toMatchObject({ state: 'ready', number: 'CMR-FRT-011' });
      // Staff see them all, as they see the document, and can cancel one.
      const carriers = links.issue(docId, FLEET)!;
      expect(links.listFor(docId, asStaff).map((r) => r.linkId).sort()).toEqual([linkId, carriers.link.linkId].sort());
      expect(links.listFor(docId, asFleet).map((r) => r.linkId)).toEqual([carriers.link.linkId]);
    });

    it('cancels it: from then on it opens nothing, whoever holds the email — and the other link on the note is untouched', async () => {
      const { links, sent, deliver, tokenOf } = setUp();
      await deliver();
      const docId = boardDocId('fr_1');
      const token = tokenOf(sent[0].params.noteUrl);
      const other = links.issue(docId, SHOP)!;
      const mine = links.listFor(docId, asShop).find((r) => r.linkId !== other.link.linkId)!;
      const at = Date.now() + 1000;
      const row = links.cancel(docId, mine.linkId, asShop, at);
      expect(row).toMatchObject({ linkId: mine.linkId, state: 'cancelled', cancelledAt: new Date(at).toISOString() });
      expect(links.look(token, at)).toEqual({ state: 'cancelled', expiresAt: sent[0].params.noteUntil });
      expect(() => links.fetch(token, at)).toThrow('This link was cancelled');
      // Twice is the same as once: the moment it was cancelled does not move.
      expect(links.cancel(docId, mine.linkId, asShop, at + DAY).cancelledAt).toBe(new Date(at).toISOString());
      // Cancelled is what was DONE to it, and is what is said — even after its date, even after the document goes.
      expect(links.look(token, at + 400 * DAY).state).toBe('cancelled');
      expect(links.look(other.token, at).state).toBe('ready');
      expect(links.fetch(other.token, at).filename).toBe('CMR-FRT-010.zip');
      expect(links.cancel(docId, other.link.linkId, asStaff, at).state).toBe('cancelled');
    });
  });
});
