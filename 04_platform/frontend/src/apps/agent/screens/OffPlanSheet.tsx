import { useState } from 'preact/hooks';
import { Button, Icon, Sheet } from '../../../shared/ui';
import { useT, type MessageKey } from '../../../shared/i18n';

/**
 * 2026-11-06 — MOVEMENT UNIFICATION (the owner: "build the whole thing"): every parcel has one plan, and a hand-over that
 * sends it another way is not done silently. The server said these go elsewhere next by their plan; the shop keeps them for
 * their own way, or sends them this way all the same, saying why — kept on each parcel for operations to see.
 */
export type OffPlanReason = 'no_transport' | 'hub_full' | 'faster' | 'other';

export const OFF_PLAN_REASONS: ReadonlyArray<{ value: OffPlanReason; labelKey: MessageKey }> = [
  { value: 'no_transport', labelKey: 'agent.offPlan.noTransport' },
  { value: 'hub_full', labelKey: 'agent.offPlan.hubFull' },
  { value: 'faster', labelKey: 'agent.offPlan.faster' },
  { value: 'other', labelKey: 'agent.offPlan.other' },
];

export const OFF_PLAN_NOTE_MAX = 100;

export function OffPlanSheet({
  open,
  items,
  goingTo,
  busy,
  onSend,
  onKeep,
}: {
  open: boolean;
  /** Each parcel, and where its plan sends it next. */
  items: ReadonlyArray<{ parcelId: string; planned: string }>;
  /** Where it would go now: the bus's area, or the bag's place. */
  goingTo: string;
  busy?: boolean;
  onSend: (reason: OffPlanReason, note?: string) => void;
  onKeep: () => void;
}) {
  const t = useT();
  const [other, setOther] = useState(false);
  const [note, setNote] = useState('');
  return (
    <Sheet open={open} onClose={onKeep} title={items.length === 1 ? t('agent.offPlan.titleOne') : t('agent.offPlan.titleMany', { count: items.length })}>
      <div class="rows" role="list">
        {items.map((i) => (
          <div key={i.parcelId} class="row" role="listitem">
            <span class="row__ic">
              <Icon name="repeat" size={24} />
            </span>
            <span class="row__body">
              <span class="row__t">{i.parcelId}</span>
              <span class="row__s">{t('agent.offPlan.plannedTo', { place: i.planned })}</span>
            </span>
          </div>
        ))}
      </div>
      <p class="hint">{t('agent.offPlan.ask', { place: goingTo })}</p>
      {other ? (
        <>
          <div class="field">
            <label class="field__label" for="offplan-note">
              {t('agent.offPlan.noteLabel')}
            </label>
            <input id="offplan-note" class="input" maxLength={OFF_PLAN_NOTE_MAX} value={note} onInput={(e) => setNote(e.currentTarget.value)} />
          </div>
          <Button chevron={false} busy={busy} disabled={!note.trim()} onClick={() => onSend('other', note.trim())}>
            {t('agent.offPlan.send', { place: goingTo })}
          </Button>
        </>
      ) : (
        <div class="rows">
          {OFF_PLAN_REASONS.map((r) => (
            <button key={r.value} type="button" class="row" disabled={busy} onClick={() => (r.value === 'other' ? setOther(true) : onSend(r.value))}>
              <span class="row__body">
                <span class="row__t">{t(r.labelKey)}</span>
              </span>
              <span class="row__end">
                <Icon name="chevronRight" size={22} />
              </span>
            </button>
          ))}
        </div>
      )}
      <Button variant="link" onClick={onKeep}>
        {t('agent.offPlan.keep')}
      </Button>
    </Sheet>
  );
}
