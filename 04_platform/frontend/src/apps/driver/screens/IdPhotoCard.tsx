import { useState } from 'preact/hooks';
import { Button, Card, Note, PhotoField, RefusalNote } from '../../../shared/ui';
import type { SbgError } from '../../../lib/sbg';
import { useT } from '../../../shared/i18n';
import type { DriverActions, DriverState } from '../useDriverApp';

/**
 * Round 39 — A LIGHT COURIER'S ID, TO BE SEEN (the user: "Ride at once, smaller cap"). They ride already; until a member
 * of staff has seen a photo of their ID, how many they may carry at once stays where it started. Sent, it waits — and they
 * are told when it has been seen, or why it was not, in which case this asks for another.
 */
export function IdPhotoCard({ state, actions }: { state: DriverState; actions: DriverActions }) {
  const t = useT();
  const [ref, setRef] = useState('');
  const [refused, setRefused] = useState<SbgError | null>(null);
  const sent = state.driver?.idCheck;
  const sentBack = state.driver?.idCheckRefusal;
  if (sent && !sent.seenAt) {
    return <Note tone="info" icon="clock" title={t('driver.idPhoto.waitingTitle')} detail={t('driver.idPhoto.waiting', { day: new Date(sent.sentAt).toLocaleDateString() })} />;
  }
  return (
    <Card title={t('driver.idPhoto.title')}>
      {sentBack ? <Note tone="warn" icon="info" title={t('driver.idPhoto.refusedTitle')} detail={sentBack.reason} /> : null}
      <p class="t-body">{t('driver.idPhoto.body', { cap: state.custodyCap?.cap ?? 0 })}</p>
      <PhotoField id="id-photo" value={ref} label={t('driver.idPhoto.label')} upload={(file) => actions.uploadPhoto('kyc_id', file)} onCapture={setRef} />
      {refused ? <RefusalNote error={refused} /> : null}
      <Button
        chevron={false}
        busy={state.busy === 'id-photo'}
        disabled={!ref}
        onClick={async () => {
          setRefused(null);
          const r = await actions.sendIdPhoto(ref);
          if (r) setRefused(r);
          else setRef('');
        }}
      >
        {t('driver.idPhoto.send')}
      </Button>
    </Card>
  );
}
