import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearCreds, readCreds, saveCreds } from './api';

/*
 * THE CONSOLE KEEPS WHO, NEVER HOW (the user, 2026-10-22: "the browser password manager should ask if the user wants to
 * save the login credentials"). A company administrator's password and the setup key used to sit in this tab so the
 * console could sign itself back in. Now the session token is the session; the type has no field for a secret, and an
 * entry an older build wrote with one is read for the name or email only and written back without it.
 */
const KEY = 'sbg:tower:creds';
const store = new Map<string, string>();
const tab = globalThis as { sessionStorage?: unknown };

describe('what the console keeps in the tab', () => {
  beforeEach(() => {
    store.clear();
    tab.sessionStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
    };
  });
  afterEach(() => {
    delete tab.sessionStorage;
  });

  it('saves who signed in, and nothing to sign in with', () => {
    saveCreds({ mode: 'company', email: 'amani@sbg.co.ke' });
    expect(JSON.parse(store.get(KEY)!)).toEqual({ mode: 'company', email: 'amani@sbg.co.ke' });
    saveCreds({ mode: 'operator', name: 'Hans' });
    expect(JSON.parse(store.get(KEY)!)).toEqual({ mode: 'operator', name: 'Hans' });
  });

  it('reads an older tab’s entry for who only, and scrubs the password or the key from it', () => {
    store.set(KEY, JSON.stringify({ mode: 'company', email: 'amani@sbg.co.ke', password: 'Kilima-ridge-2026' }));
    expect(readCreds()).toEqual({ mode: 'company', email: 'amani@sbg.co.ke' });
    expect(store.get(KEY)).not.toContain('Kilima-ridge-2026');

    store.set(KEY, JSON.stringify({ mode: 'operator', name: 'Hans', key: 'setup-key-value' }));
    expect(readCreds()).toEqual({ mode: 'operator', name: 'Hans' });
    expect(store.get(KEY)).not.toContain('setup-key-value');

    // The shape from before there were modes was the operator's.
    store.set(KEY, JSON.stringify({ name: 'Hans', key: 'setup-key-value' }));
    expect(readCreds()).toEqual({ mode: 'operator', name: 'Hans' });
    expect(store.get(KEY)).not.toContain('setup-key-value');

    store.set(KEY, JSON.stringify({ mode: 'staff', email: 'ops1@sbg.test', password: 'old' }));
    expect(readCreds()).toEqual({ mode: 'staff', email: 'ops1@sbg.test' });
    expect(store.get(KEY)).not.toContain('old');
  });

  it('reads nothing it cannot name, and signing out leaves nothing behind', () => {
    store.set(KEY, JSON.stringify({ mode: 'company', password: 'no-email' }));
    expect(readCreds()).toBeNull();
    store.set(KEY, '{not json');
    expect(readCreds()).toBeNull();
    saveCreds({ mode: 'staff', email: 'ops1@sbg.test' });
    store.set('sbg:tower:token', 'a-token');
    clearCreds();
    expect(store.size).toBe(0);
  });
});
