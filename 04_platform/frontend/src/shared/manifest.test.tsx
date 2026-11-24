import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { t } from './i18n';
import { ManifestBody, ManifestSheet, type ManifestView } from './ui/ManifestSheet';

/*
 * 2026-11-24 — THE MASTER MANIFEST, READ (the owner's brief, feature 3): plates and driver, what wants a look first, totals,
 * each thing aboard with its codes, and the crossings.
 */
const m: ManifestView = {
  manifestId: 'man_veh_1_20261124060000',
  vehicleId: 'veh_1',
  truckPlate: 'NL-12-AB',
  trailerPlate: 'WT-99-ZZ',
  driverDid: 'did:drv',
  driverName: 'Piet',
  shiftStartedAt: '2026-11-24T06:00:00.000Z',
  items: [
    { kind: 'freight', ref: 'frt_1', label: 'FRT-1', state: 'aboard', from: 'Bucharest yard', to: 'Venlo depot', weightKg: 800, declaredValue: { amount: 3000, currency: 'EUR' }, valueRon: 15000, fiscalCodes: [{ country: 'RO', kind: 'UIT', code: 'RO1234567890', validThrough: '2026-11-24', status: 'expiring_soon', expiresAt: '2026-11-24T21:59:59.999Z' }], flags: ['over_500kg', 'over_ron_10000', 'code_expiring'] },
    { kind: 'bag', ref: 'BAG-7', label: 'BAG-7', state: 'to_collect', from: 'Grachten Winkel', to: 'Sofia Central Hub', weightKg: 12.3, parcels: 3, flags: [] },
  ],
  totalWeightKg: 812.3,
  totalValue: [{ amount: 3000, currency: 'EUR' }],
  totalValueRon: 15000,
  flagged: 1,
  crossings: [{ freightCode: 'FRT-1', kind: 'at_border', post: 'Nădlac', at: '2026-11-24T10:00:00.000Z' }],
  at: '2026-11-24T12:00:00.000Z',
};

describe('the master manifest, read', () => {
  it('says the plates with the trailer, the driver, the totals and the value', () => {
    const html = renderToString(<ManifestBody m={m} />);
    expect(html).toContain(t('common.aboard.platesWithTrailer', { truck: 'NL-12-AB', trailer: 'WT-99-ZZ' }));
    expect(html).toContain('Piet');
    expect(html).toContain(t('common.aboard.totals', { count: 2, kg: 812.3 }));
    expect(html).toContain('EUR');
  });

  it('puts what wants a look first, each flag in words, then every thing aboard with its codes', () => {
    const html = renderToString(<ManifestBody m={m} />);
    expect(html).toContain(t('common.aboard.flag.over500kg'));
    expect(html).toContain(t('common.aboard.flag.codeExpiring'));
    expect(html.indexOf(t('common.aboard.flag.over500kg'))).toBeLessThan(html.indexOf('Grachten Winkel'));
    expect(html).toContain('RO1234567890');
    expect(html).toContain(t('common.aboard.toCollect'));
  });

  it('lists the crossings its loads passed', () => {
    expect(renderToString(<ManifestBody m={m} />)).toContain('Nădlac');
    expect(renderToString(<ManifestBody m={{ ...m, crossings: [] }} />)).not.toContain(t('common.aboard.crossings'));
  });

  it('nothing aboard: says so', () => {
    expect(renderToString(<ManifestBody m={{ ...m, items: [], flagged: 0, totalValue: [], crossings: [] }} />)).toContain(t('common.aboard.none'));
  });

  it('closed, the sheet shows nothing and fetches nothing', () => {
    let asked = 0;
    const fetch = async () => (asked++, { data: m });
    expect(renderToString(<ManifestSheet open={false} onClose={() => undefined} fetchManifest={fetch} fetchCsv={fetch} />)).not.toContain('NL-12-AB');
    expect(asked).toBe(0);
  });
});
