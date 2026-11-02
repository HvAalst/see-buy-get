import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { t } from '../i18n';
import { PasskeyForm, passkeyRowSub, type PasskeyState } from './PasskeySettings';
import { passkeyApi } from './passkey';

/**
 * UNLOCK WITH FINGERPRINT OR FACE, UNDER SETTINGS (the owner, 2026-11-02: "in settings users should be able to undo it
 * and get back to a preferred option"). The row says which is on, and is not there where the phone cannot do it; behind
 * it, ON takes the PIN and then the phone, OFF takes one tap.
 */
const say = t as never;
const state = (over: Partial<PasskeyState>): PasskeyState => ({ supported: true, here: null, unread: false, set: () => undefined, ...over });
const api = passkeyApi((async () => ({ data: null, error: null })) as never);

describe('the Settings row', () => {
  it('says it is on, here', () => {
    expect(passkeyRowSub(state({ here: { on: true, which: 0, id: 'cred-1' } }), say)).toBe('On for this phone. Your PIN works too.');
  });

  it('says it is off — the PIN is how they sign in', () => {
    expect(passkeyRowSub(state({ here: { on: false, which: 0 } }), say)).toBe('Off. You sign in with your PIN.');
  });

  it('is not there where the phone cannot check a fingerprint or face, or before the browser has said', () => {
    expect(passkeyRowSub(state({ supported: false, here: { on: false, which: 0 } }), say)).toBeNull();
    expect(passkeyRowSub(state({ supported: null }), say)).toBeNull();
  });

  it('is not there on a browser where this person’s PIN does not work: nothing could stand in for it here', () => {
    expect(passkeyRowSub(state({ here: { on: false, which: -1 } }), say)).toBeNull();
    expect(passkeyRowSub(state({ here: null }), say)).toBeNull();
  });
});

describe('behind the row', () => {
  it('on: says so, says what is kept, and offers the way back to the PIN', () => {
    const html = renderToString(<PasskeyForm api={api} state={state({ here: { on: true, which: 0, id: 'cred-1', addedAt: '2026-11-02T09:00:00Z' } })} />);
    expect(html).toContain('On for this phone');
    expect(html).toContain('never leaves this phone');
    expect(html).toContain('Turn it off, use my PIN');
    expect(html).not.toContain('acct-passkey-pin');
  });

  it('off: the PIN, once more, before the phone is asked', () => {
    const html = renderToString(<PasskeyForm api={api} state={state({ here: { on: false, which: 0 } })} />);
    expect(html).toContain('acct-passkey-pin');
    expect(html).toContain('Your PIN, to turn it on');
    expect(html).not.toContain('Turn it off');
  });

  it('a shop’s, a hub’s or a store’s: said by its password, the password asked, and who else could sign in said first', () => {
    const store = { ...api, secret: 'password' as const, party: 'store' as const };
    expect(passkeyRowSub(state({ here: { on: true, which: 0, id: 'cred-1' } }), say, store)).toBe('On for this phone. The password works too.');
    expect(passkeyRowSub(state({ here: { on: false, which: 0 } }), say, store)).toBe('Off. You sign in with the password.');
    expect(passkeyRowSub(state({ here: { on: false, which: -1 } }), say, store)).toBeNull();
    const off = renderToString(<PasskeyForm api={store} state={state({ here: { on: false, which: 0 } })} />);
    expect(off).toContain('acct-passkey-password');
    expect(off).not.toContain('acct-passkey-pin');
    expect(off).toContain('The store’s password, to turn it on');
    expect(off).toContain('can then sign in as the store without the password');
    const on = renderToString(<PasskeyForm api={store} state={state({ here: { on: true, which: 0, id: 'cred-1', addedAt: '2026-11-02T09:00:00Z' } })} />);
    expect(on).toContain('Turn it off, use the password');
    expect(on).toContain('The store signs in here with your fingerprint or face');
  });

  it('a shop’s phone colleagues sign in on: off, and said why — in the row and behind it, with nothing to type', () => {
    const shop = { ...api, secret: 'password' as const, party: 'shop' as const };
    const here = { on: false, which: 0, counter: '2026-11-02T09:00:00Z' };
    expect(passkeyRowSub(state({ here }), say, shop)).toBe('Off: colleagues sign in on this phone.');
    const html = renderToString(<PasskeyForm api={shop} state={state({ here })} />);
    expect(html).toContain('Not on a phone colleagues sign in on');
    expect(html).toContain('could then sign in as the shop');
    expect(html).toContain('It works on a phone that only you sign in on');
    expect(html).not.toContain('acct-passkey-password');
    expect(html).not.toContain('Turn it on');
  });

  it('…then the phone’s own prompt, on a tap', () => {
    const html = renderToString(<PasskeyForm api={api} state={state({ here: { on: false, which: 0 } })} initialStep="now" />);
    expect(html).toContain('Now your fingerprint or face');
    expect(html).toContain('Turn it on');
  });
});
