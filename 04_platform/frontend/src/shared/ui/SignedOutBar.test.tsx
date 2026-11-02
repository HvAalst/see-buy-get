import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToString } from 'preact-render-to-string';
import type { VNode } from 'preact';
import { t } from '../i18n';
import { keyboardUp, typesText } from './SignedOutBar';
import { EMPTY_JOIN, ROLES, roleById } from '../../apps/home/logic';
import { JoinScreen } from '../../apps/home/screens/JoinScreen';
import { JoinHelp, joiningArticles } from '../../apps/home/screens/JoinHelp';
import { RolesScreen } from '../../apps/home/screens/RolesScreen';
import { SignInScreen as HomeSignIn } from '../../apps/home/screens/SignInScreen';
import { SignInScreen as ShopSignIn } from '../../apps/agent/screens/SignInScreen';
import { StaffSignIn } from '../../apps/agent/screens/StaffSignIn';
import { SignInScreen as HubSignIn } from '../../apps/mdp/screens/SignInScreen';
import { SignInScreen as DriverSignIn } from '../../apps/driver/screens/SignInScreen';
import { SignInScreen as FleetSignIn } from '../../apps/fleet/screens/SignInScreen';
import { SignInScreen as StoreSignIn } from '../../apps/vendor/screens/SignInScreen';
import { SignInScreen as BusinessSignIn } from '../../apps/business/screens/SignInScreen';
import { AuthScreen } from '../../apps/genesis/screens/AuthScreen';
import { siteArticles } from '../guide/articles';

/*
 * THE BAR BEFORE SIGNING IN (the owner, 2026-11-02: "the footers now in the bottom during the sign up process — we have
 * some text like 'help' and 'read aloud' — that clutter would be better off in a sticky footer for as long as the page
 * goes. It changes after the sign in"). What is held to here: every signed-out screen draws it, with Back only where the
 * screen has a step to go back to; nothing signed in does; a credential's own link sits under the field it is about; a
 * sign-in screen still has ONE help (the user, 2026-10-23); and the keyboard puts it away.
 */

/** Every source file under src/ but the tests, as 'apps/home/main.tsx'. */
const SRC = 'src';
function allFiles(dir: string): string[] {
  return readdirSync(dir ? join(SRC, dir) : SRC, { withFileTypes: true }).flatMap((e) => {
    const rel = dir ? `${dir}/${e.name}` : e.name;
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : allFiles(rel);
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [rel] : [];
  });
}
const FILES = new Set(allFiles(''));
const read = (f: string) => readFileSync(join(SRC, f), 'utf8');
/** Every source file that imports this component, by its file. */
function filesUsing(name: string): string[] {
  return [...FILES].filter((f) => !f.endsWith(`/${name}.tsx`) && new RegExp(`from\\s*['"][^'"]*/${name}['"]`).test(read(f)));
}

// A phone that can speak, so Read aloud is drawn (where one cannot, it is not — tested below), and somewhere to keep things.
const g = globalThis as Record<string, unknown>;
const store = new Map<string, string>();
const speaking = { speechSynthesis: { speaking: false, cancel() {}, speak() {} }, SpeechSynthesisUtterance: function () {} };
beforeAll(() => {
  g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
  g.window = { ...speaking, location: { protocol: 'https:', hostname: 'example', search: '' }, matchMedia: () => ({ matches: false }) };
});
afterAll(() => {
  delete g.window;
  delete g.localStorage;
});

const render = (node: VNode) => renderToString(node);
/** The bar's own markup, and the words under its pictures, in order. */
const barOf = (html: string) => (html.match(/<nav [^>]*class="[^"]*\bsobar\b[^"]*"[^>]*>(?:(?!<\/nav>).)*<\/nav>/) ?? [''])[0];
const barClass = (html: string) => (barOf(html).match(/^<nav [^>]*class="([^"]*)"/) ?? ['', ''])[1];
const items = (html: string) => [...barOf(html).matchAll(/class="bnav__label">([^<]*)</g)].map((m) => m[1]);
const pinned = (html: string) => barClass(html) === 'bnav sobar' && html.includes('class="sobar__room"');

const signingUp = (id: string, step: string) =>
  render(
    <JoinScreen
      state={{ role: roleById(id), step, form: { ...EMPTY_JOIN, country: 'KE' }, busy: null, countries: [], countriesState: 'idle', issuedCode: null, points: [], account: { role: id, did: 'did:x', entityStatus: 'DRAFT' } } as never}
      actions={{ setForm: () => undefined, back: () => undefined } as never}
    />,
  );
