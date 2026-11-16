import { useEffect, useState } from 'preact/hooks';
import { useT } from '../i18n';
import { Button, Card, Note } from '../ui';
import { passkeySupported, type PasskeyApi, type PasskeyHere } from './passkey';

/*
 * 2026-11-16 — THE FINGERPRINT, OFFERED AT THE RIGHT MOMENT (the plan "Sign-in codes beyond Twilio SMS", D5: "Offer a passkey
 * right after a code sign-in"). Until now it was turned on only from Settings. Right after a sign-in that took a code — the
 * first time on a phone, or a PIN replaced — and a PIN just chosen, one card asks once: sign in with your fingerprint or face
 * next time? One tap starts the phone's own prompt: the PIN just typed is used for the step that would otherwise ask for it
 * again, held in this page's memory for three minutes and never kept. "Not now" puts it away; Settings keeps the way to it.
 * It saves the codes a forgotten or locked PIN would cost on this phone; a new phone still takes a code.
 */
const HOLD_MS = 3 * 60_000;
let held: { pin: string; until: number } | null = null;

/** A sign-in that took a code just ended with this PIN: the offer may show once, in the next few minutes. */
export function offerPasskeyAfterCode(pin: string, now: number = Date.now()): void {
  held = pin ? { pin, until: now + HOLD_MS } : null;
}

/** The PIN for the offer, if one is held and still fresh — taken, so the offer shows once. */
export function takeOfferPin(now: number = Date.now()): string | null {
  const pin = held && now <= held.until ? held.pin : null;
  held = null;
  return pin;
}

/** Offered only where this browser holds the person's device key, nothing is on yet, and it is no phone colleagues share. */
export function offerable(here: PasskeyHere | null | undefined): boolean {
  return Boolean(here && here.which >= 0 && !here.on && !here.counter);
}

type Step = 'quiet' | 'offer' | 'busy' | 'cancelled' | 'on';

export function PasskeyOffer({ api, look = 'app' }: { api: PasskeyApi; look?: 'app' | 'console' }) {
  const t = useT();
  const [pin] = useState(() => takeOfferPin());
  const [step, setStep] = useState<Step>('quiet');
  const [prepared, setPrepared] = useState<Parameters<PasskeyApi['create']>[0] | null>(null);

  // Only where the phone can check a fingerprint or face, this browser holds the person's device key, and nothing is on yet.
  // The step that takes the PIN is done here, ahead of the tap, so the tap itself opens the phone's prompt.
  useEffect(() => {
    if (!pin) return;
    let live = true;
    void (async () => {
      if (!(await passkeySupported())) return;
      const r = await api.read();
      if (!live || r.error || !offerable(r.data)) return;
      const ready = await api.prepare(pin);
      if (!live || ready.error || !ready.data) return;
      api.warm();
      setPrepared(ready.data);
      setStep('offer');
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const turnOn = async () => {
    if (!prepared) return;
    setStep('busy');
    const out = await api.create(prepared);
    if (out.cancelled) return setStep('cancelled');
    setStep(out.here?.on ? 'on' : 'quiet');
  };

  if (step === 'quiet') return null;
  const done = step === 'on';
  if (look === 'console') {
    return (
      <div class="cnote" role="status" style="margin-bottom:12px">
        <p>
          <b>{t(done ? 'account.passkeyOffer.done' : 'account.passkeyOffer.title')}</b>
        </p>
        {done ? null : (
          <>
            <p class="chint">{t('account.passkeyOffer.body')}</p>
            {step === 'cancelled' ? <p class="chint">{t('account.passkeyOffer.cancelled')}</p> : null}
            <button type="button" class="cbtn cbtn--primary" disabled={step === 'busy'} onClick={() => void turnOn()}>
              {t('account.passkeyOffer.turnOn')}
            </button>{' '}
            <button type="button" class="cbtn cbtn--ghost" onClick={() => setStep('quiet')}>
              {t('account.passkeyOffer.notNow')}
            </button>
          </>
        )}
      </div>
    );
  }
  if (done) return <Note tone="ok" icon="check" title={t('account.passkeyOffer.done')} />;
  return (
    <Card tone="soft">
      <Note tone="info" icon="key" title={t('account.passkeyOffer.title')} detail={t('account.passkeyOffer.body')} />
      {step === 'cancelled' ? <p class="hint">{t('account.passkeyOffer.cancelled')}</p> : null}
      <Button chevron={false} busy={step === 'busy'} onClick={() => void turnOn()}>
        {t('account.passkeyOffer.turnOn')}
      </Button>
      <Button variant="link" onClick={() => setStep('quiet')}>
        {t('account.passkeyOffer.notNow')}
      </Button>
    </Card>
  );
}
