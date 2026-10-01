import { useState } from 'preact/hooks';
import { Button, CodeBoxes, RefusalNote } from '../ui';
import { useT } from '../i18n';
import type { Result, SbgError } from '../../lib/sbg';
import { looksLikeEmail } from './recovery';

export interface EmailStepProps {
  /** Unique within the screen — two of these can be on one sheet. */
  id: string;
  email: string;
  code: string;
  onEmail: (v: string) => void;
  onCode: (v: string) => void;
  /** Send the code. Which route that is — confirm an address, recover an account, undo a change — is the caller's. */
  send: (email: string) => Promise<Result<{ sent: boolean; code?: string }>>;
  disabled?: boolean;
  label?: string;
}

/**
 * AN EMAIL ADDRESS, AND THE CODE THAT PROVES SOMEBODY READS IT.
 *
 * One control wherever an address is asked for — choosing a first PIN, replacing the recovery email, getting back
 * into an account, undoing a number change — because in every one of them the address means nothing until the
 * code sent to it comes back. In a sandbox the server echoes the code and it is shown, exactly as the phone code is.
 */
export function EmailStep({ id, email, code, onEmail, onCode, send, disabled, label }: EmailStepProps) {
  const t = useT();
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [testCode, setTestCode] = useState('');
  const [error, setError] = useState<SbgError | null>(null);

  const ask = async () => {
    setBusy(true);
    const r = await send(email.trim());
    setBusy(false);
    setError(r.error ?? null);
    if (r.error) return;
    setSent(true);
    setTestCode(r.data?.code ?? '');
    onCode('');
  };

  // Spaced by itself, so it sits the same in a sheet (which spaces its children) and in a card (which does not).
  return (
    <div style="display:flex;flex-direction:column;gap:16px">
      <div class="field">
        <label class="field__label" for={`${id}-email`}>
          {label ?? t('account.safety.emailLabel')}
        </label>
        <input
          id={`${id}-email`}
          class="input"
          type="email"
          inputMode="email"
          autocomplete="email"
          autocapitalize="off"
          spellcheck={false}
          value={email}
          disabled={disabled || busy}
          onInput={(e) => {
            onEmail(e.currentTarget.value);
            setSent(false);
            setError(null);
          }}
          placeholder="name@example.com"
        />
      </div>
      {error ? <RefusalNote error={error} /> : null}
      <Button variant="outline" chevron={false} disabled={disabled || !looksLikeEmail(email)} busy={busy} onClick={() => void ask()}>
        {t(sent ? 'account.safety.sendAgain' : 'account.safety.sendCode')}
      </Button>
      {sent ? (
        <div class="field">
          <span class="field__label">{t('account.safety.emailCodeLabel')}</span>
          <CodeBoxes id={`${id}-code`} label={t('account.safety.emailCodeLabel')} length={6} value={code} onInput={onCode} disabled={disabled} />
          <p class="hint">{testCode ? t('account.safety.testCode', { code: testCode }) : t('account.safety.codeSent')}</p>
        </div>
      ) : null}
    </div>
  );
}
