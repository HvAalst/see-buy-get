import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { t } from '../../shared/i18n';
import { EMPTY_JOIN, ROLES, readyLine, roleById, signupBody, stepBlocker, stepName, stepsFor, type JoinForm } from './logic';
import { JoinScreen } from './screens/JoinScreen';

/*
 * THE STEPS BY NAME, AND WHAT TO HAVE READY (the owner, 2026-11-01: "An indicator of the steps and how far you are in the
 * sign up process can be more clear. now it shows a couple of dots but you don't read what is gonna come next … the
 * guiding through is a bit thin especially seeing that the process is not similar"), and what the audit of every sign-up
 * found that day.
 */
/** The step-list item of a kind ('done', 'now', 'next') that names this step, whatever order its attributes are in. */
const item = (html: string, where: string, name: string) => (html.match(new RegExp(`<li[^>]*steps__item--${where}[^>]*>(?:(?!</li>).)*${name}(?:(?!</li>).)*</li>`)) ?? [''])[0];
const role = (id: string) => roleById(id)!;
const render = (id: string, step: string, form: Partial<JoinForm> = {}, more: Record<string, unknown> = {}) =>
  renderToString(
    <JoinScreen
      state={{ role: role(id), step, form: { ...EMPTY_JOIN, country: 'NL', ...form }, busy: null, countries: [], countriesState: 'idle', issuedCode: null, points: [], ...more } as never}
      actions={{ setForm: () => undefined } as never}
    />,
  );

describe('a sign-up says every step by name', () => {
  it('names each step for the role signing up', () => {
    const names = (id: string, papers = false) => stepsFor(role(id).kind, papers).slice(0, -1).map((s) => stepName(role(id), s, t));
    expect(names('mdp')).toEqual(['Your phone number', 'The code we text you', 'About your hub', 'Where it is', 'Your email and password']);
    expect(names('vendor')).toEqual(['Your phone number', 'The code we text you', 'About your store', 'Your email and password']);
    expect(names('driver', true)).toEqual(['Your phone number', 'The code we text you', 'About you', 'Where you start', 'Your PIN', 'Your ID and licence']);
    expect(names('fleet')).toEqual(['Your phone number', 'The code we text you', 'Your PIN', 'About your fleet', 'Where your depot is', 'Your four papers']);
  });

  it('shows the list: done ticked, the step now marked, the rest to come', () => {
    const html = render('mdp', 'about');
    expect(html).toContain('Signing up as a sort hub');
    expect(html).toContain('step 3 of 5');
    // Whatever order its attributes are in: preact/compat (the sheets' portal, 2026-11-02) puts `class` last.
    expect((html.match(/<li [^>]*class="steps__item/g) ?? []).length).toBe(5);
    expect(item(html, 'done', 'Your phone number')).toContain('Your phone number: done');
    expect(item(html, 'now', 'About your hub')).toContain('aria-current="step"');
    expect(item(html, 'next', 'Your email and password')).not.toBe('');
  });

  it('says on the first step what to have ready — and that a shop’s and a hub’s app signs in with an email and a password', () => {
    for (const r of ROLES) expect(readyLine(r, t).length).toBeGreaterThan(20);
    const hub = render('mdp', 'phone');
    expect(hub).toContain('Have ready');
    expect(hub).toContain('Its app signs in with an email and a password you choose at the end; this number confirms each new phone or browser with a code.');
    expect(hub).not.toContain('Your phone number is your key to the network');
    expect(render('driver', 'phone')).toContain('Your phone number is your key to the network');
  });

  it('tells a hub and a shop at the end how they sign in, whatever their papers’ state', () => {
    const done = (id: string) => render(id, 'done', { displayName: 'Central Sort' }, { account: { role: id, did: 'did:x', entityStatus: id === 'mdp' ? 'draft' : 'DRAFT' } });
    expect(done('mdp')).toContain('Sign in to the hub app with your email and password; a new phone or browser asks for a code sent to this number');
    expect(done('pudo')).toContain('Sign in to the shop app with your email and password');
  });
});

describe('what the audit of every sign-up found, 2026-11-01', () => {
  const filled = (over: Partial<JoinForm> = {}): JoinForm => ({ ...EMPTY_JOIN, phone: '+254700111222', displayName: 'Central Sort', country: 'KE', zone: 'Z-A', location: { lat: -1.28, lng: 36.82 }, email: 'hub@example.com', password: 'hunter22', ...over });
  it('keeps the landmark a hub is asked for, as its address — and sends no fee of its own for a hub or a shop', () => {
    const hub = signupBody(role('mdp'), filled({ landmark: 'Behind the bus park' }), 'x') as { profile: { mdp: Record<string, unknown> } };
    expect(hub.profile.mdp.address).toBe('Behind the bus park');
    expect(hub.profile.mdp).not.toHaveProperty('pricePerParcel');
    const shop = signupBody(role('pudo'), filled(), 'x') as { profile: { agent: Record<string, unknown> } };
    expect(shop.profile.agent).not.toHaveProperty('pricePerParcel');
  });

  it('asks a driver for the area they start from, not a pin nothing keeps; a shop and a hub still drop one', () => {
    const noPin = filled({ location: null as never });
    expect(stepBlocker(role('driver'), 'where', noPin, t)).toBeNull();
    expect(stepBlocker(role('mdp'), 'where', noPin, t)).toBe(t('home.block.location'));
  });
});

describe('the steps stay in sight while the form scrolls (the owner, 2026-11-02)', () => {
  it('pins one bar above the step’s own title: the step now, the next by name, and the whole list folded in it', () => {
    const html = render('pudo', 'code');
    const bar = html.indexOf('steps--pinned');
    expect(bar).toBeGreaterThan(-1);
    // The bar comes first, then the step's own title.
    expect(html.indexOf('class="scr__title"')).toBeGreaterThan(bar);
    expect(html).toContain('<span class="steps__now">The code we text you</span>');
    expect(html).toContain('Next: About your shop');
    expect((html.match(/class="steps__seg /g) ?? []).length).toBe(5);
    expect(html).toMatch(/<ol (?=[^>]*class="steps__list")(?=[^>]*id="steps-all")(?=[^>]*\bhidden\b)[^>]*>/);
    expect(html).toContain('aria-expanded="false"');
  });

  it('says the last step is the last', () => {
    expect(render('pudo', 'login')).toContain('Last step');
  });
});
