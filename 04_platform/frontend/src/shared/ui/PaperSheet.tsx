import type { ComponentChildren, JSX, RefObject } from 'preact';
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Result, SbgError } from '../../lib/sbg';
import { useT } from '../i18n';
import { tabAtTheTap } from '../openPage';
import { passOnLink, waysToPassOn, type PassedOn } from '../archive/handOver';
import type { NoteLinksState } from '../archive/useNoteLinks';
import type { MadeLink } from '../archive/documentLink';
import { day } from '../archive/words';
import { Button } from './Button';
import { ErrorNote, Note } from './ErrorNote';
import { Icon } from './Icon';
import { Sheet } from './Sheet';
import {
  isIos,
  mmToPx,
  pageOfImage,
  paperLayoutOf,
  paperPageOf,
  previewDoc,
  printedArea,
  printFrame,
  printsFromFrame,
  tallHeightOf,
  thisPhone,
  type PaperLayout,
} from './paperPreview';

/*
 * 2026-11-02 — A PAPER IN THE SLIDE-UP, AS IT WILL PRINT (the owner: "can we have a print preview of the consignment
 * note? and the print function in slide up").
 *
 * Every paper an app prints opens here, not in a tab of its own: in an installed app a tab throws the person out of the
 * app into the browser. The sheet shows each page as a white sheet on a grey ground, scaled to the sheet's width, the
 * whole paper scrolled top to bottom (paperPreview.ts draws the pages); under it, Print — the phone's own print screen,
 * which also keeps it as a PDF — Share, the note's LINK where this person may make one (never the file: files go by
 * link), and Close. Where a frame cannot print (an iPhone), "Open to print" puts the paper on a page of its own.
 *
 * Two dresses: the field apps' own buttons, and the console's where the Business app draws its own (`look="console"`).
 */

export type PaperLook = 'app' | 'console';

/** A paper to show: a page of HTML, a photograph of a paper, a PDF — or a file this phone opens on its own. */
export type Paper = { kind: 'page'; html: string } | { kind: 'image'; blob: Blob } | { kind: 'pdf'; blob: Blob } | { kind: 'file'; blob: Blob };

/** What came of asking for a paper: the paper (and when a copy shown with no signal was kept) — or why there is none. */
export type PaperGot = { paper: Paper; keptAt?: string } | { error: SbgError | string };

/** Where a paper is kept on the phone (shared/keptPapers.ts): read with no signal, written when it is fetched. */
export interface KeptDocument {
  get: () => { html: string; keptAt: string } | null;
  put: (html: string) => void;
}

const noSignal = (e: SbgError) => e.code === 'NETWORK' || e.code === 'OFFLINE' || e.code === 'TIMEOUT';

/**
 * A page the server renders, fetched. With no signal, the copy kept on this phone, saying when it was kept; any other
 * refusal said as it is. A page that came is kept for the next time there is none.
 */
export async function fetchPaper(fetch: () => Promise<Result<unknown>>, kept?: KeptDocument): Promise<PaperGot> {
  const r = await fetch();
  if (r.error) {
    const copy = noSignal(r.error) ? kept?.get() : null;
    if (copy) return { paper: { kind: 'page', html: copy.html }, keptAt: copy.keptAt };
    return { error: r.error };
  }
  const html = typeof r.data === 'string' ? r.data : String(r.data ?? '');
  kept?.put(html);
  return { paper: { kind: 'page', html } };
}

/** A page the server rendered, as the sheet shows it — or, where none came, the screen's own words for why. */
export function pageGot(r: { data?: unknown; error?: unknown }, gone: string): PaperGot {
  return r.error || !r.data ? { error: gone } : { paper: { kind: 'page', html: String(r.data) } };
}

/** A file that came as bytes, as the paper it is: our own page, a photograph, a PDF — or a file to open on its own. */
export async function paperOfBlob(blob: Blob): Promise<Paper> {
  const type = (blob.type || '').toLowerCase();
  if (type.startsWith('text/html')) return { kind: 'page', html: await blob.text() };
  if (type === 'application/pdf') return { kind: 'pdf', blob };
  // A photograph is shown by an <img>, which never runs anything an image might carry.
  if (type.startsWith('image/')) return { kind: 'image', blob };
  return { kind: 'file', blob };
}

