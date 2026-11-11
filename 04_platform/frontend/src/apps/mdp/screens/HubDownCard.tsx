import { useMemo, useState } from 'preact/hooks';
import { createMdpApi, type SbgClient } from '../../../lib/sbg';
import { formatDate, useT } from '../../../shared/i18n';
import { HUB_DOWN_REASONS, HUB_DOWN_WORDS, isDownNow, type HubDownReason } from '../../../shared/hubDown';
import { Button, Card, Note, refusalSentence, Sheet } from '../../../shared/ui';
import type { MdpView } from '../types';

/**
 * 2026-11-11 — A HUB DOWN (ISO 28000 gap 12; the owner: "build it now"). The hub says it cannot open — no power, a flood,
 * nobody to work it — and until when if it knows. Nothing new is sent to it, bags on their way are sent to other hubs for
 * their zones and their drivers told, and it says it is open again when it is. Staff can say it too, when it cannot be reached.
 */
export function HubDownCard({ sbg, hub, staff, onChanged }: { sbg: SbgClient | null; hub: MdpView | null; staff: boolean; onChanged: () => void }) {
  const t = useT();
  const api = useMemo(() => (sbg ? createMdpApi(sbg) : null), [sbg]);
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState<HubDownReason | ''>('');
  const [note, setNote] = useState('');
  const [until, setUntil] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [sent, setSent] = useState<number | null>(null);
  if (!api || !hub) return null;
  const down = isDownNow(hub.down) ? hub.down : undefined;

  const sayDown = async () => {
    if (!reason) return;
    setBusy(true);
    const r = await api.hubDown(hub.mdpId, { reason, ...(note.trim() ? { note: note.trim() } : {}), ...(until ? { until: new Date(until).toISOString() } : {}) });
    setBusy(false);
    if (r.error) return setProblem(refusalSentence(r.error));
    setProblem(null);
    setAsking(false);
    setSent(((r.data as unknown as { redirected?: string[] })?.redirected ?? []).length);
    onChanged();
  };
  const sayUp = async () => {
    setBusy(true);
    const r = await api.hubUp(hub.mdpId);
    setBusy(false);
    if (r.error) return setProblem(refusalSentence(r.error));
    setProblem(null);
    setSent(null);
    onChanged();
  };

  if (down) {
    return (
      <Card title={t('mdp.down.isDown')}>
        <Note tone="danger" icon="warning" title={t('mdp.down.since', { since: formatDate(down.since, { dateStyle: 'medium', timeStyle: 'short' }), reason: t(HUB_DOWN_WORDS[down.reason as HubDownReason] ?? 'common.hubDown.reason.other') })} detail={down.note} />
        {down.until ? <p class="card__note">{t('mdp.down.untilLine', { until: formatDate(down.until, { dateStyle: 'medium', timeStyle: 'short' }) })}</p> : null}
        <p class="card__note">{t('mdp.down.effect')}</p>
        {down.byRole === 'staff' ? <p class="card__note">{t('mdp.down.byStaff')}</p> : null}
        {sent !== null ? <p class="card__note">{t('mdp.down.redirected', { n: sent })}</p> : null}
        {problem ? <Note tone="danger" icon="warning" title={problem} /> : null}
        {/* The hub's own people see it; its owner (or SeeBuyGet staff) says it, as with what the hub does. */}
        {staff ? (
          <p class="hint">{t('mdp.down.ownerSays')}</p>
        ) : (
          <Button chevron={false} busy={busy} onClick={() => void sayUp()}>
            {t('mdp.down.open')}
          </Button>
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
          <label class="field__label" for="down-note">
            {t('mdp.down.note')}
          </label>
          <input id="down-note" class="input" maxLength={200} value={note} onInput={(e) => setNote(e.currentTarget.value)} />
        </div>
        <div class="field" style="margin-top:12px">
          <label class="field__label" for="down-until">
            {t('mdp.down.until')}
          </label>
          <input id="down-until" class="input" type="datetime-local" value={until} onInput={(e) => setUntil(e.currentTarget.value)} />
          <p class="hint">{t('mdp.down.untilHint')}</p>
        </div>
        {problem ? <Note tone="danger" icon="warning" title={problem} /> : null}
        <Button chevron={false} busy={busy} disabled={!reason} onClick={() => void sayDown()}>
          {t('mdp.down.confirm')}
        </Button>
        <Button variant="link" onClick={() => setAsking(false)}>
          {t('common.cancel')}
        </Button>
      </Sheet>
    </>
  );
}
