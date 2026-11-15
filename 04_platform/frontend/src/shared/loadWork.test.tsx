import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { t } from './i18n';
import {
  EMPTY_WORK,
  END_EQUIPMENT,
  HANDLING_MARKS,
  LOAD_NEEDS,
  SITE_HANDS,
  endWords,
  gapAt,
  namesExtraWork,
  workBlocker,
  workBody,
  type LoadWorkForm,
} from './loadWork';
import { LoadWorkFields } from './load-work/LoadWorkFields';
import { LoadWorkSummary } from './load-work/LoadWorkSummary';

/*
 * 2026-11-13 — UNUSUAL LOADS (plan U1–U4 as the owner revised them): the form sends only what was said, asks who helps at each
 * end, says early what the driver will bring, and names extra work for one negotiated price — by the server's own rules.
 */
const sofa: LoadWorkForm = {
  needs: 'two',
  pickup: { hands: 'none', equipment: [], theyDoIt: false, floor: '3', lift: false, carryM: '30', waitMin: '' },
  delivery: { hands: '', equipment: [], theyDoIt: true, floor: '', lift: false, carryM: '', waitMin: '' },
  marks: ['blankets', 'upright'],
};

describe('what it takes to move a load, on the forms', () => {
  it('names the same lists as the server', () => {
    const source = readFileSync('../backend/src/modules/pudo/load-work.types.ts', 'utf8');
    const list = (name: string) => source.match(new RegExp(`${name} = \\[([^\\]]+)\\]`))?.[1].match(/'([A-Za-z]+)'/g)?.map((s) => s.slice(1, -1));
    expect(list('SITE_HANDS')).toEqual([...SITE_HANDS]);
    expect(list('END_EQUIPMENT')).toEqual([...END_EQUIPMENT]);
    expect(list('LOAD_NEEDS')).toEqual([...LOAD_NEEDS]);
    expect(list('HANDLING_MARKS')).toEqual([...HANDLING_MARKS]);
  });

  it('sends nothing where nothing was said, and only what was said where it was', () => {
    expect(workBody(EMPTY_WORK)).toBeUndefined();
    expect(workBody(sofa)).toEqual({ needs: 'two', pickup: { hands: 'none', floor: 3, carryM: 30 }, delivery: { hands: 'none', theyDoIt: true }, marks: ['upright', 'blankets'] });
    // A lift on the ground floor says nothing.
    expect(workBody({ ...sofa, pickup: { ...sofa.pickup, floor: '', lift: true } })?.pickup).toEqual({ hands: 'none', carryM: 30 });
  });

  it('asks who helps at each end, unless the sender loads or the receiver unloads it', () => {
    expect(workBlocker(EMPTY_WORK)).toBeNull();
    expect(workBlocker({ ...sofa, pickup: { ...sofa.pickup, hands: '' } })).toBe('work.needHandsPickup');
    expect(workBlocker({ ...sofa, delivery: { ...sofa.delivery, theyDoIt: false } })).toBe('work.needHandsDelivery');
    expect(workBlocker(sofa)).toBeNull();
  });

  it('works out what the driver brings as the server does, and names extra work', () => {
    expect(gapAt('two', { hands: 'none' })).toEqual({ helpers: 1, tailLift: false, palletJack: false });
    expect(gapAt('machine', { hands: 'none', equipment: ['DOCK'] })).toEqual({ helpers: 0, tailLift: false, palletJack: true });
    expect(namesExtraWork(sofa)).toBe(true);
    const easy: LoadWorkForm = { ...EMPTY_WORK, needs: 'one', pickup: { ...EMPTY_WORK.pickup, hands: 'none' }, delivery: { ...EMPTY_WORK.delivery, hands: 'none' } };
    expect(namesExtraWork(easy)).toBe(false);
    expect(namesExtraWork({ ...easy, delivery: { ...easy.delivery, carryM: '40' } })).toBe(true);
    expect(endWords({ hands: 'none', floor: 3, carryM: 30 }, { helpers: 1, tailLift: false, palletJack: false }, 'pickup', t)).toBe('nobody to help · floor 3, no lift · carried 30 m · you bring a helper');
    expect(endWords({ hands: 'none', theyDoIt: true }, { helpers: 0, tailLift: false, palletJack: false }, 'delivery', t, false)).toBe('the receiver unloads it');
  });

  it('draws the form: each end, what the driver brings, and that it is one negotiated price', () => {
    const html = renderToString(<LoadWorkFields value={sofa} onChange={() => undefined} />);
    expect(html).toContain('At the pickup');
    expect(html).toContain('The driver brings: a helper');
    expect(html).toContain('The driver brings nothing extra here');
    expect(html).toContain('drivers name one price for the whole job');
    // Nothing chosen: only what it takes and the marks are asked.
    expect(renderToString(<LoadWorkFields value={EMPTY_WORK} onChange={() => undefined} />)).not.toContain('At the pickup');
    // In the console: ticks, not chips.
    expect(renderToString(<LoadWorkFields look="console" value={sofa} onChange={() => undefined} />)).toContain('cfield--check');
  });

  it('reads the work back to the driver, and to the poster', () => {
    const view = { needs: 'two' as const, pickup: { hands: 'none' as const, floor: 3 }, delivery: { hands: 'none' as const, theyDoIt: true }, gaps: { pickup: { helpers: 1, tailLift: false, palletJack: false }, delivery: { helpers: 0, tailLift: false, palletJack: false } }, extras: [{ end: 'pickup' as const, kind: 'helper' as const, n: 1 }], marks: ['upright' as const] };
    const driver = renderToString(<LoadWorkSummary work={view} />);
    expect(driver).toContain('Two people carry it.');
    expect(driver).toContain('you bring a helper');
    expect(driver).toContain('Keep upright');
    expect(renderToString(<LoadWorkSummary work={view} forDriver={false} />)).toContain('the driver brings a helper');
    expect(renderToString(<LoadWorkSummary work={undefined} />)).toBe('');
  });
});
