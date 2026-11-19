import { useMemo, useState } from 'preact/hooks';
import { createConsumerApi, type SbgClient, type SbgError } from '../../../lib/sbg';
import { useT } from '../../../shared/i18n';
import { Button, ErrorNote, PhoneField } from '../../../shared/ui';

/**
 * 2026-11-19 — A HELD PARCEL NOT PAID IN TIME: ITS SENDER CHOOSES (D19, D20). Someone else in the destination country takes it —
 * their phone number; they pay customs, our fee, the warehouse days, the extra handling and the last leg there, and the sender
 * passes them the new release code — or it is given up, and customs disposes of it. Someone else is named once.
 */
export function LapsedChoice({ parcelId, choices, client, onDone }: { parcelId: string; choices: Array<'someone_else' | 'give_up'>; client: SbgClient | null; onDone: () => void }) {
  const t = useT();
  const api = useMemo(() => (client ? createConsumerApi(client) : null), [client]);
  const [phone, setPhone] = useState('');
  const [givingUp, setGivingUp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SbgError | null>(null);
  const send = async (body: { choice: 'someone_else'; receiverMobile: string } | { choice: 'give_up' }) => {
    if (!api) return;
    setBusy(true);
    setError(null);
    const r = (await api.abroadChoice(parcelId, body)) as { error?: SbgError | null };
    setBusy(false);
    if (r.error) return setError(r.error);
    onDone();
  };
  return (
    <div class="card" role="group" aria-label={t('send.parcels.abroad.chooseTitle')}>
      <p class="t-body">
        <b>{t('send.parcels.abroad.chooseTitle')}</b>
      </p>
      {error ? <ErrorNote error={error} showDetail /> : null}
      {choices.includes('someone_else') ? (
        <>
          <p class="hint">{t('send.parcels.abroad.someoneElseLede')}</p>
          <div class="field">
            <label class="field__label" for={`abroad-new-${parcelId}`}>
              {t('send.parcels.abroad.newReceiver')}
            </label>
            <PhoneField id={`abroad-new-${parcelId}`} value={phone} onInput={setPhone} autoComplete="off" />
          </div>
          <Button chevron={false} busy={busy} disabled={phone.replace(/\D/g, '').length < 7} onClick={() => void send({ choice: 'someone_else', receiverMobile: phone.trim() })}>
            {t('send.parcels.abroad.someoneElse')}
          </Button>
        </>
      ) : null}
      {givingUp ? (
        <>
          <p class="hint">{t('send.parcels.abroad.giveUpSure')}</p>
          <Button variant="outline" chevron={false} busy={busy} onClick={() => void send({ choice: 'give_up' })}>
            {t('send.parcels.abroad.giveUpYes')}
          </Button>
          <Button variant="link" onClick={() => setGivingUp(false)}>
            {t('send.parcels.abroad.cancel')}
          </Button>
        </>
      ) : (
        <Button variant="link" onClick={() => setGivingUp(true)}>
          {t('send.parcels.abroad.giveUp')}
        </Button>
      )}
    </div>
  );
}
