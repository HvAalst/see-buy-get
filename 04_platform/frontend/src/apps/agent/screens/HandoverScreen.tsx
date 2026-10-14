import { useState } from 'preact/hooks';
import { Button, Card, ErrorNote, Icon, Note, Pill, ReadAloud, ScanField, Sheet } from '../../../shared/ui';
import { useT, type MessageKey } from '../../../shared/i18n';
import { handoverSummary } from '../logic';
import type { AgentActions, AgentState } from '../useAgentApp';

export interface HandoverScreenProps {
  state: AgentState;
  actions: AgentActions;
}

/** Preset reasons a parcel is knowingly left behind — tappable, so no typing is needed to short-ship. The
 *  `value` is the English note sent to the server (stable); `labelKey` is what the shopkeeper reads. */
const SHORT_SHIP_REASONS: Array<{ value: string; labelKey: MessageKey }> = [
  { value: 'No space left on the bus', labelKey: 'agent.handover.reasonNoSpace' },
  { value: 'Parcel not ready', labelKey: 'agent.handover.reasonNotReady' },
  { value: 'Driver would not take it', labelKey: 'agent.handover.reasonDriverRefused' },
];

/**
 * Hand waiting parcels to the bus: scan the driver badge, tap the parcels going on, one
 * CTA. Tapping a row toggles it — big targets, visible tick, no checkbox to miss.
 *
 * S25 completeness gate: the server refuses a short load and tells us exactly which parcels for this
 * bus are still waiting (`state.handover.missed`). Those rows light up as "Waiting" and the agent
 * either taps them on and hands over again, or opens the sheet to leave them behind with a reason —
 * so a bus can never quietly pull away with parcels left on the shelf.
 */
export function HandoverScreen({ state, actions }: HandoverScreenProps) {
  const t = useT();
  const f = state.handover;
  const rows = state.shopParcels;
  const loading = state.shopParcelsState === 'loading';
  const [leaveOpen, setLeaveOpen] = useState(false);
  const busy = state.busy === 'handover';

  return (
    <div class="scr">
      <h1 class="scr__title">{t('agent.handover.title')}</h1>
      <p class="scr__lede">{t('agent.handover.lede')}</p>

      {/* The gate's INCOMPLETE_MANIFEST lands here as a warn note ("load them, or leave them behind"). */}
      {state.error ? <ErrorNote error={state.error} onRetry={() => actions.go('handover')} /> : null}

      <Card>
        <ScanField
          id="badge"
          label={t('agent.handover.badgeLabel')}
          value={f.badge}
          onValue={(v) => actions.setHandover({ badge: v })}
          expect="badge"
          placeholder={t('agent.handover.badgePh')}
          upper
        />
      </Card>

      <Card label={t('agent.handover.waitingAt', { count: rows.length })}>
        {loading ? (
          <p class="hint">{t('agent.handover.gettingParcels')}</p>
        ) : rows.length === 0 ? (
          <p class="hint">{t('agent.handover.noWaiting')}</p>
        ) : (
          <div class="picklist" role="group" aria-label={t('agent.handover.pickAria')}>
            {rows.map((p) => {
              const on = f.selected.includes(p.parcelId);
              const waiting = f.missed.includes(p.parcelId);
              return (
                <button
                  key={p.parcelId}
                  type="button"
                  class={`pick${on ? ' pick--on' : ''}${waiting ? ' pick--missed' : ''}`}
                  aria-pressed={on}
                  onClick={() => actions.toggleHandover(p.parcelId)}
                >
                  <span class="pick__tick" aria-hidden="true">
                    {on ? <Icon name="check" size={20} /> : null}
                  </span>
                  <span class="pick__body">
                    <span class="pick__t">{`${p.parcelId} · ${p.size}`}</span>
                    <span class="pick__s">{t('agent.handover.toZone', { zone: p.destZone })}</span>
                  </span>
                  {waiting ? <span class="pick__end"><Pill tone="warn">{t('agent.handover.waiting')}</Pill></span> : null}
                </button>
              );
            })}
          </div>
        )}
      </Card>

      {f.missed.length ? (
        <Note
          tone="warn"
          icon="truck"
          title={f.missed.length === 1 ? t('agent.handover.missedOne', { count: f.missed.length }) : t('agent.handover.missedMany', { count: f.missed.length })}
          detail={t('agent.handover.missedDetail')}
        />
      ) : rows.length > 0 && f.selected.length === 0 ? (
        <Note tone="info" icon="box" title={t('agent.handover.tapGoing')} />
      ) : null}

      <div class="scr__cta">
        <Button
          onClick={() => void actions.submitHandover()}
          disabled={!f.badge.trim() || f.selected.length === 0}
          busy={busy}
        >
          {f.selected.length ? (f.selected.length === 1 ? t('agent.handover.handOverOne', { count: f.selected.length }) : t('agent.handover.handOverMany', { count: f.selected.length })) : t('agent.handover.handOver')}
        </Button>
        {f.missed.length ? (
          <Button variant="outline" chevron={false} disabled={busy} onClick={() => setLeaveOpen(true)}>
            {t('agent.handover.leaveBehind', { count: f.missed.length })}
          </Button>
        ) : null}
      </div>

      <div class="scr__foot">
        <ReadAloud text={() => handoverSummary(rows.length, f.selected.length, f.missed.length, t)} label={t('agent.readAloud')} />
      </div>

      <Sheet open={leaveOpen} onClose={() => setLeaveOpen(false)} title={t('agent.handover.leaveSheetTitle')}>
        <p class="hint">
          {f.missed.length === 1 ? t('agent.handover.leaveSheetOne', { count: f.missed.length }) : t('agent.handover.leaveSheetMany', { count: f.missed.length })}
        </p>
        <div class="rows">
          {SHORT_SHIP_REASONS.map((reason) => (
            <button
              key={reason.value}
              type="button"
              class="row"
              disabled={busy}
              onClick={() => {
                setLeaveOpen(false);
                void actions.submitHandover(reason.value);
              }}
            >
              <span class="row__ic"><Icon name="truck" size={24} /></span>
              <span class="row__body"><span class="row__t">{t(reason.labelKey)}</span></span>
              <span class="row__end"><Icon name="chevronRight" size={22} /></span>
            </button>
          ))}
        </div>
        <Button variant="link" onClick={() => setLeaveOpen(false)}>{t('agent.cancel')}</Button>
      </Sheet>
    </div>
  );
}
