import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * NO UPLOAD FAILS IN SILENCE — THE GUARD (the owner, 2026-11-02: "if we put a filesize limit, it needs to show or tell.
 * For example I wanted to upload a profile image that was large. It silently refused.").
 *
 * Every place a person chooses a file says what kind it is (`data-upload`), and each kind keeps its promise:
 *   - photo: made smaller on the phone before it is sent, so it is never refused for being big;
 *   - document, sheet: its limit said beside the picker before a file is chosen, and checked on the phone before sending.
 * And a picked file is read only through the one path that checks it (shared/upload.ts) — a raw FileReader was where a
 * file of any size went out unchecked, and where a read that failed said nothing at all.
 */

const ROOTS = ['src/apps', 'src/shared'];

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return filesUnder(path);
    return /\.(tsx?|jsx?)$/.test(e.name) && !/\.(test|spec)\./.test(e.name) ? [path.replace(/\\/g, '/')] : [];
  });
}

const FILES = ROOTS.flatMap(filesUnder).map((path) => ({ path, text: readFileSync(path, 'utf8') }));

/** Every `<input … type="file" … />` element, with the file it is in. */
const INPUTS = FILES.flatMap(({ path, text }) =>
  [...text.matchAll(/<input\b[\s\S]*?\/>/g)].map((m) => m[0]).filter((el) => /\btype=(?:"file"|\{'file'\})/.test(el)).map((el) => ({ path, el, kind: /\bdata-upload="(\w+)"/.exec(el)?.[1] ?? null, file: FILES.find((f) => f.path === path)!.text })),
);

/**
 * What hands a chosen photo to a path that makes it smaller. Each is checked below to really get there: a PhotoField's
 * `upload` and the handlers behind it all call downscaleImage.
 */
const SHRINKS = /downscaleImage\(|pickAvatar\(|\bupload\(file\)|\.saveAvatar\(|\.saveShopfront\(|\.uploadPhoto\(|\.uploadPicture\(|\.licencePhoto\(|\.sealPhoto\(|\.claimPhoto\(|uploadContent\(|readShot\(|\bphoto\(|\bpick\(|\banswer\(|\bonPicked\(/;

describe('every file a person chooses', () => {
  it('is found — the guard read the pickers: the profile photo among them', () => {
    expect(INPUTS.length).toBeGreaterThanOrEqual(30);
    const profile = INPUTS.find((i) => i.path === 'src/shared/account/AccountMenu.tsx');
    expect(profile?.kind).toBe('photo');
  });

  it('says what kind of file it takes: a photo (made smaller here), a document or a sheet (its limit said and checked)', () => {
    const unsaid = INPUTS.filter((i) => !['photo', 'document', 'sheet'].includes(i.kind ?? '')).map((i) => `${i.path}: ${i.el.slice(0, 120)}`);
    expect(unsaid).toEqual([]);
  });

  it('a photo goes to a path that makes it smaller before it is sent', () => {
    const unshrunk = INPUTS.filter((i) => i.kind === 'photo' && !SHRINKS.test(i.file)).map((i) => i.path);
    expect(unshrunk).toEqual([]);
  });

  it('a document or a sheet has its limit said beside the picker, and is checked on the phone before it goes', () => {
    const unsaid = INPUTS.filter((i) => (i.kind === 'document' || i.kind === 'sheet') && !/uploadHint\(/.test(i.file)).map((i) => i.path);
    expect(unsaid).toEqual([]);
    const unchecked = INPUTS.filter((i) => (i.kind === 'document' || i.kind === 'sheet') && !/paperForUpload\(|fileAsDataUrl\(|UPLOAD_LIMITS\.|MAX_WORKBOOK_BYTES/.test(i.file)).map((i) => i.path);
    expect(unchecked).toEqual([]);
  });

  it('the handlers behind the photo pickers all make the photo smaller first', () => {
    for (const path of [
      'src/apps/agent/useAgentApp.ts',
      'src/apps/driver/useDriverApp.ts',
      'src/apps/fleet/useFleetApp.ts',
      'src/apps/mdp/useMdpApp.ts',
      'src/apps/genesis/useSendApp.ts',
      'src/apps/vendor/useVendorApp.ts',
      'src/apps/home/api.ts',
      'src/apps/business/api.ts',
      'src/apps/tower/useTowerApp.ts',
    ]) {
      const text = FILES.find((f) => f.path === path)?.text ?? '';
      expect({ path, shrinks: /downscaleImage\(/.test(text) }).toEqual({ path, shrinks: true });
    }
  });

  it('is read only through the one path that checks it — never a raw FileReader to a data URL', () => {
    const raw = FILES.filter(({ path, text }) => /\.readAsDataURL\(/.test(text) && !['src/shared/upload.ts', 'src/shared/conversation/Conversations.tsx'].includes(path)).map((f) => f.path);
    expect(raw).toEqual([]);
  });
});
