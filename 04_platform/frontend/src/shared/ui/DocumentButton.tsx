import { useRef, useState } from 'preact/hooks';
import type { Result, SbgError } from '../../lib/sbg';
import { useT } from '../i18n';
import { Button } from './Button';
import { ErrorNote } from './ErrorNote';
import { Icon } from './Icon';
import { Sheet } from './Sheet';

/**
 * A button that opens a DOCUMENT the server renders — the consignment note today — inside the app, with a way to
 * print or save it. Self-contained: it fetches when tapped, so no screen has to hold a document in its state, and
 * the token stays in the app (a document behind a bearer cannot simply be a link).
 */
export function DocumentButton({ label, title, fetch, variant = 'link' }: { label: string; title: string; fetch: () => Promise<Result<unknown>>; variant?: 'link' | 'outline' }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [html, setHtml] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SbgError | null>(null);
  const frame = useRef<HTMLIFrameElement>(null);

  const show = async () => {
    setBusy(true);
    setError(null);
    const r = await fetch();
    setBusy(false);
    if (r.error) {
      setError(r.error);
      setOpen(true);
      return;
    }
    setHtml(typeof r.data === 'string' ? r.data : String(r.data ?? ''));
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
