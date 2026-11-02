/**
 * 2026-11-02 — A PRINT PREVIEW OF A PAPER, IN THE SLIDE-UP (the owner: "can we have a print preview of the consignment
 * note? and the print function in slide up").
 *
 * A paper the server draws — the consignment note, a commercial invoice, package labels — is a page of HTML that says
 * its own paper size (`@page`). Shown as it was, in a frame the phone's width, it reflowed to the phone and nobody could
 * see what would come out of the printer. So each page is now drawn as the printer will draw it:
 *
 *   - the frame is the width of the paper's printed area (A4 less its margins: 186 mm), never the phone's, so the
 *     paper's own layout — and any rule it keys to a width — is the printed one;
 *   - what the paper says only for print (`@media print`: the "Original for" line, the lines for a signature by hand)
 *     is shown too, copied into a style for the SCREEN alone;
 *   - and the browser's own breaking engine cuts it into pages: the frame's root is laid out in columns exactly one
 *     printed area wide and tall, so a box that must not be split moves whole to the next page, and a page break the
 *     paper asks for (`break-before: page`) is a column break here. Page k of a paper is that frame shifted k columns.
 *
 * THE PRINT ITSELF IS UNTOUCHED: the only thing added to the paper is one `<style media="screen">`, which a printer
 * never reads. Nothing is added to its body (a marker there would change what `:last-child` picks out on paper).
 */

/** The page a paper asks for, in millimetres: its sheet, and the margins inside which it is printed. */
export interface PaperPage {
  width: number;
  height: number;
  /** top, right, bottom, left */
  margin: [number, number, number, number];
  /** False where the paper says no size: then it is shown on A4, the paper of the countries we work in. */
  said: boolean;
}

/** The paper sizes a page may name, portrait, in millimetres. */
const SIZES: Record<string, [number, number]> = {
  a3: [297, 420],
  a4: [210, 297],
  a5: [148, 210],
  a6: [105, 148],
  b5: [176, 250],
  letter: [215.9, 279.4],
  legal: [215.9, 355.6],
  ledger: [279.4, 431.8],
};

/** A browser's own margin, where a paper says none: about 10 mm in Chrome. */
const BROWSER_MARGIN = 10;

/** CSS pixels in a millimetre: 96 to the inch. */
export const PX_PER_MM = 96 / 25.4;

export const mmToPx = (mm: number): number => Math.round(mm * PX_PER_MM);

/** One CSS length in millimetres, or null where it is not one. A bare 0 is nought. */
function lengthMm(raw: string): number | null {
  const m = /^(-?\d*\.?\d+)(mm|cm|in|px|pt|pc|q)?$/i.exec(raw.trim());
  if (!m) return null;
  const n = parseFloat(m[1]);
  switch ((m[2] ?? (n === 0 ? 'mm' : 'px')).toLowerCase()) {
    case 'mm':
      return n;
    case 'cm':
      return n * 10;
    case 'in':
      return n * 25.4;
    case 'pt':
      return (n * 25.4) / 72;
    case 'pc':
      return (n * 25.4) / 6;
    case 'q':
      return n / 4;
    default:
      return n / PX_PER_MM;
  }
}

/** Every style sheet written in the paper, as one text. */
export function stylesOf(html: string): string {
  return [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi)].map((m) => m[1]).join('\n');
}

/** The page the paper's own `@page` asks for. A size it does not say is A4; a margin it does not say is the browser's. */
export function paperPageOf(html: string): PaperPage {
  const css = stylesOf(html);
  let width = SIZES.a4[0];
  let height = SIZES.a4[1];
  let said = false;
  let margin: PaperPage['margin'] = [BROWSER_MARGIN, BROWSER_MARGIN, BROWSER_MARGIN, BROWSER_MARGIN];
  // Only the page rule for every page — not one for `:first` or a named page.
  for (const block of css.matchAll(/@page\s*\{([^}]*)\}/gi)) {
    const body = block[1];
    const size = /(?:^|;|\s)size\s*:\s*([^;]+)/i.exec(body)?.[1].trim().toLowerCase();
    if (size && size !== 'auto') {
      const words = size.split(/\s+/);
      const named = words.find((w) => SIZES[w]);
      const lengths = words.map(lengthMm).filter((n): n is number => n !== null);
      if (named) [width, height] = SIZES[named];
      if (lengths.length === 1) width = height = lengths[0];
      if (lengths.length >= 2) [width, height] = lengths;
      if (words.includes('landscape') && width < height) [width, height] = [height, width];
      if (words.includes('portrait') && width > height) [width, height] = [height, width];
      said = Boolean(named || lengths.length || words.includes('landscape') || words.includes('portrait'));
    }
    const short = /(?:^|;|\s)margin\s*:\s*([^;]+)/i.exec(body)?.[1];
    if (short) {
      const v = short.trim().split(/\s+/).map(lengthMm);
      if (v.every((n) => n !== null)) {
        const [a, b = a, c = a, d = b] = v as number[];
        margin = [a, b, c, d];
      }
    }
    for (const [i, side] of ['top', 'right', 'bottom', 'left'].entries()) {
      const one = new RegExp(`margin-${side}\\s*:\\s*([^;]+)`, 'i').exec(body)?.[1];
      const n = one ? lengthMm(one) : null;
      if (n !== null) margin[i] = n;
    }
  }
  return { width, height, margin, said };
}

