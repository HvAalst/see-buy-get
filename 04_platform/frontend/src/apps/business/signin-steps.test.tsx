import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { SignInScreen } from './screens/SignInScreen';

/*
 * The owner, 2026-11-01: "The business sign up is pretty straightforward, give phone number, confirm sim, set device pin,
 * give email, confirm email. An indicator of the steps and how far you are in the sign up process can be more clear."
 */
/** The step-list item of a kind ('done', 'now', 'next') that names this step, whatever order its attributes are in. */
const item = (html: string, where: string, name: string) => (html.match(new RegExp(`<li[^>]*steps__item--${where}[^>]*>(?:(?!</li>).)*${name}(?:(?!</li>).)*</li>`)) ?? [''])[0];
const render = (step: string) =>
  renderToString(
    <SignInScreen
      state={{ phase: 'signedOut', step, phone: '+31653568351', phoneKnown: false, pin: '', code: '', devCode: '', email: '', emailCode: '', agreement: null, emailReset: false, busy: false, error: null, memberships: null, business: null, section: 'home', note: null } as never}
      actions={{ set: () => undefined, setStep: () => undefined } as never}
    />,
  );

describe('setting up a business sign-in, step by step', () => {
  it('names the four steps, the email the first time only, and marks where you are', () => {
    const html = render('code');
    expect(html).toContain('Setting up your sign-in');
    expect(html).toContain('step 2 of 4');
    for (const name of ['Your phone number', 'The code we text you', 'Your PIN', 'Your email address (the first time)']) expect(html).toContain(name);
    expect(item(html, 'now', 'The code we text you')).toContain('aria-current="step"');
    expect(item(html, 'done', 'Your phone number')).toContain('Your phone number: done');
  });

  it('says what to have ready before the first code is sent, and shows no list to somebody signing in', () => {
    expect(render('phone')).toContain('Have ready: this phone, and an email address you can open now');
    const login = render('login');
    expect(login).not.toContain('steps__item');
    expect(login).not.toContain('Have ready');
  });
});
