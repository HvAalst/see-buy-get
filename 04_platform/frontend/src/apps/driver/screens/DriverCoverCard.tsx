import { useState } from 'preact/hooks';
import { Button, Card, ErrorNote, Note, PhotoField, Sheet } from '../../../shared/ui';
import { formatDate, useT } from '../../../shared/i18n';
import { paperDay } from '../../../shared/papers';
import type { SbgClient, SbgError } from '../../../lib/sbg';
import type { DriverActions, DriverState } from '../useDriverApp';

/**
 * YOUR OWN INSURANCE COVER (the user, 2026-10-28: "owner drivers should be able to show cover as well. Someone willing to
 * invest in it should be rewarded for it"). A driver riding for themselves sends their policy; once SeeBuyGet has read it,
 * loads whose sender asks for cover are open to them, and their notes name it. A fleet's driver is covered by the fleet's.
 */
export function DriverCoverCard({ state, actions, sbg }: { state: DriverState; actions: DriverActions; sbg: SbgClient | null }) {
  const t = useT();
  const driver = state.driver;
  const cover = driver?.cover;
  const [open, setOpen] = useState(false);
  const [photo, setPhoto] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [policy, setPolicy] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SbgError | null>(null);
  if (!driver || driver.managerDid || driver.removedFrom) return null;
  const today = new Date().toISOString().slice(0, 10);
  const proven = cover?.copyRef && cover.expiresAt && cover.expiresAt >= today ? cover : undefined;
  const ready = Boolean(photo) && expiresAt > today;

  const send = async () => {
    if (!sbg || !ready) return;
    setBusy(true);
    setError(null);
    const r = (await sbg.request((c) =>
      c.POST('/v1/sbg/fleet/drivers/{did}/cover' as never, { params: { path: { did: driver.did } }, body: { copyRef: photo, expiresAt, ...(policy.trim() ? { reference: policy.trim() } : {}) } } as never) as never,
    )) as { error?: SbgError };
    setBusy(false);
    if (r.error) return setError(r.error);
    setOpen(false);
    setPhoto('');
    setExpiresAt('');
    setPolicy('');
    await actions.refresh();
  };

  return (
    <Card title={t('driver.cover.title')}>
      {cover?.sent ? (
        <Note tone="info" icon="clock" title={t('driver.cover.sentTitle', { date: formatDate(cover.sent.sentAt) })} detail={t('driver.cover.sentBody', { expires: paperDay(cover.sent.expiresAt) })} />
      ) : cover?.refused ? (
        // The reason is the sentence of whoever read the policy, written for this driver — shown as it was written.
        <Note tone="warn" icon="warning" title={t('driver.cover.refusedTitle')} detail={cover.refused.reason} />
      ) : null}
      <p class="t-body">
        {proven
          ? t('driver.cover.on', { until: paperDay(proven.expiresAt!), limit: proven.limit != null && proven.currency ? `${proven.limit.toLocaleString('en')} ${proven.currency}` : t('driver.cover.limitAsPolicy') })
          : t('driver.cover.off')}
      </p>
      <Button variant={proven || cover?.sent ? 'link' : 'outline'} full={!(proven || cover?.sent)} onClick={() => setOpen(true)}>
        {t(cover?.sent ? 'driver.cover.sendAgain' : proven ? 'driver.cover.sendRenewed' : 'driver.cover.send')}
      </Button>
      {open ? (
        <Sheet open onClose={() => setOpen(false)} title={t('driver.cover.send')}>
          <p class="t-body">{t('driver.cover.sheetBody')}</p>
          <PhotoField id="cover-photo" value={photo} label={t('driver.cover.photo')} upload={(file) => actions.uploadPhoto('kyc_insurance', file)} onCapture={setPhoto} />
          <label class="field">
            <span class="field__label">{t('driver.cover.expires')}</span>
            <input class="input" type="date" min={today} value={expiresAt} onInput={(e) => setExpiresAt((e.target as HTMLInputElement).value)} />
          </label>
          <label class="field">
            <span class="field__label">{t('driver.cover.policy')}</span>
            <input class="input" value={policy} autoComplete="off" onInput={(e) => setPolicy((e.target as HTMLInputElement).value)} />
          </label>
          {error ? <ErrorNote error={error} /> : null}
          <Button chevron={false} disabled={!ready || busy} busy={busy} onClick={() => void send()}>
            {t('driver.cover.submit')}
          </Button>
          <Button variant="link" onClick={() => setOpen(false)}>
            {t('driver.notYet')}
          </Button>
        </Sheet>
      ) : null}
    </Card>
  );
}
