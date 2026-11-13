import { useEffect, useMemo, useState } from 'preact/hooks';
import { Button, Card, ErrorNote } from '../ui';
import { useT } from '../i18n';
import type { SbgClient, SbgError } from '../../lib/sbg';
import type { Uploaded } from '../upload';
import { trailerApi, trailerLine, type TrailerView } from '../trailers';
import { TrailerSheet } from './TrailerSheet';

/**
 * 2026-11-13 — YOUR TRAILERS (trailer plan D1): a courier's own in the Driver app, a fleet's in the Fleet app — each with what it
 * carries — added with its plate, weights and, where it has a plate of its own, its registration card; taken off when gone.
 */
export function TrailersCard({ sbg, upload, canAdd = true }: { sbg: SbgClient | null; upload: (file: File) => Promise<Uploaded>; canAdd?: boolean }) {
  const t = useT();
  const api = useMemo(() => (sbg ? trailerApi(sbg) : null), [sbg]);
  const [list, setList] = useState<TrailerView[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<SbgError | null>(null);
  const load = async () => {
    if (!api) return;
    const r = await api.list();
    if (!r.error) setList((r.data as TrailerView[]) ?? []);
  };
  useEffect(() => {
    void load();
  }, [api]);
  if (!api || list === null) return null;
  const remove = async (id: string) => {
    const r = await api.remove(id);
    setError(r.error ?? null);
    if (!r.error) await load();
  };
  return (
    <Card title={t('trailer.title')}>
      {list.length ? null : <p class="card__note">{t('trailer.none')}</p>}
      {error ? <ErrorNote error={error} showDetail /> : null}
      {list.map((tr) => (
        <div key={tr.trailerId} class="kv">
          <span>{trailerLine(tr, t)}</span>
          {canAdd ? (
            <Button variant="link" full={false} onClick={() => void remove(tr.trailerId)}>
              {t('trailer.remove')}
            </Button>
          ) : null}
        </div>
      ))}
      {canAdd ? (
        <Button variant="outline" onClick={() => setAdding(true)}>
          {t('trailer.add')}
        </Button>
      ) : null}
      <TrailerSheet
        open={adding}
        onClose={() => setAdding(false)}
        mode="keep"
        upload={upload}
        onSave={async (body) => {
          const r = await api.add(body);
          if (r.error) return r.error;
          await load();
          return null;
        }}
      />
    </Card>
  );
}
