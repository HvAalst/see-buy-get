import { useState } from 'preact/hooks';
import { Abbreviated } from '../../../shared/ui/Abbr';
import { formatDate, formatMoney, useT, type MessageKey } from '../../../shared/i18n';
import { frontDoorUrl } from '../../../shared/frontDoor';
import type { TowerActions, TowerState } from '../useTowerApp';
import { DocumentStrip } from './DocumentStrip';

/** One held load with a problem reported, as the server's queue says it (GET /v1/sbg/holds). */
export interface HoldRow {
  freightId: string;
  code: string;
  description: string;
  country?: string;
  price?: number;
  currency?: string;
  deliveredAt: string;
  heldUntil: string;
  problem: { kind: string; description: string; at: string; photoRef?: string };
  pickupPhotoRef?: string;
  pickupNote?: string;
  doorPhotoRef?: string;
  doorNotes: string[];
  answer?: { words: string; photoRefs: string[]; at: string };
  pendingOverride?: { outcome: 'release' | 'refund'; reason: string; by: string; at: string };
  reading: { step: string; outcome: 'release' | 'refund'; facts: { handedOver: boolean; notedAtDoor: boolean; notedAtPickup: boolean }; words: string };
  /** 2026-11-15 — reported more than a day ago; and when the protocol's answer applies by itself. */
  overdue?: boolean;
  appliesAt: string;
}

const KIND_WORDS: Record<string, MessageKey> = {
  damaged: 'tower.hold.kindDamaged',
  short: 'tower.hold.kindShort',
  not_received: 'tower.hold.kindNotReceived',
  wrong: 'tower.hold.kindWrong',
};
const OUTCOME_WORDS: Record<'release' | 'refund', MessageKey> = { release: 'tower.hold.release', refund: 'tower.hold.refund' };

/**
 * 2026-11-15 — PAYMENT HELD: A PROBLEM REPORTED (the owner: "very simple for staff to make a decision … a decision tree rather
 * than individual judgement"). A load a person paid first, delivered, its driver's pay held because a problem was reported
 * within 24 hours. The record side by side — at pickup, at the door, the report, the driver's answer — the protocol's three
 * questions answered from it, and one tap to apply what it says. Going against it takes a reason and a second member of staff.
 * Shown only while one waits.
 */
export function HeldPayPanel({ state, actions }: { state: TowerState; actions: TowerActions }) {
  const t = useT();
  // Read with the queues, so the Claims badge and this panel never disagree; a decision reads them again.
  const rows = state.heldPays;
  if (!rows?.length) return null;
  return (
    <section class="cons__panel">
      <div class="cons__panelhead">
        <span class="cons__panelt">{t('tower.hold.title')}</span>
        <span class="chint">{t('tower.hold.count', { n: rows.length })}</span>
      </div>
      <p class="cons__lede">
        {t('tower.hold.lede')}{' '}
        <a href={`${frontDoorUrl()}help/when-something-goes-wrong/`} target="_blank" rel="noopener">
          {t('tower.hold.how')}
        </a>
      </p>
      {rows.map((row) => (
        <HeldRow key={row.freightId} row={row} state={state} actions={actions} onChanged={() => void actions.refresh()} />
      ))}
    </section>
  );
}

