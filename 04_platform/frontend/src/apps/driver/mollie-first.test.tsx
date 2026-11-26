import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { t } from '../../shared/i18n';
import { followLink, intentOf, onLaunch, resetLaunchForTests, withoutIntent } from '../../shared/launch';
import { BoardCard } from './screens/BoardScreen';
import type { BoardRow } from './types';

/*
 * 2026-11-26 — BEFORE A PRICE IS NAMED ON A LOAD PAID UPFRONT IN EUROS (the weakness after route plan part 9b, fixed as recommended):
 * Mollie routes a carrier's pay only to an account connected before the sender pays. So the board says it on the card, where the
 * server says so (`mollieFirst`): a courier opens Settings on Mollie in one tap (`?settings=mollie`); a fleet driver is told its
 * office connects it. Nothing where the server says nothing.
 */
const row = (over: Partial<BoardRow> = {}): BoardRow => ({
  freightId: 'f1',
  code: 'FRT-009',
  description: 'Pallets of tiles',
  pickupLabel: 'Utrecht',
  destLabel: 'Sofia',
  weightKg: 400,
  commitMode: 'negotiate',
  deadheadKm: 4,
  loadedKm: 2100,
  totalKm: 2104,
  canTake: true,
  blockers: [],
  ...over,
});
const noop = () => undefined;

afterEach(() => resetLaunchForTests());

describe('the board says to connect Mollie before a price is named', () => {
  it('a courier: the line and the button that opens Settings on Mollie', () => {
    const html = renderToString(<BoardCard row={row({ mollieFirst: 'connect' })} currency="EUR" onPropose={noop} onAsk={noop} />);
    expect(html).toContain(t('driver.board.mollieConnect'));
    expect(html).toContain(t('driver.board.mollieConnectGo'));
  });

  it('a fleet driver: its office connects it — no button that would open nothing of its own', () => {
    const html = renderToString(<BoardCard row={row({ mollieFirst: 'office' })} currency="EUR" onPropose={noop} onAsk={noop} />);
    expect(html).toContain(t('driver.board.mollieOffice'));
    expect(html).not.toContain(t('driver.board.mollieConnectGo'));
  });

  it('the button opens Settings on Mollie, and closes the price sheet it is on first', () => {
    const screen = readFileSync(join('src/apps/driver/screens', 'BoardScreen.tsx'), 'utf8');
    expect(screen).toContain("onClick={() => { onGo?.(); followLink('/?settings=mollie'); }}");
    expect(screen).toContain('<MollieFirst row={row} onGo={onClose} />');
  });

  it('nothing where the server says nothing', () => {
    const html = renderToString(<BoardCard row={row()} currency="EUR" onPropose={noop} onAsk={noop} />);
    expect(html).not.toContain(t('driver.board.mollieConnect'));
    expect(html).not.toContain(t('driver.board.mollieOffice'));
  });
});

describe('a link that opens a page of Settings (?settings=payout|mollie)', () => {
  it('reads only the pages Settings has, and leaves the address clean', () => {
    expect(intentOf('/?settings=mollie')).toEqual({ settings: 'mollie' });
    expect(intentOf('/?settings=payout')).toEqual({ settings: 'payout' });
    expect(intentOf('/?settings=close')).toBeNull();
    expect(withoutIntent('https://app.test/driver/?settings=payout&x=1')).toBe('/driver/?x=1');
  });

  it('is followed inside the page to whoever opens Settings — and leads nowhere where nobody does', () => {
    expect(followLink('/?settings=mollie')).toBe(false);
    const opened: string[] = [];
    const stop = onLaunch('settings', (page) => opened.push(page));
    expect(followLink('/?settings=mollie')).toBe(true);
    expect(followLink('/?settings=payout')).toBe(true);
    expect(opened).toEqual(['mollie', 'payout']);
    stop();
  });
});