const ask = { challenge: 'ch_1', sentTo: '•••• 678' };
const shop = (deviceAsk?: object) => render(<ShopSignIn actions={{ readEmail: () => '' } as never} error={null} busy={false} deviceAsk={deviceAsk as never} />);
const hub = (deviceAsk?: object) => render(<HubSignIn actions={{ readEmail: () => '', cancelDeviceAsk: () => undefined } as never} error={null} busy={false} deviceAsk={deviceAsk as never} />);
const store_ = () => render(<StoreSignIn state={{ busy: null, deviceAsk: null } as never} actions={{ readEmail: () => '' } as never} error={null} />);
const driver = () => render(<DriverSignIn onSignIn={async () => true} onSendCode={async () => ''} onSetPin={async () => 'ok'} error={null} />);
const fleet = (company: { code: string; did: string; name: string } | null = null) => render(<FleetSignIn actions={{} as never} error={null} busy={false} company={company} />);
const staff = () => render(<StaffSignIn onBack={() => undefined} onSession={async () => undefined} />);
const send = (authMode: 'login' | 'enroll', authStep = 'phone') =>
  render(
    <AuthScreen
      state={{ authMode, authStep, authPhone: '+254712345678', authPin: '', authCode: '', authEmail: '', authEmailCode: '', authBusy: false, authError: null, phoneKnown: false, invited: false, following: false, authAgreement: null } as never}
      actions={{} as never}
    />,
  );
const business = (step: string) =>
  render(
    <BusinessSignIn
      state={{ phase: 'signedOut', step, phone: '+254712345678', phoneKnown: false, pin: '', code: '', devCode: '', email: '', emailCode: '', agreement: null, emailReset: false, busy: false, error: null, memberships: null, business: null, section: 'home', note: null } as never}
      actions={{ set: () => undefined, setStep: () => undefined } as never}
    />,
  );

const HELP = ['Help', 'Read aloud', 'All apps'];

