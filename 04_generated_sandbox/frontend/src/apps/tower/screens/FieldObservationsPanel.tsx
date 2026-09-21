import { useCallback, useEffect, useState } from 'preact/hooks';
import { AuthImage, Sheet } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import { ConsolePick } from '../ConsolePick';
import { countryNameOf, type CatalogueCountry } from '../presence';
import type { TowerActions } from '../useTowerApp';

/** One observation as the console reads it. `byDid` is never drawn: an id on a screen is a bug. */
export interface FieldObservationRow {
  observationId: string;
  country: string;
  place: string;
  subject: string;
  note?: string;
  happenedOn: string;
  byName: string;
  recordedAt: string;
  tier: 'told' | 'evidenced';
  evidenceMediaId?: string;
  consent?: { noticeVersion: string; notice: string; agreedAt: string; agreedBy: string };
}

/**
 * CL5 — WHAT PEOPLE WERE ASKED FOR AT A BORDER, beside the rules for crossing it.
 *
 * On the Borders screen because that is where the question lives. The rules above say what we KNOW a
 * crossing permits; this says what people were actually asked for there, by whom, on which day. The two
 * are never merged: a rule is ours to maintain, an observation is somebody's account, and a screen that
 * blurred them would be asserting a requirement on the strength of one driver's afternoon.
 *
 * THE DATE LEADS every row, because it is the whole claim. Last year's entry reads as last year's without
 * anybody marking it stale — the only honest way to hold knowledge about a moving target.
 *
 * THE CONSENT TRAIL IS SHOWN, not just kept. Where a photograph survived both gates, the row says who
 * agreed, to which version of the notice, and when. That is the record the two-gate design exists to
 * produce, and a record nobody can read is a record nobody can check.
 *
 * AND A PHOTOGRAPH CAN BE TAKEN BACK — staff only, always with a reason, and the words stay. For the two
 * days that will come: a country's answer changing, and somebody photographing a number they meant to
 * cover. The observation was first-hand and still is; only the picture goes.
 */
