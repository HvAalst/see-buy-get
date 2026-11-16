import { useState } from 'preact/hooks';
import { Button } from './ui';
import { useT } from './i18n';

/** Looks like an email address: something, @, something with a dot. The server checks it again. */
const EMAILISH = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * 2026-11-16 — THE CODE EMAIL CAME BACK (the owner: "a bounce deserves a notice"). Beside a load's delivery code, for
 * whoever posted it: where the email went, that they can give the code on themselves, and a box to send it to another
 * address. The Send, Business and Shop apps alike; `look` is the console's or the phone's.
 */
export function CodeMailBounced({ to, busy = false, look = 'app', onSend }: { to: string; busy?: boolean; look?: 'app' | 'console'; onSend: (email: string) => void }) {
  const t = useT();
  const [email, setEmail] = useState('');
  const typed = email.trim();
  const ok = EMAILISH.test(typed) && typed.toLowerCase() !== to.toLowerCase();
  const note = look === 'console' ? 'chint' : 'hint';
  const send = () => {
    if (ok && !busy) onSend(typed);
  };
  return (
    <div class={look === 'console' ? 'cnote' : 'card card--soft'} style="margin-top:8px">
      <p class={note}>
        <b>{t('nowWith.bounced.title')}</b>
      </p>
      <p class={note}>{t('nowWith.bounced.detail', { to })}</p>
      {look === 'console' ? (
        <>
          <label class="cfield">
            <span class="cfield__label">{t('nowWith.bounced.label')}</span>
            <input class="cinput" type="email" inputMode="email" maxLength={120} autoComplete="off" value={email} disabled={busy} onInput={(e) => setEmail((e.target as HTMLInputElement).value)} />
          </label>
          <div class="twr-panelend">
            <button type="button" class="cbtn cbtn--primary" disabled={!ok || busy} onClick={send}>
              {t('nowWith.bounced.send')}
            </button>
          </div>
        </>
      ) : (
        <>
          <div class="field">
            <label class="field__label">
              {t('nowWith.bounced.label')}
              <input class="input" type="email" inputMode="email" maxLength={120} autoComplete="off" value={email} disabled={busy} onInput={(e) => setEmail(e.currentTarget.value)} />
            </label>
          </div>
          <Button chevron={false} disabled={!ok} busy={busy} onClick={send}>
            {t('nowWith.bounced.send')}
          </Button>
        </>
      )}
    </div>
  );
}
