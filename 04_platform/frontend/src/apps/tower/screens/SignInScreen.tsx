import { SignInHelp } from '../../../shared/account/TroubleSheet';
import { consoleArticles } from '../../../shared/guide/staff-articles';

/** The staff articles about getting in: signing in, the setup key, signing in for a company. */
const CONSOLE_SIGN_IN = ['console-staff', 'console-setup-key', 'console-company'];
import { useState } from 'preact/hooks';
import { BrandMark } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import type { TowerActions, TowerState } from '../useTowerApp';
import { CodeField, TwoStepSetupPanel } from './TwoStepSetup';

/**
 * The operator console's front door — on its own address, away from the public site, and it opens for two
 * genuinely different callers.
 *
 * NETWORK STAFF sign in with their own account: a password, then the six digits their authenticator app shows. The
 * first time, where it is required, the console shows the secret to scan and the first code turns it on.
 *
 * A COMPANY'S ADMINISTRATOR has an account of their own, created by somebody who already administers that company.
 * Their token carries the company AND their name, so nothing has to be typed and nothing has to be believed.
 *
 * The shared SETUP KEY is not a way in for people. It exists to make the first staff account on a new installation,
 * and for scripts — so it is a quiet link under the form, not a tab beside the two real doors.
 */
export function SignInScreen({
  actions,
  state,
  error,
  busy,
  welcomed,
}: {
  actions: TowerActions;
  state: Pick<TowerState, 'staffStep' | 'signInNote'>;
  error: string | null;
  busy: boolean;
  /** Somebody new just chose their password by the link they were emailed: their address, to sign in with. */
  welcomed?: string | null;
}) {
  const t = useT();
  const [mode, setMode] = useState<'staff' | 'company' | 'operator'>('staff');

  return (
    <div class="twr-signin">
      <div class="twr-signin__card">
        <div class="twr-signin__brand">
          <BrandMark size={34} />
          <span class="cons__brandname">{t('tower.appTitle')}</span>
        </div>

        {mode === 'operator' ? null : (
          // A choice about WHO YOU ARE, not a tab strip: the forms ask for different things because the callers differ.
          <div class="twr-modes" role="group" aria-label={t('tower.signIn.whoAreYou')}>
            <button type="button" class={`twr-mode${mode === 'staff' ? ' twr-mode--on' : ''}`} aria-pressed={mode === 'staff'} onClick={() => setMode('staff')}>
              {t('tower.signIn.asStaff')}
            </button>
            <button type="button" class={`twr-mode${mode === 'company' ? ' twr-mode--on' : ''}`} aria-pressed={mode === 'company'} onClick={() => { actions.cancelStaffStep(); setMode('company'); }}>
              {t('tower.signIn.asCompany')}
            </button>
          </div>
        )}

        {state.signInNote ? <p class="cnote">{state.signInNote}</p> : null}
        {welcomed && mode === 'staff' && !state.staffStep ? <p class="cnote">{t('tower.welcome.done')}</p> : null}

        {mode === 'staff' ? (
          <StaffForm actions={actions} step={state.staffStep} error={error} busy={busy} startWith={welcomed ?? ''} />
        ) : mode === 'company' ? (
          <CompanyForm actions={actions} error={error} busy={busy} />
        ) : (
          <OperatorForm actions={actions} error={error} busy={busy} />
        )}

        {/* The quiet way to the setup key, with the forms it stands beside — never a third door beside the two real ones. */}
        <p class="twr-signin__alt">
          {mode === 'operator' ? (
            <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => setMode('staff')}>
              {t('tower.signIn.backToAccounts')}
            </button>
          ) : (
            <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => { actions.cancelStaffStep(); setMode('operator'); }}>
              {t('tower.signIn.setupLink')}
            </button>
          )}
        </p>

        {/* The same foot as every sign-in screen — here only "Trouble signing in?": the console has no forgot-password
            door of its own, and no sign-up. */}
        <p class="twr-signin__foot">
          {/* Only what is about getting in — not the whole staff handbook (the review of 2026-10-23). */}
          <SignInHelp app="console" articles={consoleArticles().filter((a) => CONSOLE_SIGN_IN.includes(a.id))} buttonClass="cbtn cbtn--ghost cbtn--sm" />
        </p>
      </div>
    </div>
  );
}

/**
 * Network staff: email and password, then the code — or, the first time, the authenticator set-up. The email and
 * password stay in the form while the code is asked for, so the second submit sends all three together.
 */
