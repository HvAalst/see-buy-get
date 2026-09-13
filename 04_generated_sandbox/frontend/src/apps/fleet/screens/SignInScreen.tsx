import { HelpLink } from '../../../shared/guide/HelpLink';
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
  /** The fleet named by step one, or null while the company is still being asked for. */
  company: { code: string; did: string; name: string } | null;
}

/**
 * Two steps: which fleet, then which person.
 *
 * It used to be one shared company code, and that code was the whole authentication. For a company
 * running twenty managers across as many depots that meant no record of who did what, no way to cut off
 * one leaver without re-issuing to everybody, and permanent access for anyone who ever saw the code.
 *
 * The code names the fleet now — shown back before a PIN is asked for, so nobody signs into the wrong
 * company and a mistyped code is not blamed on the PIN two fields later. The person's phone and PIN are
 * the credential, checked by the identity spine that already counts wrong attempts and locks out.
 *
 * And because the code only NAMES the fleet, forgetting it must not lock anybody out: "Forgot the code?" asks
 * for the phone and PIN first and lists the fleets that person manages.
 */
export function SignInScreen({ actions, error, busy, company }: SignInScreenProps) {
  const t = useT();
  const [mode, setMode] = useState<'code' | 'phone'>('code');
  const [code, setCode] = useState('');
  const [phone, setPhone] = useState('');
  const [pin, setPin] = useState('');
  const [fleets, setFleets] = useState<Array<{ did: string; companyName: string; status: string }> | null>(null);

  const submit = (e: JSX.TargetedEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (mode === 'phone') {
      void actions.findMyFleets(phone, pin).then((found) => setFleets(found));
      return;
    }
    if (!company) void actions.findCompany(code);
    else void actions.signIn(phone, pin);
  };

  const phoneFields = (
    <>
      <div class="field">
        <label class="field__label" for="mgr-phone">
          {t('fleet.signin.phoneLabel')}
        </label>
        <input
          id="mgr-phone"
          class="input input--mono"
          type="tel"
          value={phone}
          onInput={(e) => setPhone(e.currentTarget.value)}
          placeholder="+2547…"
          autocomplete="username"
          enterkeyhint="next"
        />
      </div>
      <div class="field">
        <label class="field__label" for="mgr-pin">
          {t('fleet.signin.pinLabel')}
        </label>
        <input
          id="mgr-pin"
          class="input input--mono"
          type="password"
          inputMode="numeric"
          value={pin}
          onInput={(e) => setPin(e.currentTarget.value)}
          autocomplete="current-password"
          enterkeyhint="go"
        />
      </div>
    </>
  );

  if (mode === 'phone') {
    return (
      <form class="scr" onSubmit={submit}>
        <h1 class="scr__title">{t('fleet.signin.forgotTitle')}</h1>
        <p class="scr__lede">{t('fleet.signin.forgotLede')}</p>
        {error ? <ErrorNote error={error} /> : null}

        {fleets === null ? (
          <Card>
            {phoneFields}
            <p class="card__note">{t('fleet.signin.pinNote')}</p>
          </Card>
        ) : fleets.length === 0 ? (
          <Card>
            <p class="card__note">{t('fleet.signin.noFleets')}</p>
          </Card>
        ) : (
          <Card title={t('fleet.signin.chooseFleet')}>
            <div class="rows">
              {fleets.map((f) => (
                <button key={f.did} type="button" class="row" disabled={busy} onClick={() => void actions.signInToFleet(f.did, phone, pin)}>
                  <span class="row__body">
                    <span class="row__t">{f.companyName}</span>
                    <span class="row__s">{f.status}</span>
                  </span>
                </button>
              ))}
            </div>
          </Card>
        )}

        {fleets === null ? (
          <div class="scr__cta">
            <Button type="submit" disabled={!phone.trim() || !pin.trim()} busy={busy}>
              {t('fleet.signin.findFleets')}
            </Button>
          </div>
        ) : null}
        <Button
          variant="link"
          onClick={() => {
            setMode('code');
            setFleets(null);
          }}
        >
          {t('fleet.signin.backToCode')}
        </Button>
      </form>
    );
  }

  return (
    <form class="scr" onSubmit={submit}>
      <h1 class="scr__title">{t('fleet.signin.title')}</h1>
      <p class="scr__lede">{t('fleet.signin.lede')}</p>

      {error ? <ErrorNote error={error} /> : null}

      {!company ? (
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
              placeholder="FM-A1B2C3"
              autocapitalize="characters"
              autocomplete="off"
              spellcheck={false}
              enterkeyhint="next"
            />
          </div>
          <p class="card__note">{t('fleet.signin.codeNote')}</p>
        </Card>
      ) : (
        <Card>
          {/* The company is named back, and is changeable without reloading — somebody who typed the
              wrong code should not have to kill the app to fix it. */}
          <p class="card__note">{t('fleet.signin.atCompany', { company: company.name })}</p>
          {phoneFields}
          <p class="card__note">{t('fleet.signin.pinNote')}</p>
        </Card>
      )}

      <div class="scr__cta">
        <Button type="submit" disabled={company ? !phone.trim() || !pin.trim() : !code.trim()} busy={busy}>
          {company ? t('fleet.signin.submit') : t('fleet.signin.next')}
        </Button>
      </div>
      {company ? (
        <Button variant="link" onClick={() => actions.clearCompany()}>
          {t('fleet.signin.otherCompany')}
        </Button>
      ) : (
        <Button
          variant="link"
          onClick={() => {
            setMode('phone');
            setFleets(null);
          }}
        >
          {t('fleet.signin.forgot')}
        </Button>
      )}

      <Card title={t('fleet.signin.canDoTitle')} tone="soft">
        <Checklist items={[t('fleet.signin.can1'), t('fleet.signin.can2'), t('fleet.signin.can3')]} />
      </Card>

      <div class="scr__foot">
        <HelpLink app="fleet" label="signin" />
        <ReadAloud text={() => t('fleet.signin.aloud')} label={t('fleet.readAloud')} />
      </div>
    </form>
  );
}
