import { useEffect, useMemo, useState } from 'preact/hooks';
import { Button, ErrorNote, Sheet } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import type { SbgClient, SbgError } from '../../../lib/sbg';
import { TOWING_KINDS, trailerApi, trailerLine, type TrailerView } from '../../../shared/trailers';
import { TrailerSheet } from '../../../shared/trailers/TrailerSheet';

/**
 * 2026-11-13 — HITCH A TRAILER (trailer plan D2–D3): on a shift, one of the trailers the driver or their fleet keeps, or one hired for
 * the day; what the licence covers for towing, said as on the card. The server says whether the pairing may be driven — the van's
 * own limits, the trailer's brakes, the country's licence rule — and, where not, why and what would allow it.
 */
export function HitchSheet({ open, onClose, sbg, driverDid, towing, onDone }: { open: boolean; onClose: () => void; sbg: SbgClient | null; driverDid: string; towing: string[]; onDone: () => void }) {
  const t = useT();
  const api = useMemo(() => (sbg ? trailerApi(sbg) : null), [sbg]);
  const [list, setList] = useState<TrailerView[]>([]);
  const [kinds, setKinds] = useState<string[]>(towing);
  const [hiring, setHiring] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<SbgError | null>(null);
  useEffect(() => {
    if (!open || !api) return;
    void api.list().then((r) => {
      if (!r.error) setList((r.data as TrailerView[]) ?? []);
    });
  }, [open, api]);
  if (!open || !api) return null;
  const hitch = async (body: { trailerId?: string; hire?: Parameters<typeof api.hitch>[1]['hire'] }): Promise<SbgError | null> => {
    setBusy(body.trailerId ?? 'hire');
    setError(null);
    const r = await api.hitch(driverDid, body);
    setBusy(null);
    if (r.error) {
      setError(r.error);
      return r.error;
    }
    onDone();
    onClose();
    return null;
  };
  const toggle = async (k: string) => {
    const next = kinds.includes(k) ? kinds.filter((x) => x !== k) : [...kinds, k];
    setKinds(next);
    const r = await api.setTowing(driverDid, next);
    if (r.error) setError(r.error);
  };
  return (
    <Sheet open onClose={onClose} title={t('trailer.hitchTitle')}>
      <p class="t-body">{t('trailer.hitchBody')}</p>
      {error ? <ErrorNote error={error} showDetail /> : null}
      <div class="rows" role="list">
        {list.map((tr) => (
          <button key={tr.trailerId} type="button" class="row" role="listitem" disabled={busy !== null} onClick={() => void hitch({ trailerId: tr.trailerId })}>
            <span class="row__body">
              <span class="row__t">{tr.plate}</span>
              <span class="row__s">{trailerLine(tr, t)}</span>
            </span>
          </button>
        ))}
      </div>
      <Button variant="outline" onClick={() => setHiring(true)}>
        {t('trailer.hire')}
      </Button>
      <div class="field">
        <span class="field__label">{t('trailer.licence')}</span>
        <div class="chips">
          {TOWING_KINDS.map((k) => (
            <button key={k} type="button" class={`chip chip--tap${kinds.includes(k) ? ' chip--on' : ''}`} aria-pressed={kinds.includes(k)} onClick={() => void toggle(k)}>
              {t(`trailer.kind.${k}` as 'trailer.kind.BE')}
            </button>
          ))}
        </div>
        <p class="hint">{t('trailer.licenceHint')}</p>
      </div>
      <Button variant="link" onClick={onClose}>
        {t('trailer.cancel')}
      </Button>
      <TrailerSheet open={hiring} onClose={() => setHiring(false)} mode="hire" onSave={(hire) => hitch({ hire })} />
    </Sheet>
  );
}
