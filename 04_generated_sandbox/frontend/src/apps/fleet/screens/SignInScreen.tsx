import { useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { Button, Card, Checklist, ErrorNote, ReadAloud } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import type { SbgError } from '../../../lib/sbg';
import type { FleetActions } from '../useFleetApp';

export interface SignInScreenProps {
  actions: FleetActions;
  error: SbgError | null;
  busy: boolean;
}

/** Manager sign-in by code (FM-XXXX) — the S2 fleet login; the app then works as that fleet only. */
export function SignInScreen({ actions, error, busy }: SignInScreenProps) {
  const t = useT();
  const [code, setCode] = useState('');

  const submit = (e: JSX.TargetedEvent<HTMLFormElement>) => {
    e.preventDefault();
    void actions.signIn(code);
  };

  return (
    <form class="scr" onSubmit={submit}>
      <h1 class="scr__title">{t('fleet.signin.title')}</h1>
      <p class="scr__lede">{t('fleet.signin.lede')}</p>

      {error ? <ErrorNote error={error} /> : null}

      <Card>
        <div class="field">
          <label class="field__label" for="code">
            {t('fleet.signin.codeLabel')}
          </label>
          <input
            id="code"
            class="input input--mono"
            value={code}
            onInput={(e) => setCode(e.currentTarget.value)}
            placeholder="FM-0000"
            autocapitalize="characters"
            autocomplete="off"
            spellcheck={false}
            enterkeyhint="go"
          />
        </div>
        <p class="card__note">{t('fleet.signin.codeNote')}</p>
      </Card>

      <div class="scr__cta">
        <Button type="submit" disabled={!code.trim()} busy={busy}>
          {t('fleet.signin.submit')}
        </Button>
      </div>

      <Card title={t('fleet.signin.canDoTitle')} tone="soft">
        <Checklist items={[t('fleet.signin.can1'), t('fleet.signin.can2'), t('fleet.signin.can3')]} />
      </Card>

      <div class="scr__foot">
        <ReadAloud text={() => t('fleet.signin.aloud')} label={t('fleet.readAloud')} />
      </div>
    </form>
  );
}
