import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { t } from '../../shared/i18n';
import { offPlanStepWords, stepsOffPlan, type OffPlanStepView, type ParcelWay } from './parcelWay';
import { WayPanel } from './screens/WayPanel';

const step = (over: Partial<OffPlanStepView> = {}): OffPlanStepView => ({ at: '2026-11-06T09:00:00.000Z', kind: 'decision', where: 'Kilima Shop', planned: 'North Sort', took: 'SouthTown', reason: 'no_transport', by: 'Kilima Shop', ...over });

const way = (over: Partial<ParcelWay> = {}): ParcelWay => ({
  stops: [
    { label: 'Kilima Shop', kind: 'shop', state: 'passed' },
    { label: 'North Sort', kind: 'hub', state: 'here' },
    { label: 'Amos Shop', kind: 'shop', state: 'next' },
  ],
  promisedAt: '2026-11-07T09:00:00.000Z',
  offPlan: [],
  ...over,
});

/** 2026-11-06 — a parcel's way, as the console's Support screen reads it (movement unification). */
describe('a parcel’s way, as staff read it', () => {
  it('says each step off its plan in words: where it was, what its plan said, where it went — and who did not choose it', () => {
    expect(offPlanStepWords(step(), t)).toBe('At Kilima Shop: its plan said North Sort, it went to SouthTown');
    expect(offPlanStepWords(step({ kind: 'arrival', took: 'Far Shop' }), t)).toBe('It arrived at Far Shop; its plan said North Sort');
    expect(offPlanStepWords(step({ kind: 'system', took: 'South Sort', reason: 'room' }), t)).toBe('The network sent it to South Sort; its plan said North Sort');
    expect(offPlanStepWords(step({ kind: 'arrival', planned: undefined, took: 'Far Shop' }), t)).toBe('It arrived at Far Shop, not a stop of its plan');
    expect(offPlanStepWords(step({ kind: 'system', reason: 'priced_other_way', planned: undefined, took: 'Kilima Shop → North Sort → Amos Shop' }), t)).toBe('Planned Kilima Shop → North Sort → Amos Shop; priced on another way — the price stands');
  });

  it('counts the steps it took off its plan — a price made on another route is said, and is not one', () => {
    expect(stepsOffPlan(way({ offPlan: [step(), step({ reason: 'priced_other_way', kind: 'system' })] }))).toBe(1);
    expect(stepsOffPlan(way())).toBe(0);
  });

  it('shows its stops, where it is now and what is next, and each step off its plan with why and by whom', () => {
    const words = (html: string) => html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&');
    const text = words(renderToString(<WayPanel way={way({ offPlan: [step({ note: 'the bus broke down' })] })} />));
    expect(text).toContain('Its way');
    expect(text).toContain('1 step off its plan');
    expect(text).toMatch(/Kilima Shop→North Sorthere now→Amos Shopnext/);
    expect(text).toContain('At Kilima Shop: its plan said North Sort, it went to SouthTown');
    expect(text).toContain('no bus or driver its way');
    expect(text).toContain('by Kilima Shop');
    expect(text).toContain('“the bus broke down”');
    expect(words(renderToString(<WayPanel way={way()} />))).toContain('Kept to its plan');
  });
});
