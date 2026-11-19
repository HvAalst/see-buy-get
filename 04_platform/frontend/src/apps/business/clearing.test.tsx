import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { t } from '../../shared/i18n';
import { navGroupsFor, sectionsFor } from './logic';
import { clearingGroups, type ClearingRow, type ClearingView } from './clearing';
import { ClearingPanel } from './screens/ClearingScreen';

/*
 * 2026-11-19 — CUSTOMS CLEARING IN THE BUSINESS APP (parcels across a border, step 4): shown to a clearing agent; the countries it
 * is named for, accepted by an owner; the parcels into them, with what customs decided and when a held one is paid.
 */
const row = (parcelId: string, step: ClearingRow['step'], o: Partial<ClearingRow> = {}): ClearingRow => ({
  parcelId,
  step,
  from: 'KE',
  to: 'ET',
  toName: 'Ethiopia',
  carrier: 'Kilimanjaro Air Cargo',
  departure: 'NBO',
  arrival: 'ADD',
  seal: 'SL-1',
  contents: 'Shoes ×2',
  itemCount: 2,
  value: 45,
  valueCurrency: 'USD',
  ...o,
});
const noop = () => {};
const panel = (view: ClearingView, o: { owner?: boolean; mayAct?: boolean } = {}) =>
  renderToString(<ClearingPanel view={view} owner={o.owner ?? true} mayAct={o.mayAct ?? true} busy={null} error={null} onAccept={noop} onReleased={noop} onHeld={noop} onPaid={noop} />);

describe('customs clearing in the Business app', () => {
  it('is a section for a clearing agent, among its shipments', () => {
    expect(sectionsFor(['clearing_agent'])).toContain('clearing');
    expect(sectionsFor(['shipper'])).not.toContain('clearing');
    expect(navGroupsFor(['clearing_agent']).find((g) => g.key === 'shipments')?.sections).toContain('clearing');
  });

  it('a country it is named for is accepted by an owner; anyone else is told so', () => {
    const view: ClearingView = { countries: [{ country: 'ET', name: 'Ethiopia', accepted: false }], rows: [] };
    const owner = panel(view);
    expect(owner).toContain(t('business.clearing.named'));
    expect(owner).toContain(`>${t('business.clearing.accept')}<`);
    const booker = panel(view, { owner: false });
    expect(booker).not.toContain(`>${t('business.clearing.accept')}<`);
    expect(booker).toContain(t('business.clearing.acceptOwner'));
    expect(panel({ countries: [], rows: [] })).toContain(t('business.clearing.noCountries'));
  });

  it('a parcel waiting for customs: released or held, by one who may act; a viewer reads', () => {
    const view: ClearingView = { countries: [{ country: 'ET', name: 'Ethiopia', accepted: true }], rows: [row('PUD-1', 'customs')] };
    const html = panel(view);
    expect(html).toContain(t('business.clearing.row', { parcel: 'PUD-1', country: 'Ethiopia', airport: 'ADD', seal: 'SL-1' }));
    expect(html).toContain(t('business.clearing.declared', { contents: 'Shoes ×2', count: 2, value: '45.00', currency: 'USD' }));
    expect(html).toContain(`>${t('business.clearing.released')}<`);
    expect(html).toContain(`>${t('business.clearing.held')}<`);
    expect(panel(view, { mayAct: false })).not.toContain(`>${t('business.clearing.released')}<`);
  });

  it('a held parcel: what, by when, its reference — said paid once customs released it; not paid in time, said so', () => {
    const held = { amount: 90, currency: 'ETB', reference: 'ET-CUS-0050', payee: 'Addis Clearing Ltd', payBy: '2026-12-03T10:00:00.000Z' };
    const html = panel({ countries: [{ country: 'ET', name: 'Ethiopia', accepted: true }], rows: [row('PUD-2', 'held', { held })] });
    expect(html).toContain(t('business.clearing.heldLine', { amount: '90.00', currency: 'ETB', reference: 'ET-CUS-0050', date: '2026-12-03' }));
    expect(html).toContain(`>${t('business.clearing.paid')}<`);
    expect(panel({ countries: [], rows: [row('PUD-3', 'held', { held: { ...held, lapsed: true } })] })).toContain(t('business.clearing.lapsed'));
  });

  it('coming from abroad: with which carrier, under what reference; nothing waiting, said so', () => {
    expect(panel({ countries: [{ country: 'ET', name: 'Ethiopia', accepted: true }], rows: [row('PUD-4', 'coming', { reference: 'HAWB-9' })] })).toContain(t('business.clearing.comingWith', { carrier: 'Kilimanjaro Air Cargo', reference: 'HAWB-9' }));
    expect(panel({ countries: [{ country: 'ET', name: 'Ethiopia', accepted: true }], rows: [] })).toContain(t('business.clearing.nothing'));
    expect(clearingGroups([row('A', 'coming'), row('B', 'customs'), row('C', 'held')])).toEqual({ coming: [row('A', 'coming')], customs: [row('B', 'customs')], held: [row('C', 'held')] });
  });
});
