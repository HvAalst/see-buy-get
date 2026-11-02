import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { ConversationService, MESSAGES_PER_HOUR, carriesBytes } from './conversation.service';
import { MESSAGE_KINDS } from './conversation.types';
import { DamageReportService } from './damage-report.service';
import { FiledPhotoService, fingerprintOf } from './filed-photo.service';
import { MediaService } from './media.service';

/*
 * 2026-11-02 — A PHOTO IS FILED, THEN SHOWN (the owner: "I want to avoid that images are shared rather than attached to the
 * right file path. Damage claims should be fingerprinted and just sharing blurs this").
 *
 * Built over a real media store (bytes in memory under Jest) and stubs for the records, because what is under test is the
 * filing: who may, what is kept, what the thread carries, what a report hands over — not the parcel or load machinery.
 */

// A valid 1x1 PNG — the smallest real raster that passes the media store's checks.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const PNG_B64 = PNG.split(',')[1];
const PNG_SHA = createHash('sha256').update(Buffer.from(PNG_B64, 'base64')).digest('hex');
const NOW = Date.parse('2026-11-02T10:42:00Z');
const DAY = 86_400_000;

describe('a photo is filed to its load or parcel, then shown in the chat', () => {
  let loads: Record<string, Record<string, unknown>>;
  let parcels: Record<string, Record<string, unknown>>;
  let media: MediaService;
  let filed: FiledPhotoService;
  let chats: ConversationService;
  let reports: DamageReportService;

  const person = (did: string) => ({ personDid: did, phoneHash: `h_${did}` });

  beforeEach(() => {
    loads = {
      fr_1: { freightId: 'fr_1', code: 'FRT-7781', status: 'in_transit', claimedBy: 'did:drv:tsehay', postedByDid: 'did:shop', description: 'Maize', pickupLabel: 'Nakuru', destLabel: 'Nairobi' },
      fr_open: { freightId: 'fr_open', code: 'FRT-0002', status: 'available', postedByDid: 'did:shop', description: 'Tiles', pickupLabel: 'A', destLabel: 'B' },
      fr_gone: { freightId: 'fr_gone', code: 'FRT-0003', status: 'cancelled', claimedBy: 'did:drv:tsehay', postedByDid: 'did:shop', description: 'Sand', pickupLabel: 'A', destLabel: 'B' },
      fr_old: { freightId: 'fr_old', code: 'FRT-0004', status: 'delivered', deliveredAt: new Date(NOW - 10 * DAY).toISOString(), claimedBy: 'did:drv:tsehay', postedByDid: 'did:shop', description: 'Salt', pickupLabel: 'A', destLabel: 'B' },
    };
    parcels = {
      pcl_1: { parcelId: 'pcl_1', status: 'Ready_For_Pickup', destAgentDid: 'did:agent:mama', receiver: { owner: 'did:person:wanjiru' }, sender: { owner: 'did:person:otieno' }, scans: [], custody: [], size: 'S' },
      pcl_void: { parcelId: 'pcl_void', status: 'Voided', destAgentDid: 'did:agent:mama', receiver: { owner: 'did:person:wanjiru' }, scans: [], custody: [], size: 'S' },
    };
    const dispatch = {
      requireFreightPublic: (id: string) => {
        if (!loads[id]) throw new Error('not found');
        return loads[id];
      },
      posterCurrencyOf: () => 'KES',
    };
    const parcelsSvc = {
      get: (id: string) => {
        if (!parcels[id]) throw new Error('Parcel not found');
        return parcels[id];
      },
      list: () => Object.values(parcels),
      receiverOf: (p: { receiver?: unknown }) => p.receiver ?? {},
      senderOf: (p: { sender?: unknown }) => p.sender ?? {},
      intakeTermsFor: () => {
        throw new Error('no counter terms');
      },
      registerProblemReported: () => undefined,
    };
    const persons = {
      findByDid: (did: string) => (did.startsWith('did:person:') ? person(did) : undefined),
      findByHash: () => undefined,
      profile: () => ({ displayName: 'Wanjiru' }),
    };
    const drivers = { canOperate: (did: string) => did.startsWith('did:drv'), get: (did: string) => ({ displayName: did === 'did:drv:tsehay' ? 'Tsehay' : 'Kofi', managerDid: undefined }) };
    const vendors = { has: () => false, get: () => ({ did: 'did:store' }) };
    const agents = { get: () => ({ shopName: 'Mama Sarah Shop' }), find: () => ({ shopName: 'Mama Sarah Shop' }) };
    media = new MediaService();
    filed = new FiledPhotoService(media, dispatch as never, parcelsSvc as never, persons as never, drivers as never, vendors as never);
    chats = new ConversationService(dispatch as never, drivers as never, { notify: jest.fn(async () => ({})) } as never, vendors as never, parcelsSvc as never, persons as never, agents as never, filed);
    reports = new DamageReportService(parcelsSvc as never, agents as never, media, vendors as never, persons as never, drivers as never, undefined, undefined, undefined, undefined, undefined, filed);
  });

  const upload = (ownerDid: string) => media.upload({ ownerDid, kind: 'filed', dataUrl: PNG }).mediaId;
  /** Nothing of a refused filing is kept: the photo is nobody's evidence, the thread did not grow, the record holds nothing. */
  const nothingKept = (mediaId: string, conversationId: string, lastSeq: number, subject: { freightId?: string; parcelId?: string }) => {
    expect(media.get(mediaId)?.link).toBeUndefined();
    expect(chats.messagesFor(conversationId, 'did:shop').thread.lastSeq).toBe(lastSeq);
    expect(filed.forSubject(subject)).toEqual([]);
  };

  it('files a photo by the driver carrying the load: kept with the load, fingerprinted, and shown as a card', () => {
    const { conversationId } = chats.open('fr_1', 'did:drv:tsehay');
    const mediaId = upload('did:drv:tsehay');
    const card = chats.filePhoto(conversationId, 'did:drv:tsehay', { mediaId, as: 'damage', source: 'app_camera', takenAt: '2026-11-02T10:41:50Z' }, NOW);

    expect(card.kind).toBe('photo');
    const photo = card.photo!;
    expect(photo).toMatchObject({ subject: 'freight', freightId: 'fr_1', code: 'FRT-7781', as: 'damage', by: 'driver', mediaId, sha256: PNG_SHA, source: 'app_camera', takenAt: '2026-11-02T10:41:50.000Z', filedAt: new Date(NOW).toISOString() });
    // The card's own fingerprint is over exactly what the card says: anybody holding it can work it out again.
    expect(photo.fingerprint).toBe(fingerprintOf(photo));
    expect(photo.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    // Kept with the load, as the load's, on the record's own clock.
    expect(media.get(mediaId)).toMatchObject({ kind: 'filed', link: { type: 'freight', id: 'fr_1' }, retentionClass: 'shipment-proof' });
    expect(filed.forSubject({ freightId: 'fr_1' }).map((f) => f.filingId)).toEqual([photo.filingId]);
    // The poster reads the card in the thread, the photo through it, and the load's photo file.
    expect(chats.messagesFor(conversationId, 'did:shop').items[0].photo).toEqual(photo);
    expect(chats.photoFor(conversationId, photo.filingId, 'did:shop').bytes.toString('base64')).toBe(PNG_B64);
    expect(chats.recordPhotos(conversationId, 'did:shop')).toMatchObject({ code: 'FRT-7781', subject: 'freight', items: [{ filingId: photo.filingId, here: true }] });
  });

  it('files to a parcel by the person collecting it and by the shop holding it — each named by their part in the parcel', () => {
    const { conversationId } = chats.openAboutParcel('pcl_1', 'did:person:wanjiru');
    const a = chats.filePhoto(conversationId, 'did:person:wanjiru', { mediaId: upload('did:person:wanjiru'), as: 'proof', proofOf: 'handover', source: 'gallery' }, NOW);
    const b = chats.filePhoto(conversationId, 'did:agent:mama', { mediaId: upload('did:agent:mama'), as: 'paper', source: 'unknown' }, NOW);
    expect(a.photo).toMatchObject({ subject: 'parcel', parcelId: 'pcl_1', code: 'pcl_1', by: 'receiver', as: 'proof', proofOf: 'handover' });
    expect(b.photo).toMatchObject({ by: 'shop', as: 'paper', source: 'unknown' });
    expect(b.photo).not.toHaveProperty('phoneDate');
  });

  it('refuses, before anything is kept: a stranger, a driver who only asked, a closed record, a photo not theirs, a closed thread', () => {
    // A stranger to the thread is told it does not exist.
    const own = chats.open('fr_1', 'did:drv:tsehay');
    const m0 = upload('did:drv:kofi');
    expect(() => chats.filePhoto(own.conversationId, 'did:drv:kofi', { mediaId: m0, as: 'damage', source: 'gallery' }, NOW)).toThrow(/Conversation not found/);

    // A driver who only asked about a load has nothing of theirs on it — and is not offered the camera; its poster is.
    const asked = chats.open('fr_open', 'did:drv:kofi');
    expect(asked.canFilePhotos).toBe(false);
    expect(chats.listFor('did:shop').find((c) => c.conversationId === asked.conversationId)?.canFilePhotos).toBe(true);
    expect(own.canFilePhotos).toBe(true);
    const m1 = upload('did:drv:kofi');
    expect(() => chats.filePhoto(asked.conversationId, 'did:drv:kofi', { mediaId: m1, as: 'damage', source: 'gallery' }, NOW)).toThrow(/not carrying this load/);
    nothingKept(m1, asked.conversationId, 0, { freightId: 'fr_open' });

    // A cancelled load, and one delivered beyond the time to claim, are closed.
    const gone = chats.open('fr_gone', 'did:drv:tsehay');
    const m2 = upload('did:drv:tsehay');
    expect(() => chats.filePhoto(gone.conversationId, 'did:drv:tsehay', { mediaId: m2, as: 'damage', source: 'app_camera' }, NOW)).toThrow(/cancelled/);
    nothingKept(m2, gone.conversationId, 0, { freightId: 'fr_gone' });
    const old = chats.open('fr_old', 'did:drv:tsehay');
    const m3 = upload('did:drv:tsehay');
    expect(() => chats.filePhoto(old.conversationId, 'did:drv:tsehay', { mediaId: m3, as: 'proof', proofOf: 'delivery', source: 'app_camera' }, NOW)).toThrow(/more than 7 days ago/);
    nothingKept(m3, old.conversationId, 0, { freightId: 'fr_old' });

    // Somebody else's photo is never laundered into a record.
    const m4 = upload('did:shop');
    expect(() => chats.filePhoto(own.conversationId, 'did:drv:tsehay', { mediaId: m4, as: 'damage', source: 'gallery' }, NOW)).toThrow(/We do not hold that photo/);
    expect(media.get(m4)?.link).toBeUndefined();

    // A voided parcel is closed; a parcel is never "loaded".
    const voided = chats.openAboutParcel('pcl_1', 'did:person:wanjiru');
    parcels.pcl_1.status = 'Voided';
    const m5 = upload('did:person:wanjiru');
    expect(() => chats.filePhoto(voided.conversationId, 'did:person:wanjiru', { mediaId: m5, as: 'damage', source: 'gallery' }, NOW)).toThrow(/voided or sent back/);
    parcels.pcl_1.status = 'Ready_For_Pickup';
    expect(() => chats.filePhoto(voided.conversationId, 'did:person:wanjiru', { mediaId: m5, as: 'proof', proofOf: 'loading', source: 'gallery' }, NOW)).toThrow(/proof of loading is for a load/);
    expect(media.get(m5)?.link).toBeUndefined();
    expect(filed.forSubject({ parcelId: 'pcl_1' })).toEqual([]);

    // A blocked thread takes no card.
    chats.block(own.conversationId, 'did:shop');
    const m6 = upload('did:drv:tsehay');
    expect(() => chats.filePhoto(own.conversationId, 'did:drv:tsehay', { mediaId: m6, as: 'damage', source: 'gallery' }, NOW)).toThrow(/closed/);
    expect(media.get(m6)?.link).toBeUndefined();
    expect(filed.forSubject({ freightId: 'fr_1' })).toEqual([]);
  });

  it('a filing the hourly cap refuses leaves nothing behind: no card, no filing, the photo nobody’s evidence', () => {
    const { conversationId } = chats.open('fr_1', 'did:drv:tsehay');
    for (let i = 0; i < MESSAGES_PER_HOUR; i += 1) chats.send(conversationId, 'did:drv:tsehay', { body: `m${i}` }, NOW);
    const mediaId = upload('did:drv:tsehay');
    expect(() => chats.filePhoto(conversationId, 'did:drv:tsehay', { mediaId, as: 'damage', source: 'app_camera' }, NOW)).toThrow(/a lot of messages/);
    nothingKept(mediaId, conversationId, MESSAGES_PER_HOUR, { freightId: 'fr_1' });
  });

  it('keeps the gallery and app labels as sent — and refuses a label that is not one', () => {
    const { conversationId } = chats.open('fr_1', 'did:drv:tsehay');
    const file = (input: Record<string, string>) => chats.filePhoto(conversationId, 'did:drv:tsehay', { mediaId: upload('did:drv:tsehay'), as: 'damage', ...input } as never, NOW).photo!;
    expect(file({ source: 'gallery', phoneDate: '2026-10-30T14:22:05' })).toMatchObject({ source: 'gallery', phoneDate: '2026-10-30T14:22:05' });
    expect(file({ source: 'gallery' })).not.toHaveProperty('phoneDate');
    expect(file({ source: 'app_camera', takenAt: '2026-11-02T10:40:00Z' })).toMatchObject({ source: 'app_camera', takenAt: '2026-11-02T10:40:00.000Z' });
    const sha = 'a'.repeat(64);
    expect(file({ source: 'gallery', originalSha256: sha })).toMatchObject({ originalSha256: sha });
    // A gallery photo is not dated by the app, the app's camera by no file's date, and an unknown origin by nothing.
    expect(() => file({ source: 'gallery', takenAt: '2026-11-02T10:40:00Z' })).toThrow(/phone’s own date/);
    expect(() => file({ source: 'app_camera', phoneDate: '2026-10-30' })).toThrow(/dated when it was taken/);
    expect(() => file({ source: 'unknown', phoneDate: '2026-10-30' })).toThrow(/carries no date/);
    expect(() => file({ source: 'gallery', phoneDate: '30/10/2026' })).toThrow(/written as/);
    expect(() => file({ source: 'satellite' })).toThrow(/Where the photo came from/);
    expect(() => file({ source: 'gallery', as: 'selfie' })).toThrow(/What the photo is/);
    expect(() => file({ source: 'gallery', as: 'damage', proofOf: 'delivery' })).toThrow(/Only proof/);
  });

  it('a thread carries the reference, never the picture — and no kind of message can carry one', () => {
    const { conversationId } = chats.open('fr_1', 'did:drv:tsehay');
    chats.filePhoto(conversationId, 'did:drv:tsehay', { mediaId: upload('did:drv:tsehay'), as: 'damage', source: 'gallery' }, NOW);
    const read = JSON.stringify(chats.messagesFor(conversationId, 'did:shop'));
    expect(read).not.toContain(PNG_B64.slice(0, 40));
    expect(read).not.toMatch(/data:image/);
    const listed = JSON.stringify(chats.listFor('did:shop'));
    expect(listed).not.toContain(PNG_B64.slice(0, 40));

    // Whatever door a message comes in by, a picture in it is refused before anything is kept.
    expect(() => chats.send(conversationId, 'did:shop', { body: PNG })).toThrow(/never sent inside a message/);
    expect(() => chats.send(conversationId, 'did:shop', { body: `look ${PNG}` })).toThrow(/never sent inside a message/);
    // Words that only start like it are words.
    expect(chats.send(conversationId, 'did:shop', { body: 'Data: 5 pallets, 2 broken' }).body).toBe('Data: 5 pallets, 2 broken');

    // Every kind, carrying a picture in any field, is refused by the one gate every message passes.
    for (const kind of MESSAGE_KINDS) {
      expect(carriesBytes({ kind, body: PNG })).toBe(true);
      expect(carriesBytes({ kind, photo: { mediaId: PNG } })).toBe(true);
      expect(carriesBytes({ kind, body: 'x'.repeat(9000) })).toBe(true);
      expect(carriesBytes({ kind, body: 'On my way' })).toBe(false);
    }
  });

  it('the guard reads what a message may hold: no field in it is named for bytes', () => {
    const source = readFileSync(join(__dirname, 'conversation.types.ts'), 'utf8');
    const block = (name: string) => {
      const start = source.indexOf(`export interface ${name} {`);
      expect(start).toBeGreaterThan(-1); // the guard read something
      return source.slice(start, source.indexOf('\n}', start));
    };
    for (const name of ['ConversationMessage', 'MessageView']) {
      const fields = [...block(name).matchAll(/^\s{2}(\w+)\??:/gm)].map((m) => m[1]);
      expect(fields).toContain('photo');
      expect(fields.filter((f) => /^(data|dataUrl|bytes|base64|image|blob|thumb|thumbDataUrl)$/i.test(f))).toEqual([]);
    }
  });

  it('puts a filed photo in a shared report, by its reference, and lets the operator open that one and no other', () => {
    const { conversationId } = chats.open('fr_1', 'did:drv:tsehay');
    const a = chats.filePhoto(conversationId, 'did:drv:tsehay', { mediaId: upload('did:drv:tsehay'), as: 'damage', source: 'app_camera' }, NOW);
    const b = chats.filePhoto(conversationId, 'did:drv:tsehay', { mediaId: upload('did:drv:tsehay'), as: 'paper', source: 'gallery' }, NOW);
    const { reportId } = chats.shareDisputeReport(conversationId, 'did:drv:tsehay', [a.seq], 'The sacks were wet', NOW);
    const report = chats.listDisputeReports().find((r) => r.reportId === reportId)!;
    expect(report.messages[0]).toMatchObject({ kind: 'photo', photo: { filingId: a.photo!.filingId, fingerprint: a.photo!.fingerprint, sha256: PNG_SHA } });
    expect(JSON.stringify(report)).not.toContain(PNG_B64.slice(0, 40));
    expect(chats.photoForReport(reportId, a.photo!.filingId).bytes.toString('base64')).toBe(PNG_B64);
    expect(() => chats.photoForReport(reportId, b.photo!.filingId)).toThrow(/not found in that report/);
  });

  it('reads the record’s own rule: another asker sees nothing filed in somebody else’s thread; the poster sees it all', () => {
    const grace = chats.open('fr_open', 'did:drv:grace');
    const kofi = chats.open('fr_open', 'did:drv:kofi');
    const paper = chats.filePhoto(grace.conversationId, 'did:shop', { mediaId: upload('did:shop'), as: 'paper', source: 'gallery' }, NOW).photo!;
    // Grace sees the paper filed in her own conversation…
    expect(chats.recordPhotos(grace.conversationId, 'did:drv:grace').items.map((f) => f.filingId)).toEqual([paper.filingId]);
    // …Kofi, who only asked in his, sees nothing of it, and cannot open it by its id.
    expect(chats.recordPhotos(kofi.conversationId, 'did:drv:kofi').items).toEqual([]);
    expect(() => chats.photoFor(kofi.conversationId, paper.filingId, 'did:drv:kofi')).toThrow(/Photo not found/);
    // The poster, a reader of the load, sees it through either thread.
    expect(chats.recordPhotos(kofi.conversationId, 'did:shop').items).toEqual([expect.objectContaining({ filingId: paper.filingId, here: false })]);
  });

  it('a parcel’s damage claim report holds the photos filed before it was made, and hands over later ones beside it', () => {
    const { conversationId } = chats.openAboutParcel('pcl_1', 'did:person:wanjiru');
    const before = chats.filePhoto(conversationId, 'did:person:wanjiru', { mediaId: upload('did:person:wanjiru'), as: 'damage', source: 'gallery', phoneDate: '2026-10-30T14:22:05' }, NOW).photo!;
    // The problem is reported an hour later.
    const raisedAt = new Date(NOW + 3_600_000).toISOString();
    Object.assign(parcels.pcl_1, { status: 'Disputed', dispute: { origin: 'buyer', raisedAt, fromStatus: 'Ready_For_Pickup', raisedBy: 'did:person:wanjiru', reason: 'Crushed' } });
    const after = chats.filePhoto(conversationId, 'did:person:wanjiru', { mediaId: upload('did:person:wanjiru'), as: 'damage', source: 'app_camera' }, NOW + 2 * 3_600_000).photo!;

    const report = reports.ensure('pcl_1')!;
    const inBody = report.body.photographs.find((p) => p.reference === before.filingId);
    expect(inBody).toMatchObject({ what: 'filed_damage', mediaId: before.mediaId, sha256: PNG_SHA, source: 'gallery', phoneDate: '2026-10-30T14:22:05', by: 'receiver', fingerprint: before.fingerprint });
    expect(report.body.photographs.some((p) => p.reference === after.filingId)).toBe(false);
    // Beside it, never in it: the report's own fingerprint does not move.
    const read = reports.read('pcl_1', { role: 'operator' } as never);
    expect(read.sha256).toBe(report.sha256);
    expect(read.filedAfter).toEqual([expect.objectContaining({ reference: after.filingId, source: 'app_camera', fingerprint: after.fingerprint })]);
    // …and in the file handed over: the photo, the filing its fingerprint covers, and the words for where it came from.
    const zip = reports.file('pcl_1', { role: 'operator' } as never).bytes.toString('latin1');
    expect(zip).toContain(`filed/${after.filingId}.json`);
    expect(zip).toContain('Photos filed after it was reported');
    expect(zip).toContain('from the gallery, taken 2026-10-30 (the phone’s date)'.replace('’', 'â\u0080\u0099'));
    // The dispute moved every photo of the parcel onto the dispute clock, the later one included.
    expect(media.get(after.mediaId)?.retentionClass).toBe('dispute-evidence');
  });
});
