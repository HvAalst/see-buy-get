import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { t } from '../../shared/i18n';
import { ExportPanel } from './screens/ExportsScreen';
import { boxLine, boxTag, type ExportBoxClock, type ExportDetail } from './exports';
import { sectionsFor } from './logic';
import type { BusinessClient, BusinessView } from './api';

/*
 * THE BOX'S CLOCK AND THE CLEARING AGENT ON AN EXPORT (the user, 2026-10-28: "1 and 2 are clear addition to what you built
 * here"). The clock is said in days, to a date only where the exporter gave the free days; the panel offers the exporter
 * its writing and its agent only its word on the papers.
 */
const box = (over: Partial<ExportBoxClock> = {}): ExportBoxClock => ({ kind: 'unknown', overdue: false, dueSoon: false, basis: '', ...over });

const detail = (over: Partial<ExportDetail> = {}, consignment: Partial<ExportDetail['consignment']> = {}): ExportDetail =>
  ({
    consignment: {
      exportId: 'exp_1',
      code: 'EXP-007',
      goodsDescription: 'Green coffee, 320 bags',
      originCountry: 'KE',
      destCountry: 'DE',
      loadingPort: 'Mombasa',
      containerType: '22G1',
      booking: { reference: 'MBA4471', bookedWith: 'forwarder', partyName: 'Pwani Forwarders', gateCutoffAt: '2026-11-04T18:00:00.000Z' },
      loadingPlace: { label: 'Thika warehouse', location: { lat: -1, lng: 37 } },
      terminal: { label: 'Kipevu container terminal', location: { lat: -4, lng: 39.6 } },
      createdAt: '2026-10-28T08:00:00.000Z',
      ...consignment,
    },
    timing: { state: 'on_time', leaveByAt: '2026-11-04T06:00:00.000Z', roadKm: 480, plannedHours: 12 },
    seals: [],
    papers: [
      { key: 'commercial_invoice', label: 'Commercial invoice', documentId: 'doc_1', documentTitle: 'Invoice 117' },
      { key: 'packing_list', label: 'Packing list', reference: 'PL-117', refusedAt: '2026-10-28T10:00:00.000Z', refusedBy: 'Juma', refusedReason: 'The weights do not match the invoice' },
      { key: 'certificate_of_origin', label: 'Certificate of origin', optional: true },
      { key: 'export_entry', label: 'Export entry' },
    ],
    missing: [],
    documents: [],
    box: box(),
    you: 'exporter',
    exporterName: 'Thika Coffee',
    feeState: 'none',
    ...over,
  }) as ExportDetail;

const business = { entityId: 'ent_x', activities: ['shipper'], you: { role: 'owner', name: 'Wanjiku' } } as unknown as BusinessView;
/** A field the reader may write in, by its label — not a fact that shares its words. */
const field = (key: Parameters<typeof t>[0]) => `<span class="cfield__label">${t(key)}</span>`;
const render = (d: ExportDetail, works = true) => renderToString(<ExportPanel exportId="exp_1" business={business} client={{} as BusinessClient} works={works} onChanged={() => undefined} initial={d} />);

