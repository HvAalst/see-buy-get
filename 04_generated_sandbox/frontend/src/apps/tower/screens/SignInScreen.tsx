import { useState } from 'preact/hooks';
import { BrandMark } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import type { TowerActions } from '../useTowerApp';

/**
 * The operator console's front door, and it opens for two genuinely different callers.
 *
 * NETWORK STAFF hold one shared operator key. It reaches everything, and it cannot say who is holding
 * it — so that side asks for a name as well and says plainly that the name is not verified. The key
 * proves somebody may be here; the name is what tells the next person who made the call.
 *
 * A COMPANY'S ADMINISTRATOR has an account of their own, created by somebody who already administers
 * that company. Their token carries the company AND their name, so nothing has to be typed and nothing
 * has to be believed: what they change is recorded against a person the network authenticated.
 *
 * Two panels rather than one clever form, because the two credentials are not variants of each other and
 * a single "email or name" field would teach people to try the wrong one.
 */
export function SignInScreen({ actions, error, busy }: { actions: TowerActions; error: string | null; busy: boolean }) {
  const t = useT();
  const [mode, setMode] = useState<'company' | 'staff' | 'operator'>('company');

  return (
    <div class="twr-signin">
      <div class="twr-signin__card">
        <div class="twr-signin__brand">
          <BrandMark size={34} />
          <span class="cons__brandname">{t('tower.appTitle')}</span>
        </div>

        {/* A choice about WHO YOU ARE, not a tab strip: the two forms below ask for different things
            because the two of you are different kinds of caller. */}
        <div class="twr-modes" role="group" aria-label={t('tower.signIn.whoAreYou')}>
          <button type="button" class={`twr-mode${mode === 'company' ? ' twr-mode--on' : ''}`} aria-pressed={mode === 'company'} onClick={() => setMode('company')}>
            {t('tower.signIn.asCompany')}
          </button>
          <button type="button" class={`twr-mode${mode === 'staff' ? ' twr-mode--on' : ''}`} aria-pressed={mode === 'staff'} onClick={() => setMode('staff')}>
            {t('tower.signIn.asStaff')}
          </button>
          <button type="button" class={`twr-mode${mode === 'operator' ? ' twr-mode--on' : ''}`} aria-pressed={mode === 'operator'} onClick={() => setMode('operator')}>
            {t('tower.signIn.asOperator')}
          </button>
        </div>

        {mode === 'company' ? (
          <CompanyForm actions={actions} error={error} busy={busy} />
        ) : mode === 'staff' ? (
          <AccountForm actions={actions} error={error} busy={busy} staff />
        ) : (
          <OperatorForm actions={actions} error={error} busy={busy} />
        )}
      </div>
    </div>
  );
}

/** A company's own administrator: an ordinary account, and the console works out the rest from the token. */
function CompanyForm({ actions, error, busy }: { actions: TowerActions; error: string | null; busy: boolean }) {
  return <AccountForm actions={actions} error={error} busy={busy} />;
}

/**
 * Email + password — a company's administrator, or (`staff`) a member of network staff. The same two fields, but
 * two different doors: which one you came through decides what the console shows you.
 */
function AccountForm({ actions, error, busy, staff }: { actions: TowerActions; error: string | null; busy: boolean; staff?: boolean }) {
  const t = useT();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [local, setLocal] = useState<string | null>(null);

  const submit = (e: Event) => {
    e.preventDefault();
    if (!email.trim() || !password) return setLocal(t('tower.signIn.needBoth'));
    setLocal(null);
    void (staff ? actions.signInAsStaff(email, password) : actions.signInAsCompany(email, password));
  };

  return (
    <form onSubmit={submit}>
      <h1 class="cons__title">{t(staff ? 'tower.signIn.staffTitle' : 'tower.signIn.companyTitle')}</h1>
      <p class="cons__lede">{t(staff ? 'tower.signIn.staffLede' : 'tower.signIn.companyLede')}</p>

      <label class="cfield" style="margin-top:18px">
        <span class="cfield__label">{t('tower.signIn.email')}</span>
        <input class="cinput" type="email" value={email} autocomplete="username" onInput={(e) => setEmail((e.target as HTMLInputElement).value)} />
      </label>

      <label class="cfield">
        <span class="cfield__label">{t('tower.signIn.password')}</span>
        <input class="cinput" type="password" value={password} autocomplete="current-password" onInput={(e) => setPassword((e.target as HTMLInputElement).value)} />
        <span class="chint">{t(staff ? 'tower.signIn.staffHint' : 'tower.signIn.companyHint')}</span>
      </label>

      {local || error ? <p class="cerr">{local ?? error}</p> : null}

      <button type="submit" class="cbtn cbtn--primary" disabled={busy} style="margin-top:8px">
        {t('tower.signIn.cta')}
      </button>
    </form>
  );
}

/** Network staff, with the one shared key — and the honesty that costs. */
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
