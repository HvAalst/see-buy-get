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
 * Hand parcels to the bus (the user, 2026-10-18: "scan at the bus handover"): scan the driver's pass, see THIS bus's list
 * — what it takes from this shop — and scan each parcel as it goes on, with a green beep on the list and a red one for a
 * parcel that is not for this bus. It is where parcels went missing: a list ticked by tapping is a list nobody checked.
 * A row can still be tapped for a sticker that will not read; it goes through the same check and the same beep.
 *
 * S25 completeness gate: the server refuses a short load and names the parcels on the list not scanned
 * (`state.handover.missed`). They light up as "Waiting": scan them on, or leave them behind with a reason.
 */
export function HandoverScreen({ state, actions }: HandoverScreenProps) {
  const t = useT();
  const f = state.handover;
  const list = f.list;
  const [leaveOpen, setLeaveOpen] = useState(false);
  const busy = state.busy === 'handover';
  const scanned = new Set(f.selected);

  return (
    <div class="scr">
      <h1 class="scr__title">{t('agent.handover.title')}</h1>
      <p class="scr__lede">{t('agent.handover.lede')}</p>

      {/* The gate's INCOMPLETE_MANIFEST lands here as a warn note ("load them, or leave them behind"). */}
      {state.error ? <ErrorNote error={state.error} onRetry={() => actions.go('handover')} /> : null}

      {/* A form, so a handheld scanner that types the pass and presses Enter reads the list too. */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          // What is in the field now: a handheld scanner types and presses Enter faster than the screen redraws.
          void actions.readBusList(e.currentTarget.querySelector<HTMLInputElement>('#badge')?.value);
        }}
      >
        <Card>
          <ScanField
            id="badge"
            label={t('agent.handover.badgeLabel')}
            value={f.badge}
            onValue={(v) => actions.setHandover({ badge: v })}
            expect="badge"
            placeholder={t('agent.handover.badgePh')}
            upper
            enterKeyHint="go"
            onScan={(v) => void actions.readBusList(v)}
          />
          {!list ? (
            <Button type="submit" variant="outline" chevron={false} disabled={!f.badge.trim()} busy={f.listState === 'loading'}>
              {t('agent.handover.showList')}
            </Button>
          ) : null}
        </Card>
      </form>

      {!list ? (
        f.listState === 'loading' ? <p class="hint">{t('agent.handover.gettingParcels')}</p> : <Note tone="info" icon="truck" title={t('agent.handover.passFirst')} />
      ) : list.parcels.length === 0 ? (
        <Note tone="info" icon="box" title={t('agent.handover.nothingForBus')} />
      ) : (
        <Card
          title={t('agent.handover.listTitle', { zone: list.destZone })}
          aside={<Pill tone={f.selected.length === list.parcels.length ? 'ok' : 'idle'}>{t('agent.handover.scannedOf', { scanned: f.selected.length, count: list.parcels.length })}</Pill>}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              actions.scanForBus(e.currentTarget.querySelector<HTMLInputElement>('#handover-parcel')?.value);
            }}
          >
            <ScanField
              id="handover-parcel"
              label={t('agent.handover.scanLabel')}
              value={f.scan}
              onValue={(v) => actions.setBusScan(v)}
              expect="parcel"
              placeholder={t('agent.scanPlaceholder')}
              upper
              enterKeyHint="go"
              onScan={(v) => actions.scanForBus(v)}
            />
            {/* Spoken back for the worker whose eyes are on the parcel, not the screen. */}
            <p class="card__note" aria-live="polite">
              {f.lastScanned ? t('agent.handover.lastScanned', { id: f.lastScanned }) : t('agent.handover.scanHint')}
            </p>
            <Button type="submit" variant="outline" chevron={false} disabled={!f.scan.trim()}>
              {t('agent.handover.addCta')}
            </Button>
          </form>
          <div class="picklist" role="group" aria-label={t('agent.handover.pickAria')} style="margin-top:12px">
            {list.parcels.map((p) => {
              const on = scanned.has(p.parcelId);
              const waiting = f.missed.includes(p.parcelId);
              const where = [p.binSlot ? t('agent.handover.shelf', { slot: p.binSlot }) : '', p.fragile ? t('agent.handover.fragile') : '', p.leftBehindBefore ? t('agent.handover.leftBefore') : ''].filter(Boolean).join(' · ');
              return (
                <button
                  key={p.parcelId}
                  type="button"
                  class={`pick${on ? ' pick--on' : ''}${waiting ? ' pick--missed' : ''}`}
                  aria-pressed={on}
                  onClick={() => (on ? actions.toggleHandover(p.parcelId) : actions.scanForBus(p.parcelId))}
                >
                  <span class="pick__tick" aria-hidden="true">
                    {on ? <Icon name="check" size={20} /> : null}
                  </span>
                  <span class="pick__body">
                    <span class="pick__t">{`${p.parcelId} · ${p.size}`}</span>
                    <span class="pick__s">{where || t('agent.handover.toZone', { zone: p.destZone })}</span>
                  </span>
                  {waiting ? <span class="pick__end"><Pill tone="warn">{t('agent.handover.waiting')}</Pill></span> : null}
                </button>
              );
            })}
          </div>
        </Card>
      )}

      {f.missed.length ? (
        <Note
          tone="warn"
          icon="truck"
          title={f.missed.length === 1 ? t('agent.handover.missedOne', { count: f.missed.length }) : t('agent.handover.missedMany', { count: f.missed.length })}
          detail={t('agent.handover.missedDetail')}
        />
      ) : null}

      {list && list.parcels.length ? (
        <div class="scr__cta">
          <Button onClick={() => void actions.submitHandover()} disabled={!f.badge.trim() || f.selected.length === 0} busy={busy}>
            {f.selected.length ? (f.selected.length === 1 ? t('agent.handover.handOverOne', { count: f.selected.length }) : t('agent.handover.handOverMany', { count: f.selected.length })) : t('agent.handover.handOver')}
          </Button>
          {f.missed.length ? (
            <Button variant="outline" chevron={false} disabled={busy} onClick={() => setLeaveOpen(true)}>
              {t('agent.handover.leaveBehind', { count: f.missed.length })}
            </Button>
          ) : null}
        </div>
      ) : null}

      <div class="scr__foot">
        <ReadAloud text={() => handoverSummary(list?.parcels.length ?? 0, f.selected.length, f.missed.length, t)} label={t('agent.readAloud')} />
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