/** The printed area of a page — the sheet less its margins — in CSS pixels. */
export function printedArea(p: PaperPage): { width: number; height: number } {
  return { width: mmToPx(p.width - p.margin[1] - p.margin[3]), height: mmToPx(p.height - p.margin[0] - p.margin[2]) };
}

/** The inside of every `@media print { … }` in a style text: what the paper says for paper only. */
export function printRules(css: string): string {
  const out: string[] = [];
  const re = /@media\s+print\b[^{]*\{/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    for (; i < css.length && depth > 0; i++) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') depth--;
    }
    out.push(css.slice(start, i - 1));
    re.lastIndex = i;
  }
  return out.join('\n');
}

/**
 * A page break the paper asks for, said again as a column break, for the screen. The columns are the pages here, and a
 * browser on a screen does not take a page break for a column one.
 */
export function columnBreaks(css: string): string {
  const out: string[] = [];
  // Each innermost rule: a selector and its declarations, no braces inside.
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = m[1].trim();
    if (!selector || selector.startsWith('@')) continue;
    const said: string[] = [];
    for (const side of ['before', 'after'] as const) {
      const re = new RegExp(`(?:^|;|\\s)(?:page-)?break-${side}\\s*:\\s*(page|always|left|right|recto|verso)\\b`, 'i');
      if (re.test(m[2])) said.push(`break-${side}: column`);
    }
    if (/(?:^|;|\s)(?:page-)?break-inside\s*:\s*avoid(?:-page)?\b/i.test(m[2])) said.push('break-inside: avoid');
    if (said.length) out.push(`${selector} { ${said.join('; ')}; }`);
  }
  return out.join('\n');
}

/** Marks the one thing the preview adds to a paper, so it can be told apart from the paper's own. */
export const PREVIEW_MARK = 'data-sbg-preview';

/**
 * The paper as shown for page `page` (from 0): the paper itself, and one style for the screen.
 *
 * `tall` — the whole paper as one long page, where this browser did not cut it into columns (paperLayoutOf says so):
 * then nothing is shifted and nothing is hidden, and only the page breaks are not shown.
 */
export function previewDoc(html: string, page: number, area: { width: number; height: number }, tall = false): string {
  const css = stylesOf(html);
  const layout = tall
    ? 'html { margin: 0 !important; padding: 0 !important; overflow: hidden !important; }'
    : [
        // The root laid out in columns one printed area wide and tall — the frame's own size: each column is a page.
        `html { margin: 0 !important; padding: 0 !important; width: ${area.width}px !important; height: ${area.height}px !important; overflow: hidden !important;`,
        `  columns: ${area.width}px !important; column-gap: 0 !important; column-fill: auto !important;`,
        `  transform: translateX(${-Math.max(0, Math.floor(page)) * area.width}px) !important; }`,
      ].join('\n');
  const style = [
    `<style media="screen" ${PREVIEW_MARK}>`,
    // A phone must not enlarge the words of a frame it thinks too wide to read: the page would no longer be the page.
    'html { -webkit-text-size-adjust: 100% !important; text-size-adjust: 100% !important; }',
    printRules(css),
    tall ? '' : columnBreaks(css),
    layout,
    '</style>',
  ]
    .filter(Boolean)
    .join('\n');
  return insertInHead(html, style);
}

/** Put `piece` at the end of the paper's head — or, with no head, before its body — never ahead of its doctype. */
function insertInHead(html: string, piece: string): string {
  const head = html.search(/<\/head\s*>/i);
  if (head >= 0) return html.slice(0, head) + piece + html.slice(head);
  const body = html.search(/<body\b/i);
  if (body >= 0) return html.slice(0, body) + piece + html.slice(body);
  const doctype = /^\s*<!doctype[^>]*>/i.exec(html);
  return doctype ? doctype[0] + piece + html.slice(doctype[0].length) : piece + html;
}

