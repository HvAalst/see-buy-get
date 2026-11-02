import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { t } from '../i18n';
import type { Result, SbgError } from '../../lib/sbg';
import type { NoteLinksState } from '../archive/useNoteLinks';
import { fetchPaper, labelGot, pageGot, PaperSheet, paperOfBlob, sharePaper, type PaperGot, type PaperShare, type PaperState } from './PaperSheet';
import { columnBreaks, pageOfSvg, paperLayoutOf, paperPageOf, previewDoc, printedArea, printFrame, printRules, printsFromFrame, withoutPreview } from './paperPreview';
import { ownTouch } from './sheetDrag';

/*
 * 2026-11-02 — A PAPER IN THE SLIDE-UP, AS IT WILL PRINT (the owner: "can we have a print preview of the consignment
 * note? and the print function in slide up").
 */

/** A note as the server draws it: its own page rule, its boxes that must not split, and what it says for paper only. */
const NOTE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>CMR-FRT-001 — Consignment note</title>
<style>
  @page { size: A4; margin: 12mm; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 16px; font: 12px/1.45 sans-serif; color: #111; background: #fff; }
  .box { border: 1px solid #111; padding: 6px 8px; min-height: 58px; break-inside: avoid; }
  .paper { display: none; }
  @media print { body { padding: 0; } .paper { display: block; } .hand { display: block; margin-top: 10px; } }
</style></head><body><div class="sheet"><p class="paper">Original for: the sender</p><div class="box">1 Sender</div></div></body></html>`;

const LABELS = `<!doctype html><html><head><style>
  @page { size: 100mm 150mm; margin: 0; }
  body { margin: 0; background: #e9ecef; }
  .label { display: block; width: 100mm; height: 150mm; margin: 6mm auto; }
  @media print { body { background: #fff; } .label { margin: 0; box-shadow: none; break-after: page; } .label:last-child { break-after: auto; } }
</style></head><body><svg class="label"></svg><svg class="label"></svg></body></html>`;

const INVOICE_CSS = '.copy { max-width: 800px; }\n.copy + .copy { break-before: page; }';

const noLinks = (over: Partial<NoteLinksState> = {}): NoteLinksState => ({ phase: 'ready', links: [], cancelling: '', cancelLink: async () => undefined, made: null, making: false, makeLink: async () => null, problem: '', ...over });
const shown = (got: PaperGot | null, over: Partial<PaperState> = {}): PaperState => ({ open: true, title: 'Consignment note', loading: false, got, show: () => undefined, retry: () => undefined, close: () => undefined, ...over });
const page = (html = NOTE): PaperGot => ({ paper: { kind: 'page', html } });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the page as the paper asks for it', () => {
  it('reads the paper’s own size and margins: an A4 note, a 100 × 150 mm label with none, A4 where nothing is said', () => {
    expect(paperPageOf(NOTE)).toEqual({ width: 210, height: 297, margin: [12, 12, 12, 12], said: true });
    expect(printedArea(paperPageOf(NOTE))).toEqual({ width: 703, height: 1032 });
    expect(paperPageOf(LABELS)).toMatchObject({ width: 100, height: 150, margin: [0, 0, 0, 0] });
    expect(printedArea(paperPageOf(LABELS))).toEqual({ width: 378, height: 567 });
    expect(paperPageOf('<style>@page { size: A4 landscape; margin: 1cm 2cm; }</style>')).toMatchObject({ width: 297, height: 210, margin: [10, 20, 10, 20] });
    expect(paperPageOf('<p>no style</p>')).toMatchObject({ width: 210, height: 297, said: false });
  });

  it('the fixture is the server’s note: its page rule and its print-only lines are the renderer’s own', () => {
    const server = readFileSync(join('..', 'backend', 'src', 'modules', 'pudo', 'consignment-note.service.ts'), 'utf8');
    expect(server).toContain('@page { size: A4; margin: 12mm; }');
    expect(server).toContain('.box { border: 1px solid #111; margin: -1px 0 0 -1px; padding: 6px 8px; min-height: 58px; break-inside: avoid; }');
    expect(server).toContain('@media print { body { padding: 0; } .paper { display: block; }');
  });
});

describe('the preview leaves the print untouched', () => {
  it('adds one style, for the screen only — take it out and the paper is exactly what the server sent', () => {
    const area = printedArea(paperPageOf(NOTE));
    for (const k of [0, 1, 4]) {
      const doc = previewDoc(NOTE, k, area);
      expect(withoutPreview(doc)).toBe(NOTE);
      expect((doc.match(/<style\b/g) ?? []).length).toBe((NOTE.match(/<style\b/g) ?? []).length + 1);
      expect(doc).toMatch(/<style media="screen" data-sbg-preview>/);
      // Before </head>, never ahead of the doctype: a style before it would put the page in quirks mode.
      expect(doc.startsWith('<!doctype html>')).toBe(true);
      expect(doc.indexOf('data-sbg-preview')).toBeLessThan(doc.indexOf('</head>'));
    }
  });

  it('shows what the paper says for paper only, and cuts it into pages one printed area wide and tall', () => {
    const doc = previewDoc(NOTE, 1, { width: 703, height: 1032 });
    expect(doc).toContain('.paper { display: block; }');
    expect(doc).toContain('columns: 703px !important');
    expect(doc).toContain('height: 1032px !important');
    // Page 2 is the same paper shifted one page to the left.
    expect(doc).toContain('translateX(-703px)');
    expect(previewDoc(NOTE, 0, { width: 703, height: 1032 })).toContain('translateX(0px)');
  });

  it('says a page break the paper asks for again as a column break, and keeps a box whole', () => {
    expect(columnBreaks(INVOICE_CSS)).toBe('.copy + .copy { break-before: column; }');
    expect(columnBreaks(printRules(LABELS))).toBe('.label { break-after: column; }');
    expect(columnBreaks(NOTE)).toContain('.box { break-inside: avoid; }');
    // A rule that only takes a break away is not one.
    expect(columnBreaks('.a:last-child { break-after: auto; }')).toBe('');
  });

  it('drawn whole where the columns do not take: nothing shifted, so nothing is hidden', () => {
    const doc = previewDoc(NOTE, 0, { width: 703, height: 1032 }, true);
    expect(doc).not.toContain('columns:');
    expect(doc).not.toContain('translateX');
    expect(withoutPreview(doc)).toBe(NOTE);
  });
});

/** A frame's document, as much of one as the page count reads. */
const fakeDoc = (columnWidth: string, rects: Array<{ left: number; bottom: number }>) => {
  const el = (r: Array<{ left: number; bottom: number }>, children: unknown[] = []) => ({ getClientRects: () => r.map((x) => ({ ...x, width: 10, height: 10 })), children, lastElementChild: null });
  const kids = rects.map((r) => el([r]));
  const body = { ...el([]), children: kids, lastElementChild: kids[kids.length - 1] ?? null };
  return { body, documentElement: {}, defaultView: { getComputedStyle: () => ({ columnWidth }) } } as unknown as Document;
};

describe('how many pages it came to', () => {
  it('counts the columns the paper reached: its last box on the second page is two pages', () => {
    expect(paperLayoutOf(fakeDoc('703px', [{ left: 16, bottom: 900 }, { left: 703 + 16, bottom: 300 }]), { width: 703, height: 1032 })).toEqual({ pages: 2 });
    expect(paperLayoutOf(fakeDoc('378px', [{ left: 0, bottom: 567 }, { left: 378, bottom: 567 }, { left: 756, bottom: 567 }]), { width: 378, height: 567 })).toEqual({ pages: 3 });
    expect(paperLayoutOf(fakeDoc('703px', [{ left: 16, bottom: 400 }]), { width: 703, height: 1032 })).toEqual({ pages: 1 });
  });

  it('a browser that did not lay it out in columns shows it whole, as one long page — never cut at the first page’s foot', () => {
    expect(paperLayoutOf(fakeDoc('auto', [{ left: 16, bottom: 400 }]), { width: 703, height: 1032 })).toEqual({ tall: true });
    expect(paperLayoutOf(fakeDoc('703px', [{ left: 16, bottom: 2400 }]), { width: 703, height: 1032 })).toEqual({ tall: true });
  });
});

describe('the sheet draws the pages, scaled to fit', () => {
  it('on a phone: each page a white sheet the paper’s size, scaled to the sheet’s width, its frame the printed area', () => {
    vi.stubGlobal('window', { innerWidth: 390 });
    const html = renderToString(<PaperSheet state={shown(page())} startsAs={{ pages: 2 }} />);
    // 390 less the sheet's padding, give back the ground's bleed, less its own padding: 350 px for a 794 px page.
    expect(html).toContain(`transform:scale(${(350 / 794).toFixed(4)})`);
    expect(html).toContain('width:794px;height:1123px;padding:45px 45px 45px 45px');
    expect(html).toContain('width="703" height="1032"');
    expect((html.match(/<iframe/g) ?? []).length).toBe(2);
    expect(html).toContain(t('common.doc.page', { n: 1, of: 2 }));
    expect(html).toContain(t('common.doc.page', { n: 2, of: 2 }));
    expect(html).toContain(t('common.doc.pages', { n: 2 }));
    // Larger, to read from the phone.
    expect(html).toContain(t('common.doc.actualSize'));
    // The second frame is the same paper shifted: hidden from a screen reader, which reads it once from the first.
    expect(html).toContain('style="width:703px;height:1032px" aria-hidden="true" tabindex="-1"></iframe>');
    expect((html.match(/aria-hidden="true" tabindex="-1"><\/iframe>/g) ?? []).length).toBe(1);
  });

  it('sandboxed as tightly as printing allows: nothing in the paper runs, opens or navigates', () => {
    const html = renderToString(<PaperSheet state={shown(page())} />);
    const sandbox = /sandbox="([^"]*)"/.exec(html)?.[1];
    expect(sandbox).toBe('allow-same-origin allow-modals');
    expect(sandbox).not.toContain('allow-scripts');
    expect(html).toContain('class="paper__frame"');
  });

  it('at a desk: the page as large as it prints, no larger', () => {
    vi.stubGlobal('window', { innerWidth: 1280 });
    const html = renderToString(<PaperSheet state={shown(page())} look="console" />);
    expect(html).toContain('transform:scale(1.0000)');
    expect(html).not.toContain(t('common.doc.actualSize'));
  });

  it('labels: one label a page, at their own size', () => {
    vi.stubGlobal('window', { innerWidth: 390 });
    const html = renderToString(<PaperSheet state={shown(page(LABELS))} look="console" startsAs={{ pages: 2 }} />);
    expect(html).toContain('width="378" height="567"');
    expect(html).toContain(`transform:scale(${(350 / 378).toFixed(4)})`);
  });

  it('a label drawn as a picture is put on a page of its own to print', () => {
    const doc = pageOfSvg('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"></svg>', 'The parcel’s label — PCL-1');
    expect(doc).toContain('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"></svg>');
    expect(doc).toContain('The parcel’s label — PCL-1');
    expect(paperPageOf(doc)).toMatchObject({ width: 210, margin: [12, 12, 12, 12] });
  });
});

describe('Print', () => {
  it('calls the frame’s own print — the phone’s print screen, which also saves a PDF', () => {
    const print = vi.fn();
    const focus = vi.fn();
    expect(printFrame({ contentWindow: { print, focus } as unknown as Window })).toBe(true);
    expect(print).toHaveBeenCalledTimes(1);
    expect(t('common.doc.printHint')).toContain('Save as PDF');
  });

  it('says it could not where the frame will not print — and the sheet offers the paper on a page of its own', () => {
    expect(printFrame({ contentWindow: { print: () => { throw new Error('blocked'); } } as unknown as Window })).toBe(false);
    expect(printFrame({ contentWindow: null })).toBe(false);
    expect(printFrame(null)).toBe(false);
    expect(t('common.doc.printFailed')).toContain('page of its own');
  });

  it('offers Print under the pages, and Close', () => {
    const html = renderToString(<PaperSheet state={shown(page())} />);
    expect(html).toContain(t('common.doc.print'));
    expect(html).toContain(t('common.close'));
    expect(html).not.toContain(t('common.doc.openToPrint'));
  });
});

describe('an iPhone', () => {
  const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';

  it('prints from a page of its own: the installed app, Safari, and an iPad that calls itself a Mac', () => {
    expect(printsFromFrame({ userAgent: iphone, standalone: true, installed: true })).toBe(false);
    expect(printsFromFrame({ userAgent: iphone })).toBe(false);
    expect(printsFromFrame({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15', maxTouchPoints: 5 })).toBe(false);
    expect(printsFromFrame({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15', maxTouchPoints: 0 })).toBe(true);
    expect(printsFromFrame({ userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36', installed: true })).toBe(true);
  });

  it('the sheet there says “Open to print” in Print’s place, and how to print from Safari', () => {
    vi.stubGlobal('navigator', { userAgent: iphone, maxTouchPoints: 5, standalone: true });
    const html = renderToString(<PaperSheet state={shown(page())} />);
    expect(html).toContain(t('common.doc.openToPrint'));
    expect(html).toContain(t('common.doc.openHint'));
    expect(html).not.toContain(t('common.doc.printHint'));
  });
});

describe('Share — the note’s link, never its file', () => {
  const ways = () => {
    const share = vi.fn(async (_data: { url: string; title: string }) => undefined);
    const copy = vi.fn(async (_text: string) => undefined);
    return { share, copy };
  };

  it('is offered only where a link may be made: a screen that hands the sheet the note’s links', () => {
    const share: PaperShare = { links: noLinks(), title: 'FRT-001 · Maize flour' };
    expect(renderToString(<PaperSheet state={shown(page())} look="console" share={share} />)).toContain(t('common.doc.share'));
    expect(renderToString(<PaperSheet state={shown(page())} look="console" />)).not.toContain(t('common.doc.share'));
    // Not before the links are read: making one needs the list it joins.
    expect(renderToString(<PaperSheet state={shown(page())} look="console" share={{ ...share, links: noLinks({ phase: 'loading' }) }} />)).toMatch(/<button(?=[^>]*\bdisabled\b)[^>]*>(?:(?!<\/button>)[^])*Share link/);
  });

  it('makes a link and hands it to the phone’s share sheet — the address and a title, no file', async () => {
    const w = ways();
    const makeLink = vi.fn(async () => ({ url: 'https://seebuyget.com/#doc=abc', expiresAt: '2026-12-02T00:00:00Z' }));
    expect(await sharePaper({ links: noLinks({ makeLink }), title: 'FRT-001' }, w)).toBe('shared');
    expect(makeLink).toHaveBeenCalledTimes(1);
    expect(w.share).toHaveBeenCalledWith({ url: 'https://seebuyget.com/#doc=abc', title: 'FRT-001' });
    expect(Object.keys(w.share.mock.calls[0][0]).sort()).toEqual(['title', 'url']);
  });

  it('passes on the link already made while the note is open, rather than making another', async () => {
    const w = ways();
    const makeLink = vi.fn(async () => null);
    await sharePaper({ links: noLinks({ makeLink, made: { url: 'https://seebuyget.com/#doc=made', expiresAt: '2026-12-02T00:00:00Z' } }), title: 'FRT-001' }, w);
    expect(makeLink).not.toHaveBeenCalled();
    expect(w.share).toHaveBeenCalledWith({ url: 'https://seebuyget.com/#doc=made', title: 'FRT-001' });
  });

  it('copies it where the phone has no share sheet; passes nothing on where no link could be made', async () => {
    const copy = vi.fn(async (_text: string) => undefined);
    const makeLink = vi.fn(async () => ({ url: 'https://seebuyget.com/#doc=c', expiresAt: '2026-12-02T00:00:00Z' }));
    expect(await sharePaper({ links: noLinks({ makeLink }), title: 'FRT-001' }, { copy })).toBe('copied');
    expect(copy).toHaveBeenCalledWith('https://seebuyget.com/#doc=c');
    const w = ways();
    expect(await sharePaper({ links: noLinks({ makeLink: async () => null }), title: 'FRT-001' }, w)).toBeNull();
    expect(w.share).not.toHaveBeenCalled();
  });

  it('shows the link once made, to copy by hand, and where it can be cancelled', () => {
    const made = { url: 'https://seebuyget.com/#doc=shown', expiresAt: '2026-12-02T00:00:00Z' };
    const html = renderToString(<PaperSheet state={shown(page())} look="console" share={{ links: noLinks({ made }), title: 'FRT-001' }} />);
    expect(html).toContain('value="https://seebuyget.com/#doc=shown"');
    expect(t('common.doc.linkMade', { date: 'x' })).toContain('Links to this note');
  });
});

describe('the copy kept on the phone, with no signal', () => {
  const copy = { html: '<p>kept note</p>', keptAt: '2026-11-02T06:30:00Z' };
  /** The server's answer, as much of one as fetchPaper reads. */
  const answer = (r: { data?: string; error?: SbgError }) => r as unknown as Result<unknown>;

  it('no signal: the kept copy, saying when it was kept', async () => {
    const put = vi.fn();
    const got = await fetchPaper(async () => answer({ error: { code: 'NETWORK', status: 0, title: '', detail: '', retryable: true } }), { get: () => copy, put });
    expect(got).toEqual({ paper: { kind: 'page', html: '<p>kept note</p>' }, keptAt: '2026-11-02T06:30:00Z' });
    expect(put).not.toHaveBeenCalled();
    const html = renderToString(<PaperSheet state={shown(got)} />);
    expect(html).toContain(t('common.doc.keptTitle'));
  });

  it('any other refusal is said as it is — the kept copy is not shown in its place', async () => {
    const got = await fetchPaper(async () => answer({ error: { code: 'FORBIDDEN', status: 403, title: 'Not yours', detail: '', retryable: false } }), { get: () => copy, put: () => undefined });
    expect('error' in got && typeof got.error !== 'string' ? got.error.code : null).toBe('FORBIDDEN');
  });

  it('a paper that came is kept for the next time there is no signal', async () => {
    const put = vi.fn();
    const got = await fetchPaper(async () => answer({ data: '<p>fresh</p>' }), { get: () => null, put });
    expect(got).toEqual({ paper: { kind: 'page', html: '<p>fresh</p>' } });
    expect(put).toHaveBeenCalledWith('<p>fresh</p>');
  });
});

describe('what came, as the paper it is', () => {
  it('our own page, a photograph, a PDF — or a file this phone opens on its own', async () => {
    expect(await paperOfBlob(new Blob(['<p>invoice</p>'], { type: 'text/html; charset=utf-8' }))).toEqual({ kind: 'page', html: '<p>invoice</p>' });
    expect((await paperOfBlob(new Blob(['%PDF'], { type: 'application/pdf' }))).kind).toBe('pdf');
    expect((await paperOfBlob(new Blob(['x'], { type: 'image/jpeg' }))).kind).toBe('image');
    expect((await paperOfBlob(new Blob(['x'], { type: 'application/zip' }))).kind).toBe('file');
  });

  it('a page that did not come is said in the screen’s own words', () => {
    expect(pageGot({ error: { code: 'NOT_FOUND' } }, 'The note could not be opened.')).toEqual({ error: 'The note could not be opened.' });
    expect(pageGot({ data: '<p>n</p>' }, 'gone')).toEqual({ paper: { kind: 'page', html: '<p>n</p>' } });
  });
});

describe('a pull on the paper’s sheet is that sheet’s alone', () => {
  it('a finger in a sheet opened over this one — or on its backdrop — does not pull this one', () => {
    const outer = { name: 'the load' };
    const inner = { name: 'the paper' };
    const at = (sheet: unknown, backdrop = false) => ({ closest: (s: string) => (s === '.sheet__backdrop' ? (backdrop ? {} : null) : s === '.sheet' ? sheet : null) });
    expect(ownTouch(at(outer), outer)).toBe(true);
    expect(ownTouch(at(inner), outer)).toBe(false);
    expect(ownTouch(at(outer, true), outer)).toBe(false);
  });
});

describe('every app’s papers in the sheet', () => {
  const read = (path: string) => readFileSync(join('src', ...path.split('/')), 'utf8');

  it('a label in hand, or fetched, is put on a page of its own; none is said in the screen’s words', () => {
    const got = labelGot('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"></svg>', 'The parcel’s label — PCL-9', 'gone');
    expect('paper' in got && got.paper.kind === 'page' ? got.paper.html : '').toContain('<title>The parcel’s label — PCL-9</title>');
    expect(labelGot(undefined, 'x', 'The label could not be opened.')).toEqual({ error: 'The label could not be opened.' });
  });

  it('a store’s label, drawn in the sheet at a phone’s width, with Print under it', () => {
    vi.stubGlobal('window', { innerWidth: 390 });
    const got = labelGot('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"></svg>', 'The parcel’s label — PCL-9', 'gone');
    const html = renderToString(<PaperSheet state={shown(got, { title: t('common.doc.label') })} />);
    expect(html).toContain(t('common.doc.label'));
    expect(html).toContain(`transform:scale(${(350 / 794).toFixed(4)})`);
    expect(html).toContain(t('common.doc.print'));
  });

  it('the Shop’s note shares a link where the server named the note its archive keeps — read only while the sheet is open', () => {
    const button = read('shared/ui/DocumentButton.tsx');
    expect(button).toMatch(/const shares = Boolean\(note\?\.client && note\.noteId\);/);
    expect(button).toMatch(/useNoteLinks\(paper\.open && shares \? note!\.client : null, paper\.open && shares \? note!\.noteId : undefined\)/);
    expect(button).toMatch(/share=\{shares \? \{ links, title: note!\.title \} : undefined\}/);
    expect(read('apps/agent/useAgentApp.ts')).toMatch(/\n {2}noteId\?: string;/);
    expect(read('apps/agent/screens/FreightScreen.tsx')).toMatch(/note=\{\{ client: sbg \?\? null, noteId: load\.noteId,/);
    expect(read('apps/agent/app.tsx')).toMatch(/<FreightScreen state=\{state\} actions=\{actions\} sbg=\{sbg\} \/>/);
    // The fleet's register names no note (the server says none there), so its note has no Share: never a built id.
    expect(read('apps/fleet/screens/EarningsScreen.tsx')).not.toMatch(/<DocumentButton[^\n]*note=/);
  });

  it('the archive’s copy shuts with its note, so it never reopens over the next one', () => {
    expect(read('shared/archive/useArchive.ts')).toMatch(/const closeDoc = useCallback\(\(\) => \{[\s\S]*?closePaper\(\);\s*\}, \[closePaper\]\);/);
  });

  it('a driver’s card is shown as a photograph on a page — an <img>, which runs nothing', () => {
    expect(read('apps/fleet/screens/DriversScreen.tsx')).toMatch(/\{ paper: \{ kind: 'image', blob: r\.data \} \}/);
  });
});

/** Every source file of the Business app, read. */
function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sources(path);
    return /\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [path] : [];
  });
}

describe('the Business app’s papers open in the slide-up', () => {
  const files = sources(join('src', 'apps', 'business'));
  const read = (name: string) => readFileSync(join('src', 'apps', 'business', 'screens', name), 'utf8');

  it('opens no tab of its own anywhere: in an installed app a tab throws the person out into the browser', () => {
    // The guard read something: the app's files, its loads screen among them.
    expect(files.length).toBeGreaterThan(30);
    expect(files.map((f) => f.split(/[\\/]/).pop())).toContain('LoadsScreen.tsx');
    const opening = files.filter((f) => /\btabAtTheTap\b|\bopen(Page|Svg)\b|window\.open\(/.test(readFileSync(f, 'utf8'))).map((f) => f.split(/[\\/]/).pop());
    expect(opening).toEqual([]);
  });

  it('the note, the receiver’s copy, a run’s note, labels and invoice, a parcel’s label, an export’s papers: each in the sheet, in the console’s dress', () => {
    for (const name of ['LoadsScreen.tsx', 'InboundDetail.tsx', 'RunsScreen.tsx', 'LoadPapers.tsx', 'ParcelsScreen.tsx', 'ExportsScreen.tsx']) {
      const src = read(name);
      expect({ name, sheet: /<PaperSheet state=\{\w+\} look="console"/.test(src), shown: /\.show\(/.test(src) }).toEqual({ name, sheet: true, shown: true });
    }
    // The papers opened by DocumentButton — a letter of instruction, a packing list, an invoice, the handover file — too.
    const buttons = files.flatMap((f) => readFileSync(f, 'utf8').match(/<DocumentButton\b[^>]*>/g) ?? []);
    expect(buttons.length).toBeGreaterThanOrEqual(7);
    expect(buttons.filter((b) => !b.includes('look="console"'))).toEqual([]);
  });

  it('Share is handed over only for a kept note, to somebody who may act', () => {
    expect(read('LoadsScreen.tsx')).toMatch(/share=\{kept === 'kept' && act \? \{ links: noteLinks/);
    expect(read('InboundDetail.tsx')).toMatch(/share=\{row\.noteId && act \? \{ links: noteLinks/);
    for (const name of ['RunsScreen.tsx', 'LoadPapers.tsx', 'ParcelsScreen.tsx', 'ExportsScreen.tsx']) expect(read(name)).not.toMatch(/<PaperSheet[^>]*share=/);
  });
});
