import { describe, expect, it } from 'vitest';
import { t } from '../../shared/i18n';
import { gateNotice, licenceNotice, licenceReady } from './logic';
import type { AgentView, LicenceStanding } from './types';

/**
 * Round 40 — WHAT THE SHOP IS TOLD ABOUT ITS TRADING LICENCE (the user: "Expiry, notice, grace"): nothing while it is in date;
 * from thirty days before it runs out, the day and what follows; lapsed, the grace and the day new parcels stop; stopped, what
 * has stopped and what goes on. Once the renewed one is sent, that it is with SeeBuyGet — and no second button.
 */
describe('the trading licence on the Shop app', () => {
  const day = (iso: string) => iso; // the date as given, so the sentences can be read here
  const shop = (standing: Partial<LicenceStanding>, over: Partial<AgentView> = {}) => ({ licenceStanding: { state: 'ok', renewalSent: false, ...standing } as LicenceStanding, ...over });

  it('says nothing while it is in date, or with no date at all', () => {
    expect(licenceNotice(shop({ state: 'ok', expiresAt: '2027-12-31' }), t, day)).toBeNull();
    expect(licenceNotice(shop({ state: 'none' }), t, day)).toBeNull();
    expect(licenceNotice({}, t, day)).toBeNull(); // a server that predates it
  });

  it('warns from thirty days out, with the day it runs to', () => {
    const n = licenceNotice(shop({ state: 'due', expiresAt: '2026-11-11', daysLeft: 20, stopsOn: '2026-11-26' }), t, day)!;
    expect(n).toMatchObject({ tone: 'warn', title: 'Your trading licence runs out in 20 days', send: true });
    expect(n.detail).toMatch(/^It runs to 2026-11-11\. /);
    expect(licenceNotice(shop({ state: 'due', expiresAt: '2026-11-11', daysLeft: 1 }), t, day)!.title).toBe('Your trading licence runs out in 1 day');
  });

  it('says the day new parcels stop while in its grace', () => {
    const n = licenceNotice(shop({ state: 'grace', expiresAt: '2026-10-21', stopsOn: '2026-11-05', graceDaysLeft: 14 }), t, day)!;
    expect(n).toMatchObject({ tone: 'danger', title: 'Your trading licence has lapsed', send: true });
    expect(n.detail).toMatch(/From 2026-11-05 — in 14 days — no new parcel can start at your shop/);
  });

  it('says what has stopped, and what goes on, once the grace is over', () => {
    const n = licenceNotice(shop({ state: 'stopped', expiresAt: '2026-09-01' }), t, day)!;
    expect(n).toMatchObject({ tone: 'danger', title: 'New parcels have stopped at your shop', send: true });
    expect(n.detail).toMatch(/Booked parcels and your shelf go on as usual/);
  });

  it('once sent, says it is with SeeBuyGet and offers nothing more — but a stop is still said', () => {
    const sent = { licenceRenewal: { copyRef: 'm', expiresAt: '2027-11-11', sentAt: '2026-10-20T08:00:00Z' } };
    expect(licenceNotice(shop({ state: 'due', expiresAt: '2026-11-11', daysLeft: 20, renewalSent: true }, sent), t, day)).toMatchObject({ tone: 'info', title: 'Your renewed licence is with SeeBuyGet', send: false });
    const stopped = licenceNotice(shop({ state: 'stopped', expiresAt: '2026-09-01', renewalSent: true }, sent), t, day)!;
    expect(stopped).toMatchObject({ title: 'New parcels have stopped at your shop', send: false });
    expect(stopped.detail).toMatch(/The renewed one you sent is with SeeBuyGet/);
  });

  it('says why the last one was sent back, and asks for another', () => {
    const n = licenceNotice(shop({ state: 'due', expiresAt: '2026-11-11', daysLeft: 20 }, { licenceRenewalRefusal: { reason: 'The photo is blurred', at: '' } }), t, day)!;
    expect(n).toMatchObject({ tone: 'danger', title: 'Your licence photo was not accepted', send: true });
    expect(n.detail).toContain('The photo is blurred');
  });

  it('sends only with a photo and a whole date', () => {
    expect(licenceReady({ photo: '', expiresAt: '2027-12-31' })).toBe(false);
    expect(licenceReady({ photo: 'm1', expiresAt: '' })).toBe(false);
    expect(licenceReady({ photo: 'm1', expiresAt: '2027-12-31' })).toBe(true);
  });

  it('tells the counter at the gate, in place of asking for money', () => {
    const n = gateNotice({ status: 'ACTIVE' }, { ok: false, code: 'LICENCE_LAPSED', balance: 40 }, t)!;
    expect(n).toMatchObject({ tone: 'danger', title: 'No new parcel can be started here' });
    expect(n.detail).toMatch(/Send the renewed licence from the home screen/);
    expect(n.detail).not.toMatch(/[Tt]op up/);
  });
});