/** The sheet's state: which paper, asked for when, and what came. One a screen, whatever papers it opens. */
export interface PaperState {
  open: boolean;
  title: string;
  loading: boolean;
  got: PaperGot | null;
  /** Open the sheet at the tap, and fetch the paper into it. */
  show: (title: string, load: () => Promise<PaperGot>) => void;
  retry: () => void;
  close: () => void;
}

export function usePaper(): PaperState {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(false);
  const [got, setGot] = useState<PaperGot | null>(null);
  const load = useRef<(() => Promise<PaperGot>) | null>(null);
  // Which asking an answer is for: one that comes back after the sheet was closed, or another paper asked for, is dropped.
  const asked = useRef(0);

  const run = useCallback(async () => {
    const fetch = load.current;
    if (!fetch) return;
    const me = ++asked.current;
    setLoading(true);
    setGot(null);
    let r: PaperGot;
    try {
      r = await fetch();
    } catch {
      r = { error: '' };
    }
    if (me !== asked.current) return;
    setLoading(false);
    setGot(r);
  }, []);

  const show = useCallback(
    (name: string, fetch: () => Promise<PaperGot>) => {
      load.current = fetch;
      setTitle(name);
      setOpen(true);
      void run();
    },
    [run],
  );

  const close = useCallback(() => {
    asked.current++;
    setOpen(false);
    setLoading(false);
  }, []);

  return { open, title, loading, got, show, retry: () => void run(), close };
}

/** The links to a kept note, the same the note's own panel lists — so a link made here is listed there. */
export interface PaperShare {
  links: NoteLinksState;
  /** What the link is called where it is sent: the load's code and its goods. */
  title: string;
}

/** The slide-up with the paper in it. */
export function PaperSheet({ state, look = 'app', share, startsAs }: { state: PaperState; look?: PaperLook; share?: PaperShare; startsAs?: PaperLayout }) {
  const t = useT();
  const got = state.got;
  return (
    <Sheet open={state.open} onClose={state.close} title={state.title}>
      <div class={`paper paper--${look}`}>
        {state.loading ? (
          <p class={look === 'console' ? 'chint' : 'paper__wait'} role="status">
            {t('common.doc.loading')}
          </p>
        ) : null}
        {got && 'error' in got ? <PaperError error={got.error} look={look} onRetry={state.retry} /> : null}
        {got && 'paper' in got ? (
          <PaperView paper={got.paper} keptAt={got.keptAt} title={state.title} look={look} share={share} onClose={state.close} startsAs={startsAs} />
        ) : (
          <Acts look={look}>
            <Act look={look} kind="quiet" onClick={state.close}>
              {t('common.close')}
            </Act>
          </Acts>
        )}
      </div>
    </Sheet>
  );
}

function PaperError({ error, look, onRetry }: { error: SbgError | string; look: PaperLook; onRetry: () => void }) {
  const t = useT();
  if (typeof error !== 'string' && look === 'app') return <ErrorNote error={error} onRetry={onRetry} />;
  const words = typeof error === 'string' ? error || t('common.doc.gone') : error.detail || error.title || t('common.doc.gone');
  return look === 'console' ? (
    <div class="paper__problem">
      <p class="cerr" role="alert">
        {words}
      </p>
      <button type="button" class="cbtn cbtn--ghost" onClick={onRetry}>
        {t('common.retry')}
      </button>
    </div>
  ) : (
    <>
      <Note tone="warn" icon="warning" title={words} />
      <Button variant="outline" full={false} chevron={false} onClick={onRetry}>
        {t('common.retry')}
      </Button>
    </>
  );
}

/** The row under the paper, kept in sight at the sheet's foot while the pages scroll. */
function Acts({ look, children }: { look: PaperLook; children: ComponentChildren }) {
  return <div class={`paper__acts${look === 'console' ? ' twr-panelend' : ''}`}>{children}</div>;
}

/** One button of that row, in the app's dress or the console's: `main` is the paper's one call, `second` the next. */
function Act({ look, kind, onClick, disabled, children }: { look: PaperLook; kind: 'main' | 'second' | 'quiet'; onClick: () => void; disabled?: boolean; children: ComponentChildren }) {
  if (look === 'console') {
    return (
      <button type="button" class={`cbtn ${kind === 'main' ? 'cbtn--primary' : 'cbtn--ghost'}`} disabled={disabled} onClick={onClick}>
        {children}
      </button>
    );
  }
  return (
    <Button variant={kind === 'main' ? 'primary' : kind === 'second' ? 'outline' : 'link'} full={false} chevron={false} disabled={disabled} onClick={onClick}>
      <span class="btn__row">{children}</span>
    </Button>
  );
}

