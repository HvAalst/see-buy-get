import { useState } from 'preact/hooks';
import { BrandMark } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import type { TowerActions } from '../useTowerApp';

/**
 * The operator's front door.
 *
 * Two fields, and they do two different jobs, which the screen says rather than implies. The KEY is the
 * credential: it is what the server checks, and it is shared by everyone who operates the network. The
 * NAME is not checked by anything — it is what gets written next to every decision made in here, so the
 * next person to ask "who cleared this hazard, and why" has an answer better than "somebody with the
 * key". Pretending the name were an identity would be worse than asking for it honestly.
 */
export function SignInScreen({ actions, error, busy }: { actions: TowerActions; error: string | null; busy: boolean }) {
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
    <div class="twr-signin">
      <form class="twr-signin__card" onSubmit={submit}>
        <div class="twr-signin__brand">
          <BrandMark size={34} />
          <span class="cons__brandname">{t('tower.appTitle')}</span>
        </div>
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
          <input
            class="cinput"
            type="password"
            value={key}
            autocomplete="current-password"
            onInput={(e) => setKey((e.target as HTMLInputElement).value)}
          />
          <span class="chint">{t('tower.signIn.keyHint')}</span>
          <span class="chint">{t('tower.signIn.keySandbox')}</span>
        </label>

        {local || error ? <p class="cerr">{local ?? error}</p> : null}

        <button type="submit" class="cbtn cbtn--primary" disabled={busy} style="margin-top:8px">
          {t('tower.signIn.cta')}
        </button>
      </form>
    </div>
  );
}
