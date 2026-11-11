import { useMemo, useState } from 'preact/hooks';
import { createMdpApi, type SbgClient } from '../../../lib/sbg';
import { formatDate, useT } from '../../../shared/i18n';
import { confirmedInTime, confirmOpen, HUB_DOWN_REASONS, HUB_DOWN_WORDS, isDownNow, unconfirmedPast, type HubDownReason } from '../../../shared/hubDown';
import { Button, Card, Note, refusalSentence, Sheet } from '../../../shared/ui';
import type { MdpView } from '../types';

const when = (iso: string) => formatDate(iso, { dateStyle: 'medium', timeStyle: 'short' });

/**
 * 2026-11-11 — A HUB DOWN (ISO 28000 gap 12; the owner: "build it now"). The hub says it cannot open — no power, a flood,
 * nobody to work it — and when it opens again (mandatory: a best guess where it does not know; the owner, 2026-11-11). Nothing
 * new is sent to it, bags on their way go to other hubs for their zones and their drivers are told. It is asked every day,
 * and confirms in the last day before that it opens then — not confirmed, it stays closed. It may let drivers collect the
 * bags standing in it. Staff can say all of it too, when it cannot be reached.
 */
export function HubDownCard({ sbg, hub, staff, onChanged }: { sbg: SbgClient | null; hub: MdpView | null; staff: boolean; onChanged: () => void }) {
  const t = useT();
  const api = useMemo(() => (sbg ? createMdpApi(sbg) : null), [sbg]);
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState<HubDownReason | ''>('');
  const [note, setNote] = useState('');
  const [until, setUntil] = useState('');
  const [newTime, setNewTime] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [sent, setSent] = useState<number | null>(null);
  if (!api || !hub) return null;
  const down = isDownNow(hub.down) ? hub.down : undefined;

  const run = async (call: () => Promise<{ error?: unknown; data?: unknown }>, after?: (data: unknown) => void) => {
    setBusy(true);
    const r = await call();
    setBusy(false);
    if (r.error) return setProblem(refusalSentence(r.error as never));
    setProblem(null);
    after?.(r.data);
    onChanged();
  };
  const sayDown = () =>
    run(
      () => api.hubDown(hub.mdpId, { reason: reason as HubDownReason, ...(note.trim() ? { note: note.trim() } : {}), until: new Date(until).toISOString() }),
      (data) => {
        setAsking(false);
        setSent(((data as { redirected?: string[] } | undefined)?.redirected ?? []).length);
      },
    );

  if (down) {
    const past = unconfirmedPast(down);
    const confirmed = confirmedInTime(down);
    const mayConfirm = !past && !confirmed && confirmOpen(down);
    return (
      <Card title={t('mdp.down.isDown')}>
        <Note tone="danger" icon="warning" title={t('mdp.down.since', { since: when(down.since), reason: t(HUB_DOWN_WORDS[down.reason as HubDownReason] ?? 'common.hubDown.reason.other') })} detail={down.note} />
        {down.until ? <p class="card__note">{t('mdp.down.untilLine', { until: when(down.until) })}</p> : null}
        {confirmed ? <p class="card__note">{t('mdp.down.confirmed')}</p> : null}
        {past ? <Note tone="danger" icon="warning" title={t('mdp.down.notConfirmed')} /> : null}
        {mayConfirm ? <Note tone="warn" icon="clock" title={t('mdp.down.confirmNow', { until: when(down.until!) })} /> : null}
        {!past && !confirmed && !mayConfirm ? <p class="hint">{t('mdp.down.askedDaily')}</p> : null}
        <p class="card__note">{t('mdp.down.effect')}</p>
        {down.byRole === 'staff' ? <p class="card__note">{t('mdp.down.byStaff')}</p> : null}
        {down.collectable ? <p class="card__note">{t('mdp.down.collecting', { since: when(down.collectable.since) })}</p> : null}
        {sent !== null ? <p class="card__note">{t('mdp.down.redirected', { n: sent })}</p> : null}
        {problem ? <Note tone="danger" icon="warning" title={problem} /> : null}
        {/* The hub's own people see it; its owner (or SeeBuyGet staff) says it, as with what the hub does. */}
        {staff ? (
          <p class="hint">{t('mdp.down.ownerSays')}</p>
        ) : (
          <>
            {past ? (
              <Button chevron={false} busy={busy} onClick={() => void run(() => api.hubReopening(hub.mdpId, {}))}>
                {t('mdp.down.openNow')}
              </Button>
            ) : mayConfirm ? (
              <Button chevron={false} busy={busy} onClick={() => void run(() => api.hubReopening(hub.mdpId, {}))}>
                {t('mdp.down.yesOpens')}
              </Button>
            ) : null}
            <div class="field" style="margin-top:12px">
              <label class="field__label" for="down-new-time">
                {t('mdp.down.newTime')}
              </label>
              <input id="down-new-time" class="input" type="datetime-local" value={newTime} onInput={(e) => setNewTime(e.currentTarget.value)} />
            </div>
            <div class="btnrow">
              <Button variant="outline" full={false} busy={busy} disabled={!newTime} onClick={() => void run(() => api.hubReopening(hub.mdpId, { until: new Date(newTime).toISOString() }), () => setNewTime(''))}>
                {t('mdp.down.saveTime')}
              </Button>
              <Button variant="outline" full={false} busy={busy} onClick={() => void run(() => api.hubCollect(hub.mdpId, !down.collectable))}>
                {down.collectable ? t('mdp.down.stopCollect') : t('mdp.down.letCollect')}
              </Button>
            </div>
            {!down.collectable ? <p class="hint">{t('mdp.down.collectHint')}</p> : null}
            {!past ? (
              <Button variant="link" busy={busy} onClick={() => void run(() => api.hubUp(hub.mdpId), () => setSent(null))}>
                {t('mdp.down.open')}
              </Button>
            ) : null}
          </>
        )}
      </Card>
    );
  }

  return (
    <>
      <Card title={t('mdp.down.title')}>
        <p class="card__note">{t('mdp.down.lede')}</p>
        {staff ? (
          <p class="hint">{t('mdp.down.ownerSays')}</p>
        ) : (
          <div class="btnrow">
            <Button variant="outline" full={false} onClick={() => setAsking(true)}>
              {t('mdp.down.cta')}
            </Button>
          </div>
        )}
      </Card>
      <Sheet open={asking} onClose={() => setAsking(false)} title={t('mdp.down.sheetTitle')}>
        <p class="field__label">{t('mdp.down.why')}</p>
        <div class="chips" style="display:flex;flex-wrap:wrap;gap:8px">
          {HUB_DOWN_REASONS.map((r) => (
            <button key={r} type="button" class={`chip chip--tap${reason === r ? ' chip--on' : ''}`} aria-pressed={reason === r} onClick={() => setReason(r)}>
              {t(HUB_DOWN_WORDS[r])}
            </button>
          ))}
        </div>
        <div class="field" style="margin-top:12px">
          <label class="field__label" for="down-until">
            {t('mdp.down.until')}
          </label>
          <input id="down-until" class="input" type="datetime-local" required value={until} onInput={(e) => setUntil(e.currentTarget.value)} />
          <p class="hint">{t('mdp.down.untilHint')}</p>
        </div>
        <div class="field" style="margin-top:12px">
          <label class="field__label" for="down-note">
            {t('mdp.down.note')}
          </label>
          <input id="down-note" class="input" maxLength={200} value={note} onInput={(e) => setNote(e.currentTarget.value)} />
        </div>
        {problem ? <Note tone="danger" icon="warning" title={problem} /> : null}
        <Button chevron={false} busy={busy} disabled={!reason || !until} onClick={() => void sayDown()}>
          {t('mdp.down.confirm')}
        </Button>
        <Button variant="link" onClick={() => setAsking(false)}>
          {t('common.cancel')}
        </Button>
      </Sheet>
    </>
  );
}
