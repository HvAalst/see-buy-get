import { beforeEach, describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { allDeviceKeys, saveDeviceKey } from './pin';
import { markUnlock } from './unlock';
import { UnlockFirst, useUnlockFirst } from './UnlockFirst';
import { SignInScreen as DriverSignIn } from '../../apps/driver/screens/SignInScreen';

/**
 * THE FINGERPRINT OR FACE, FIRST — AT A SIGN-IN SCREEN (the owner, 2026-11-02). Where it was turned on for the number
 * on this phone, the button is the first choice and the PIN one tap away; anywhere else, the screen is what it was.
 */
function mockStorage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
    key: (i) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
  } as Storage;
}
const PHONE = '+254712345678';
const config = { baseUrl: 'https://api.example', clientId: 'test/1', timeoutMs: 5000 };

beforeEach(() => {
  (globalThis as { localStorage?: Storage }).localStorage = mockStorage();
});
const turnedOnHere = (phone = PHONE, key = 'dvc_this-phone') => {
  saveDeviceKey(phone, key);
  markUnlock(allDeviceKeys().find((k) => k.key === key)?.slot, key, 'cred-1');
};

function Screen({ phone }: { phone: string }) {
  const state = useUnlockFirst(phone);
  return (
    <UnlockFirst state={state} phone={phone} config={config} onTicket={() => undefined}>
      <p id="the-pin-boxes">PIN</p>
    </UnlockFirst>
  );
}

describe('the sign-in button', () => {
  it('is the first choice where it is on for this number here, with the PIN one tap away', () => {
    turnedOnHere();
    const html = renderToString(<Screen phone="0712 345 678" />);
    expect(html).toContain('Unlock with fingerprint or face');
    expect(html).toContain('Use my PIN instead');
    expect(html).not.toContain('the-pin-boxes');
  });

  it('is not there for another number, nor where nothing was turned on — the PIN is', () => {
    turnedOnHere();
    for (const html of [renderToString(<Screen phone="+254798765432" />), renderToString(<Screen phone="" />)]) {
      expect(html).toContain('the-pin-boxes');
      expect(html).not.toContain('Unlock with fingerprint or face');
      expect(html).not.toContain('Use fingerprint or face');
    }
    (globalThis as { localStorage?: Storage }).localStorage = mockStorage();
    saveDeviceKey(PHONE, 'dvc_this-phone');
    expect(renderToString(<Screen phone={PHONE} />)).not.toContain('Unlock with fingerprint or face');
  });

  it('is not there once the device key changed under it — a PIN replaced by a code, a device forgotten', () => {
    turnedOnHere();
    saveDeviceKey(PHONE, 'dvc_after-the-code');
    expect(renderToString(<Screen phone={PHONE} />)).not.toContain('Unlock with fingerprint or face');
  });

  it('in the Driver app, where nothing was turned on, the PIN screen is as it was', () => {
    const props = { onSignIn: async () => true, onSendCode: async () => '', onSetPin: async () => 'ok' as const, error: null };
    const before = renderToString(<DriverSignIn {...props} />);
    expect(before).toContain('id="drv-pin');
    expect(before).not.toContain('Unlock with fingerprint or face');
  });
});
