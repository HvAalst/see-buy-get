import { buildSiteTools, scaleCounts, scaleStanding, siteLimits, stampNotice, BY_HAND_KG } from './site-tools';
import { MAX_PARCEL_KG } from './pudo.config';

/**
 * 2026-11-13 — THE TOOLS A SHOP OR A HUB HAS (the owner: "shop and hub tools", plan T1–T5, "build as recommended"): what it may
 * say, what a scale that counts is, what it may take, and what it is told about a scale's stamp.
 */
describe('a shop’s or hub’s tools', () => {
  const NOW = Date.parse('2026-11-13T10:00:00Z');
  const ctx = (over: Partial<Parameters<typeof buildSiteTools>[1]> = {}) => ({ country: 'NL', by: 'Mama Pendo', now: NOW, adoptCertificate: () => true, ...over });

  it('keeps the equipment it says (by hand first), its scale, printer and CCTV, with who said it and what changed', () => {
    const made = buildSiteTools({ equipment: ['HTR', 'RMP'], scale: { maxKg: 30, approved: true }, labelPrinter: true, cctv: false }, ctx());
    expect(made.equipment).toEqual(['MAN', 'HTR', 'RMP']);
    expect(made.tools).toMatchObject({ scale: { maxKg: 30, approved: true }, labelPrinter: true, cctv: false, setBy: 'Mama Pendo' });
    expect(made.tools.history[0].said).toBe('a sack barrow added; a ramp or loading dock added; scale up to 30 kg, approved; label printer added');
    // Saying it again changes nothing, so nothing new is kept; taking a piece off is kept.
    const again = buildSiteTools({ equipment: ['HTR', 'RMP'], scale: { maxKg: 30, approved: true }, labelPrinter: true, cctv: false }, ctx({ before: made.tools, beforeEquipment: made.equipment }));
    expect(again.tools.history).toHaveLength(1);
    const less = buildSiteTools({ equipment: ['HTR'], scale: null, labelPrinter: true, cctv: true }, ctx({ before: again.tools, beforeEquipment: again.equipment }));
    expect(less.tools.history[0].said).toBe('a ramp or loading dock taken off; scale none; cameras added');
    expect(less.tools.scale).toBeUndefined();
  });

  it('refuses a piece no shop or hub says, a forklift without its operator’s licence, and a scale of nothing', () => {
    expect(() => buildSiteTools({ equipment: ['CRN'], labelPrinter: false, cctv: false }, ctx())).toThrow(/not CRN/);
    expect(() => buildSiteTools({ equipment: ['FLT'], labelPrinter: false, cctv: false }, ctx())).toThrow(/operator’s licence/);
    expect(buildSiteTools({ equipment: ['FLT'], labelPrinter: false, cctv: false, forkliftLicence: ' G-12345 ' }, ctx()).tools.forkliftLicence).toBe('G-12345');
    expect(() => buildSiteTools({ equipment: [], scale: { maxKg: 0, approved: false }, labelPrinter: false, cctv: false }, ctx())).toThrow(/more than nothing/);
  });

  it('in Kenya an approved scale is a stamped one: the day the stamp runs to, in date, and the certificate’s photo, taken as the site’s own', () => {
    const ke = (scale: Record<string, unknown>, adopt = true) => buildSiteTools({ equipment: [], scale: { maxKg: 50, approved: true, ...scale } as never, labelPrinter: false, cctv: false }, ctx({ country: 'KE', adoptCertificate: () => adopt }));
    expect(() => ke({})).toThrow(/the day the inspector’s stamp runs to/);
    expect(() => ke({ stampedUntil: '2026-11-01', certificateRef: 'med_1' })).toThrow(/That stamp has run out/);
    expect(() => ke({ stampedUntil: '2027-03-31' })).toThrow(/photo of the stamp certificate/);
    expect(() => ke({ stampedUntil: '2027-03-31', certificateRef: 'med_theirs' }, false)).toThrow(/photo of the stamp certificate/);
    expect(ke({ stampedUntil: '2027-03-31', certificateRef: 'med_1' }).tools.scale).toEqual({ maxKg: 50, approved: true, stampedUntil: '2027-03-31', certificateRef: 'med_1' });
    // Not approved: a guide, nothing asked.
    expect(ke({ approved: false }).tools.scale).toEqual({ maxKg: 50, approved: false });
  });

  it('a scale counts where it is approved — in Kenya while its stamp is in date; told thirty days ahead and on the day', () => {
    const tools = (scale?: Record<string, unknown>) => (scale ? ({ scale, labelPrinter: false, cctv: false, setBy: 'x', setAt: '', history: [] } as never) : undefined);
    expect(scaleStanding(tools(), 'KE', NOW).state).toBe('none');
    expect(scaleStanding(tools({ maxKg: 30, approved: false }), 'NL', NOW).state).toBe('not_approved');
    expect(scaleStanding(tools({ maxKg: 30, approved: true }), 'NL', NOW).state).toBe('ok');
    expect(scaleStanding(tools({ maxKg: 30, approved: true }), 'KE', NOW).state).toBe('not_approved');
    expect(scaleStanding(tools({ maxKg: 30, approved: true, stampedUntil: '2027-06-30', certificateRef: 'm' }), 'KE', NOW).state).toBe('ok');
    const due = scaleStanding(tools({ maxKg: 30, approved: true, stampedUntil: '2026-11-30', certificateRef: 'm' }), 'KE', NOW);
    expect(due).toMatchObject({ state: 'due', daysLeft: 18 });
    expect(scaleCounts(tools({ maxKg: 30, approved: true, stampedUntil: '2026-11-30', certificateRef: 'm' }), 'KE', NOW)).toBe(true);
    const lapsed = scaleStanding(tools({ maxKg: 30, approved: true, stampedUntil: '2026-11-12', certificateRef: 'm' }), 'KE', NOW);
    expect(lapsed.state).toBe('lapsed');
    expect(scaleCounts(tools({ maxKg: 30, approved: true, stampedUntil: '2026-11-12', certificateRef: 'm' }), 'KE', NOW)).toBe(false);
    expect(stampNotice(due).title).toBe('Your scale’s stamp runs out in 18 days');
    expect(stampNotice(lapsed).body).toMatch(/the weights you take are the sender’s word, not a price/);
  });

  it('what a site may take: by hand alone 23 kg; with a sack barrow the network’s cap; a smaller scale lowers it; pallets with a jack and a ramp, or a forklift', () => {
    expect(siteLimits(['MAN'], undefined, 'KE', NOW)).toMatchObject({ maxKg: BY_HAND_KG, by: 'hands', pallets: false, weighs: false, printsLabels: false });
    expect(siteLimits(['MAN', 'HTR'], undefined, 'KE', NOW)).toMatchObject({ maxKg: MAX_PARCEL_KG, by: 'network' });
    const small = { scale: { maxKg: 15, approved: true }, labelPrinter: true, cctv: false, setBy: 'x', setAt: '', history: [] };
    expect(siteLimits(['MAN', 'HTR'], small, 'NL', NOW)).toMatchObject({ maxKg: 15, by: 'scale', weighs: true, printsLabels: true });
    expect(siteLimits(['MAN', 'PLT'], undefined, 'NL', NOW).pallets).toBe(false);
    expect(siteLimits(['MAN', 'PLT', 'RMP'], undefined, 'NL', NOW).pallets).toBe(true);
    expect(siteLimits(['MAN', 'FLT'], undefined, 'NL', NOW).pallets).toBe(true);
    expect(siteLimits(undefined, undefined, 'NL', NOW).maxKg).toBe(BY_HAND_KG);
  });
});