/** An address for bytes in hand, for as long as they are shown — and a minute after, for a page opened from it. */
function useObjectUrl(blob: Blob | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
      setUrl(null);
      return;
    }
    const made = URL.createObjectURL(blob);
    setUrl(made);
    return () => {
      setTimeout(() => URL.revokeObjectURL(made), 60_000);
    };
  }, [blob]);
  return url;
}

function PaperView({ paper, keptAt, title, look, share, onClose, startsAs }: { paper: Paper; keptAt?: string; title: string; look: PaperLook; share?: PaperShare; onClose: () => void; startsAs?: PaperLayout }) {
  const t = useT();
  const frame = useRef<HTMLIFrameElement>(null);
  const [failed, setFailed] = useState(false);
  // What became of the last Share, said under the link — held here, as the link itself is: never on the note.
  const [passed, setPassed] = useState<PassedOn | null>(null);
  const place = useMemo(() => thisPhone(), []);
  const image = useObjectUrl(paper.kind === 'image' ? paper.blob : null);
  const pdfUrl = useObjectUrl(paper.kind === 'pdf' ? paper.blob : null);
  // A photograph is printed as a page of its own: the picture, as large as the sheet takes.
  const html = paper.kind === 'page' ? paper.html : paper.kind === 'image' && image ? pageOfImage(image, title) : null;
  // A PDF is shown by the browser's own viewer, where it has one in a page; a phone without (most Androids) opens it.
  const pdfHere = paper.kind === 'pdf' && typeof navigator !== 'undefined' && (navigator as Navigator & { pdfViewerEnabled?: boolean }).pdfViewerEnabled === true && !isIos(place);
  const framePrints = printsFromFrame(place) && !failed;

  useEffect(() => setFailed(false), [paper]);

  /** In a page of its own, opened at the tap: where a frame cannot print, and for a file this phone opens itself. */
  const openOwn = () => {
    const tab = tabAtTheTap();
    if (paper.kind === 'page' || paper.kind === 'image') tab.show(html ?? '');
    else tab.show(paper.blob);
  };

  const print = () => {
    if (!printFrame(frame.current)) setFailed(true);
  };

  const keptLine = keptAt ? t('common.doc.keptDetail', { when: new Date(keptAt).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' }) }) : '';

  return (
    <>
      {keptAt ? (
        look === 'console' ? (
          <p class="cnote" role="status">
            <strong>{t('common.doc.keptTitle')}</strong> {keptLine}
          </p>
        ) : (
          <Note tone="warn" icon="offline" title={t('common.doc.keptTitle')} detail={keptLine} />
        )
      ) : null}

      {html !== null ? <Preview html={html} title={title} frameRef={frame} look={look} startsAs={startsAs} /> : null}
      {paper.kind === 'pdf' && pdfHere && pdfUrl ? <iframe ref={frame} class="paper__pdf" title={title} src={pdfUrl} /> : null}
      {(paper.kind === 'pdf' && !pdfHere) || paper.kind === 'file' ? <p class={look === 'console' ? 'chint' : 'paper__hint'}>{t(paper.kind === 'pdf' ? 'common.doc.pdfElsewhere' : 'common.doc.fileElsewhere')}</p> : null}

      {share ? <ShareLine share={share} look={look} passed={passed} /> : null}
      {html !== null || pdfHere ? (
        <p class={look === 'console' ? 'chint' : 'paper__hint'}>{failed ? t('common.doc.printFailed') : framePrints ? t('common.doc.printHint') : t('common.doc.openHint')}</p>
      ) : null}

      <Acts look={look}>
        {html !== null || pdfHere ? (
          framePrints ? (
            <Act look={look} kind="main" onClick={print}>
              <Icon name="printer" size={18} /> {t('common.doc.print')}
            </Act>
          ) : (
            <Act look={look} kind="main" onClick={openOwn}>
              <Icon name="printer" size={18} /> {t('common.doc.openToPrint')}
            </Act>
          )
        ) : (
          <Act look={look} kind="main" onClick={openOwn}>
            {t('common.doc.open')}
          </Act>
        )}
        {share ? (
          <Act look={look} kind="second" disabled={share.links.making || share.links.phase !== 'ready'} onClick={() => void sharePaper(share).then((went) => went && setPassed(went))}>
            <Icon name="send" size={18} /> {t('common.doc.share')}
          </Act>
        ) : null}
        <Act look={look} kind="quiet" onClick={onClose}>
          {t('common.close')}
        </Act>
      </Acts>
    </>
  );
}

/** How wide the grey ground is, followed as the sheet changes width; a guess from the window until it is measured. */
function useWidth(ref: RefObject<HTMLElement>): number {
  const [width, setWidth] = useState(() => (typeof window !== 'undefined' && window.innerWidth ? Math.min(window.innerWidth, GROUND_MAX) - GROUND_INSET : 350));
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => {
      const w = el.clientWidth - 2 * GROUND_PAD;
      if (w > 0) setWidth(w);
    };
    read();
    if (typeof ResizeObserver !== 'function') {
      window.addEventListener('resize', read);
      return () => window.removeEventListener('resize', read);
    }
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}

/**
 * The grey ground's own padding; the widest the sheet grows at a desk; and what is left of the window's width for a page:
 * the sheet's padding (20 a side) less the ground's bleed into it (12 a side), less the ground's own padding (12 a side).
 */
const GROUND_PAD = 12;
const GROUND_MAX = 920;
const GROUND_INSET = 40;
/** Pages after the first three are drawn as they come near, so fifty labels are not fifty pages drawn at once. */
const EAGER = 3;

/**
 * THE PAGES, AS THEY WILL PRINT. Each page a frame of the paper's printed area, on a white sheet the paper's size,
 * scaled to fit the sheet's width ("Actual size" shows it as large as it prints, to read at a border post). The first
 * frame is read once drawn to learn how many pages there are; it is also the one that prints.
 */
export function Preview({ html, title, frameRef, look, startsAs }: { html: string; title: string; frameRef: RefObject<HTMLIFrameElement>; look: PaperLook; startsAs?: PaperLayout }) {
  const t = useT();
  const page = useMemo(() => paperPageOf(html), [html]);
  const area = printedArea(page);
  const sheetW = mmToPx(page.width);
  const margins = page.margin.map(mmToPx);
  const [layout, setLayout] = useState<PaperLayout | null>(startsAs ?? null);
  const [tallH, setTallH] = useState<number | null>(null);
  const [actual, setActual] = useState(false);
  const ground = useRef<HTMLDivElement>(null);
  const width = useWidth(ground);
  const seen = useRef(html);

  useEffect(() => {
    if (seen.current === html) return;
    seen.current = html;
    setLayout(startsAs ?? null);
    setTallH(null);
  }, [html]);

  const tall = Boolean(layout && 'tall' in layout);
  const pages = layout && 'pages' in layout ? layout.pages : 1;
  const fit = Math.min(1, width / sheetW);
  const scale = actual ? 1 : fit;
  const frameH = tall ? (tallH ?? area.height) : area.height;
  const sheetH = tall ? frameH + margins[0] + margins[2] : mmToPx(page.height);
  const docs = useMemo(() => Array.from({ length: tall ? 1 : pages }, (_, k) => previewDoc(html, k, area, tall)), [html, pages, tall, area.width, area.height]);

  const read = (e: JSX.TargetedEvent<HTMLIFrameElement, Event>) => {
    const doc = e.currentTarget.contentDocument;
    if (!doc) return;
    if (tall) setTallH(tallHeightOf(doc));
    else setLayout(paperLayoutOf(doc, area));
  };

  return (
    <section class="paper__preview" aria-label={t('common.doc.preview')}>
      {fit < 0.9 || pages > 1 || tall ? (
        <div class="paper__bar">
          <span class={look === 'console' ? 'chint' : 'paper__count'}>{tall ? t('common.doc.noBreaks') : pages > 1 ? t('common.doc.pages', { n: pages }) : ''}</span>
          {fit < 0.9 ? (
            <button type="button" class={look === 'console' ? 'cbtn cbtn--ghost paper__zoom' : 'btn btn--link paper__zoom'} aria-pressed={actual} onClick={() => setActual((v) => !v)}>
              {t(actual ? 'common.doc.fitPage' : 'common.doc.actualSize')}
            </button>
          ) : null}
        </div>
      ) : null}
      <div class={`paper__ground${actual && fit < 1 ? ' paper__ground--actual' : ''}`} ref={ground}>
        {docs.map((doc, k) => (
          <figure class="paper__page" key={k} style={`width:${Math.round(sheetW * scale)}px;height:${Math.round(sheetH * scale)}px`}>
            <div class="paper__sheet" style={`width:${sheetW}px;height:${sheetH}px;padding:${margins[0]}px ${margins[1]}px ${margins[2]}px ${margins[3]}px;transform:scale(${scale.toFixed(4)})`}>
              <PageFrame k={k} doc={doc} width={area.width} height={frameH} eager={k < EAGER} title={k === 0 ? title : t('common.doc.page', { n: k + 1, of: pages })} frameRef={k === 0 ? frameRef : undefined} onLoad={k === 0 ? read : undefined} />
            </div>
            {docs.length > 1 ? <figcaption class="paper__pageno">{t('common.doc.page', { n: k + 1, of: docs.length })}</figcaption> : null}
          </figure>
        ))}
      </div>
    </section>
  );
}

/**
 * One page's frame. Sandboxed as tightly as printing lets it be: nothing in the paper runs (no scripts), it opens nothing
 * and goes nowhere; `allow-same-origin` lets this app read how many pages it came to and call its print, and
 * `allow-modals` lets that print open. It takes no touch — a finger on the paper scrolls the sheet, and a pull closes it.
 */
function PageFrame({ k, doc, width, height, eager, title, frameRef, onLoad }: { k: number; doc: string; width: number; height: number; eager: boolean; title: string; frameRef?: RefObject<HTMLIFrameElement>; onLoad?: (e: JSX.TargetedEvent<HTMLIFrameElement, Event>) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(eager);
  useEffect(() => {
    if (near) return;
    const el = box.current;
    if (!el || typeof IntersectionObserver !== 'function') return setNear(true);
    const io = new IntersectionObserver((seen) => seen.some((s) => s.isIntersecting) && (setNear(true), io.disconnect()), { root: el.closest('.sheet'), rootMargin: '100% 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [near]);
  return (
    <div class="paper__window" ref={box} style={`width:${width}px;height:${height}px`}>
      {near ? (
        <iframe
          ref={frameRef}
          class="paper__frame"
          title={title}
          sandbox="allow-same-origin allow-modals"
          srcDoc={doc}
          width={width}
          height={height}
          style={`width:${width}px;height:${height}px`}
          // The pages after the first are the same paper shifted: a screen reader reads it once, from the first.
          aria-hidden={k > 0 ? 'true' : undefined}
          tabIndex={k > 0 ? -1 : undefined}
          onLoad={onLoad}
        />
      ) : null}
    </div>
  );
}

/** Share a kept note: its LINK, never its file. A link already made while this note is open is the one passed on. */
export async function sharePaper(share: PaperShare, ways = waysToPassOn()): Promise<PassedOn | null> {
  const made: MadeLink | null = share.links.made ?? (await share.links.makeLink());
  if (!made) return null;
  return passOnLink(made.url, share.title, 'share', ways);
}

/** The link once made: shown this once, to copy by hand where neither the share sheet nor the clipboard would take it. */
function ShareLine({ share, look, passed }: { share: PaperShare; look: PaperLook; passed: PassedOn | null }) {
  const t = useT();
  const made = share.links.made;
  const said = passed === 'shared' ? t('archive.links.passedShared') : passed === 'copied' ? t('archive.links.passedCopied') : passed === 'shown' ? t('archive.links.passedShown') : '';
  return (
    <>
      {made ? (
        <div class={look === 'console' ? 'cnote paper__link' : 'note note--info paper__link'} role="status">
          <strong>{t('archive.links.madeTitle')}</strong>
          <span>{t('common.doc.linkMade', { date: day(made.expiresAt) })}</span>
          <input class={look === 'console' ? 'cinput paper__url' : 'paper__url'} type="text" readOnly aria-label={t('archive.links.madeLabel')} value={made.url} onFocus={(e) => (e.target as HTMLInputElement).select()} />
          {said ? <span>{said}</span> : null}
        </div>
      ) : (
        <p class={look === 'console' ? 'chint' : 'paper__hint'}>{t('common.doc.shareHint')}</p>
      )}
      {share.links.problem ? (
        <p class={look === 'console' ? 'cerr' : 'paper__problemline'} role="alert">
          {share.links.problem}
        </p>
      ) : null}
    </>
  );
}
