import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { looksLikeALinkToken, readEmailLink } from './emailLink';
import { EMPTY_JOIN, ROLES } from './logic';
import { JoinScreen } from './screens/JoinScreen';
import { YesItIsMeScreen } from './screens/YesItIsMeScreen';
import { accountRoleOf, sbgChangePassword, sbgForgot, sbgLogin } from '../../lib/sbg/appclient';
import { makeConfig } from '../../lib/sbg';

/*
 * ONE EMAIL, SEVERAL KINDS OF ACCOUNT (the owner, 2026-11-03: "the email would then be linked … a confirmation mail will
 * ask the user to click the 'yes it is me' button"). The email's button lands on the front page at #link=…; the page asks
 * once more and a tap links. The sign-up's last step says the email was sent. And the Shop, Hub and Store apps each sign
 * in to their own kind under an address that has several.
 */
const TOKEN = 'abcdefghijklmnopqrstuvwxyz012345'; // 32 characters, as the server makes them

describe('the key in a “Yes, it is me” link', () => {
  it('is read from #link=, alone or beside other parts, and nothing else is taken for one', () => {
    expect(readEmailLink(`#link=${TOKEN}`)).toBe(TOKEN);
    expect(readEmailLink(`#lang=sw&link=${TOKEN}`)).toBe(TOKEN);
    expect(readEmailLink('#doc=abc')).toBeUndefined();
    expect(readEmailLink('')).toBeUndefined();
    expect(readEmailLink(undefined)).toBeUndefined();
    // Cut short by a mail program: still handed back, so the page can say so.
    expect(readEmailLink('#link=abc')).toBe('abc');
    expect(looksLikeALinkToken(TOKEN)).toBe(true);
    expect(looksLikeALinkToken('abc')).toBe(false);
  });
});

describe('the page the email opens', () => {
  it('asks once more, and links nothing by being opened', () => {
    const html = renderToString(<YesItIsMeScreen token={TOKEN} />);
    expect(html).toContain('Is this you?');
    expect(html).toContain('Yes, it is me');
    expect(html).toContain('Without your tap, the new account does not sign in with your email.');
  });

  it('says a link cut short is not one of ours, and offers no button', () => {
    const html = renderToString(<YesItIsMeScreen token="abc" />);
    expect(html).toContain('This link has been used already, or is not one of ours');
    expect(html).not.toContain('Yes, it is me</');
  });
});

describe('the sign-up’s last step', () => {
  const role = ROLES.find((r) => r.id === 'mdp')!;
  const done = (linkPending?: boolean) =>
    renderToString(<JoinScreen state={{ role, step: 'done', form: { ...EMPTY_JOIN, email: 'amani@example.com', displayName: 'Kituo' }, busy: null, countries: [], countriesState: 'idle', issuedCode: null, account: { role: 'mdp', did: 'did:x', email: 'amani@example.com', entityStatus: 'PENDING', ...(linkPending ? { linkPending } : {}) }, store: null } as never} actions={{} as never} />);

  it('says the email was sent, and what to tap, where the address signs in to another account already', () => {
    const html = done(true);
    expect(html).toContain('One more step: your email');
    expect(html).toMatch(/amani@example\.com signs in to another SeeBuyGet account already/);
  });

  it('says nothing of it for a first account', () => {
    expect(done()).not.toContain('One more step: your email');
  });
});

describe('each app signs in to its own kind', () => {
  const sent: Array<{ path: string; body: Record<string, unknown> }> = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    sent.push({ path: new URL(String(input)).pathname, body: JSON.parse(String(init?.body ?? '{}')) });
    return new Response(JSON.stringify({}), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;

  it('names the kind from the app the config was made for, and none for any other app', () => {
    expect(accountRoleOf(makeConfig('agent', '1'))).toEqual({ role: 'pudo' });
    expect(accountRoleOf(makeConfig('mdp', '1'))).toEqual({ role: 'mdp' });
    expect(accountRoleOf(makeConfig('vendor', '1'))).toEqual({ role: 'vendor' });
    expect(accountRoleOf(makeConfig('business', '1'))).toEqual({});
  });

  it('sends it with the sign-in, the forgotten password and the changed one', async () => {
    const hub = makeConfig('mdp', '1', { baseUrl: 'https://api.example' });
    await sbgLogin(hub, 'amani@example.com', 'kituo-cha-amani', f, 'dvc_1');
    await sbgForgot(hub, 'amani@example.com', f);
    await sbgChangePassword(hub, 'amani@example.com', 'kituo-cha-amani', 'kituo-kipya-cha', f, 'dvc_1');
    expect(sent.map((x) => [x.path, x.body.role])).toEqual([
      ['/v1/sbg/auth/login', 'mdp'],
      ['/v1/sbg/auth/forgot', 'mdp'],
      ['/v1/sbg/auth/password', 'mdp'],
    ]);
  });
});
