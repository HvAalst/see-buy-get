import { QrBlock } from '../../../shared/ui/QrBlock';
import { useT } from '../../../shared/i18n';
import type { TwoStepSetup } from '../api';

/** "JBSW Y3DP EHPK 3PXP" — a secret somebody may have to type is shown in fours, like a card number. */
export function groupSecret(secret: string): string {
  return secret.replace(/(.{4})/g, '$1 ').trim();
}

/**
 * SETTING UP AN AUTHENTICATOR — the same three steps at sign-in and in Settings.
 *
 * Any authenticator app works (Google or Microsoft Authenticator, 1Password, Aegis, a password manager): nothing
 * here belongs to a provider and no account anywhere is needed. The QR code is the easy way; the secret in fours
 * is for a phone whose camera will not read a screen.
 */
export function TwoStepSetupPanel({ setup, code, onCode, disabled }: { setup: TwoStepSetup; code: string; onCode: (v: string) => void; disabled?: boolean }) {
  const t = useT();
  return (
    <div class="twr-2fa">
      <ol class="twr-2fa__steps">
        <li>{t('tower.twoStep.step1')}</li>
        <li>{t('tower.twoStep.step2')}</li>
        <li>{t('tower.twoStep.step3')}</li>
      </ol>
      <div class="twr-2fa__scan">
        <QrBlock value={setup.uri} size={172} ecc="M" label={t('tower.twoStep.qrLabel')} />
        <div class="twr-2fa__key">
          <span class="cfield__label">{t('tower.twoStep.keyLabel')}</span>
          <span class="ctbl__mono twr-2fa__secret">{groupSecret(setup.secret)}</span>
          <span class="chint">{t('tower.twoStep.keyHint')}</span>
        </div>
      </div>
      <CodeField code={code} onCode={onCode} disabled={disabled} autoFocus={false} />
    </div>
  );
}

/** Six digits from the app. `one-time-code` lets a password manager fill it. */
export function CodeField({ code, onCode, disabled, autoFocus = true }: { code: string; onCode: (v: string) => void; disabled?: boolean; autoFocus?: boolean }) {
  const t = useT();
  return (
    <label class="cfield">
      <span class="cfield__label">{t('tower.twoStep.codeLabel')}</span>
      <input
        class="cinput twr-2fa__code"
        inputMode="numeric"
        autocomplete="one-time-code"
        maxLength={7}
        value={code}
        disabled={disabled}
        autoFocus={autoFocus}
        placeholder="123 456"
        onInput={(e) => onCode((e.target as HTMLInputElement).value.replace(/[^\d]/g, '').slice(0, 6))}
      />
      <span class="chint">{t('tower.twoStep.codeHint')}</span>
    </label>
  );
}