describe('the box’s clock on an export, in one line', () => {
  it('runs nothing before the empty is out, and counts to no date it was not given', () => {
    expect(boxLine(box(), t).text).toBe(t('business.exports.clock.unknown'));
    const noClaim = boxLine(box({ kind: 'detention', since: '2026-10-25T08:00:00.000Z', daysElapsed: 3 }), t);
    expect(noClaim).toEqual({ tone: 'info', text: 'Outside the terminal (detention) since 25 Oct 2026: 3 days. Say how many free days the line gives, to count to a date.' });
  });

  it('counts to the date from whose figure it is — and warns near it and past it', () => {
    const running = boxLine(box({ kind: 'detention', since: '2026-10-25T08:00:00.000Z', daysElapsed: 5, freeDays: 7, freeDaysBy: 'Wanjiku', dueAt: '2026-11-01T08:00:00.000Z', daysLeft: 2, dueSoon: true }), t);
    expect(running).toEqual({ tone: 'warn', text: 'Outside the terminal (detention) since 25 Oct 2026: day 5 of the 7 free days Wanjiku gave. It must be inside the gate by 1 Nov 2026.' });
    const inside = boxLine(box({ kind: 'demurrage', since: '2026-11-01T08:00:00.000Z', daysElapsed: 1, freeDays: 4, freeDaysBy: 'Wanjiku', dueAt: '2026-11-05T08:00:00.000Z', daysLeft: 3 }), t);
    expect(inside.text).toContain('It must be loaded on board by 5 Nov 2026.');
    const over = boxLine(box({ kind: 'demurrage', since: '2026-11-01T08:00:00.000Z', freeDays: 4, dueAt: '2026-11-05T08:00:00.000Z', daysLeft: -2, overdue: true }), t);
    expect(over).toEqual({ tone: 'warn', text: expect.stringContaining('ran out on 5 Nov 2026, 2 days ago') });
    expect(boxLine(box({ kind: 'stopped', detentionDays: 4, demurrageDays: 1 }), t).text).toBe('Loaded on board: the box’s clock has stopped. It was 4 days outside the terminal and 1 day inside.');
    // Nothing in money, anywhere in the line.
    for (const text of [running.text, inside.text, over.text]) expect(text).not.toMatch(/KES|USD|\$|€|cost/);
  });

  it('tags the list only when the free days ask for something', () => {
    expect(boxTag(box({ kind: 'detention', freeDays: 7, daysLeft: 5 }), t)).toBeNull();
    expect(boxTag(box({ kind: 'detention', freeDays: 7, daysLeft: 2, dueSoon: true }), t)).toEqual({ tone: 'warn', word: 'Free days end in 2 days' });
    expect(boxTag(box({ kind: 'demurrage', freeDays: 3, daysLeft: -1, overdue: true }), t)).toEqual({ tone: 'warn', word: 'Free days ran out' });
    expect(boxTag(box({ kind: 'stopped' }), t)).toBeNull();
  });

  it('gives a clearing agent the Exports section, to read the exports it was appointed on', () => {
    expect(sectionsFor(['clearing_agent'])).toContain('exports');
    expect(sectionsFor(['receiver'])).not.toContain('exports');
  });
});

describe('the export panel, from each side', () => {
  it('offers the exporter its writing: the free days, the empty out, and choosing an agent', () => {
    const html = render(detail());
    expect(html).toContain(field('business.exports.clock.freeOutsideLabel'));
    expect(html).toContain(field('business.exports.clock.emptyOutLabel'));
    expect(html).toContain(t('business.exports.agent.choose'));
    expect(html).toContain(t('business.exports.agent.none'));
    // Its agent's word stands on its papers, with the reason; it gives no word itself.
    expect(html).toContain('Sent back by Juma: The weights do not match the invoice');
    expect(html).toContain(`<span class="ctag ctag--warn">${t('business.exports.papers.sentBack')}</span>`);
    expect(html).not.toContain(`>${t('business.exports.papers.accept')}<`);
  });

  it('once an agent is appointed, says who and offers to end it — not a second appointment', () => {
    const html = render(detail({ agent: { entityId: 'ent_a', name: 'Pwani Clearing', appointedAt: '2026-10-28T09:00:00.000Z', appointedBy: 'Wanjiku' } }));
    expect(html).toContain('Pwani Clearing is appointed, since 28 Oct 2026 (by Wanjiku)');
    expect(html).toContain(t('business.exports.agent.end'));
    expect(html).not.toContain(t('business.exports.agent.choose'));
  });

  it('offers the agent only its word: open, accept, send back, and the entry — none of the exporter’s writing', () => {
    const html = render(detail({ you: 'agent', agent: { entityId: 'ent_a', name: 'Pwani Clearing', appointedAt: '2026-10-28T09:00:00.000Z', appointedBy: 'Wanjiku' } }));
    expect(html).toContain('Thika Coffee appointed you as its clearing agent on 28 Oct 2026');
    expect(html).toContain(t('business.exports.papers.open'));
    expect(html).toContain(t('business.exports.papers.accept'));
    expect(html).toContain(t('business.exports.papers.sendBackStart'));
    expect(html).toContain(t('business.exports.papers.giveEntry'));
    expect(html).not.toContain(field('business.exports.clock.freeOutsideLabel'));
    expect(html).not.toContain(field('business.exports.clock.emptyOutLabel'));
    for (const theirs of ['business.exports.agent.choose', 'business.exports.agent.end', 'business.exports.box.save', 'business.exports.vgm.save', 'business.exports.laden.post'] as const) expect(html).not.toContain(t(theirs));
  });

  it('offers staff nothing to write', () => {
    const html = render(detail({ you: 'staff' }));
    expect(html).not.toContain(field('business.exports.clock.freeOutsideLabel'));
    for (const write of ['business.exports.agent.choose', 'business.exports.papers.giveEntry'] as const) expect(html).not.toContain(t(write));
    expect(html).not.toContain(`>${t('business.exports.papers.accept')}<`);
  });
});

