import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { options, type VNode } from 'preact';
import { renderToString } from 'preact-render-to-string';
import type { ConversationsApi, SbgError } from '../../lib/sbg';
import { t } from '../i18n';
import { heldCount, heldPhoto } from '../heldPhotos';
import { drain, enqueue, outboxItems, queueableLabel } from '../outbox';
import { forgetSharedFiles, takeSharedFiles, SHARED_CACHE } from '../sharedFiles';
import { Chip } from '../ui';
import { FiledPhotoCard, PhotoFilingView } from './FiledPhoto';
import { fileBody, fitsSubject, proofChoices, shortPrint, sourceLabel, waitingPhotosIn, type FiledPhotoRef, type PreparedPhoto } from './filedPhotoLogic';
import type { ChatThread } from './logic';
import { fileAll, fileTo, photoRefusal, preparePhoto, sha256Hex } from './photoFiling';
import { UploadRefusal } from '../upload';
import { SharedPhotosView, type SharedPhotosViewProps } from './SharedPhotos';

// The camera asks the browser about itself; what is under test is the filing.
vi.mock('../ui/CameraCapture', () => ({ CameraCapture: () => null, canCaptureLive: () => false }));

/*
 * 2026-11-02 — A PHOTO IS FILED, THEN SHOWN (the owner: "Damage claims should be fingerprinted and just sharing blurs
 * this"): "What is this?", the card a filed photo leaves, a photo shared in from the gallery, and a photo filed with no
 * signal, held on the phone and filed when the signal comes back.
 */

const store = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  },
});

const PRINT = '3f9a0000000000000000000000000000000000000000000000000000000c21';
const ref = (over: Partial<FiledPhotoRef> = {}): FiledPhotoRef => ({
  filingId: 'fp_1',
  subject: 'freight',
  freightId: 'fr_1',
  code: 'FRT-7781',
  as: 'damage',
  by: 'driver',
  mediaId: 'med_1',
  sha256: 'a'.repeat(64),
  source: 'app_camera',
  takenAt: new Date().toISOString(),
  filedAt: new Date().toISOString(),
  fingerprint: PRINT,
  ...over,
});
const gallery: PreparedPhoto = { dataUrl: 'data:image/jpeg;base64,AAAA', thumbDataUrl: 'data:image/jpeg;base64,BB', source: 'gallery', phoneDate: '2026-10-30T14:22:05', originalSha256: 'b'.repeat(64) };

