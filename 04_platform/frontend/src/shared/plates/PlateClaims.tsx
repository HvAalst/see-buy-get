import { useEffect, useState } from 'preact/hooks';
import type { SbgClient, SbgError } from '../../lib/sbg';
import { formatDate, useT, type MessageKey } from '../i18n';
import { Button, Card, ErrorNote, Note } from '../ui';
import { ANSWER_DAYS, plateClaimApi, plateTakenOf, type PlateClaimState, type PlateClaimView, type PlateClaimsView } from '../plates';

const DAY: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };

/**
 * 2026-11-21 — UNDER A PLATE REFUSED AS "ON ANOTHER VEHICLE ALREADY": the way on for whoever bought it. One tap asks its owner
 * whether they sold it; what happens next is said beside it. Nothing shows for any other refusal.
 */
export function PlateTakenAsk({ error, sbg }: { error: SbgError | null | undefined; sbg: SbgClient | null | undefined }) {
  const t = useT();
  const plate = plateTakenOf(error);
  const [asked, setAsked] = useState<string | null>(null);
  const [failed, setFailed] = useState<SbgError | null>(null);
  const [busy, setBusy] = useState(false);
  if (!plate || !sbg) return null;
  if (asked === plate) return <Note tone="info" icon="clock" title={t('plate.claim.askedTitle', { plate })} detail={t('plate.claim.askedDetail', { days: ANSWER_DAYS })} />;
  return (
    <div class="stack">
      {failed ? <ErrorNote error={failed} /> : null}
      <Button
        variant="outline"
        chevron={false}
        busy={busy}
        onClick={async () => {
          setBusy(true);
          const r = await plateClaimApi(sbg).ask(plate);
          setBusy(false);
          if (r.error) return setFailed(r.error);
          setFailed(null);
          setAsked(plate);
        }}
      >
        {t('plate.claim.ask', { plate })}
      </Button>
      <p class="hint">{t('plate.claim.askHint')}</p>
    </div>
  );
}

const ASKED_STATE: Record<PlateClaimState, MessageKey> = {
  asked: 'plate.claim.state.asked',
  lapsed: 'plate.claim.state.lapsed',
  sold: 'plate.claim.state.free',
  released: 'plate.claim.state.free',
  freed: 'plate.claim.state.free',
  kept: 'plate.claim.state.kept',
  left: 'plate.claim.state.left',
};

/**
 * 2026-11-21 — WHAT IS ASKED OF THIS DRIVER OR FLEET ABOUT ITS VEHICLES, AND WHAT IT ASKED. To the owner: "Did you sell …?", with
 * who says they bought it, and one tap each way — sold takes it off their vehicles now. To the asker: where each ask stands.
 * Nothing shows when there is nothing. Where a bell notice about a plate opens.
 */
export function PlateClaimsCard({ sbg, onChanged }: { sbg: SbgClient | null | undefined; onChanged?: () => void }) {
  const [view, setView] = useState<PlateClaimsView | null>(null);
  const [error, setError] = useState<SbgError | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = async () => {
    if (!sbg) return;
    const r = await plateClaimApi(sbg).mine();
    if (!r.error && r.data) setView(r.data);
  };
  useEffect(() => {
    void load();
  }, [sbg]);
  const answer = async (c: PlateClaimView, sold: boolean) => {
    if (!sbg) return;
    setBusy(`${c.claimId}:${sold}`);
    const r = await plateClaimApi(sbg).answer(c.claimId, sold);
    setBusy(null);
    if (r.error) return setError(r.error);
    setError(null);
    await load();
    onChanged?.();
  };
  return <PlateClaimsBody view={view} busy={busy} error={error} onAnswer={(c, sold) => void answer(c, sold)} />;
}

/** The card's inside, from what the server said — pure, for the test. Nothing when there is nothing. */
export function PlateClaimsBody({ view, busy, error, onAnswer }: { view: PlateClaimsView | null; busy: string | null; error: SbgError | null; onAnswer: (c: PlateClaimView, sold: boolean) => void }) {
  const t = useT();
  if (!view || (view.forMe.length === 0 && view.asked.length === 0)) return null;
  const answer = onAnswer;
  return (
    <>
      {view.forMe.map((c) => (
        <Card key={c.claimId} title={t('plate.claim.soldTitle', { plate: c.plate })}>
          <p class="card__note">{t('plate.claim.soldDetail', { name: c.askedBy ?? '', days: ANSWER_DAYS })}</p>
          {error ? <ErrorNote error={error} /> : null}
          <div class="stack">
            <Button chevron={false} busy={busy === `${c.claimId}:true`} disabled={busy !== null} onClick={() => answer(c, true)}>
              {t('plate.claim.yesSold')}
            </Button>
            <Button variant="outline" chevron={false} busy={busy === `${c.claimId}:false`} disabled={busy !== null} onClick={() => answer(c, false)}>
              {t('plate.claim.stillMine')}
            </Button>
          </div>
        </Card>
      ))}
      {view.asked.length ? (
        <Card title={t('plate.claim.askedListTitle')}>
          <ul class="rows">
            {view.asked.map((c) => (
              <li key={c.claimId} class="row row--static">
                <span class="row__body">
                  <span class="row__t">{c.plate}</span>
                  <span class="row__s">
                    {t(ASKED_STATE[c.state], { day: formatDate(new Date(Date.parse(c.askedAt) + ANSWER_DAYS * 86_400_000).toISOString(), DAY) })}
                    {c.reason ? ` ${c.reason}` : ''}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </>
  );
}
