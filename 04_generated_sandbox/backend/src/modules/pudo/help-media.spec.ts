import { HelpMediaService } from './help-media.service';
import { HELP_IMAGE_MAX_BYTES, HELP_TOPIC_KEYS, isHelpKey, isHelpTopic } from './help.types';
import { PACKAGING } from './packaging';
import { TRUCK_SUBTYPES } from './fleet.config';
import { CARGO_NATURES, EQUIPMENT } from './cargo.types';

/** A real 1×1 PNG — the magic-number check rejects anything that only CLAIMS to be one. */
const PNG = `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]).toString('base64')}`;
/** The same bytes' worth of nothing, announced as a PNG. */
const FAKE = `data:image/png;base64,${Buffer.from('<svg onload=alert(1)>xxxxxxxxxxxx').toString('base64')}`;

describe('help illustrations (admin-curated)', () => {
  let help: HelpMediaService;
  beforeEach(() => {
    help = new HelpMediaService();
    // Each topic's keys are read from the canonical lists, so a fresh service already knows every option.
    for (const t of ['packaging', 'body', 'equipment', 'nature'] as const) {
      for (const k of HELP_TOPIC_KEYS[t]) help.remove(t, k);
    }
  });

  it('covers exactly the four vocabularies, each keyed off its canonical list', () => {
    // Never a hand-kept copy: add a truck subtype and it appears here waiting for a picture; remove one and
    // its key stops validating. A second list would let an admin curate an option the system no longer has.
    expect(HELP_TOPIC_KEYS.packaging).toBe(PACKAGING);
    expect(HELP_TOPIC_KEYS.body).toBe(TRUCK_SUBTYPES);
    expect(HELP_TOPIC_KEYS.equipment).toBe(EQUIPMENT);
    expect(HELP_TOPIC_KEYS.nature).toBe(CARGO_NATURES);
    expect(isHelpTopic('packaging')).toBe(true);
    expect(isHelpTopic('colour')).toBe(false);
  });

  it('lists EVERY option, illustrated or not — the empty slots are the admin’s to-do list', () => {
    // A picker needs the whole vocabulary to render, and an un-illustrated option is a normal state, not an
    // absence. Returning only what has a picture would hide options from the person choosing between them.
    const view = help.topic('packaging');
    expect(view.options.map((o) => o.key)).toEqual([...PACKAGING]);
    // Some arrive illustrated by the shipped house set; the rest are the slots still to draw. Both are
    // listed, which is the assertion — a topic where nothing was drawn yet must still offer all seven.
    expect(view.options.some((o) => o.imageUrl === undefined)).toBe(true);
    expect(view.options.every((o) => o.source !== 'deployment')).toBe(true); // nothing uploaded here yet
  });

  it('serves a curated picture at a URL that changes when the picture does', () => {
    help.put({ topic: 'packaging', key: 'bagged', dataUrl: PNG, actor: 'ops' });
    const first = help.topic('packaging').options.find((o) => o.key === 'bagged')!.imageUrl!;
    expect(first).toContain('/v1/sbg/help/packaging/bagged/image?v=');
    expect(help.image('packaging', 'bagged').contentType).toBe('image/png');

    // Replacing rotates the blob id, so the URL changes. Without this an admin fixing a WRONG picture would
    // be overruled for a month by every phone that had already cached the old one under the same URL.
    help.put({ topic: 'packaging', key: 'bagged', dataUrl: PNG, actor: 'ops' });
    expect(help.topic('packaging').options.find((o) => o.key === 'bagged')!.imageUrl).not.toBe(first);
  });

  it('refuses a key that is not an option of the topic', () => {
    // The write path is the only place this can be caught: a curated picture for a non-existent option would
    // simply never render, so it would look like an upload that silently did nothing.
    expect(() => help.put({ topic: 'packaging', key: 'skeletal', dataUrl: PNG, actor: 'ops' })).toThrow(/not an option/);
    expect(isHelpKey('packaging', 'bagged')).toBe(true);
    expect(isHelpKey('packaging', 'skeletal')).toBe(false);
    expect(isHelpKey('body', 'skeletal')).toBe(true);
  });

  it('refuses bytes that are not a real raster image, however they are labelled', () => {
    // Shared with MediaService via foundation/media/decode-image — one allowlist, so the two uploaders
    // cannot drift into disagreeing about what an image is.
    expect(() => help.put({ topic: 'packaging', key: 'bagged', dataUrl: FAKE, actor: 'ops' })).toThrow(/real JPEG, PNG or WebP/);
    expect(() => help.put({ topic: 'packaging', key: 'bagged', dataUrl: 'not-a-data-url', actor: 'ops' })).toThrow(/base64 image data URL/);
  });

  it('keeps the previous picture when a replacement is rejected', () => {
    // The switch happens only after the new bytes are written and validated. Losing a curated image to one
    // malformed upload would be a bad trade for the admin who made a single typo.
    help.put({ topic: 'nature', key: 'FOD', dataUrl: PNG, actor: 'ops' });
    const before = help.topic('nature').options.find((o) => o.key === 'FOD')!.imageUrl;
    expect(() => help.put({ topic: 'nature', key: 'FOD', dataUrl: FAKE, actor: 'ops' })).toThrow();
    expect(help.topic('nature').options.find((o) => o.key === 'FOD')!.imageUrl).toBe(before);
    expect(help.image('nature', 'FOD').bytes.length).toBeGreaterThan(0);
  });

  it('removes idempotently, and leaves the OPTION itself intact', () => {
    // Deleting an illustration must not delete a vocabulary entry — the sheet just falls back to text.
    help.put({ topic: 'equipment', key: 'FLT', dataUrl: PNG, actor: 'ops' });
    expect(help.remove('equipment', 'FLT')).toEqual({ removed: true });
    expect(help.remove('equipment', 'FLT')).toEqual({ removed: false }); // deleting nothing is not an error
    expect(help.topic('equipment').options.map((o) => o.key)).toEqual([...EQUIPMENT]);
    expect(() => help.image('equipment', 'FLT')).toThrow(/No illustration/);
  });

  describe('the house set behind a deployment’s own uploads', () => {
    it('serves a shipped drawing where nobody has uploaded one, marked as the network’s', () => {
      // The whole point of the fallback: a fresh deployment is illustrated on day one, and the operator can
      // still see which pictures are theirs and which arrived with the build.
      const view = help.topic('packaging').options;
      const bagged = view.find((o) => o.key === 'bagged')!;
      expect(bagged.imageUrl).toContain('/v1/sbg/help/packaging/bagged/image?v=');
      expect(bagged.source).toBe('builtin');
      expect(bagged.updatedAt).toBeUndefined(); // a house drawing has no local history to report
      expect(help.image('packaging', 'bagged').contentType).toBe('image/svg+xml');
    });

    it('an upload WINS over the house drawing, and says so', () => {
      help.put({ topic: 'packaging', key: 'bagged', dataUrl: PNG, actor: 'ops' });
      const bagged = help.topic('packaging').options.find((o) => o.key === 'bagged')!;
      expect(bagged.source).toBe('deployment');
      expect(bagged.updatedAt).toBeTruthy();
      expect(help.image('packaging', 'bagged').contentType).toBe('image/png'); // theirs, not ours
    });

    it('removing an upload REVEALS the house drawing rather than blanking the option', () => {
      // The operator needs this to be true and predictable: Remove is an undo, not a delete. Nothing an
      // operator does can reach the house set, which ships read-only with the build.
      help.put({ topic: 'packaging', key: 'palletised', dataUrl: PNG, actor: 'ops' });
      expect(help.topic('packaging').options.find((o) => o.key === 'palletised')!.source).toBe('deployment');
      help.remove('packaging', 'palletised');
      const after = help.topic('packaging').options.find((o) => o.key === 'palletised')!;
      expect(after.source).toBe('builtin');
      expect(help.image('packaging', 'palletised').contentType).toBe('image/svg+xml');
    });

    it('an option with neither layer is still returned, with no picture', () => {
      // Undrawn is a normal state, not an absence: the picker still has to offer the option, and its sheet
      // falls back to the words.
      const loose = help.topic('packaging').options.find((o) => o.key === 'loose')!;
      expect(loose.imageUrl).toBeUndefined();
      expect(loose.source).toBeUndefined();
      expect(() => help.image('packaging', 'loose')).toThrow(/No illustration/);
    });

    it('the two layers get different cache-busting versions', () => {
      // A content hash for the shipped drawing, the blob id for an upload — either way the URL changes when
      // the picture does, which is what lets the bytes be cached hard.
      const before = help.topic('packaging').options.find((o) => o.key === 'bagged')!.imageUrl;
      help.put({ topic: 'packaging', key: 'bagged', dataUrl: PNG, actor: 'ops' });
      expect(help.topic('packaging').options.find((o) => o.key === 'bagged')!.imageUrl).not.toBe(before);
    });
  });

  it('caps a help picture well below a delivery photo', () => {
    // It is a diagram, and it is fetched by every clerk on every booking over a connection somebody pays for
    // by the megabyte — not evidence uploaded once.
    expect(HELP_IMAGE_MAX_BYTES).toBeLessThan(500 * 1024);
    const huge = `data:image/png;base64,${Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(HELP_IMAGE_MAX_BYTES + 1)]).toString('base64')}`;
    expect(() => help.put({ topic: 'packaging', key: 'loose', dataUrl: huge, actor: 'ops' })).toThrow(/too large/);
  });
});
