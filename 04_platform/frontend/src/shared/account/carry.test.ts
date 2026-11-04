import { describe, expect, it } from 'vitest';
import { CARRY_KEEP_MS, keptCarry, readCarry, withCarry } from './carry';
import { myAppsApi } from './myApps';
import { saveShopDeviceKey } from './shopDevice';
import { carriedForm, carriedStep, EMPTY_JOIN } from '../../apps/home/logic';

/*
 * ANOTHER SIGN-UP, STARTED FROM A SIGNED-IN APP ON THIS PHONE (the owner, 2026-11-04: "I am in the hub, click 'all sbg apps'
 * then select fleet and sign up. The phone number, name etc is not prefilled" — then: "Phone, name, email, country", and
 * the text code skipped).
 */
function mockStorage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, String(v)),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
    key: (i) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
  } as Storage;
}
const CODE = 'jc_aAbB1234-_xyz';

describe('the code in an address', () => {
  it('is read from #carry=, only in the shape the server gives, and put after an address in place of what was there', () => {
    expect(readCarry(`#carry=${CODE}`)).toBe(CODE);
    expect(readCarry(`#lang=sw&carry=${CODE}`)).toBe(CODE);
    expect(readCarry('#carry=ho_a-hand-over')).toBeUndefined();
    expect(readCarry('#carry=jc_<script>')).toBeUndefined();
    expect(readCarry('#handover=ho_abc')).toBeUndefined();
    expect(readCarry(undefined)).toBeUndefined();
    expect(withCarry('/fleet/', CODE)).toBe(`/fleet/#carry=${CODE}`);
    expect(withCarry('/?join=fleet#old', CODE)).toBe(`/?join=fleet#carry=${CODE}`);
    expect(withCarry('/fleet/', undefined)).toBe('/fleet/');
  });

  it('is kept for the tab it opened — so "New here? Sign up" hands it on — while it is fresh', () => {
    const store = mockStorage();
    const now = Date.parse('2026-11-04T09:00:00Z');
    expect(keptCarry(now, { hash: `#carry=${CODE}`, pathname: '/fleet/', search: '' }, store)).toBe(CODE);
    // The address cleaned of it, the tab still has it.
    expect(keptCarry(now + 60_000, { hash: '', pathname: '/fleet/', search: '' }, store)).toBe(CODE);
    expect(keptCarry(now + CARRY_KEEP_MS + 1, { hash: '', pathname: '/fleet/', search: '' }, store)).toBeUndefined();
    expect(store.getItem('sbg-carry')).toBeNull();
  });
});

describe('asking for it, from a signed-in app', () => {
  it('asks with this phone’s key for the account asking', async () => {
    (globalThis as { localStorage?: Storage }).localStorage = mockStorage();
    saveShopDeviceKey('amani@example.com', 'dvc_hub', 'hub');
    const sent: Array<[string, unknown]> = [];
    const api = myAppsApi(
      (async () => ({ data: { apps: [] }, error: null, status: 200 })) as never,
      (async (path: string, body: unknown) => {
        sent.push([path, body]);
        return { data: { code: CODE }, error: null, status: 201 };
      }) as never,
      () => 'amani@example.com',
      'hub',
    );
    expect((await api.carry!()).data).toEqual({ code: CODE });
    expect(sent).toEqual([['/v1/sbg/account/my-apps/carry', { device: 'dvc_hub' }]]);
  });
});

describe('the sign-up it fills in', () => {
  const carried = { email: 'amani@example.com', phone: '+254712345678', name: 'Amani Otieno', country: 'KE', phoneChecked: true };

  it('fills the number, the email, the name — only where nothing is typed — and the country over the page’s guess; never the company', () => {
    const f = carriedForm({ ...EMPTY_JOIN, country: 'UG', displayName: '' }, carried);
    expect(f).toMatchObject({ phone: '+254712345678', email: 'amani@example.com', contactEmail: 'amani@example.com', recoveryEmail: 'amani@example.com', fullName: 'Amani Otieno', country: 'KE', displayName: '' });
    expect(carriedForm({ ...EMPTY_JOIN, fullName: 'Typed Already' }, carried).fullName).toBe('Typed Already');
    // Nothing carried for a field: it stays as it was.
    expect(carriedForm({ ...EMPTY_JOIN, country: 'NL' }, { email: 'a@b.example' })).toMatchObject({ phone: '', fullName: '', country: 'NL' });
  });

  it('starts past the number and its code when the number came checked — and asks them where it did not', () => {
    expect(carriedStep('fleet', 'phone', carried)).toBe('pin');
    expect(carriedStep('driver', 'phone', carried)).toBe('about');
    expect(carriedStep('signup', 'code', carried, true)).toBe('about');
    expect(carriedStep('fleet', 'phone', { ...carried, phoneChecked: false })).toBe('phone');
    expect(carriedStep('fleet', 'phone', { phoneChecked: true })).toBe('phone');
    // Somebody already further on is not moved.
    expect(carriedStep('fleet', 'about', carried)).toBe('about');
  });
});
