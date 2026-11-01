import { afterEach, describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { EmailStep } from './EmailStep';
import { rememberSent } from './sentCode';

/*
 * THE BOX FOR THE CODE, STILL THERE AFTER A RELOAD (the owner, 2026-11-01: "when I have to switch apps, from chrome on
 * mobile to mail, to fetch the security code to confirm my email, the sbg page is refreshed and I can't write the code").
 */
describe('the email step after the browser loaded the page again', () => {
  const real = globalThis.sessionStorage;
  afterEach(() => {
    Object.defineProperty(globalThis, 'sessionStorage', { value: real, configurable: true, writable: true });
  });
  const tab = () => {
    const m = new Map<string, string>();
    const store = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
    Object.defineProperty(globalThis, 'sessionStorage', { value: store, configurable: true, writable: true });
    return store;
  };
  const render = (email: string) =>
    renderToString(<EmailStep id="e" email={email} code="" onEmail={() => undefined} onCode={() => undefined} send={async () => ({ data: { sent: true }, error: null }) as never} />);

  it('opens the box for the code at once when one went to this address a moment ago', () => {
    tab();
    rememberSent('me@example.com', Date.now() - 3 * 60_000);
    const html = render('me@example.com');
    expect(html).toContain('id="e-code"');
    expect(html).toContain('asking again sends the same one');
  });

  it('asks to send a code where none went to this address', () => {
    tab();
    rememberSent('other@example.com', Date.now() - 60_000);
    expect(render('me@example.com')).not.toContain('id="e-code"');
  });
});
