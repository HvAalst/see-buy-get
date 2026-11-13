import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { addEnglish, t } from './i18n';
import { enSiteTools } from './i18n/catalogs/en.site-tools';
import { limitsLines, stampLine, toolsBody, toolsForm, type SiteToolsView } from './siteTools';
import { SiteToolsSheet } from './site-tools/SiteToolsSheet';

addEnglish(enSiteTools);

/*
 * 2026-11-13 — A SHOP'S OR A HUB'S TOOLS (the owner: "shop and hub tools"): the form sends only what it says, asks a stamping
 * country for the stamp, and says what the tools let it take.
 */
const VIEW: SiteToolsView = {
  equipment: ['HTR'],
  tools: { scale: { maxKg: 25, approved: true, stampedUntil: '2027-03-31', certificateRef: 'med_1' }, labelPrinter: true, cctv: false, setBy: 'Mama Pendo', setAt: '2026-11-13T10:00:00Z', history: [{ at: '2026-11-13T10:00:00Z', by: 'Mama Pendo', said: 'a sack barrow added' }] },
  limits: { maxKg: 25, by: 'scale', pallets: false, weighs: true, printsLabels: true },
  stamp: { state: 'ok', stampedUntil: '2027-03-31', daysLeft: 138 },
  stampCountry: true,
};

describe('a site’s tools', () => {
  it('fills the form from what it said, and sends it back as said', () => {
    const f = toolsForm(VIEW);
    expect(f).toMatchObject({ equipment: ['HTR'], hasScale: true, scaleMaxKg: '25', approved: true, stampedUntil: '2027-03-31', certificateRef: 'med_1', labelPrinter: true, cctv: false });
    expect(toolsBody(f, true)).toEqual({ body: { equipment: ['HTR'], scale: { maxKg: 25, approved: true, stampedUntil: '2027-03-31', certificateRef: 'med_1' }, labelPrinter: true, cctv: false } });
    // Outside a stamping country the stamp is not sent; no scale is null.
    expect(toolsBody(f, false)).toEqual({ body: { equipment: ['HTR'], scale: { maxKg: 25, approved: true }, labelPrinter: true, cctv: false } });
    expect(toolsBody({ ...f, hasScale: false }, true)).toMatchObject({ body: { scale: null } });
  });

  it('asks what is missing first: a forklift’s licence, a scale’s maximum, a stamp and its certificate', () => {
    const f = toolsForm(null);
    expect(toolsBody({ ...f, equipment: ['FLT'] }, false)).toEqual({ error: 'tools.errLicence' });
    expect(toolsBody({ ...f, equipment: ['FLT'], forkliftLicence: ' G-1 ' }, false)).toMatchObject({ body: { forkliftLicence: 'G-1' } });
    expect(toolsBody({ ...f, hasScale: true, scaleMaxKg: '' }, false)).toEqual({ error: 'tools.errMax' });
    expect(toolsBody({ ...f, hasScale: true, scaleMaxKg: '30', approved: true }, true)).toEqual({ error: 'tools.errStamp' });
    expect(toolsBody({ ...f, hasScale: true, scaleMaxKg: '7,5', approved: false }, true)).toMatchObject({ body: { scale: { maxKg: 7.5, approved: false } } });
  });

  it('says what the tools let it take, and a stamp running out', () => {
    expect(limitsLines({ maxKg: 23, by: 'hands', pallets: false, weighs: false, printsLabels: false }, t)).toEqual([t('tools.limitHands', { kg: '23', max: 30 }), t('tools.noPallets'), t('tools.guide')]);
    expect(limitsLines(VIEW.limits, t)[0]).toBe(t('tools.limitScale', { kg: '25' }));
    expect(stampLine({ state: 'due', daysLeft: 1, stampedUntil: '2026-11-14' }, t, (d) => d)).toBe('Your scale’s stamp runs out in 1 day: record the new date once it is stamped.');
    expect(stampLine({ state: 'lapsed', stampedUntil: '2026-11-12' }, t, (d) => d)).toContain('2026-11-12');
    expect(stampLine(VIEW.stamp, t, (d) => d)).toBeNull();
  });

  it('the sheet offers the four handling tools and the scale, printer and CCTV', () => {
    const html = renderToString(<SiteToolsSheet open onClose={() => undefined} load={async () => ({ data: VIEW })} save={async () => ({ data: VIEW })} upload={async () => null} />);
    for (const k of ['tools.htr', 'tools.plt', 'tools.flt', 'tools.rmp', 'tools.scale', 'tools.printer', 'tools.cctv'] as const) expect(html).toContain(t(k));
    expect(renderToString(<SiteToolsSheet open={false} onClose={() => undefined} load={async () => ({})} save={async () => ({})} upload={async () => null} />)).toBe('');
  });

});
