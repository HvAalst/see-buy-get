import { useEffect, useMemo, useState } from 'preact/hooks';
import { createMdpApi, type SbgClient } from '../../../lib/sbg';
import { useT } from '../../../shared/i18n';
import { Button, Card, Note, Pill, refusalSentence, Sheet } from '../../../shared/ui';
import type { HubCounterView } from '../types';

/**
 * 2026-11-09 — WHAT A HUB DOES (the owner: "The hub decides that. Only Sort vs Sort and Hand Out"; "Shop app at the hub";
 * "Its own counter fee"). Sort only, or sort and hand out: a counter at the hub — a shop worked in the Shop app, signed in to
 * with the hub owner's email and password — offered to senders and buyers beside the shops while its shelf has room. The
 * first time its owner says the counter's shelf and fee; its hours are the hub's. Its floor people read it.
 */
export function HubCounterCard({ sbg, mdpId, staff, currency }: { sbg: SbgClient | null; mdpId?: string; staff: boolean; currency?: string }) {
  const t = useT();
  const api = useMemo(() => (sbg ? createMdpApi(sbg) : null), [sbg]);
  const [view, setView] = useState<HubCounterView | null>(null);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!api || !mdpId) return;
    let live = true;
    void api.counter(mdpId).then((r) => {
      if (live && r.data) setView(r.data as unknown as HubCounterView);
    });
    return () => {
      live = false;
    };
  }, [api, mdpId]);

  if (!view || !api || !mdpId) return null;
  const c = view.counter;
  const handsOut = view.mode === 'sort_and_hand_out';

  const choose = async (body: { mode: 'sort' | 'sort_and_hand_out'; rows?: number; cols?: number; pricePerParcel?: number }) => {
    setBusy(true);
    const r = await api.setCounter(mdpId, body);
    setBusy(false);
    if (r.error) return setProblem(refusalSentence(r.error));
    setProblem(null);
    setAsking(false);
    setView(r.data as unknown as HubCounterView);
  };

  return (
    <>
      <Card title={t('mdp.counter.title')} aside={<Pill tone={handsOut ? 'ok' : 'idle'}>{t(handsOut ? 'mdp.counter.handsOut' : 'mdp.counter.sortsOnly')}</Pill>}>
        <p class="card__note">{t('mdp.counter.lede')}</p>
        {problem ? <Note tone="danger" icon="warning" title={problem} /> : null}
        {handsOut && c ? (
          <>
            <p class="t-body">{t('mdp.counter.open', { fee: `${c.pricePerParcel} ${c.currency}`, slots: c.rows * c.cols })}</p>
            {c.signIn ? <p class="card__note">{t('mdp.counter.signIn', { email: c.signIn })}</p> : null}
            {c.status === 'APPROVED_UNFUNDED' ? <Note tone="info" icon="clock" title={t('mdp.counter.float')} /> : null}
          </>
        ) : null}
        {!handsOut && c ? <p class="card__note">{t('mdp.counter.closed')}</p> : null}
        {!view.hoursSet && !c ? <p class="hint">{t('mdp.counter.hoursFirst')}</p> : null}
        {staff ? (
          <p class="hint">{t('mdp.counter.ownerDecides')}</p>
        ) : (
          <div class="btnrow">
            {handsOut ? (
              <Button variant="outline" full={false} busy={busy} onClick={() => void choose({ mode: 'sort' })}>
                {t('mdp.counter.toSortOnly')}
              </Button>
            ) : (
              <Button variant="outline" full={false} busy={busy} disabled={!view.hoursSet && !c} onClick={() => (c ? void choose({ mode: 'sort_and_hand_out' }) : setAsking(true))}>
                {t('mdp.counter.toHandOut')}
              </Button>
            )}
          </div>
        )}
      </Card>
      {asking ? <CounterSheet currency={currency} busy={busy} problem={problem} onClose={() => setAsking(false)} onOpen={(rows, cols, pricePerParcel) => void choose({ mode: 'sort_and_hand_out', rows, cols, pricePerParcel })} /> : null}
    </>
  );
}

/** The counter's shelf and its fee, said once — its hours are the hub's. */
function CounterSheet({ currency, busy, problem, onClose, onOpen }: { currency?: string; busy: boolean; problem: string | null; onClose: () => void; onOpen: (rows: number, cols: number, fee: number) => void }) {
  const t = useT();
  const [rows, setRows] = useState('3');
  const [cols, setCols] = useState('4');
  const [fee, setFee] = useState('');
  const n = (v: string) => Number(v.trim());
  const ready = Number.isInteger(n(rows)) && n(rows) >= 1 && n(rows) <= 50 && Number.isInteger(n(cols)) && n(cols) >= 1 && n(cols) <= 50 && fee.trim() !== '' && n(fee) >= 0;
  return (
    <Sheet open title={t('mdp.counter.sheetTitle')} onClose={onClose}>
      <p class="card__note">{t('mdp.counter.sheetLede')}</p>
      {problem ? <Note tone="danger" icon="warning" title={problem} /> : null}
      <div class="field">
        <label class="field__label" for="counter-rows">
          {t('mdp.counter.rows')}
        </label>
        <input id="counter-rows" class="input" inputMode="numeric" value={rows} onInput={(e) => setRows(e.currentTarget.value)} />
      </div>
      <div class="field">
        <label class="field__label" for="counter-cols">
          {t('mdp.counter.cols')}
        </label>
        <input id="counter-cols" class="input" inputMode="numeric" value={cols} onInput={(e) => setCols(e.currentTarget.value)} />
      </div>
      <div class="field">
        <label class="field__label" for="counter-fee">
          {t('mdp.counter.fee', { currency: currency ?? '' })}
        </label>
        <input id="counter-fee" class="input" inputMode="decimal" value={fee} onInput={(e) => setFee(e.currentTarget.value)} />
      </div>
      <p class="hint">{t('mdp.counter.feeHint')}</p>
      <div class="btnrow">
        <Button busy={busy} disabled={!ready} onClick={() => onOpen(n(rows), n(cols), n(fee))}>
          {t('mdp.counter.openIt')}
        </Button>
      </div>
    </Sheet>
  );
}
