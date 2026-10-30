import { Abbreviated } from '../../../shared/ui/Abbr';
import { useEffect, useState } from 'preact/hooks';
import { BrandMark } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import { staffWelcome, staffWelcomeCheck } from '../api';
import { passwordBlocker } from '../staff';

/**
 * A NEW MEMBER OF STAFF CHOOSES THEIR OWN PASSWORD.
 *
 * They arrive by the link they were emailed — and by nothing else: no colleague was ever shown a password for them,
 * so there is none to be handed over, read over a shoulder or kept. The link works once, for two days.
 *
 * The screen first asks the server whose link it is, and shows the name and the address: somebody who was forwarded
 * the email sees that it is not theirs before they type anything. A link that was used, has lapsed or was replaced
 * says so and offers the way to the sign-in — a colleague sends a new one.
 */
export function WelcomeScreen({ token, onDone, onLeave }: { token: string; onDone: (email: string) => void; onLeave: () => void }) {
  const t = useT();
  const [who, setWho] = useState<{ email: string; name: string } | null>(null);
  // The link itself opens nothing any more: the server's own words.
  const [dead, setDead] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let gone = false;
    void staffWelcomeCheck(token).then((r) => {
      if (gone) return;
      if (r.error || !r.data) setDead(r.error?.detail || r.error?.title || t('tower.welcome.deadTitle'));
      else setWho(r.data);
    });
    return () => {
      gone = true;
    };
  }, [token]);

  const submit = async (e: Event) => {
    e.preventDefault();
    const blocker = passwordBlocker(password, again);
    if (blocker) return setError(t(blocker));
    setBusy(true);
    setError(null);
    const r = await staffWelcome(token, password);
    setBusy(false);
    if (r.error) {
      // The link is spent or has lapsed: nothing typed here can help. Anything else is about the password, and the link still works.
      if (r.error.code === 'WINDOW_EXPIRED') return setDead(r.error.detail || r.error.title);
      return setError(r.error.detail || r.error.title);
    }
    onDone(r.data?.email ?? who?.email ?? '');
  };

  return (
    <div class="twr-signin">
      <div class="twr-signin__card">
        <div class="twr-signin__brand">
          <BrandMark size={34} />
          <span class="cons__brandname">{t('tower.appTitle')}</span>
        </div>

        {dead ? (
          <>
            <h1 class="cons__title">{t('tower.welcome.deadTitle')}</h1>
            <p class="cons__lede">{dead}</p>
            <button type="button" class="cbtn cbtn--primary" style="margin-top:14px" onClick={onLeave}>
              {t('tower.welcome.toSignIn')}
            </button>
          </>
        ) : !who ? (
          <p class="cons__lede" aria-busy="true">
            {t('tower.welcome.checking')}
          </p>
        ) : (
          <form onSubmit={submit}>
            <h1 class="cons__title">{t('tower.welcome.title')}</h1>
            <p class="cons__lede">{t('tower.welcome.lede', { name: who.name })}</p>
            <p class="twr-signin__who">
              <span class="ctbl__mono">{who.email}</span>
            </p>
            {/* Named for a password manager: this is the sign-in it will be asked to fill next. */}
            <input type="email" name="username" autocomplete="username" value={who.email} readOnly hidden />
            <label class="cfield">
              <span class="cfield__label">{t('tower.welcome.password')}</span>
              <input class="cinput" type="password" name="new-password" value={password} autocomplete="new-password" onInput={(e) => setPassword((e.target as HTMLInputElement).value)} />
              <span class="chint">{t('tower.welcome.hint')}</span>
            </label>
            <label class="cfield">
              <span class="cfield__label">{t('tower.welcome.again')}</span>
              <input class="cinput" type="password" name="new-password-again" value={again} autocomplete="new-password" onInput={(e) => setAgain((e.target as HTMLInputElement).value)} />
            </label>

            {error ? <p class="cerr"><Abbreviated text={error} /></p> : null}

            <button type="submit" class="cbtn cbtn--primary" disabled={busy} style="margin-top:8px">
              {t('tower.welcome.cta')}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
