import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { pairQr, shownPairCode, typedPairCode } from './pairing';
import { deviceAskOf } from './shopDevice';
import { checkScan } from '../scan';
import { ConfirmDevice } from './ConfirmDevice';
import { makeConfig } from '../../lib/sbg';

/*
 * A NEW PHONE LINKED BY ONE THE ACCOUNT ALREADY USES (the owner, 2026-11-03: "like the dutch digid with a qr and a couple
 * code"). The new phone shows a code as a QR code and in words; the other phone scans or types it.
 */
describe('the pairing code', () => {
  it('is shown in two groups of four, read back however it is typed, and scanned only as a pairing code', () => {
    expect(shownPairCode('K7QXM2PF')).toBe('K7QX-M2PF');
    expect(typedPairCode(' k7qx-m2pf ')).toBe('K7QXM2PF');
    expect(typedPairCode('K7QX M2P')).toBeNull();
    expect(checkScan(pairQr('K7QXM2PF'), 'pair')).toEqual({ value: 'K7QXM2PF', mismatch: false, scannedKind: 'pair' });
    // A parcel's code held up instead is said to be the wrong kind, not taken.
    expect(checkScan('sbg:parcel:SBG-1', 'pair').mismatch).toBe(true);
  });
});

describe('a sign-in where no code could be texted', () => {
  const refused = (code: string, params?: Record<string, unknown>) => ({ code, status: 503, title: '', detail: '', retryable: true, ...(params ? { params } : {}) });

  it('is a challenge that only pairs, where the password was right', () => {
    expect(deviceAskOf(refused('SMS_NOT_SENT', { challenge: 'dq_1', pairOnly: true }))).toEqual({ challenge: 'dq_1', sentTo: '', pairOnly: true });
    expect(deviceAskOf(refused('PHONE_NOT_SERVED', { challenge: 'dq_2', pairOnly: true }))).toEqual({ challenge: 'dq_2', sentTo: '', pairOnly: true });
    // No challenge, or not said to pair: a refusal like any other.
    expect(deviceAskOf(refused('SMS_NOT_SENT'))).toBeNull();
    expect(deviceAskOf(refused('SMS_NOT_SENT', { challenge: 'dq_3' }))).toBeNull();
  });

  it('opens on linking the phone, with no boxes for a code that never came', () => {
    const html = renderToString(<ConfirmDevice ask={{ challenge: 'dq_1', sentTo: '', pairOnly: true }} party="hub" busy={false} error={null} onConfirm={() => undefined} onGivePhone={() => undefined} onBack={() => undefined} pair={{ config: makeConfig('mdp', '1'), onLinked: () => undefined }} />);
    expect(html).toContain('Link this phone');
    expect(html).toContain('Codes cannot be texted to the hub’s number from here yet');
    expect(html).not.toContain('id="device-code"');
  });

  it('offers the link beside the code where a code did go', () => {
    const html = renderToString(<ConfirmDevice ask={{ challenge: 'dc_1', sentTo: '•••678' }} party="store" busy={false} error={null} onConfirm={() => undefined} onGivePhone={() => undefined} onBack={() => undefined} pair={{ config: makeConfig('vendor', '1'), onLinked: () => undefined }} />);
    expect(html).toContain('No code? Link it with a phone the store already uses');
  });
});
