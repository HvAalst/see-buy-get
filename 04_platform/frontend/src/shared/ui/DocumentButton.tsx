import { useRef, useState } from 'preact/hooks';
import type { Result, SbgError } from '../../lib/sbg';
import { useT } from '../i18n';
import { Button } from './Button';
import { ErrorNote, Note } from './ErrorNote';
import { Icon } from './Icon';
import { Sheet } from './Sheet';

/**
 * A button that opens a DOCUMENT the server renders — the consignment note today — inside the app, with a way to
 * print or save it. Self-contained: it fetches when tapped, so no screen has to hold a document in its state, and
 * the token stays in the app (a document behind a bearer cannot simply be a link).
 */
/** Where a document is kept on the phone (shared/keptPapers.ts): read with no signal, written when it is fetched. */
export interface KeptDocument {
  get: () => { html: string; keptAt: string } | null;
  put: (html: string) => void;
}

const noSignal = (e: SbgError) => e.code === 'NETWORK' || e.code === 'OFFLINE' || e.code === 'TIMEOUT';

export function DocumentButton({ label, title, fetch, variant = 'link', kept }: { label: string; title: string; fetch: () => Promise<Result<unknown>>; variant?: 'link' | 'outline'; kept?: KeptDocument }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [html, setHtml] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SbgError | null>(null);
  // The copy kept on this phone, shown because there was no signal: when it was kept.
  const [keptAt, setKeptAt] = useState<string | null>(null);
  const frame = useRef<HTMLIFrameElement>(null);

  const show = async () => {
    setBusy(true);
    setError(null);
    setKeptAt(null);
    const r = await fetch();
    setBusy(false);
    if (r.error) {
      // No signal, and a copy kept on this phone: the copy, saying when it was kept. Any other refusal is said as it is.
      const copy = noSignal(r.error) ? kept?.get() : null;
      if (copy) {
        setHtml(copy.html);
        setKeptAt(copy.keptAt);
        setOpen(true);
        return;
      }
      setError(r.error);
      setOpen(true);
      return;
    }
    const doc = typeof r.data === 'string' ? r.data : String(r.data ?? '');
    setHtml(doc);
    kept?.put(doc);
    setOpen(true);
  };

  return (
    <>
      <Button variant={variant} full={false} chevron={false} busy={busy} onClick={() => void show()}>
        <Icon name="edit" size={18} /> {label}
      </Button>
      <Sheet open={open} onClose={() => setOpen(false)} title={title}>
        {error ? <ErrorNote error={error} onRetry={() => void show()} /> : null}
        {html ? (
          <>
            {keptAt ? <Note tone="warn" icon="offline" title={t('common.doc.keptTitle')} detail={t('common.doc.keptDetail', { when: new Date(keptAt).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' }) })} /> : null}
            <iframe ref={frame} class="doc" title={title} srcDoc={html} style="width:100%; height:70vh; border:1px solid var(--line, #dcdce4); border-radius:10px; background:#fff" />
            <div class="btnrow" style="margin-top:10px">
              <Button variant="outline" full={false} chevron={false} onClick={() => frame.current?.contentWindow?.print()}>
                {t('common.doc.print')}
              </Button>
            </div>
          </>
        ) : null}
      </Sheet>
    </>
  );
}