export function HeldRow({ row, state, actions, onChanged }: { row: HoldRow; state: TowerState; actions: TowerActions; onChanged: () => void }) {
  const t = useT();
  const client = actions.client();
  const me = state.who?.name;
  const [against, setAgainst] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const when = (iso: string) => formatDate(iso, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const other: 'release' | 'refund' = row.reading.outcome === 'release' ? 'refund' : 'release';
  const post = async (key: string, fn: () => Promise<{ error?: { detail?: string; title?: string } | null }>) => {
    if (!client) return;
    setBusy(key);
    setError(null);
    const r = await fn();
    setBusy(null);
    if (r.error) return setError(r.error.detail || r.error.title || null);
    setAgainst(false);
    setReason('');
    onChanged();
  };
  const yes = (v: boolean) => t(v ? 'tower.hold.yes' : 'tower.hold.no');
  const question = (key: MessageKey, v: boolean, decides: boolean) => (
    <li style={decides ? 'font-weight:600' : undefined}>
      {t(key)} <span class={`ctag ctag--${v ? 'ok' : 'warn'}`}>{yes(v)}</span>
    </li>
  );
  const f = row.reading.facts;
  const step = row.reading.step;
  return (
    <div class="cnote" style="margin-top:12px">
      <div class="cons__panelhead">
        <span class="crow__t">
          <span class="mono-t">{row.code}</span> · {row.description}
        </span>
        <span class="chint">
          {row.price != null && row.currency ? `${formatMoney(row.price, row.currency)} · ` : ''}
          {t('tower.hold.since', { delivered: when(row.deliveredAt), reported: when(row.problem.at) })}
        </span>
      </div>

      {/* The record, side by side: what was seen at pickup, at the door, what was reported, and what the driver says. */}
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-top:8px">
        <div>
          <p class="cfield__label">{t('tower.hold.atPickup')}</p>
          <p class="chint">{row.pickupNote ? `“${row.pickupNote}”` : t('tower.hold.nothingNoted')}</p>
          <DocumentStrip refs={row.pickupPhotoRef ? [row.pickupPhotoRef] : []} state={state} actions={actions} titleKey="tower.hold.photos" emptyKey="tower.hold.noPhoto" />
        </div>
        <div>
          <p class="cfield__label">{t('tower.hold.atDoor')}</p>
          <p class="chint">{row.doorNotes.length ? row.doorNotes.join(', ') : t('tower.hold.nothingNoted')}</p>
          <DocumentStrip refs={row.doorPhotoRef ? [row.doorPhotoRef] : []} state={state} actions={actions} titleKey="tower.hold.photos" emptyKey="tower.hold.noPhoto" />
        </div>
        <div>
          <p class="cfield__label">{t('tower.hold.reported', { kind: t(KIND_WORDS[row.problem.kind] ?? 'tower.hold.kindDamaged') })}</p>
          <p class="chint">“{row.problem.description}”</p>
          <DocumentStrip refs={row.problem.photoRef ? [row.problem.photoRef] : []} state={state} actions={actions} titleKey="tower.hold.photos" emptyKey="tower.hold.noPhoto" />
        </div>
        <div>
          <p class="cfield__label">{t('tower.hold.driverSays')}</p>
          <p class="chint">{row.answer ? `“${row.answer.words}”` : t('tower.hold.noAnswer')}</p>
          {row.answer?.photoRefs.length ? <DocumentStrip refs={row.answer.photoRefs} state={state} actions={actions} titleKey="tower.hold.photos" emptyKey="tower.hold.noPhoto" /> : null}
        </div>
      </div>

      {/* The protocol: three questions, read from the record; the one that decided in bold. */}
      <p class="cfield__label" style="margin-top:10px">{t('tower.hold.protocol')}</p>
      <ol class="chint" style="margin:4px 0 0 18px">
        {question('tower.hold.q1', f.handedOver, step === 'not_handed_over')}
        {f.handedOver ? question('tower.hold.q2', f.notedAtDoor, step === 'not_noted_at_door') : null}
        {f.handedOver && f.notedAtDoor ? question('tower.hold.q3', f.notedAtPickup, step === 'noted_at_pickup' || step === 'arose_in_carriage') : null}
      </ol>
      <p class="crow__sub" style="margin-top:6px">{row.reading.words}</p>
      {/* 2026-11-15 — the reminder, and the deadline: after three days the protocol's answer applies by itself. */}
      <p class="chint">
        {row.overdue ? <span class="ctag ctag--warn">{t('tower.hold.overdue')}</span> : null} {t('tower.hold.appliesAt', { when: when(row.appliesAt) })}
      </p>

      {row.pendingOverride ? (
        <div style="margin-top:10px">
          <p class="chint">{t('tower.hold.asked', { by: row.pendingOverride.by, outcome: t(OUTCOME_WORDS[row.pendingOverride.outcome]), reason: row.pendingOverride.reason })}</p>
          {me && me.trim().toLowerCase() === row.pendingOverride.by.trim().toLowerCase() ? (
            <p class="chint">{t('tower.hold.notYou')}</p>
          ) : (
            <div class="twr-panelend">
              <button type="button" class="cbtn cbtn--primary" disabled={busy !== null || !client} onClick={() => void post('approve', () => client!.api.approveHoldOverride(row.freightId, me) as never)}>
                {t('tower.hold.approve', { outcome: t(OUTCOME_WORDS[row.pendingOverride.outcome]) })}
              </button>
            </div>
          )}
        </div>
      ) : (
        <>
          <div class="twr-panelend">
            <button type="button" class="cbtn cbtn--ghost" disabled={busy !== null} aria-pressed={against} onClick={() => setAgainst(!against)}>
              {t('tower.hold.against')}
            </button>
            <button type="button" class="cbtn cbtn--primary" disabled={busy !== null || !client} onClick={() => void post('apply', () => client!.api.applyHold(row.freightId, me) as never)}>
              {t('tower.hold.apply', { outcome: t(OUTCOME_WORDS[row.reading.outcome]) })}
            </button>
          </div>
          {against ? (
            <div style="margin-top:8px">
              <label class="cfield">
                <span class="cfield__label">{t('tower.hold.againstReason', { outcome: t(OUTCOME_WORDS[other]) })}</span>
                <textarea id={`hold-reason-${row.freightId}`} class="cinput" rows={2} maxLength={500} value={reason} onInput={(e) => setReason((e.target as HTMLTextAreaElement).value)} />
                <span class="chint">{t('tower.hold.againstHint')}</span>
              </label>
              <div class="twr-panelend">
                <button type="button" class="cbtn cbtn--primary" disabled={reason.trim().length < 5 || busy !== null || !client} onClick={() => void post('override', () => client!.api.overrideHold(row.freightId, { outcome: other, reason: reason.trim() }, me) as never)}>
                  {t('tower.hold.askSecond')}
                </button>
              </div>
            </div>
          ) : null}
        </>
      )}
      {error ? <p class="cerr"><Abbreviated text={error} /></p> : null}
    </div>
  );
}
