import { useState } from 'preact/hooks';
import { Button, Card, CodeBoxes, ErrorNote, NeedsSignalNote, PhoneField } from '../ui';
import { useT, type MessageKey } from '../i18n';
import type { SbgError } from '../../lib/sbg';
import type { DeviceAsk } from './shopDevice';

/** Whose sign-in it is: what the account is called on the screen. */
export type BoundParty = 'shop' | 'hub' | 'store';

export const PARTY_WORD: Record<BoundParty, MessageKey> = { shop: 'account.bound.party.shop', hub: 'account.bound.party.hub', store: 'account.bound.party.store' };

/**
 * Round 40 — A NEW PHONE OR BROWSER FOR A HUB OR A STORE (the user: "Hubs and stores now"), as a shop's already was. The
 * password was right; the account's sign-in works only on its own phones and browsers, so a code went to its number — typed
 * here, this one is the account's. An account that has no number yet (made before they were bound) gives one first.
 */
export function ConfirmDevice({
  ask,
  party,
  busy,
  error,
  onConfirm,
  onGivePhone,
  onBack,
}: {
  ask: DeviceAsk;
  party: BoundParty;
  busy: boolean;
  error: SbgError | null;
  onConfirm: (code: string) => void;
  onGivePhone: (phone: string) => void;
  onBack: () => void;
}) {
  const t = useT();
  const [code, setCode] = useState('');
  const [phone, setPhone] = useState('');
  const who = t(PARTY_WORD[party]);

  if (ask.needsPhone) {
    const ok = /^\+?\d{7,15}$/.test(phone.replace(/[\s()-]/g, ''));
    return (
      <form
        class="scr"
        onSubmit={(e) => {
          e.preventDefault();
          if (ok) onGivePhone(phone.replace(/[\s()-]/g, ''));
        }}
      >
        <h1 class="scr__title">{t('account.bound.needsPhoneTitle', { party: who })}</h1>
        <p class="scr__lede">{t('account.bound.needsPhoneLede', { party: who })}</p>
        <NeedsSignalNote title={t('common.needsSignal.signInTitle')} detail={t('common.needsSignal.signInDetail')} />
        {error ? <ErrorNote error={error} /> : null}
        <Card>
          <div class="field">
            <label class="field__label" for="device-phone">
              {t('account.bound.phone', { party: who })}
            </label>
            <PhoneField id="device-phone" value={phone} onInput={(v) => setPhone(v)} />
          </div>
        </Card>
        <Button type="submit" chevron={false} busy={busy} disabled={busy || !ok}>
          {t('account.bound.sendCode')}
        </Button>
        <Button variant="link" onClick={onBack}>
          {t('common.back')}
        </Button>
      </form>
    );
  }

  return (
    <form
      class="scr"
      onSubmit={(e) => {
        e.preventDefault();
        onConfirm(code);
      }}
    >
      <h1 class="scr__title">{t('account.bound.title')}</h1>
      <p class="scr__lede">{t('account.bound.lede', { party: who, sentTo: ask.sentTo })}</p>
      <NeedsSignalNote title={t('common.needsSignal.signInTitle')} detail={t('common.needsSignal.signInDetail')} />
      {error ? <ErrorNote error={error} /> : null}
      <Card>
        <div class="field">
          <span class="field__label">{t('account.bound.code')}</span>
          <CodeBoxes id="device-code" label={t('account.bound.code')} length={6} value={code} onInput={setCode} disabled={busy} />
          {ask.code ? <p class="hint">{t('account.safety.testCode', { code: ask.code })}</p> : null}
        </div>
      </Card>
      <p class="hint">{t('account.bound.why', { party: who })}</p>
      <Button type="submit" chevron={false} busy={busy} disabled={busy || code.length !== 6}>
        {t('account.bound.confirm')}
      </Button>
      <Button variant="link" onClick={onBack}>
        {t('common.back')}
      </Button>
    </form>
  );
}
