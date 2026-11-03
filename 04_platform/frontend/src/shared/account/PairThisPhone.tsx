import { useEffect, useRef, useState } from 'preact/hooks';
import { Button, Card, ErrorNote, Note } from '../ui';
import { QrBlock } from '../ui/QrBlock';
import { useT } from '../i18n';
import type { SbgConfig, SbgError } from '../../lib/sbg';
import type { BoundParty } from './ConfirmDevice';
import { pairQr, pairingStatus, shownPairCode, startPairing, type Paired, type PairShown } from './pairing';

/** Whose phone: the words ConfirmDevice says them in (kept here too, so the two files do not import each other's values). */
const WHO = { shop: 'account.bound.party.shop', hub: 'account.bound.party.hub', store: 'account.bound.party.store' } as const;

/** How often the new phone asks whether its code was scanned. */
const EVERY_MS = 3000;

export interface PairThisPhoneProps {
  config: SbgConfig;
  /** The challenge the right password was answered with. */
  challenge: string;
  party: BoundParty;
  /** Shown at once, not behind a button: where no code could be texted, it is the only way in. */
  auto?: boolean;
  /** Linked: signed in — the app enters as it does after a code. */
  onLinked: (signedIn: Paired) => void;
}

/**
 * THE NEW PHONE'S HALF OF "LINK A NEW PHONE" (2026-11-03, pairing.ts): a QR code and the same code in words, for a phone the
 * shop, hub or store already uses to scan or type; asked after every few seconds until it is, or until it runs out — then a
 * new one, on a tap. Where the account has no phone to do it, it says so: the code to its number is the way.
 */
export function PairThisPhone({ config, challenge, party, auto = false, onLinked }: PairThisPhoneProps) {
  const t = useT();
  const who = t(WHO[party]);
  const [shown, setShown] = useState<PairShown | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SbgError | null>(null);
  const [ranOut, setRanOut] = useState(false);
  const linkedRef = useRef(onLinked);
  linkedRef.current = onLinked;

  const show = async () => {
    setBusy(true);
    setError(null);
    setRanOut(false);
    const r = await startPairing(config, challenge);
    setBusy(false);
    if (r.error) return setError(r.error);
    setShown(r.data);
  };

  useEffect(() => {
    if (auto) void show();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, challenge]);

  // Asked after while it shows: linked → signed in; run out → a new one on a tap.
  useEffect(() => {
    if (!shown || ranOut) return;
    let live = true;
    const timer = setInterval(() => {
      void pairingStatus(config, challenge).then((r) => {
        if (!live) return;
        if (r.error) {
          setRanOut(true);
          return;
        }
        if (r.data.linked) {
          live = false;
          clearInterval(timer);
          linkedRef.current(r.data);
        }
      });
    }, EVERY_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [shown, ranOut, config, challenge]);

  if (!shown) {
    return (
      <>
        {error ? <ErrorNote error={error} /> : null}
        {auto ? (
          <p class="t-body">{t('common.loading')}</p>
        ) : (
          <Button variant="outline" chevron={false} busy={busy} onClick={() => void show()}>
            {t('account.pair.show', { party: who })}
          </Button>
        )}
      </>
    );
  }

  if (!shown.phones) return <Note tone="info" icon="info" title={t('account.pair.noPhone', { party: who })} detail={t('account.pair.noPhoneSub', { party: who })} />;

  return (
    <Card title={t('account.pair.title', { party: who })}>
      {ranOut ? (
        <>
          <Note tone="warn" icon="clock" title={t('account.pair.ranOut')} />
          <Button chevron={false} busy={busy} onClick={() => void show()}>
            {t('account.pair.again')}
          </Button>
        </>
      ) : (
        <>
          <QrBlock value={pairQr(shown.pairCode)} size={200} label={t('account.pair.qrLabel', { party: who })} />
          <p class="cred" aria-label={t('account.pair.codeLabel')}>
            {shownPairCode(shown.pairCode)}
          </p>
          <p class="t-body">{t('account.pair.how', { party: who })}</p>
          <p class="hint" role="status">
            {t('account.pair.waiting', { minutes: Math.max(1, Math.round(shown.expiresIn / 60)) })}
          </p>
        </>
      )}
    </Card>
  );
}