function StaffForm({ actions, step, error, busy, startWith }: { actions: TowerActions; step: TowerState['staffStep']; error: string | null; busy: boolean; startWith: string }) {
  const t = useT();
  const [email, setEmail] = useState(startWith);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [local, setLocal] = useState<string | null>(null);

  const submit = (e: Event) => {
    e.preventDefault();
    if (!email.trim() || !password) return setLocal(t('tower.signIn.needBoth'));
    if (step && code.length !== 6) return setLocal(t('tower.twoStep.needCode'));
    setLocal(null);
    void actions.signInAsStaff(email, password, step ? code : undefined);
  };

  const title = step?.kind === 'setup' ? t('tower.twoStep.setupTitle') : step ? t('tower.twoStep.codeTitle') : t('tower.signIn.staffTitle');
  const lede = step?.kind === 'setup' ? t('tower.twoStep.setupLede') : step ? t('tower.twoStep.codeLede') : t('tower.signIn.staffLede');

  return (
    <form onSubmit={submit}>
      <h1 class="cons__title">{title}</h1>
      <p class="cons__lede">{lede}</p>

      {step ? (
        <p class="twr-signin__who">
          <span class="ctbl__mono">{email}</span>
          <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => { setCode(''); actions.cancelStaffStep(); }}>
            {t('tower.twoStep.notYou')}
          </button>
        </p>
      ) : (
        <>
          <label class="cfield" style="margin-top:18px">
            <span class="cfield__label">{t('tower.signIn.email')}</span>
            <input class="cinput" type="email" value={email} autocomplete="username" onInput={(e) => setEmail((e.target as HTMLInputElement).value)} />
          </label>
          <label class="cfield">
            <span class="cfield__label">{t('tower.signIn.password')}</span>
            <input class="cinput" type="password" value={password} autocomplete="current-password" onInput={(e) => setPassword((e.target as HTMLInputElement).value)} />
            <span class="chint">{t('tower.signIn.staffHint')}</span>
          </label>
        </>
      )}

      {step?.kind === 'setup' ? <TwoStepSetupPanel setup={step} code={code} onCode={setCode} disabled={busy} /> : step ? <CodeField code={code} onCode={setCode} disabled={busy} /> : null}

      {local || error ? <p class="cerr">{local ?? error}</p> : null}

      <button type="submit" class="cbtn cbtn--primary" disabled={busy} style="margin-top:8px">
        {step?.kind === 'setup' ? t('tower.twoStep.turnOnCta') : t('tower.signIn.cta')}
      </button>
      {step ? <p class="chint" style="margin-top:12px">{t('tower.twoStep.lost')}</p> : null}
    </form>
  );
}

/** A company's own administrator: email and password, and the console works out the rest from the token. */
function CompanyForm({ actions, error, busy }: { actions: TowerActions; error: string | null; busy: boolean }) {
  const t = useT();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [local, setLocal] = useState<string | null>(null);

  const submit = (e: Event) => {
    e.preventDefault();
    if (!email.trim() || !password) return setLocal(t('tower.signIn.needBoth'));
    setLocal(null);
    void actions.signInAsCompany(email, password);
  };

  return (
    <form onSubmit={submit}>
      <h1 class="cons__title">{t('tower.signIn.companyTitle')}</h1>
      <p class="cons__lede">{t('tower.signIn.companyLede')}</p>

      <label class="cfield" style="margin-top:18px">
        <span class="cfield__label">{t('tower.signIn.email')}</span>
        <input class="cinput" type="email" value={email} autocomplete="username" onInput={(e) => setEmail((e.target as HTMLInputElement).value)} />
      </label>

      <label class="cfield">
        <span class="cfield__label">{t('tower.signIn.password')}</span>
        <input class="cinput" type="password" value={password} autocomplete="current-password" onInput={(e) => setPassword((e.target as HTMLInputElement).value)} />
        <span class="chint">{t('tower.signIn.companyHint')}</span>
      </label>

      {local || error ? <p class="cerr">{local ?? error}</p> : null}

      <button type="submit" class="cbtn cbtn--primary" disabled={busy} style="margin-top:8px">
        {t('tower.signIn.cta')}
      </button>
    </form>
  );
}

/** The one shared setup key — for the first staff account on a new installation, and for scripts. */
function OperatorForm({ actions, error, busy }: { actions: TowerActions; error: string | null; busy: boolean }) {
  const t = useT();
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [local, setLocal] = useState<string | null>(null);

  const submit = (e: Event) => {
    e.preventDefault();
    if (!name.trim()) return setLocal(t('tower.signIn.needName'));
    if (!key) return setLocal(t('tower.signIn.needKey'));
    setLocal(null);
    void actions.signIn(name, key);
  };

  return (
    <form onSubmit={submit}>
      <h1 class="cons__title">{t('tower.signIn.title')}</h1>
      <p class="cons__lede">{t('tower.signIn.lede')}</p>

      <label class="cfield" style="margin-top:18px">
        <span class="cfield__label">{t('tower.signIn.name')}</span>
        <input
          class="cinput"
          value={name}
          placeholder={t('tower.signIn.namePlaceholder')}
          autocomplete="name"
          onInput={(e) => setName((e.target as HTMLInputElement).value)}
        />
        <span class="chint">{t('tower.signIn.nameHint')}</span>
      </label>

      <label class="cfield">
        <span class="cfield__label">{t('tower.signIn.key')}</span>
        <input class="cinput" type="password" value={key} autocomplete="current-password" onInput={(e) => setKey((e.target as HTMLInputElement).value)} />
        <span class="chint">{t('tower.signIn.keyHint')}</span>
        <span class="chint">{t('tower.signIn.keySandbox')}</span>
      </label>

      {local || error ? <p class="cerr">{local ?? error}</p> : null}

      <button type="submit" class="cbtn cbtn--primary" disabled={busy} style="margin-top:8px">
        {t('tower.signIn.cta')}
      </button>
    </form>
  );
}