/*
 * A BOX THE EXPORTER OWNS, AND THE AGENT'S FEE (the user, 2026-10-28: "ok, great, implement it"). No line's clock on an
 * own box; the fee is a quotation the agent sends and the exporter agrees to — nothing paid through us.
 */
const appointed = { entityId: 'ent_a', name: 'Pwani Clearing', appointedAt: '2026-10-28T09:00:00.000Z', appointedBy: 'Wanjiku' };
const quote = (over: Record<string, unknown> = {}) =>
  ({
    quoteId: 'quo_1',
    subject: { kind: 'export', id: 'exp_1@2026-10-28T09:00:00.000Z', code: 'EXP-007' },
    issuer: { name: 'Pwani Clearing', entityId: 'ent_a' },
    payer: { name: 'Thika Coffee', entityId: 'ent_x' },
    amount: 18000,
    currency: 'KES',
    status: 'open',
    history: [{ at: '2026-10-28T10:00:00.000Z', by: 'Juma', what: 'quoted' }],
    createdAt: '2026-10-28T10:00:00.000Z',
    createdBy: 'Juma',
    ...over,
  }) as unknown as ExportDetail['fee'];

describe('a box the exporter owns', () => {
  it('says no clock counts, asks for no free days, and offers to say it is the line’s after all', () => {
    expect(boxLine(box({ kind: 'owned' }), t)).toEqual({ tone: 'info', text: t('business.exports.clock.owned') });
    expect(boxTag(box({ kind: 'owned' }), t)).toBeNull();
    const html = render(detail({ box: box({ kind: 'owned' }) }, { ownBox: { by: 'Wanjiku', at: '2026-10-28T08:00:00.000Z' } }));
    expect(html).toContain(t('business.exports.clock.ownerYours'));
    expect(html).toContain(t('business.exports.clock.lineBox'));
    expect(html).not.toContain(field('business.exports.clock.freeOutsideLabel'));
    expect(html).not.toContain(t('business.exports.clock.freeOutside'));
    expect(html).not.toContain(field('business.exports.clock.emptyOutLabel'));
    // A line's box offers the other way round.
    expect(render(detail())).toContain(`>${t('business.exports.clock.ownBox')}<`);
  });
});

describe('the agent’s fee, from each side', () => {
  it('before a quotation: the exporter waits for it, the agent is asked for it', () => {
    expect(render(detail({ agent: appointed }))).toContain(t('business.exports.fee.none', { name: 'Pwani Clearing' }));
    const agent = render(detail({ you: 'agent', agent: appointed }));
    expect(agent).toContain(field('business.exports.fee.amount'));
    expect(agent).toContain(t('business.exports.fee.send'));
  });

  it('quoted: the exporter can agree, and reads the quotation; the agent can change the figure, not agree', () => {
    const exporter = render(detail({ agent: appointed, fee: quote(), feeState: 'quoted' }));
    expect(exporter).toContain(t('business.exports.fee.agree'));
    expect(exporter).toContain('18,000 KES');
    expect(exporter).not.toContain(field('business.exports.fee.amount'));
    const agent = render(detail({ you: 'agent', agent: appointed, fee: quote(), feeState: 'quoted' }));
    expect(agent).toContain(t('business.exports.fee.change'));
    expect(agent).not.toContain(t('business.exports.fee.agree'));
  });

  it('agreed or paid: says who agreed, offers no second agreement and no new figure once paid', () => {
    const agreed = render(detail({ agent: appointed, fee: quote({ agreedAt: '2026-10-28T11:00:00.000Z', agreedBy: 'Wanjiku' }), feeState: 'accepted' }));
    expect(agreed).toContain('Agreed by Wanjiku on 28 Oct 2026.');
    expect(agreed).not.toContain(t('business.exports.fee.agree'));
    const paid = render(detail({ you: 'agent', agent: appointed, fee: quote({ status: 'paid', paidBy: 'Wanjiku', paidAt: '2026-10-29T08:00:00.000Z' }), feeState: 'paid' }));
    expect(paid).not.toContain(t('business.exports.fee.change'));
    expect(paid).not.toContain(field('business.exports.fee.amount'));
  });

  it('offers staff neither the agreement nor a figure', () => {
    const html = render(detail({ you: 'staff', agent: appointed, fee: quote(), feeState: 'quoted' }));
    expect(html).not.toContain(t('business.exports.fee.agree'));
    expect(html).not.toContain(t('business.exports.fee.change'));
    expect(html).toContain('18,000 KES');
  });
});
