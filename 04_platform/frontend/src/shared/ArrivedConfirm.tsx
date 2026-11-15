import { useState } from 'preact/hooks';
import { Button } from './ui';
import { useT } from './i18n';

/**
 * 2026-11-15 — "IT ARRIVED", CONFIRMED (the owner: "as recommended"). A tap that lets a driver deliver without the code is
 * one a driver on the phone could talk a sender into: so the sender confirms they spoke to the receiver themselves, and is
 * shown who has the load (the company and its vehicle, and the driver where one is named) before it counts. The Send,
 * Business and Shop apps alike; `look` is the console's or the phone's.
 */
export function ArrivedConfirm({ who, busy = false, look = 'app', onConfirm, onCancel }: { who?: string; busy?: boolean; look?: 'app' | 'console'; onConfirm: () => void; onCancel: () => void }) {
  const t = useT();
  const [spoke, setSpoke] = useState(false);
  const note = look === 'console' ? 'chint' : 'hint';
  return (
    <div class={look === 'console' ? 'cnote' : 'card card--soft'} style="margin-top:8px">
      <p class={note}>{t('nowWith.arrived.ask')}</p>
      {who ? <p class={note}>{t('nowWith.arrived.who', { who })}</p> : null}
      <label class="checkline" style="margin-top:6px">
        <input type="checkbox" checked={spoke} disabled={busy} onChange={(e) => setSpoke(e.currentTarget.checked)} />
        <span>{t('nowWith.arrived.tick')}</span>
      </label>
      {look === 'console' ? (
        <div class="twr-panelend">
          <button type="button" class="cbtn cbtn--ghost" onClick={onCancel}>
            {t('nowWith.arrived.cancel')}
          </button>
          <button type="button" class="cbtn cbtn--primary" disabled={!spoke || busy} onClick={onConfirm}>
            {t('nowWith.arrived.confirm')}
          </button>
        </div>
      ) : (
        <>
          <Button chevron={false} disabled={!spoke} busy={busy} onClick={onConfirm}>
            {t('nowWith.arrived.confirm')}
          </Button>
          <Button variant="link" onClick={onCancel}>
            {t('nowWith.arrived.cancel')}
          </Button>
        </>
      )}
    </div>
  );
}
