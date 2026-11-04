import { useEffect, useState } from 'preact/hooks';
import type { SbgClient, SbgError } from '../lib/sbg';
import { Button, Card, CheckGate, Note, RefusalNote } from './ui';
import { formatDate, useT } from './i18n';
import { declarationAsks, declarationLeft, declarationWhy, readDeclaration, signDeclaration, type DeclarationView } from './declaration';

/**
 * Round 39 — THE SECURITY DECLARATION ON THE HOME SCREEN (the user: "At joining and yearly"). Shown only while it asks for
 * their hand — none signed, lapsed, a new wording, or due within the month — and gone once it is signed. Reads and signs
 * by itself, from the partner's own sign-in; somebody at a shop's counter is not the one who signs, and sees nothing here.
 */
export function DeclarationCard({ sbg }: { sbg: SbgClient | null }) {
  const t = useT();
  const [view, setView] = useState<DeclarationView | null>(null);
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<SbgError | null>(null);
  const [signed, setSigned] = useState<string | null>(null);
  // 2026-11-04 — each line ticked by itself (declaration.ts declarationLeft): a new wording starts with none.
  const [ticked, setTicked] = useState<string[]>([]);
  useEffect(() => setTicked([]), [view?.version]);

  useEffect(() => {
    if (!sbg) return;
    let live = true;
    void readDeclaration(sbg).then((r) => {
      if (live) setView(r.error ? null : (r.data ?? null));
    });
    return () => {
      live = false;
    };
  }, [sbg]);

  const day = (iso: string) => (iso ? formatDate(iso) : '');
  if (signed) return <Note tone="ok" icon="check" title={t('common.declaration.thanks')} detail={t('common.declaration.until', { day: day(signed) })} />;
  if (!view || !declarationAsks(view)) return null;
  const why = declarationWhy(view, t, day)!;
  const left = declarationLeft(view.lines, ticked);

  return (
    <Card title={view.title} class="declaration">
      <Note tone={why.tone} icon="info" title={why.title} />
      <p class="hint">{t('common.declaration.tickEach')}</p>
      <CheckGate items={view.lines!.map((line, i) => ({ key: String(i), label: line }))} checked={ticked} onChange={setTicked} disabled={busy} />
      <p class="hint">{t('common.declaration.how')}</p>
      {refused ? <RefusalNote error={refused} /> : null}
      <Button
        chevron={false}
        busy={busy}
        disabled={left > 0}
        onClick={async () => {
          if (!sbg || !view.version || left > 0) return;
          setBusy(true);
          setRefused(null);
          const r = await signDeclaration(sbg, view.version, ticked.map(Number));
          setBusy(false);
          if (r.error) {
            setRefused(r.error);
            return;
          }
          setView(r.data ?? null);
          setSigned(r.data?.until ?? '');
        }}
      >
        {left > 0 ? t('common.declaration.toGo', { n: left }) : t('common.declaration.sign')}
      </Button>
    </Card>
  );
}
