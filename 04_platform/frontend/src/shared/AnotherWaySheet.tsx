import { useState } from 'preact/hooks';
import { Button, Icon, Sheet } from './ui';
import { useT, type MessageKey } from './i18n';

/** Why parcels go another way than their plans — the reasons a shop gives too (the server's HUMAN_OFF_PLAN_REASONS). */
export type AnotherWayReason = 'no_transport' | 'hub_full' | 'faster' | 'other';

const REASONS: ReadonlyArray<{ value: AnotherWayReason; labelKey: MessageKey }> = [
  { value: 'no_transport', labelKey: 'anotherWay.noTransport' },
  { value: 'hub_full', labelKey: 'anotherWay.hubFull' },
  { value: 'faster', labelKey: 'anotherWay.faster' },
  { value: 'other', labelKey: 'anotherWay.other' },
];

export const ANOTHER_WAY_NOTE_MAX = 100;

/**
 * 2026-11-06 — SENT ANOTHER WAY FROM ITS OWN PLACE (the owner: "I follow point 1 to 6 at your recommendation"): a store's or
 * a business's parcels waiting for a bag, sent through another hub than their plans' — the hub chosen from those near it,
 * then why. The server keeps the step and the reason on each parcel, and from then they are grouped and bagged for that hub.
 */
export function AnotherWaySheet({
  open,
  count,
  ways,
  exclude,
  busy,
  onSend,
  onClose,
}: {
  open: boolean;
  count: number;
  /** The hubs near, nearest first (the dock plan's `ways`). */
  ways: ReadonlyArray<{ id: string; label: string; km: number }>;
  /** Where they go now: not offered as another way. */
  exclude?: string;
  busy?: boolean;
  onSend: (toHubId: string, reason: AnotherWayReason, note?: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [hub, setHub] = useState<{ id: string; label: string } | null>(null);
  const [other, setOther] = useState(false);
  const [note, setNote] = useState('');
  const choices = ways.filter((w) => w.id !== exclude);
  const close = () => {
    setHub(null);
    setOther(false);
    setNote('');
    onClose();
  };
  const send = (reason: AnotherWayReason, why?: string) => {
    if (!hub) return;
    onSend(hub.id, reason, why);
    setHub(null);
    setOther(false);
    setNote('');
  };
  return (
    <Sheet open={open} onClose={close} title={t('anotherWay.title', { count })}>
      <p class="hint">{t('anotherWay.lede')}</p>
      {!hub ? (
        choices.length === 0 ? (
          <p class="hint">{t('anotherWay.none')}</p>
        ) : (
          <>
            <p class="field__label">{t('anotherWay.through')}</p>
            <div class="rows">
              {choices.map((w) => (
                <button key={w.id} type="button" class="row" disabled={busy} onClick={() => setHub({ id: w.id, label: w.label })}>
                  <span class="row__body">
                    <span class="row__t">{w.label}</span>
                    <span class="row__s">{t('anotherWay.km', { km: w.km })}</span>
                  </span>
                  <span class="row__end">
                    <Icon name="chevronRight" size={22} />
                  </span>
                </button>
              ))}
            </div>
          </>
        )
      ) : other ? (
        <>
          <div class="field">
            <label class="field__label" for="another-way-note">
              {t('anotherWay.noteLabel')}
            </label>
            <input id="another-way-note" class="input" maxLength={ANOTHER_WAY_NOTE_MAX} value={note} onInput={(e) => setNote(e.currentTarget.value)} />
          </div>
          <Button chevron={false} busy={busy} disabled={!note.trim()} onClick={() => send('other', note.trim())}>
            {t('anotherWay.send', { hub: hub.label })}
          </Button>
        </>
      ) : (
        <>
          <p class="field__label">{t('anotherWay.why', { hub: hub.label })}</p>
          <div class="rows">
            {REASONS.map((r) => (
              <button key={r.value} type="button" class="row" disabled={busy} onClick={() => (r.value === 'other' ? setOther(true) : send(r.value))}>
                <span class="row__body">
                  <span class="row__t">{t(r.labelKey)}</span>
                </span>
                <span class="row__end">
                  <Icon name="chevronRight" size={22} />
                </span>
              </button>
            ))}
          </div>
        </>
      )}
      <Button variant="link" onClick={close}>
        {t('anotherWay.keep')}
      </Button>
    </Sheet>
  );
}