describe('the bar before signing in', () => {
  it('is pinned under the sign-up: Back to the step before, Help and Read aloud — no All apps on the front door', () => {
    for (const r of ROLES) {
      const html = signingUp(r.id, 'phone');
      expect(pinned(html), r.id).toBe(true);
      expect(items(html), r.id).toEqual(['Back', 'Help', 'Read aloud']);
    }
    // Once the account is made the steps behind it are spent: no Back.
    expect(items(signingUp('pudo', 'done'))).toEqual(['Help', 'Read aloud']);
    // The page before the steps, and the front door's own sign-in, the same.
    expect(items(render(<RolesScreen actions={{} as never} />))).toEqual(['Help', 'Read aloud']);
    expect(items(render(<HomeSignIn actions={{} as never} />))).toEqual(['Help', 'Read aloud']);
  });

  it('is pinned under every app’s sign-in: Help, Read aloud and All apps — Back only where a step has one', () => {
    for (const [name, html] of [
      ['shop', shop()],
      ['hub', hub()],
      ['store', store_()],
      ['driver', driver()],
      ['fleet by phone', fleet()],
      ['fleet by code', fleet({ code: 'FM-1', did: 'did:fleet', name: 'Kilima Haulage' })],
      ['the shop’s people', staff()],
    ] as const) {
      expect(pinned(html), name).toBe(true);
      expect(items(html), name).toEqual(HELP);
    }
    // A new phone for the shop, the hub, the store: still signed out, and Back goes to the password.
    for (const [name, html] of [
      ['shop', shop(ask)],
      ['hub', hub(ask)],
      ['hub with no number yet', hub({ ...ask, needsPhone: true })],
    ] as const) {
      expect(items(html), name).toEqual(['Back', ...HELP]);
    }
  });

  it('sits in the Send app’s page rather than pinned: the bottom there is already its own tab bar', () => {
    const login = send('login');
    expect(barClass(login)).toBe('sobar sobar--inline');
    expect(login).not.toContain('sobar__room');
    expect(items(login)).toEqual(HELP);
    // Back from the code, the email and the PIN to the number — and not from the number itself.
    for (const step of ['code', 'email', 'pin']) expect(items(send('enroll', step)), step).toEqual(['Back', ...HELP]);
    expect(items(send('enroll', 'phone'))).toEqual(HELP);
  });

  it('draws no Read aloud where the phone cannot speak — a dead speaker teaches a non-reader that the app lies', () => {
    const was = g.window;
    g.window = { location: { protocol: 'https:', hostname: 'example', search: '' }, matchMedia: () => ({ matches: false }) };
    try {
      expect(items(shop())).toEqual(['Help', 'All apps']);
    } finally {
      g.window = was;
    }
  });

  it('is never drawn signed in: only the screens before signing in import it', () => {
    const found = filesUsing('SignedOutBar');
    // The guard read something: a sign-in screen it must find is among what it found.
    expect(found).toContain('apps/agent/screens/SignInScreen.tsx');
    expect(found.sort()).toEqual(
      [
        'apps/agent/screens/SignInScreen.tsx',
        'apps/agent/screens/StaffSignIn.tsx',
        'apps/driver/screens/SignInScreen.tsx',
        'apps/fleet/screens/SignInScreen.tsx',
        'apps/genesis/screens/AuthScreen.tsx',
        'apps/home/screens/JoinScreen.tsx',
        'apps/home/screens/RolesScreen.tsx',
        'apps/home/screens/SignInScreen.tsx',
        'apps/mdp/screens/SignInScreen.tsx',
        'apps/vendor/screens/SignInScreen.tsx',
        'shared/account/ConfirmDevice.tsx',
      ].sort(),
    );
    // And no app's shell — where the signed-in tab bar is drawn — draws it.
    const shells = readdirSync(join(SRC, 'apps'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => `apps/${d.name}/app.tsx`);
    expect(shells).toContain('apps/agent/app.tsx');
    for (const f of shells.filter((s) => FILES.has(s))) expect(read(f), f).not.toContain('SignedOutBar');
  });

  it('is what every sign-in screen ends in, in place of the old foot — the desks’ cards (Business, the console) apart', () => {
    const DESKS = ['apps/business/screens/SignInScreen.tsx', 'apps/tower/screens/SignInScreen.tsx'];
    const doors = [...FILES].filter((f) => /^apps\/[^/]+\/screens\/(SignInScreen|AuthScreen|JoinScreen|StaffSignIn|RolesScreen)\.tsx$/.test(f));
    expect(doors).toContain('apps/driver/screens/SignInScreen.tsx');
    expect(doors.length).toBeGreaterThanOrEqual(12);
    for (const f of doors.filter((d) => !DESKS.includes(d))) {
      const src = read(f);
      expect(src, f).toMatch(/<SignedOutBar\b/);
      // What the bar draws is not drawn beside it again: the old foot, a second help, a second way to the other apps.
      expect(src, f).not.toContain('scr__foot');
      expect(src, f).not.toMatch(/<SignInHelp\b|<AllAppsLink\b|<HelpLink\b/);
    }
  });
});

describe('what the bar took off the screen', () => {
  /** The words come after the field's own box and before the next field or the button: under the field they are about. */
  const underField = (html: string, box: string, words: string) => {
    const at = html.indexOf(box);
    const link = html.indexOf(`>${words}<`, at);
    return at >= 0 && link > at && !/class="field"|scr__cta|class="cfield"|type="submit"/.test(html.slice(at, link));
  };

  it('puts a credential’s own way round under the field it is about, once, and not in the bar', () => {
    for (const [name, html, box, words] of [
      ['shop', shop(), 'id="password"', t('agent.signin.forgot')],
      ['hub', hub(), 'id="password"', t('mdp.signin.forgot')],
      ['store', store_(), 'id="vpass"', t('vendor.signin.forgot')],
      ['driver', driver(), 'id="drv-pin"', t('driver.signin.firstTime')],
      ['fleet', fleet(), 'id="mgr-pin"', t('account.choosePin.link')],
      ['fleet by code', fleet({ code: 'FM-1', did: 'did:fleet', name: 'Kilima Haulage' }), 'id="mgr-pin"', t('account.choosePin.link')],
      ['the shop’s people', staff(), 'id="staff-pin"', t('agent.staff.firstTime')],
      ['send', send('login'), 'id="auth-pin"', t('send.auth.forgot')],
      ['business', business('login'), 'id="biz-pin"', t('business.signIn.forgot')],
    ] as const) {
      expect(underField(html, box, words), name).toBe(true);
      expect(html.split(`>${words}<`).length - 1, name).toBe(1);
      expect(barOf(html), name).not.toContain(words);
    }
    // A code's: "Send a new code" under the code.
    expect(underField(send('enroll', 'code'), 'id="auth-otp"', t('send.auth.newCode'))).toBe(true);
    expect(underField(business('code'), 'id="biz-code"', t('business.signIn.newCode'))).toBe(true);
  });

  it('keeps "New here? Sign up" with the form, under its button, as the call it is', () => {
    for (const [name, html] of [
      ['shop', shop()],
      ['hub', hub()],
      ['store', store_()],
      ['driver', driver()],
      ['fleet', fleet()],
    ] as const) {
      const cta = html.indexOf('type="submit"');
      const signUp = html.indexOf(`>${t('common.signUp')}<`);
      expect(cta, name).toBeGreaterThan(0);
      expect(signUp, name).toBeGreaterThan(cta);
      expect(barOf(html), name).not.toContain(t('common.signUp'));
    }
    expect(send('login')).toContain(`>${t('send.auth.newHere')}<`);
    expect(business('login')).toContain(`>${t('common.signUp')}<`);
  });

  it('leaves every sign-in screen ONE help — the bar’s Help is "Trouble signing in?" (the user, 2026-10-23: "a bit redundant right?")', () => {
    const helps = (html: string) => html.split(`>${t('account.trouble.link')}<`).length - 1 + (html.split(`>${t('guide.link')}<`).length - 1);
    for (const [name, html] of [
      ['shop', shop()],
      ['shop, a new phone', shop(ask)],
      ['hub', hub()],
      ['hub, a new phone', hub(ask)],
      ['store', store_()],
      ['driver', driver()],
      ['fleet', fleet()],
      ['the shop’s people', staff()],
      ['send', send('login')],
      ['send, joining', send('enroll')],
      ['the front door', render(<HomeSignIn actions={{} as never} />)],
      ['business', business('login')],
      ['business, a code', business('code')],
    ] as const) {
      expect(helps(html), name).toBe(1);
    }
    // On a sign-in screen the bar's Help still says what it is, to a long press and to a mouse.
    expect(barOf(shop())).toContain(`title="${t('account.trouble.link')}"`);
  });
});

describe('the help on the sign-up', () => {
  it('is about joining as what was chosen: signing up first, then the papers where there are any, then signing in to its app', () => {
    const list = siteArticles();
    const ids = (role: string | null) => joiningArticles(role, list).map((a) => a.id);
    expect(ids('pudo')).toEqual(['sign-up', 'shop-papers', 'shop-sign-in']);
    expect(ids('mdp')).toEqual(['sign-up', 'hub-papers', 'shop-sign-in']);
    expect(ids('driver')).toEqual(['sign-up', 'driver-sign-in']);
    expect(ids('fleet')).toEqual(['sign-up', 'fleet-sign-in']);
    expect(ids('vendor')).toEqual(['sign-up', 'store-sign-in']);
    // Before a role is chosen: signing up, and which app is whose.
    expect(ids(null)).toEqual(['sign-up', 'which-sign-in']);
    // The sheet itself, open: the sign-up article's own title is the first in it.
    const signUp = list.find((a) => a.id === 'sign-up')!;
    const sheet = render(<JoinHelp open onClose={() => undefined} roleId="pudo" role="a shop" />);
    expect(sheet.indexOf(`<span>${signUp.title}</span>`)).toBeGreaterThan(-1);
    expect(sheet.indexOf(`<span>${signUp.title}</span>`)).toBeLessThan(sheet.indexOf(`<span>${list.find((a) => a.id === 'shop-papers')!.title}</span>`));
    expect(sheet).toContain('help/?for=shop');
  });
});

describe('the keyboard', () => {
  it('puts the bar away while something is typed and the keyboard has taken the bottom of the screen', () => {
    expect(keyboardUp(true, 420, 780)).toBe(true);
    // A box with the focus and the keyboard put away with Back: nothing covers the bar.
    expect(keyboardUp(true, 780, 780)).toBe(false);
    // The browser's own bar coming and going is not a keyboard.
    expect(keyboardUp(true, 724, 780)).toBe(false);
    // A screen made shorter by a split screen, with nothing being typed: no keyboard either.
    expect(keyboardUp(false, 420, 780)).toBe(false);
  });

  it('knows which controls bring the keyboard up', () => {
    const el = (tagName: string, type = '', isContentEditable = false) => ({ tagName, type, isContentEditable }) as unknown as Element;
    for (const box of [el('INPUT', 'text'), el('INPUT', 'tel'), el('INPUT', 'password'), el('INPUT', 'email'), el('TEXTAREA'), el('DIV', '', true)]) expect(typesText(box)).toBe(true);
    for (const other of [el('INPUT', 'checkbox'), el('INPUT', 'radio'), el('INPUT', 'file'), el('BUTTON'), el('SELECT'), null]) expect(typesText(other)).toBe(false);
  });
});