/** The paper as it was, from a page of the preview: the preview's one style taken out. */
export function withoutPreview(doc: string): string {
  return doc.replace(new RegExp(`<style media="screen" ${PREVIEW_MARK}>[\\s\\S]*?</style>`), '');
}

/** What the first frame shows once drawn: how many pages — or that it was not cut into columns, and is one long page. */
export type PaperLayout = { pages: number } | { tall: true };

/**
 * How many pages the paper came to, read from the first frame (unshifted). Where the columns did not take — a browser
 * that will not lay out the root in columns — everything sits in the first column and runs below it: then the paper is
 * shown whole, as one long page, rather than cut off at the first page's foot.
 */
export function paperLayoutOf(doc: Document, frame: { width: number; height: number }): PaperLayout {
  const body = doc.body;
  if (!body) return { pages: 1 };
  const columns = doc.defaultView?.getComputedStyle(doc.documentElement).columnWidth;
  if (!columns || columns === 'auto') return { tall: true };
  let left = 0;
  let bottom = 0;
  const near = [body, ...Array.from(body.children), ...Array.from(body.children).flatMap((c) => Array.from(c.children))];
  // The last thing in the paper, however deep, is on its last page.
  for (let n = body.lastElementChild; n; n = n.lastElementChild) near.push(n);
  for (const el of near) {
    for (const r of Array.from(el.getClientRects())) {
      if (r.width === 0 && r.height === 0) continue;
      left = Math.max(left, r.left);
      bottom = Math.max(bottom, r.bottom);
    }
  }
  if (left < frame.width && bottom > frame.height + 2) return { tall: true };
  return { pages: Math.max(1, Math.floor(left / frame.width + 0.001) + 1) };
}

/** The height of the whole paper, read from a frame drawn `tall`. */
export function tallHeightOf(doc: Document): number {
  return Math.max(doc.documentElement?.scrollHeight ?? 0, doc.body?.scrollHeight ?? 0);
}

const escapeText = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

/**
 * A label the server drew as a picture (an SVG), as a page to print: at its own size, at the top of the sheet, as it
 * came out when the picture was opened on its own. The paper size is the printer's; it is shown on A4.
 */
export function pageOfSvg(svg: string, title: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeText(title)}</title><style>@page { margin: 12mm; } html, body { margin: 0; background: #fff; } svg { display: block; max-width: 100%; height: auto; }</style></head><body>${svg}</body></html>`;
}

/** A photograph of a paper, as a page to print: as large as the sheet takes, never cut. */
export function pageOfImage(src: string, title: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeText(title)}</title><style>@page { margin: 12mm; } html, body { margin: 0; background: #fff; } img { display: block; max-width: 100%; max-height: 270mm; margin: 0 auto; object-fit: contain; }</style></head><body><img src="${escapeText(src)}" alt="${escapeText(title)}"></body></html>`;
}

/** What is known of the phone: enough to say whether printing from a frame works on it. */
export interface PrintPlace {
  userAgent?: string;
  maxTouchPoints?: number;
  /** Safari's own word that this is the app on the home screen. */
  standalone?: boolean;
  /** `display-mode: standalone` — an installed app, on any phone. */
  installed?: boolean;
}

/** This phone, as the browser says it. */
export function thisPhone(): PrintPlace {
  if (typeof navigator === 'undefined') return {};
  let installed = false;
  try {
    installed = typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches;
  } catch {
    installed = false;
  }
  return { userAgent: navigator.userAgent, maxTouchPoints: navigator.maxTouchPoints, standalone: (navigator as Navigator & { standalone?: boolean }).standalone, installed };
}

/** An iPhone or an iPad — an iPad says it is a Mac, and gives itself away by its touch screen. */
export function isIos(p: PrintPlace): boolean {
  const ua = p.userAgent ?? '';
  return /iP(hone|ad|od)/.test(ua) || (/Macintosh/.test(ua) && (p.maxTouchPoints ?? 0) > 1);
}

/**
 * WHETHER A FRAME'S PRINT CAN BE TRUSTED HERE. On an iPhone or an iPad it cannot: in the app on the home screen it does
 * nothing at all, and in Safari it has been known to print the app's page around the frame instead of the paper. There
 * the paper is opened on a page of its own, and printed from Safari's Share. Everywhere else, the frame prints.
 */
export function printsFromFrame(p: PrintPlace): boolean {
  return !isIos(p);
}

/** Print the paper in a frame: the phone's own print screen, which also saves it as a PDF. False where it could not. */
export function printFrame(frame: { contentWindow: Window | null } | null | undefined): boolean {
  const w = frame?.contentWindow;
  if (!w || typeof w.print !== 'function') return false;
  try {
    w.focus?.();
    w.print();
    return true;
  } catch {
    return false;
  }
}
