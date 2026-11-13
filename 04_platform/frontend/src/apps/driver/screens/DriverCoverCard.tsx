import { useState } from 'preact/hooks';
import { Button, Card, ErrorNote, Note, PhotoField, Sheet } from '../../../shared/ui';
import { formatDate, useT, type Translate } from '../../../shared/i18n';
import { paperDay } from '../../../shared/papers';
import type { SbgClient, SbgError } from '../../../lib/sbg';
import type { DriverActions, DriverState } from '../useDriverApp';

/**
 * YOUR OWN INSURANCE COVER (the user, 2026-10-28: "owner drivers should be able to show cover as well. Someone willing to
 * invest in it should be rewarded for it"). A driver riding for themselves sends their policy; once SeeBuyGet has read it,
 * loads whose sender asks for cover are open to them, and their notes name it. A fleet's driver is covered by the fleet's.
 *
 * 2026-11-13 — also a row in the account menu (the owner: "I seem not to be able to find the input field for insurance
 * cover … after I have gone through sign up but ignored the papers"): the card sits low on the start screen and is gone once
 * a shift starts; the menu is there on every screen, on shift or off.
 */
type Driver = NonNullable<DriverState['driver']>;

/** Whether this driver keeps their own cover at all: riding for themselves, not between fleets. */
export function keepsOwnCover(driver: DriverState['driver']): driver is Driver {
  return Boolean(driver && !driver.managerDid && !driver.removedFrom);
}

/** Their cover read and still running today, else nothing. */
function provenCover(driver: Driver, today: string) {
  const cover = driver.cover;
  return cover?.copyRef && cover.expiresAt && cover.expiresAt >= today ? cover : undefined;
}

/** The menu row's second line: covered until a day, being read, not accepted, or not sent. */
export function coverRowSub(driver: Driver, t: Translate, today: string = new Date().toISOString().slice(0, 10)): string {
  const cover = driver.cover;
  if (cover?.sent) return t('driver.cover.rowSent');
  if (cover?.refused) return t('driver.cover.rowRefused');
  const proven = provenCover(driver, today);
  return proven ? t('driver.cover.rowOn', { until: paperDay(proven.expiresAt!) }) : t('driver.cover.rowOff');
}

/** Where it stands: sent and waiting, or refused with the reader's own sentence. */
function CoverStatus({ driver }: { driver: Driver }) {
  const t = useT();
  const cover = driver.cover;
  if (cover?.sent) return <Note tone="info" icon="clock" title={t('driver.cover.sentTitle', { date: formatDate(cover.sent.sentAt) })} detail={t('driver.cover.sentBody', { expires: paperDay(cover.sent.expiresAt) })} />;
  // The reason is the sentence of whoever read the policy, written for this driver — shown as it was written.
  if (cover?.refused) return <Note tone="warn" icon="warning" title={t('driver.cover.refusedTitle')} detail={cover.refused.reason} />;
  return null;
}

/** What it opens, in one sentence: the cover in force, or what sending one would open. */
function coverLine(driver: Driver, t: Translate, today: string): string {
  const proven = provenCover(driver, today);
  return proven
    ? t('driver.cover.on', { until: paperDay(proven.expiresAt!), limit: proven.limit != null && proven.currency ? `${proven.limit.toLocaleString('en')} ${proven.currency}` : t('driver.cover.limitAsPolicy') })
    : t('driver.cover.off');
}

/**
 * The policy sent: a photo of it, the day it runs until, its number. Opened from the start screen's card or the account
 * menu; from the menu it also says where the cover stands, since there is no card above it there.
 */
export function CoverSheet({ state, actions, sbg, onClose, withStatus = false }: { state: DriverState; actions: DriverActions; sbg: SbgClient | null; onClose: () => void; withStatus?: boolean }) {
  const t = useT();
  const [photo, setPhoto] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [policy, setPolicy] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SbgError | null>(null);
  const driver = state.driver;
  if (!keepsOwnCover(driver)) return null;
  const today = new Date().toISOString().slice(0, 10);
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
    onClose();
    await actions.refresh();
  };

  return (
    <Sheet open onClose={onClose} title={withStatus ? t('driver.cover.title') : t('driver.cover.send')}>
      {withStatus ? (
        <>
          <CoverStatus driver={driver} />
          <p class="t-body">{coverLine(driver, t, today)}</p>
        </>
      ) : null}
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
      <Button variant="link" onClick={onClose}>
        {t('driver.notYet')}
      </Button>
    </Sheet>
  );
}

export function DriverCoverCard({ state, actions, sbg }: { state: DriverState; actions: DriverActions; sbg: SbgClient | null }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const driver = state.driver;
  if (!keepsOwnCover(driver)) return null;
  const today = new Date().toISOString().slice(0, 10);
  const cover = driver.cover;
  const proven = provenCover(driver, today);

  return (
    <Card title={t('driver.cover.title')}>
      <CoverStatus driver={driver} />
      <p class="t-body">{coverLine(driver, t, today)}</p>
      <Button variant={proven || cover?.sent ? 'link' : 'outline'} full={!(proven || cover?.sent)} onClick={() => setOpen(true)}>
        {t(cover?.sent ? 'driver.cover.sendAgain' : proven ? 'driver.cover.sendRenewed' : 'driver.cover.send')}
      </Button>
      {open ? <CoverSheet state={state} actions={actions} sbg={sbg} onClose={() => setOpen(false)} /> : null}
    </Card>
  );
}
