import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { t } from '../../shared/i18n';
import { ExportPacking } from './screens/ExportPacking';
import { ExportSli } from './screens/ExportSli';
import { packingTotalsLine, type ExportDetail } from './exports';
import type { BusinessClient } from './api';

/*
 * THE PACKING LIST, FROM THE SHIPPER'S OWN FILE (the user, 2026-10-28: "a shipper doesn't want to import by hand"):
 * brought in by a file or pasted cells, never typed; signed by the exporter; read by its agent; and the letter's goods
 * shown as worked out from it.
 */
const view = (over: Partial<NonNullable<ExportDetail['packing']>> = {}): NonNullable<ExportDetail['packing']> => ({
  lineCount: 3,
  totals: { lines: 3, packages: 1700, grossKg: 7650, netKg: 0, volumeM3: 0 },
  preview: [
    { marks: '1-800', description: 'Fresh avocados, Hass', packages: 800, packageKind: 'cartons', grossKg: 3600, extra: { Batch: 'B-0911' } },
    { marks: '801-1600', description: 'Fresh avocados, Hass', packages: 800, packageKind: 'cartons', grossKg: 3600, extra: { Batch: 'B-0912' } },
    { marks: '1601-1700', description: 'Fresh avocados, Fuerte', packages: 100, packageKind: 'cartons', grossKg: 450, extra: { Batch: 'B-0913' } },
  ],
  extraColumns: ['Batch'],
  versions: [],
  importedAt: '2026-10-28T11:00:00.000Z',
  importedBy: 'Wanjiku Mwangi',
  sourceName: 'packing-TA-117.xlsx',
  unsigned: true,
  notes: [],
  ...over,
});
const detail = (packing?: ExportDetail['packing'], sli: Partial<ExportDetail['sli']> = {}): ExportDetail =>
  ({
    consignment: { exportId: 'exp_1', code: 'EXP-007', goodsDescription: 'Fresh avocados', loadingPort: 'Mombasa', booking: { reference: 'MBA4471', partyName: 'Pwani Forwarders' } },
    exporterName: 'Thika Avocados',
    ...(packing ? { packing } : {}),
    sli: { versions: [], gaps: [], stale: false, hazardous: false, fromPacking: false, ...sli },
  }) as unknown as ExportDetail;
const render = (d: ExportDetail, mine = true) => renderToString(<ExportPacking d={d} client={{} as BusinessClient} mine={mine} signatory="Wanjiku Mwangi" onDetail={() => undefined} />);

describe('the packing list on the export', () => {
  it('says its totals in one line', () => {
    expect(packingTotalsLine({ lines: 3, packages: 1700, grossKg: 7650, netKg: 7400.5, volumeM3: 58.25 }, { lines: 'lines', packages: 'packages', gross: 'gross', net: 'net', volume: 'cubic metres' })).toBe('3 lines · 1,700 packages · 7,650 kg gross · 7,400.5 kg net · 58.25 cubic metres');
  });

  it('asks the exporter for its own file, or its cells pasted — never a form to type every line', () => {
    const html = render(detail());
    expect(html).toContain(t('business.exports.packing.bring'));
    expect(html).toContain(t('business.exports.packing.upload'));
    expect(html).toContain(t('business.exports.packing.paste'));
    expect(html).toContain(t('business.exports.packing.ownSystem'));
  });

  it('once brought in: its totals, where it came from, its lines with the columns of its own, and signing it', () => {
    const html = render(detail(view()));
    expect(html).toContain('3 lines · 1,700 packages · 7,650 kg gross');
    expect(html).toContain('From packing-TA-117.xlsx, brought in by Wanjiku Mwangi');
    expect(html).toContain('Batch');
    expect(html).toContain('B-0913');
    expect(html).toContain(t('business.exports.packing.sign', { n: 1 }));
    expect(html).toContain(t('business.exports.packing.replace'));
    // Its weight against the box is said in the warning colour.
    expect(render(detail(view({ notes: ['The list’s gross weight is more than the box’s verified gross mass'] })))).toContain('<p class="cerr">The list’s gross weight is more than the box’s verified gross mass</p>');
  });

  it('offers its agent the signed versions only — no file, no signing', () => {
    const signed = view({ unsigned: false, versions: [{ version: 1, signedBy: 'Wanjiku Mwangi', signedAt: '2026-10-28T12:00:00.000Z', fingerprint: 'a'.repeat(64), lines: 3, packages: 1700 }] });
    const html = render(detail(signed), false);
    expect(html).toContain(t('business.exports.sli.version', { n: 1 }));
    expect(html).not.toContain(t('business.exports.packing.upload'));
    expect(html).not.toContain(t('business.exports.packing.sign', { n: 2 }));
    expect(render(detail(), false)).toContain(t('business.exports.packing.noneYet'));
  });
});

describe('the letter’s goods from the packing list', () => {
  it('shows the goods worked out from the list, and no lines to type', () => {
    const goods = [{ marks: '1-800 – 801-1600', packages: 1600, packageKind: 'cartons', description: 'Fresh avocados, Hass', hsCode: '080440', grossKg: 7200 }];
    const html = renderToString(<ExportSli d={detail(view(), { fromPacking: true, goods, gaps: ['The port of discharge'] })} client={{} as BusinessClient} mine signatory="Wanjiku Mwangi" onDetail={() => undefined} />);
    expect(html).toContain(t('business.exports.sli.goodsFromPacking'));
    expect(html).toContain('1,600 cartons · 7,200 kg gross · marks 1-800 – 801-1600 · HS 080440');
    expect(html).not.toContain(`<span class="cfield__label">${t('business.exports.sli.packages')}</span>`);
    expect(html).not.toContain(t('business.exports.sli.addLine'));
  });
});