/** Every element made while rendering — so a test can press what a string of HTML cannot. */
function captureWhile(render: () => string): { html: string; made: VNode[] } {
  const made: VNode[] = [];
  const before = options.vnode;
  options.vnode = (v) => {
    made.push(v);
    before?.(v);
  };
  try {
    return { html: render(), made };
  } finally {
    options.vnode = before;
  }
}
const noop = () => undefined;
const unescape = (html: string) => html.replace(/&#39;|&rsquo;/g, '’').replace(/&amp;/g, '&');

describe('where a photo came from, in words — said, never judged', () => {
  it('labels the app’s camera, a gallery photo with the phone’s date, one with none, and one nobody can place', () => {
    const say = (p: Parameters<typeof sourceLabel>[0]) => {
      const l = sourceLabel(p);
      return t(l.key, l.params);
    };
    expect(say({ source: 'app_camera' })).toBe('taken in the app, at the time');
    expect(say({ source: 'gallery', phoneDate: '2026-10-30T14:22:05' })).toBe('from the gallery, taken 30 Oct 2026 (the phone’s date)');
    expect(say({ source: 'gallery' })).toBe('from the gallery, no date on it');
    expect(say({ source: 'unknown' })).toBe('where it came from is not known');
    // A date with a zone is still said as the phone's own day, never moved by this phone's time zone.
    expect(say({ source: 'gallery', phoneDate: '2026-10-30T23:59:00-05:00' })).toBe('from the gallery, taken 30 Oct 2026 (the phone’s date)');
    expect(shortPrint(PRINT)).toBe('3f9a…c21');
  });

  it('sends only the labels that belong to where it came from', () => {
    expect(fileBody('med_1', gallery, { as: 'damage' }, '2026-11-02T10:42:00.000Z')).toEqual({ mediaId: 'med_1', as: 'damage', source: 'gallery', phoneDate: '2026-10-30T14:22:05', originalSha256: 'b'.repeat(64), writtenAt: '2026-11-02T10:42:00.000Z' });
    const camera: PreparedPhoto = { dataUrl: 'x', source: 'app_camera', takenAt: '2026-11-02T10:41:00.000Z', phoneDate: '2026-01-01' };
    expect(fileBody('med_2', camera, { as: 'proof', proofOf: 'loading' }, 'w')).toEqual({ mediaId: 'med_2', as: 'proof', proofOf: 'loading', source: 'app_camera', takenAt: '2026-11-02T10:41:00.000Z', writtenAt: 'w' });
  });
});

describe('the card a filed photo leaves in the chat', () => {
  it('says where it was filed, what it is, where it came from, who, the fingerprint — and opens the record', () => {
    const opened: string[] = [];
    const taken = ref();
    const time = new Date(taken.takenAt!).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const { html, made } = captureWhile(() => renderToString(<FiledPhotoCard photo={taken} who="Tsehay" onOpen={() => opened.push('open')} />));
    const text = unescape(html);
    expect(text).toContain('Filed: FRT-7781 › Damage');
    expect(text).toContain(`taken ${time} in the app · Tsehay · fingerprint 3f9a…c21`);
    expect(text).toContain('Open in the load’s record');
    // Words only: the picture is in the record.
    expect(html).not.toContain('<img');
    const open = made.find((v) => v.type === 'button');
    (open!.props as unknown as { onClick: () => void }).onClick();
    expect(opened).toEqual(['open']);
    // A parcel's card points at the parcel's record.
    expect(unescape(renderToString(<FiledPhotoCard photo={ref({ subject: 'parcel', parcelId: 'pcl_1', code: 'pcl_1', as: 'proof', proofOf: 'handover' })} who="You" onOpen={noop} />))).toContain('Open in the parcel’s record');
  });
});

describe('“What is this?”', () => {
  const panel = (over: Partial<Parameters<typeof PhotoFilingView>[0]> = {}) => ({
    photo: gallery,
    subject: 'freight' as const,
    code: 'FRT-7781',
    choice: null,
    busy: false,
    failed: null,
    onChoose: noop,
    onFile: noop,
    onCancel: noop,
    ...over,
  });

  it('asks before anything is filed: Damage, A paper, Proof — and File it waits for the answer', () => {
    const chosen: unknown[] = [];
    const { html, made } = captureWhile(() => renderToString(<PhotoFilingView {...panel({ onChoose: (c) => chosen.push(c) })} />));
    const text = unescape(html);
    expect(text).toContain('What is this?');
    expect(text).toContain('from the gallery, taken 30 Oct 2026 (the phone’s date)');
    expect(text).toContain('It is filed to FRT-7781');
    const chips = made.filter((v) => v.type === Chip).map((v) => v.props as unknown as { label: string; onClick: () => void });
    expect(chips.map((c) => c.label)).toEqual(['Damage', 'A paper', 'Proof']);
    chips[0].onClick();
    expect(chosen).toEqual([{ as: 'damage' }]);
    // Nothing chosen: File it cannot be pressed.
    const file = made.find((v) => typeof v.props === 'object' && (v.props as { children?: unknown }).children === t('common.chat.photo.file'));
    expect((file!.props as { disabled?: boolean }).disabled).toBe(true);
  });

  it('offers proof of the moments the record has: a load is loaded, a parcel never', () => {
    const labels = (subject: 'freight' | 'parcel') =>
      captureWhile(() => renderToString(<PhotoFilingView {...panel({ subject, choice: { as: 'proof', proofOf: 'handover' } })} />))
        .made.filter((v) => v.type === Chip)
        .map((v) => (v.props as unknown as { label: string }).label);
    expect(labels('freight')).toEqual(['Damage', 'A paper', 'Proof', 'Loading', 'Handover', 'Delivery']);
    expect(labels('parcel')).toEqual(['Damage', 'A paper', 'Proof', 'Handover', 'Delivery']);
    expect(proofChoices('parcel')).not.toContain('loading');
    expect(fitsSubject({ as: 'proof', proofOf: 'loading' }, 'parcel')).toBe(false);
    expect(fitsSubject({ as: 'damage' }, 'parcel')).toBe(true);
  });
});

describe('a photo made ready, and filed — or held for a signal', () => {
  beforeEach(() => store.clear());

  it('reads the phone’s date and the fingerprint off the original BEFORE it is made smaller', async () => {
    const calls: string[] = [];
    const deps = {
      exif: async () => (calls.push('exif'), '2026-10-30T14:22:05'),
      digest: async () => (calls.push('digest'), 'c'.repeat(64)),
      shrink: async () => (calls.push('shrink'), { dataUrl: 'data:image/jpeg;base64,AA', thumbDataUrl: 'data:image/jpeg;base64,B' }),
    };
    const ready = await preparePhoto(new Blob(['x']), 'gallery', undefined, deps);
    expect(calls).toEqual(['exif', 'digest', 'shrink']);
    expect(ready).toMatchObject({ source: 'gallery', phoneDate: '2026-10-30T14:22:05', originalSha256: 'c'.repeat(64) });
    // The app's own camera carries the moment it was taken, and no file's date is looked for.
    calls.length = 0;
    const taken = await preparePhoto(new Blob(['x']), 'app_camera', '2026-11-02T10:41:00.000Z', deps);
    expect(calls).toEqual(['digest', 'shrink']);
    expect(taken).toMatchObject({ source: 'app_camera', takenAt: '2026-11-02T10:41:00.000Z' });
    expect(taken).not.toHaveProperty('phoneDate');
    // The fingerprint of a file is the SHA-256 everybody computes.
    expect(await sha256Hex(new Blob(['abc']))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  const api = (upload: { data?: unknown; error?: Partial<SbgError> | null }, filed: { data?: unknown; error?: Partial<SbgError> | null } = { data: { seq: 4, kind: 'photo' } }) => {
    const calls: Array<{ id: string; body: Record<string, unknown> }> = [];
    return {
      calls,
      api: {
        upload: async () => ({ data: upload.data ?? null, error: upload.error ?? null, status: upload.error ? 0 : 201 }),
        filePhoto: async (id: string, body: Record<string, unknown>) => {
          calls.push({ id, body });
          return { data: filed.data ?? null, error: filed.error ?? null, status: filed.error ? 409 : 201 };
        },
      } as unknown as Pick<ConversationsApi, 'upload' | 'filePhoto'>,
    };
  };
  const say = (e: SbgError) => e.detail ?? 'refused';

  it('files it to the chat with its labels when there is a signal', async () => {
    const { api: a, calls } = api({ data: { mediaId: 'med_9' } });
    const outcome = await fileTo(a, 'cv_1', gallery, { as: 'damage' }, say, 'no room', new Date('2026-11-02T10:42:00Z'));
    expect(outcome.state).toBe('filed');
    expect(calls).toEqual([{ id: 'cv_1', body: expect.objectContaining({ mediaId: 'med_9', as: 'damage', source: 'gallery', phoneDate: '2026-10-30T14:22:05', writtenAt: '2026-11-02T10:42:00.000Z' }) }]);
  });

  it('with no signal, holds the photo on the phone and the filing waits with it — then both go, photo first', async () => {
    const { api: a, calls } = api({ error: { code: 'NETWORK' } }, { data: { queued: true } });
    const outcome = await fileTo(a, 'cv_1', gallery, { as: 'proof', proofOf: 'delivery' }, say, 'no room');
    expect(outcome).toEqual({ state: 'queued' });
    const held = calls[0].body.mediaId as string;
    expect(held).toMatch(/^local:/);
    expect(heldPhoto(held)).toMatchObject({ kind: 'filed', dataUrl: gallery.dataUrl });

    // The outbox carries a filing like this one (the chat's own fetch queues it), and the server only ever sees a real photo.
    expect(queueableLabel('POST', '/v1/sbg/conversations/cv_1/photos')).toBe('Photo filed');
    enqueue({ id: 'ob_p', key: 'key-p', method: 'POST', path: '/v1/sbg/conversations/cv_1/photos', body: calls[0].body, label: 'Photo filed', at: new Date().toISOString() });
    // Shown in the chat, while it waits, as what it was filed as.
    expect(waitingPhotosIn(outboxItems(), 'cv_1')).toEqual([expect.objectContaining({ id: 'ob_p', as: 'proof', proofOf: 'delivery' })]);
    const sent: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      sent.push({ url, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify(url.endsWith('/media') ? { mediaId: 'med_real' } : { seq: 5 }), { status: 201, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    await drain({ baseUrl: 'https://api.test', token: async () => 'tok', fetch: fetchImpl });
    expect(sent.map((s) => s.url)).toEqual(['https://api.test/v1/sbg/media', 'https://api.test/v1/sbg/conversations/cv_1/photos']);
    expect(sent[0].body).toMatchObject({ kind: 'filed', dataUrl: gallery.dataUrl });
    expect(sent[1].body).toMatchObject({ mediaId: 'med_real', as: 'proof', proofOf: 'delivery', phoneDate: '2026-10-30T14:22:05' });
    expect(heldCount()).toBe(0);
    expect(waitingPhotosIn(outboxItems(), 'cv_1')).toEqual([]);
  });

  it('a filing refused when it arrives leaves no photo waiting for nothing; a full phone says so', async () => {
    const { api: refused } = api({ error: { code: 'NETWORK' } }, { error: { code: 'INVALID_STATE', detail: 'This load was cancelled, so its record is closed' } });
    expect(await fileTo(refused, 'cv_1', gallery, { as: 'damage' }, say, 'no room')).toEqual({ state: 'refused', why: 'This load was cancelled, so its record is closed' });
    expect(heldCount()).toBe(0);
    const { api: full } = api({ error: { code: 'NETWORK' } });
    expect(await fileTo(full, 'cv_1', gallery, { as: 'damage' }, say, 'no room', new Date(), { hold: () => null, forget: noop })).toEqual({ state: 'refused', why: 'no room' });
  });
});

describe('photos shared in from the phone’s gallery', () => {
  /** A cache as the app's worker leaves it: each photo untouched, and a note of what was shared and when. */
  const cacheWith = (entries: Record<string, Response>) => {
    const kept = new Map(Object.entries(entries));
    const cache = {
      keys: async () => [...kept.keys()].map((url) => ({ url }) as Request),
      match: async (k: string | Request) => kept.get(typeof k === 'string' ? k : k.url)?.clone(),
      delete: async (k: string | Request) => kept.delete(typeof k === 'string' ? k : k.url),
    };
    return { kept, caches: { open: async (name: string) => (name === SHARED_CACHE ? cache : null) } as unknown as Pick<CacheStorage, 'open'> };
  };
  const base = 'https://x.test/driver/__shared/k3x9a1/';

  it('reads back the photos exactly as the phone shared them, with the words that came with them — and lets them go', async () => {
    const { kept, caches } = cacheWith({
      [`${base}0`]: new Response(new Blob(['jpeg-bytes'], { type: 'image/jpeg' })),
      [`${base}meta`]: new Response(JSON.stringify({ at: 1000, files: [{ key: `${base}0`, type: 'image/jpeg', name: 'IMG_2041.jpg' }], text: 'Crushed on arrival' })),
    });
    const got = await takeSharedFiles('k3x9a1', 2000, caches);
    expect(got).toMatchObject({ id: 'k3x9a1', words: 'Crushed on arrival', files: [{ name: 'IMG_2041.jpg', type: 'image/jpeg' }] });
    expect(await got!.files[0].blob.text()).toBe('jpeg-bytes');
    await forgetSharedFiles('k3x9a1', caches);
    expect(kept.size).toBe(0);
  });

  it('a share older than an hour is gone, and cleared on the way; a name that is not one opens nothing', async () => {
    const { kept, caches } = cacheWith({ [`${base}0`]: new Response('x'), [`${base}meta`]: new Response(JSON.stringify({ at: 0, files: [{ key: `${base}0` }] })) });
    expect(await takeSharedFiles('k3x9a1', 2 * 60 * 60 * 1000, caches)).toBeNull();
    expect(kept.size).toBe(0);
    expect(await takeSharedFiles('../meta', 0, caches)).toBeNull();
  });

  const thread = (over: Partial<ChatThread> = {}): ChatThread => ({
    conversationId: 'c-1',
    subject: 'freight',
    freightCode: 'FRT-7781',
    freightLabel: 'Maize · Nakuru → Nairobi',
    role: 'asker',
    counterpartName: 'Mama Njeri Stores',
    canFilePhotos: true,
    lastSeq: 3,
    unread: 0,
    createdAt: '2026-11-01T08:00:00.000Z',
    blocked: false,
    blockedByMe: false,
    ...over,
  });
  const view = (over: Partial<SharedPhotosViewProps> = {}): SharedPhotosViewProps => ({
    phase: 'ready',
    photos: [gallery],
    words: undefined,
    choice: null,
    threads: [thread(), thread({ conversationId: 'c-2', subject: 'parcel', freightCode: 'pcl_9', freightLabel: 'Collect at Mama Sarah Shop', counterpartName: undefined, role: 'asker' })],
    loadError: null,
    busy: null,
    results: {},
    last: null,
    onChoose: noop,
    onPick: noop,
    onRetry: noop,
    onOpenChat: noop,
    onClose: noop,
    ...over,
  });
  const rows = (props: SharedPhotosViewProps) =>
    captureWhile(() => renderToString(<SharedPhotosView {...props} />)).made.filter((v) => v.type === 'button' && (v.props as { class?: string }).class === 'row').map((v) => v.props as unknown as { disabled?: boolean; onClick: () => void });

  it('asks the same “What is this?”, labels each photo by where it came from, and files nothing before the answer', () => {
    const text = unescape(renderToString(<SharedPhotosView {...view()} />));
    expect(text).toContain('The photo you shared');
    expect(text).toContain('from the gallery, taken 30 Oct 2026 (the phone’s date)');
    expect(text).toContain('What is this?');
    expect(text).toContain('Say what it is first.');
    expect(rows(view()).every((r) => r.disabled)).toBe(true);
  });

  it('once answered, the chats it fits can be tapped — and a parcel is never offered for proof of loading', () => {
    const picked: string[] = [];
    const answered = rows(view({ choice: { as: 'damage' }, onPick: (x) => picked.push(x.conversationId) }));
    expect(answered.map((r) => r.disabled)).toEqual([false, false]);
    answered[1].onClick();
    expect(picked).toEqual(['c-2']);
    const loading = view({ choice: { as: 'proof', proofOf: 'loading' } });
    expect(rows(loading).map((r) => r.disabled)).toEqual([false, true]);
    expect(unescape(renderToString(<SharedPhotosView {...loading} />))).toContain('A parcel is handed over and delivered, not loaded');
  });

  it('files every shared photo to the chosen chat as a gallery photo with the phone’s date, and says where it went', async () => {
    const calls: Array<Record<string, unknown>> = [];
    let n = 0;
    const a = {
      upload: async () => ({ data: { mediaId: `med_${++n}` }, error: null, status: 201 }),
      filePhoto: async (_id: string, body: Record<string, unknown>) => (calls.push(body), { data: { seq: n }, error: null, status: 201 }),
    } as unknown as Pick<ConversationsApi, 'upload' | 'filePhoto'>;
    const second: PreparedPhoto = { ...gallery, phoneDate: undefined };
    expect((await fileAll(a, 'c-1', [gallery, second], { as: 'damage' }, () => 'x', 'no room')).state).toBe('filed');
    expect(calls).toEqual([expect.objectContaining({ mediaId: 'med_1', source: 'gallery', phoneDate: '2026-10-30T14:22:05' }), expect.objectContaining({ mediaId: 'med_2', source: 'gallery' })]);
    expect(calls[1]).not.toHaveProperty('phoneDate');
    const done = unescape(renderToString(<SharedPhotosView {...view({ choice: { as: 'damage' }, results: { 'c-1': { state: 'filed', message: null } }, last: thread() })} />));
    expect(done).toContain('Filed to FRT-7781, in your chat with Mama Njeri Stores.');
  });

  it('a photo this phone cannot open says why, in the words every photo field uses — and the rest can still be filed', () => {
    const why = photoRefusal(new UploadRefusal('unreadable', { kind: 'photo', bytes: 2_000 }), 'fallback');
    expect(why).toBe(t('upload.unreadable'));
    expect(photoRefusal(new Error('not about the file'), 'fallback')).toBe('fallback');
    const props = view({ photos: [{ failed: why }, gallery], choice: { as: 'damage' } });
    expect(unescape(renderToString(<SharedPhotosView {...props} />))).toContain(why);
    expect(rows(props).map((r) => r.disabled)).toEqual([false, false]);
  });

  it('says plainly when what was shared never arrived, or is no longer on the phone', () => {
    expect(unescape(renderToString(<SharedPhotosView {...view({ phase: 'lost' })} />))).toContain(t('sharedIn.photos.lost'));
    expect(unescape(renderToString(<SharedPhotosView {...view({ phase: 'gone' })} />))).toContain(t('sharedIn.photos.gone'));
  });
});

describe('the guard: a chat message carries a reference, never a picture', () => {
  it('no field of a chat message is named for bytes, and the photo field is the reference', () => {
    const src = readFileSync(join('src', 'shared', 'conversation', 'logic.ts'), 'utf8');
    const start = src.indexOf('export interface ChatMessage {');
    expect(start).toBeGreaterThan(-1);
    const fields = [...src.slice(start, src.indexOf('\n}', start)).matchAll(/^\s{2}(\w+)\??:/gm)].map((m) => m[1]);
    expect(fields).toContain('photo');
    expect(fields.filter((f) => /^(data|dataUrl|bytes|base64|image|blob|thumb|thumbDataUrl)$/i.test(f))).toEqual([]);
    expect(src).toMatch(/photo\?: FiledPhotoRef;/);
  });
});
