import { useState } from 'preact/hooks';
import { Icon } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import { passwordChangeBlocker } from '../../../shared/account/password';
import type { TowerActions } from '../useTowerApp';

/**
 * A company administrator changes the password they sign in with — the password a network operator generated
 * for them, which is exactly the one that should not be kept. Proven with the current password; at least ten
 * characters, because this console sets prices. The console keeps using the new one without asking again.
 */
/**
 * `onClose` is optional: this is a PANEL OVER THE WORK AREA when staff open it from the account menu,
 * and a section of a page when a company reads it in their settings. A page has nothing to close.
 */
export function CompanyPasswordPanel({ actions, onClose }: { actions: TowerActions; onClose?: () => void }) {
  const t = useT();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const blocker = passwordChangeBlocker({ current, next, again }, 10);

  return (
    <section class="cons__panel" style="margin-bottom:18px">
      <div class="cons__panelhead">
        <span class="cons__panelt">{t('account.password.title')}</span>
        {/* A section of Settings has nothing to close; only a panel opened over the work area does. */}
        {onClose ? (
          <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={onClose}>
            {t('tower.presence.close')}
          </button>
        ) : null}
      </div>
      {done ? (
        <p class="twr-done" style="margin:12px 0">
          <Icon name="check" size={16} />
          {t('account.password.done')}
        </p>
      ) : (
        <>
          {error ? (
            <p class="cerr" style="margin:12px 0">
              {error}
            </p>
          ) : null}
          <div class="twr-corridorform">
            <label class="cfield">
              <span class="cfield__label">{t('account.password.current')}</span>
              <input class="cinput" type="password" autocomplete="current-password" value={current} onInput={(e) => setCurrent(e.currentTarget.value)} />
            </label>
            <label class="cfield">
              <span class="cfield__label">{t('account.password.new')}</span>
              <input class="cinput" type="password" autocomplete="new-password" value={next} onInput={(e) => setNext(e.currentTarget.value)} />
            </label>
            <label class="cfield">
              <span class="cfield__label">{t('account.password.again')}</span>
              <input class="cinput" type="password" autocomplete="new-password" value={again} onInput={(e) => setAgain(e.currentTarget.value)} />
            </label>
          </div>
          <div class="twr-corridorsave">
            <button
              type="button"
              class="cbtn cbtn--primary"
              disabled={blocker !== null || busy}
              onClick={async () => {
                setBusy(true);
                setError(null);
                const refused = await actions.changeCompanyPassword(current, next);
                setBusy(false);
                if (refused) setError(refused);
                else setDone(true);
              }}
            >
              {t('account.password.save')}
            </button>
            {blocker && (current || next || again) ? <span class="chint">{t(blocker)}</span> : null}
          </div>
        </>
      )}
    </section>
  );
}
