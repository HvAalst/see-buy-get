import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { t } from '../../shared/i18n';
import { ExportSli } from './screens/ExportSli';
import { sliBody, sliForm, type ExportDetail, type SliDraft } from './exports';
import type { BusinessClient } from './api';

/*
 * THE SHIPPER'S LETTER OF INSTRUCTION (the user, 2026-10-28: "not just take the reference, but rather the form fields";
 * then: a form, needed, frozen on signing). The form round-trips what was saved, sends nothing empty, and is offered to
 * the exporter alone; its agent and staff read the signed versions.
 */
const draft: SliDraft = {
  consigneeKind: 'named',
  consignee: { name: 'Van Rees Tea BV', address: 'Rotterdam' },
  notifySameAsConsignee: true,
  dischargePort: 'Rotterdam',
  incoterm: 'FOB',
  incotermPlace: 'Mombasa',
  freight: 'collect',
  blRelease: 'originals',
  originals: 3,
  lines: [{ packages: 640, packageKind: 'bags', description: 'Black tea', grossKg: 18400, hsCode: '090240' }],
  savedAt: '2026-10-28T10:00:00.000Z',
  savedBy: 'Wanjiku',
};

describe('the letter’s form', () => {
  it('starts a fresh form from what the export says is in it, with three originals', () => {
    const f = sliForm(undefined, 'Black tea, 640 bags');
    expect(f.lines).toEqual([expect.objectContaining({ description: 'Black tea, 640 bags', packages: '' })]);
    expect(f.originals).toBe('3');
    expect(f.consigneeKind).toBe('named');
  });

  it('round-trips what was saved, and sends no empty field and no empty goods line', () => {
    const f = sliForm(draft, 'ignored');
    const body = sliBody({ ...f, lines: [...f.lines, { marks: '', packages: '', packageKind: '', description: '', hsCode: '', grossKg: '', netKg: '', volumeM3: '' }] });
    expect(body).toEqual({
      consigneeKind: 'named',
      consignee: { name: 'Van Rees Tea BV', address: 'Rotterdam' },
      notifySameAsConsignee: true,
      dischargePort: 'Rotterdam',
      incoterm: 'FOB',
      incotermPlace: 'Mombasa',
      freight: 'collect',
      blRelease: 'originals',
      originals: 3,
      lines: [{ packages: 640, packageKind: 'bags', description: 'Black tea', hsCode: '090240', grossKg: 18400 }],
    });
  });

  it('sends a bank only for a bill to its order, and a notify party only where one is needed', () => {
    const f = sliForm(draft, '');
    const toBank = sliBody({ ...f, consigneeKind: 'to_order_of_bank', orderOfBank: 'Equity Bank', notifySame: true, notify: { name: 'Van Rees', address: 'Rotterdam', contact: '' } });
    expect(toBank).toMatchObject({ consigneeKind: 'to_order_of_bank', orderOfBank: 'Equity Bank', notify: { name: 'Van Rees', address: 'Rotterdam' } });
    expect(toBank).not.toHaveProperty('consignee');
    expect(toBank).not.toHaveProperty('notifySameAsConsignee');
  });
});

const detail = (sli: Partial<ExportDetail['sli']> = {}): ExportDetail =>
  ({
    consignment: { exportId: 'exp_1', code: 'EXP-007', goodsDescription: 'Black tea', loadingPort: 'Mombasa', booking: { reference: 'MBA4471', partyName: 'Pwani Forwarders' } },
    exporterName: 'Kericho Tea',
    sli: { versions: [], gaps: ['Fill in the form'], stale: false, hazardous: false, fromPacking: false, ...sli },
  }) as unknown as ExportDetail;
const render = (d: ExportDetail, mine = true) => renderToString(<ExportSli d={d} client={{} as BusinessClient} mine={mine} signatory="Wanjiku Mwangi" onDetail={() => undefined} />);
const field = (key: Parameters<typeof t>[0]) => `<span class="cfield__label">${t(key)}</span>`;
const signed = [{ version: 1, signedBy: 'Wanjiku Mwangi', signedAt: '2026-10-28T10:00:00.000Z', fingerprint: 'a'.repeat(64) }];

describe('the letter on the export, from each side', () => {
  it('offers the exporter the form until it is signed, says what signing needs, and signs as version 1', () => {
    const html = render(detail());
    for (const k of ['business.exports.sli.consigneeKind', 'business.exports.sli.dischargePort', 'business.exports.sli.release', 'business.exports.sli.hsCode', 'business.exports.sli.signatory'] as const) expect(html).toContain(field(k));
    expect(html).toContain(t('business.exports.sli.sign', { n: 1 }));
    expect(html).toContain('Before it can be signed: Fill in the form.');
    expect(html).toContain('Pwani Forwarders');
    // Every choice in the console's own picker, never the phone's popup.
    expect(html).not.toContain('<select');
    expect(html).toContain('cselect__btn');
    // The trade term said in full beside its letters, on the button once chosen.
    expect(render(detail({ draft }))).toContain('<span class="cselect__val">FOB — Free On Board</span>');
    expect(html).not.toContain(field('business.exports.sli.unNumber'));
  });

  it('asks for the dangerous goods’ particulars when the goods are hazardous', () => {
    expect(render(detail({ hazardous: true }))).toContain(field('business.exports.sli.unNumber'));
  });

  it('once signed, lists the versions and keeps the form behind “Change the letter”; out of date is said', () => {
    const html = render(detail({ versions: signed, gaps: [], draft }));
    expect(html).toContain(t('business.exports.sli.version', { n: 1 }));
    expect(html).toContain(t('business.exports.sli.current'));
    expect(html).toContain(t('business.exports.sli.change'));
    expect(html).not.toContain(field('business.exports.sli.dischargePort'));
    expect(render(detail({ versions: signed, stale: true }))).toContain(t('business.exports.sli.stale', { n: 1 }));
  });

  it('offers its agent and staff the signed versions only — no form, no signing', () => {
    const none = render(detail(), false);
    expect(none).toContain(t('business.exports.sli.noneYet'));
    expect(none).not.toContain(field('business.exports.sli.dischargePort'));
    const read = render(detail({ versions: signed }), false);
    expect(read).toContain(t('business.exports.sli.version', { n: 1 }));
    expect(read).not.toContain(t('business.exports.sli.change'));
    expect(read).not.toContain(t('business.exports.sli.sign', { n: 2 }));
  });
});