export function FieldObservationsPanel({ actions, isOperator, catalogue }: { actions: TowerActions; isOperator: boolean; catalogue: CatalogueCountry[] }) {
  const t = useT();
  const client = actions.client();
  const [rows, setRows] = useState<FieldObservationRow[] | null>(null);
  const [country, setCountry] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [removing, setRemoving] = useState<FieldObservationRow | null>(null);
  const [why, setWhy] = useState('');
  const [busy, setBusy] = useState(false);
  const [big, setBig] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!client) return;
    const r = await client.api.fieldObservations();
    if (r.error) {
      setError(r.error.detail || r.error.title || null);
      return;
    }
    setRows(((r.data as unknown as { items?: FieldObservationRow[] })?.items ?? []) as FieldObservationRow[]);
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  /*
   * THE FILTER OFFERS ONLY COUNTRIES THAT ARE IN THE ANSWER. A list of all 243 would let somebody choose a
   * country with nothing in it and read the empty list as news — a filter that can empty its own list is a
   * wall, which this console has learned three times.
   */
  const present = [...new Set((rows ?? []).map((r) => r.country))].sort((a, b) => countryNameOf(a, catalogue).localeCompare(countryNameOf(b, catalogue)));
  const shown = (rows ?? []).filter((r) => !country || r.country === country);
  const evidenced = shown.filter((r) => r.tier === 'evidenced').length;

  const remove = async () => {
    if (!client || !removing || !why.trim()) return;
    setBusy(true);
    setError(null);
    const r = await client.api.removeObservationEvidence(removing.observationId, { reason: why.trim() });
    setBusy(false);
    if (r.error) {
      setError(r.error.detail || r.error.title || null);
      return;
    }
    setDone(t('tower.observations.removed'));
    setRemoving(null);
    setWhy('');
    await load();
  };

  return (
    <section class="cons__panel">
      <div class="cons__panelhead">
        <span class="cons__panelt">{t('tower.observations.title')}</span>
        <span class="ctag ctag--quiet">{rows === null ? t('tower.queues.loading') : t('tower.observations.count', { n: shown.length, evidenced })}</span>
      </div>
      <p class="cons__lede">{t('tower.observations.lede')}</p>
      <p class="chint">{t('tower.observations.basis')}</p>

      {error ? <p class="cerr">{error}</p> : null}
      {done ? <p class="chint">{done}</p> : null}

      {present.length > 1 ? (
        <div class="twr-knob">
          <ConsolePick
            label={t('tower.observations.country')}
            value={country}
            onChange={setCountry}
            options={[{ value: '', label: t('tower.observations.allCountries') }, ...present.map((c) => ({ value: c, label: countryNameOf(c, catalogue), tag: c }))]}
          />
        </div>
      ) : null}

      {rows !== null && shown.length === 0 ? (
        <p class="cons__empty">{t('tower.observations.none')}</p>
      ) : (
        <div class="crows">
          {shown.map((o) => (
            <div key={o.observationId} class="crow">
              <span class="crow__body">
                <span class="crow__top">
                  <span class="crow__name">{o.subject}</span>
                  <span class={`ctag ${o.tier === 'evidenced' ? 'ctag--ok' : 'ctag--quiet'}`}>{t(o.tier === 'evidenced' ? 'tower.observations.evidenced' : 'tower.observations.told')}</span>
                </span>
                {/* The DATE first — see the comment above. */}
                <span class="crow__sub">
                  {o.happenedOn} · {o.place} · {countryNameOf(o.country, catalogue)}
                </span>
                <span class="chint">{t('tower.observations.by', { who: o.byName })}</span>
                {o.note ? <span class="chint">{o.note}</span> : null}

                {o.tier === 'evidenced' && o.evidenceMediaId && client ? (
                  <>
                    {/* Thumbnail until somebody asks for the full frame, the rule every photo here follows. */}
                    <span class="cons__shots">
                    <button type="button" class={`cons__shot${big === o.evidenceMediaId ? ' cons__shot--big' : ''}`} onClick={() => setBig(big === o.evidenceMediaId ? null : o.evidenceMediaId!)} aria-label={t('tower.observations.open')}>
                      <AuthImage
                        key={`${o.evidenceMediaId}-${big === o.evidenceMediaId ? 'full' : 'thumb'}`}
                        mediaId={o.evidenceMediaId}
                        alt={t('tower.observations.photoAlt', { subject: o.subject })}
                        load={(id) => client.api.mediaBlob(id, big === o.evidenceMediaId ? 'full' : 'thumb') as never}
                      />
                    </button>
                    </span>
                    {o.consent ? (
                      <span class="chint">{t('tower.observations.consent', { who: o.consent.agreedBy, version: o.consent.noticeVersion, when: o.consent.agreedAt.slice(0, 10) })}</span>
                    ) : null}
                  </>
                ) : null}
              </span>
              {isOperator && o.tier === 'evidenced' ? (
                <span class="crow__tail">
                  <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => setRemoving(o)}>
                    {t('tower.observations.remove')}
                  </button>
                </span>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {/* A reason, in a sheet — never a browser dialog, and never skippable: it is kept on the observation. */}
      {removing ? (
        <Sheet open onClose={() => setRemoving(null)} title={t('tower.observations.remove')}>
          <p class="cons__lede">{removing.subject}</p>
          <p class="chint">
            {removing.happenedOn} · {removing.place}
          </p>
          <p class="chint">{t('tower.observations.removeKeeps')}</p>
          <label class="cfield">
            <span class="cfield__label">{t('tower.observations.why')}</span>
            <input class="cinput" value={why} onChange={(e) => setWhy((e.target as HTMLInputElement).value)} />
          </label>
          <div class="twr-panelend">
            <button type="button" class="cbtn cbtn--primary" disabled={!why.trim() || busy} onClick={() => void remove()}>
              {t('tower.observations.remove')}
            </button>
          </div>
        </Sheet>
      ) : null}
    </section>
  );
}
