import { MediaService } from './media.service';
import { GlosError } from '../../foundation/http/glos-error';

// A valid 1x1 PNG — the smallest real raster we can round-trip through decode/store/fetch.
const PNG_1x1 =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const upload = (m: MediaService, over: Record<string, unknown> = {}) =>
  m.upload({ ownerDid: 'did:owner', kind: 'vehicle', dataUrl: PNG_1x1, ...over } as Parameters<MediaService['upload']>[0]);

describe('MediaService (S26) — upload, gating, retention', () => {
  let media: MediaService;
  beforeEach(() => {
    media = new MediaService(); // FS store is in-memory under Jest; no interval started (no bootstrap call)
  });

  it('stores a valid image and serves its bytes; the list view is PII-free', () => {
    const { mediaId } = upload(media);
    const blob = media.blob(mediaId);
    expect(blob.contentType).toBe('image/png');
    expect(blob.bytes.length).toBeGreaterThan(0);

    const [view] = media.listForOwner('did:owner');
    expect(view.mediaId).toBe(mediaId);
    expect(view.retentionClass).toBe('vehicle-asset'); // kind 'vehicle' → asset bin
    // The projection must never expose the owner or the content hash.
    expect(JSON.stringify(view)).not.toContain('did:owner');
    expect(JSON.stringify(view)).not.toContain('sha256');
    expect(view).not.toHaveProperty('sha256');
  });

  it('rejects non-images, malformed data URLs, and oversized payloads', () => {
    expect(() => upload(media, { dataUrl: 'not-a-data-url' })).toThrow(/base64 image/);
    expect(() => upload(media, { dataUrl: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' })).toThrow(/Unsupported/);
    const huge = `data:image/png;base64,${Buffer.alloc(600 * 1024).toString('base64')}`;
    expect(() => upload(media, { dataUrl: huge })).toThrow(/too large/);
  });

  it('gates fetch to owner-or-operator only', () => {
    const { mediaId } = upload(media);
    const ref = media.get(mediaId)!;
    expect(media.viewableBy(ref, 'did:owner', false)).toBe(true); // the owner
    expect(media.viewableBy(ref, 'did:someone-else', false)).toBe(false); // a stranger
    expect(media.viewableBy(ref, 'did:ops', true)).toBe(true); // an operator
  });

  /**
   * THE ONE WIDENING. A posted road-hazard photo is readable by any authenticated peer, because a warning
   * that says "2 photos" and then refuses them is a warning nobody can check. Everything around it stays
   * shut: another kind, or a hazard nobody has posted yet, is still the owner's alone.
   */
  /**
   * CL5 — the only bin whose clock does not wait for something to happen.
   *
   * Every other class is anchored by a lifecycle event, and a photograph with no event to wait for is a
   * photograph kept for ever. A field observation has no such event, so this one is dated at upload.
   */
  it('dates a field-evidence photograph at upload, because nothing will ever anchor it', () => {
    const { mediaId } = upload(media, { kind: 'field_evidence' });
    const ref = media.get(mediaId)!;
    expect(ref.retentionClass).toBe('field-evidence');
    expect(ref.expiresAt).toBeTruthy();
    const days = Math.round((Date.parse(ref.expiresAt!) - Date.parse(ref.createdAt)) / 86400000);
    expect(days).toBe(90);
  });

  it('withdraws a field-evidence photograph now, leaving a tombstone', () => {
    const { mediaId } = upload(media, { kind: 'field_evidence' });
    media.withdrawFieldEvidence(mediaId);
    // The bytes are gone at once, not in ninety days — and the record that they existed stays.
    expect(() => media.blob(mediaId)).toThrow(/retention window/);
    expect(media.get(mediaId)?.status).toBe('expired');
  });

  it('refuses to withdraw anything that is not field evidence — it cannot become a way to destroy proof', () => {
    // Every other public door refuses the evidence bins, because a party must never destroy proof
    // mid-case. This one must not become the back door to the same thing.
    const dispute = upload(media, { kind: 'dispute' }).mediaId;
    expect(() => media.withdrawFieldEvidence(dispute)).toThrow(/Only a photograph of an official document/);
    expect(media.get(dispute)?.status).toBe('active');
    // An unknown id, or nothing at all, is a quiet no-op rather than an error.
    expect(() => media.withdrawFieldEvidence('med_nope')).not.toThrow();
    expect(() => media.withdrawFieldEvidence(undefined)).not.toThrow();
  });

  it('leaves every other kind unanchored at upload — those wait for their event', () => {
    // The contrast IS the rule: a bridge does not come back up because ninety days elapsed.
    expect(media.get(upload(media, { kind: 'hazard' }).mediaId)!.expiresAt).toBeUndefined();
    expect(media.get(upload(media, { kind: 'vehicle' }).mediaId)!.expiresAt).toBeUndefined();
  });

  describe('a posted road-hazard photo, and only that', () => {
    it('lets a peer read one that is attached to a constraint', () => {
      const { mediaId } = media.upload({ ownerDid: 'did:driver:a', kind: 'hazard', dataUrl: PNG_1x1 });
      media.link(mediaId, { type: 'constraint', id: 'RC-1' }, 'hazard');
      expect(media.viewableBy(media.get(mediaId)!, 'did:driver:b', false)).toBe(true);
    });

    it('refuses an UNPOSTED hazard upload — an abandoned capture is nobody else’s', () => {
      const { mediaId } = media.upload({ ownerDid: 'did:driver:a', kind: 'hazard', dataUrl: PNG_1x1 });
      expect(media.viewableBy(media.get(mediaId)!, 'did:driver:b', false)).toBe(false);
      expect(media.viewableBy(media.get(mediaId)!, 'did:driver:a', false)).toBe(true); // still theirs
    });

    it('does not widen any other kind, however it is linked', () => {
      const { mediaId } = media.upload({ ownerDid: 'did:owner', kind: 'kyc_id', dataUrl: PNG_1x1 });
      // Linked to a constraint by an imagined bug: the KIND is what is decided on, so this stays shut.
      media.link(mediaId, { type: 'constraint', id: 'RC-1' });
      expect(media.viewableBy(media.get(mediaId)!, 'did:driver:b', false)).toBe(false);
    });

    /**
     * THE GATE THE WIDENING PAID FOR. `adopt` is what a CLIENT-supplied ref goes through, and it answers
     * whether the media is now ours to serve — so a caller recording a citation knows whether the
     * photograph behind it exists.
     */
    it('refuses to adopt media the caller does not own, so it can never be relabelled as a hazard', () => {
      const { mediaId } = media.upload({ ownerDid: 'did:driver:a', kind: 'kyc_licence', dataUrl: PNG_1x1 });
      expect(media.adopt(mediaId, 'did:driver:b', { type: 'constraint', id: 'RC-1' }, 'hazard')).toBe(false);
      // Untouched: still a licence, still in the account-doc bin, still nobody else's.
      expect(media.get(mediaId)!.kind).toBe('kyc_licence');
      expect(media.get(mediaId)!.link).toBeUndefined();
      expect(media.viewableBy(media.get(mediaId)!, 'did:driver:b', false)).toBe(false);
    });

    it('adopts the caller’s own fresh upload, and says so', () => {
      const { mediaId } = media.upload({ ownerDid: 'did:driver:a', kind: 'hazard', dataUrl: PNG_1x1 });
      expect(media.adopt(mediaId, 'did:driver:a', { type: 'constraint', id: 'RC-1' }, 'hazard')).toBe(true);
      expect(media.viewableBy(media.get(mediaId)!, 'did:driver:b', false)).toBe(true);
    });

    it('still answers MEDIA_EXPIRED, not a refusal, once the bytes are gone', () => {
      const { mediaId } = media.upload({ ownerDid: 'did:driver:a', kind: 'hazard', dataUrl: PNG_1x1 });
      media.link(mediaId, { type: 'constraint', id: 'RC-1' }, 'hazard');
      media.anchorConstraintCleared('RC-1', new Date(Date.now() - 181 * 24 * 60 * 60 * 1000));
      expect(media.sweep()).toBe(1);
      // The gate still opens — a peer gets the true answer ("kept 180 days, then deleted"), never a lie.
      expect(media.viewableBy(media.get(mediaId)!, 'did:driver:b', false)).toBe(true);
      expect(() => media.blob(mediaId)).toThrow(/retention/);
    });
  });

  it('starts the retention clock only at the lifecycle anchor, then the sweep removes the bytes', () => {
    const { mediaId } = media.upload({ ownerDid: 'did:agent', kind: 'dropoff', dataUrl: PNG_1x1 });
    media.link(mediaId, { type: 'parcel', id: 'P-1' }, 'dropoff');
    expect(media.get(mediaId)!.expiresAt).toBeUndefined(); // nothing scheduled until the parcel is terminal

    // Anchor with a date 91 days ago → the 90-day window is already closed.
    const longAgo = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000);
    media.anchorParcelTerminal('P-1', longAgo);
    expect(media.get(mediaId)!.expiresAt).toBeDefined();

    const removed = media.sweep();
    expect(removed).toBe(1);
    expect(media.get(mediaId)!.status).toBe('expired'); // tombstone survives (audit), bytes do not
    expect(() => media.blob(mediaId)).toThrow(GlosError); // GONE
  });

  it('anchoring is idempotent and does not fire before the window closes', () => {
    const { mediaId } = media.upload({ ownerDid: 'did:agent', kind: 'pod', dataUrl: PNG_1x1 });
    media.link(mediaId, { type: 'parcel', id: 'P-2' }, 'pod');
    media.anchorParcelTerminal('P-2'); // now → expiresAt ~90 days out
    const first = media.get(mediaId)!.expiresAt;
    media.anchorParcelTerminal('P-2', new Date(Date.now() + 1000)); // must NOT move an already-set clock
    expect(media.get(mediaId)!.expiresAt).toBe(first);
    expect(media.sweep()).toBe(0); // 90 days away — nothing to remove yet
  });

  it('owner may remove an asset image early, but evidence stays locked until expiry', () => {
    const asset = media.upload({ ownerDid: 'did:mgr', kind: 'vehicle', dataUrl: PNG_1x1 });
    const proof = media.upload({ ownerDid: 'did:agent', kind: 'dropoff', dataUrl: PNG_1x1 });

    media.removeByOwner(asset.mediaId, 'did:mgr'); // vehicle-asset → deletable
    expect(media.get(asset.mediaId)).toBeUndefined();

    expect(() => media.removeByOwner(proof.mediaId, 'did:agent')).toThrow(/evidence/); // shipment-proof locked
    expect(() => media.removeByOwner(proof.mediaId, 'did:someone')).toThrow(/your own/); // not the owner
  });

  it('link is best-effort — an unknown / legacy filename ref is a no-op, never an error', () => {
    expect(() => media.link('legacy-photo.jpg', { type: 'parcel', id: 'P-9' }, 'dropoff')).not.toThrow();
    expect(() => media.link(undefined, { type: 'parcel', id: 'P-9' }, 'dropoff')).not.toThrow();
  });

  it('trusts the bytes, not the declared type — a real PNG mislabelled image/jpeg is rejected', () => {
    // PNG_1x1 bytes declared as jpeg → the magic number (89 50 4E 47) does not match FF D8 FF.
    expect(() => media.upload({ ownerDid: 'did:o', kind: 'vehicle', dataUrl: PNG_1x1.replace('image/png', 'image/jpeg') })).toThrow(/real JPEG/);
  });

  it('a bad thumbnail is rejected and does not leave a half-stored upload', () => {
    const bigThumb = `data:image/png;base64,${Buffer.alloc(80 * 1024).toString('base64')}`; // >64KB thumb cap
    expect(() => media.upload({ ownerDid: 'did:o', kind: 'vehicle', dataUrl: PNG_1x1, thumbDataUrl: bigThumb })).toThrow(/too large/);
    // The full image is validated + the thumb rejected BEFORE anything is written, so no ref leaks.
    expect(media.listForOwner('did:o')).toHaveLength(0);
    // A subsequent clean upload is the only media that exists.
    upload(media);
    expect(media.listForOwner('did:owner')).toHaveLength(1);
  });

  it('holdParcelForDispute puts the delivery proof AND the dispute photo on one 180-day clock', () => {
    const pod = media.upload({ ownerDid: 'did:rx', kind: 'pod', dataUrl: PNG_1x1 });
    const problem = media.upload({ ownerDid: 'did:rx', kind: 'dispute', dataUrl: PNG_1x1 });
    media.link(pod.mediaId, { type: 'parcel', id: 'D-1' }, 'pod');
    media.link(problem.mediaId, { type: 'parcel', id: 'D-1' }, 'dispute');
    media.anchorParcelTerminal('D-1'); // delivery started the PoD's 90-day shipment-proof clock
    const podClock = media.get(pod.mediaId)!.expiresAt!;
    expect(media.get(problem.mediaId)!.expiresAt).toBeUndefined(); // dispute photo not yet anchored

    media.holdParcelForDispute('D-1');
    const podRef = media.get(pod.mediaId)!;
    const problemRef = media.get(problem.mediaId)!;
    expect(podRef.retentionClass).toBe('dispute-evidence'); // reclassified onto the case clock
    expect(new Date(podRef.expiresAt!).getTime()).toBeGreaterThan(new Date(podClock).getTime()); // 90d → 180d
    expect(problemRef.expiresAt).toBeDefined(); // the dispute photo's clock now started (no longer forever)
    expect(problemRef.expiresAt).toBe(podRef.expiresAt); // both on the SAME window
  });

  it('reaps an abandoned upload that never reached a lifecycle event, but keeps linked media', () => {
    const orphan = media.upload({ ownerDid: 'did:o', kind: 'vehicle', dataUrl: PNG_1x1 }); // never linked
    const linked = media.upload({ ownerDid: 'did:o', kind: 'dropoff', dataUrl: PNG_1x1 });
    media.link(linked.mediaId, { type: 'parcel', id: 'P-K' }, 'dropoff'); // linked, awaiting its terminal anchor

    // A sweep before the grace elapses touches neither.
    expect(media.sweep()).toBe(0);
    // 49h later the never-linked orphan is reclaimed (hard delete — no audit value); the linked one stays.
    const later = new Date(Date.now() + 49 * 60 * 60 * 1000);
    expect(media.sweep(later)).toBe(1);
    expect(media.get(orphan.mediaId)).toBeUndefined(); // gone entirely, no tombstone
    expect(media.get(linked.mediaId)).toBeDefined(); // linked media is not an orphan — its clock starts later
  });
});
