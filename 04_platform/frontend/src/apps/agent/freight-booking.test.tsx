import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { t } from '../../shared/i18n';
import { EMPTY_ACCEPT, FREIGHT_STEPS, bookFreightMissing, freightStepMissing, type AcceptForm, type FreightStep } from './logic';
import { FreightBooking } from './screens/FreightBooking';

/*
 * 2026-11-03 — THE COUNTER'S FREIGHT BOOKING, ONE PART PER SCREEN. The owner, of the Business app's "post a new load": "It
 * is in my opinion better if we chunk it up similar to the sign up process. And an indicator shows how far we are before a
 * load goes public." The counter's card was as long, so it was given the same, in the Shop app's own look.
 */

const HERE = 'src/apps/agent';
/** 3 November 2026, 10:00 local. */
const NOW = new Date(2026, 10, 3, 10, 0, 0).getTime();
const measured = (over: Partial<AcceptForm> = {}): AcceptForm => ({ ...EMPTY_ACCEPT, dims: { l: '240', w: '120', h: '150', kg: '1800' }, destPudoDid: 'did:sbg:shop:thika', destShopName: 'Thika Market Shop', ...over });
const ready = (over: Partial<AcceptForm> = {}) => measured({ budgetCap: '9000', packaging: 'palletised' as never, ...over });
const draw = (step: FreightStep, f: AcceptForm, busy: string | null = null) =>
  renderToString(<FreightBooking state={{ accept: f, busy, agent: { currency: 'KES' } } as never} actions={{ setAccept: () => undefined, submitBookFreight: async () => undefined } as never} onTakeIn={() => undefined} start={step} now={NOW} />);

describe('booking a walk-up as freight, one part per screen', () => {
  it('goes price and when, the load, who to call, on the day, then the check — the bar saying nothing goes out before the last', () => {
    expect(FREIGHT_STEPS).toEqual(['price', 'load', 'people', 'day', 'check']);
    const html = draw('load', ready());
    expect(html).toContain('steps steps--pinned');
    expect(html).toContain('Booking freight · goes out at the last step');
    expect(html).toContain('step 2 of 5');
    for (const s of FREIGHT_STEPS) expect(html).toContain(t(`agent.freightSteps.step.${s}` as never));
  });

  it('asks each of the card’s questions on one step, and only there', () => {
    const where: Record<string, FreightStep> = {
      'freight-budget': 'price',
      'freight-date': 'price',
      'freight-packaging': 'load',
      'freight-un': 'load',
      'freight-class': 'load',
      'freight-psn': 'load',
      'freight-pg': 'load',
      'freight-body': 'load',
      'freight-exclude': 'load',
      'freight-phone': 'people',
      'freight-consignee': 'people',
      'freight-contact': 'people',
      'freight-contact-phone': 'people',
      'freight-window': 'day',
      'freight-term': 'day',
      'freight-place': 'day',
      'freight-instructions': 'day',
    };
    // Everything that can show at once: a planned pickup, dangerous goods, a trade term.
    const all = ready({ freightWhen: 'planned', freightDate: '2026-11-10T09:00', natureCode: 'HAZ-FLAM', incoterm: 'DAP' as never });
    const pages = Object.fromEntries(FREIGHT_STEPS.map((s) => [s, draw(s, all)])) as Record<FreightStep, string>;
    for (const [id, step] of Object.entries(where)) {
      for (const s of FREIGHT_STEPS) expect({ id, s, there: pages[s].includes(`id="${id}"`) }).toEqual({ id, s, there: s === step });
    }
    expect(pages.price).toContain(t('agent.accept.negotiate'));
    expect(pages.price).toContain(t('agent.accept.earlyClaim'));
    expect(pages.load).toContain(t('agent.accept.indivisible'));
    // Dangerous goods are asked only of dangerous goods.
    expect(draw('load', ready())).not.toContain('id="freight-un"');
  });

  it('keeps every answer the card had, set the same way — so the booking sent for them is the one the card sent', () => {
    // The card's own handlers, as AcceptScreen.tsx had them at 6dbc2a57 (FreightBookingCard).
    const OLD = [
      "actions.setAccept({ budgetCap: e.currentTarget.value })",
      "actions.setAccept({ freightWhen: 'now' })",
      "actions.setAccept({ freightWhen: 'planned' })",
      "actions.setAccept({ freightDate: e.currentTarget.value })",
      "actions.setAccept({ allowEarlyClaim: e.currentTarget.checked })",
      "actions.setAccept({ packaging: key as PackagingChoice })",
      "actions.setAccept({ indivisible: e.currentTarget.checked })",
      "actions.setAccept(chooseBodyHint(f, key as BodyHint))",
      "actions.setAccept(toggleExcludedBody(f, b.value))",
      "actions.setAccept({ negotiate: e.currentTarget.checked })",
      "actions.setAccept({ customerMobile: v })",
      "actions.setAccept({ consigneeName: e.currentTarget.value })",
      "actions.setAccept({ dgUn: e.currentTarget.value })",
      "actions.setAccept({ dgClass: e.currentTarget.value })",
      "actions.setAccept({ dgName: e.currentTarget.value })",
      "actions.setAccept({ dgGroup: e.currentTarget.value as never })",
      "actions.setAccept({ contactName: e.currentTarget.value })",
      "actions.setAccept({ contactPhone: v })",
      "actions.setAccept({ incoterm: e.currentTarget.value as never })",
      "actions.setAccept({ namedPlace: e.currentTarget.value })",
      "actions.setAccept({ deliveryWindow: e.currentTarget.value })",
      "actions.setAccept({ instructions: e.currentTarget.value })",
    ];
    const src = readFileSync(join(HERE, 'screens/FreightBooking.tsx'), 'utf8');
    const now = [...src.matchAll(/actions\.setAccept\((?:\{[^}]*\}|\w+\([^)]*\))\)/g)].map((m) => m[0]);
    expect(now.length).toBeGreaterThan(20);
    expect([...new Set(now)].sort()).toEqual([...OLD].sort());
    // And the booking is sent as it was: from the take-in's answers, by the one action — from the check only.
    expect(readFileSync(join(HERE, 'useAgentApp.ts'), 'utf8')).toMatch(/const submitBookFreight = useCallback\(async \(\) => \{\s*if \(!client \|\| !did\) return;\s*const f = stateRef\.current\.accept;/);
    expect(src.match(/actions\.submitBookFreight\(\)/g)).toHaveLength(1);
    expect(src).toMatch(/\{step === 'check' \? \(\s*<Button onClick=\{\(\) => void actions\.submitBookFreight\(\)\}/);
    expect(readFileSync(join(HERE, 'screens/AcceptScreen.tsx'), 'utf8')).not.toContain('submitBookFreight');
  });
});

describe('each step’s own checks, said under its button', () => {
  it('are the card’s own rules and words, each on its step — and together refuse exactly what the card refused', () => {
    const forms: AcceptForm[] = [
      EMPTY_ACCEPT,
      measured({ destPudoDid: '' }),
      measured(),
      measured({ budgetCap: '9000' }),
      measured({ budgetCap: '9000', freightWhen: 'planned' }),
      measured({ budgetCap: '9000', freightWhen: 'planned', freightDate: '2026-11-01T09:00' }),
      ready({ natureCode: 'HAZ-CHEM' }),
      ready({ natureCode: 'HAZ-CHEM', dgUn: '1789', dgName: 'Hydrochloric acid', dgClass: '8' }),
      ready({ natureCode: 'HAZ-CHEM', packaging: '' as never }),
      ready(),
    ];
    for (const f of forms) {
      const card = bookFreightMissing(f, NOW, t);
      const said = (['goods', ...FREIGHT_STEPS.filter((s) => s !== 'check')] as const).map((s) => freightStepMissing(s, f, NOW, t)).filter(Boolean);
      // Nothing missing on any step exactly when the card had nothing missing; what the card said first, a step says.
      expect(said.length === 0).toBe(card === null);
      if (card) expect(said).toContain(card);
      // The last step holds the booking on the card's own check.
      expect(freightStepMissing('check', f, NOW, t)).toBe(card);
    }
    // Where two steps each miss something, the steps' order says which comes first: the budget's day before the packing.
    const two = measured({ budgetCap: '9000', freightWhen: 'planned' });
    expect(freightStepMissing('price', two, NOW, t)).toBe(t('agent.logic.freightPlannedDate'));
    expect(freightStepMissing('load', two, NOW, t)).toBe(t('agent.logic.freightPackaging'));
    // A step never stops on another's answer.
    expect(freightStepMissing('load', measured({ packaging: 'palletised' as never }), NOW, t)).toBeNull();
    expect(freightStepMissing('price', measured({ budgetCap: '9000' }), NOW, t)).toBeNull();
    expect(freightStepMissing('people', EMPTY_ACCEPT, NOW, t)).toBeNull();
    expect(freightStepMissing('day', EMPTY_ACCEPT, NOW, t)).toBeNull();
  });

  it('holds Next until the step is answered, saying what is missing under it', () => {
    const held = draw('price', measured());
    expect(held).toMatch(/<button[^>]*\bdisabled[^>]*><span>Next</);
    expect(held).toContain(t('agent.logic.freightBudget'));
    const on = draw('price', measured({ budgetCap: '9000' }));
    expect(on).toMatch(/<button(?![^>]*\bdisabled)[^>]*><span>Next</);
    expect(on).not.toContain(t('agent.logic.freightBudget'));
    // Said with its short forms explained (Abbreviated), so read as text.
    expect(draw('load', ready({ natureCode: 'HAZ-FLAM' })).replace(/<[^>]+>/g, '')).toContain(t('agent.logic.freightDangerous'));
  });
});

describe('Back, and the phone’s Back', () => {
  it('goes back a step at a time; from the first, back to the take-in', () => {
    expect(draw('price', ready())).toContain(t('agent.freightSteps.toTakeIn'));
    expect(draw('load', ready())).toContain(`>${t('common.back')}`);
    expect(draw('load', ready())).not.toContain(t('agent.freightSteps.toTakeIn'));
    const src = readFileSync(join(HERE, 'screens/FreightBooking.tsx'), 'utf8');
    expect(src).toContain('<BackStep key={step} back={() => (back ? go(back) : onTakeIn())} />');
    expect(src).toMatch(/window\.scrollTo\?\.\(0, 0\);\s*titleRef\.current\?\.focus\(\);\s*\}, \[step\]\);/);
  });

  it('is opened from the take-in once the walk-up is measured and has its shop, and is then the whole screen', () => {
    const src = readFileSync(join(HERE, 'screens/AcceptScreen.tsx'), 'utf8');
    expect(src).toContain("const entryBlock = freightStepMissing('goods', f, Date.now(), t);");
    expect(src).toMatch(/if \(booking && isDedicated && walkUp && !entryBlock\) \{\s*return \(\s*<div class="scr">/);
    expect(src).toMatch(/<Button onClick=\{\(\) => setBooking\(true\)\} disabled=\{Boolean\(entryBlock\)\}>/);
    expect(freightStepMissing('goods', measured({ destPudoDid: '' }), NOW, t)).toBe(t('agent.logic.acceptPickDest'));
  });
});

describe('check and book', () => {
  it('reads every part back with Change to it, the goods included', () => {
    const html = draw('check', ready({ contactName: 'Wanjiru', contactPhone: '+254700000001', instructions: 'Forklift at the back' }));
    expect(html).toContain(t('agent.freightSteps.checkLede'));
    expect((html.match(new RegExp(`>${t('agent.freightSteps.change')}</button>`, 'g')) ?? []).length).toBe(5);
    for (const v of ['240 × 120 × 150 cm · 1800 kg', 'Thika Market Shop', 'Wanjiru · +254700000001', 'Forklift at the back', t('agent.accept.shipNow')]) expect(html).toContain(v);
    expect(html).toMatch(/<button(?![^>]*\bdisabled)[^>]*><span>Book the freight</);
    // Missing something, it is held, and says what.
    expect(draw('check', measured())).toMatch(/<button[^>]*\bdisabled[^>]*><span>Book the freight</);
  });

  it('says who will see it: the marketplace, the drivers’ board, or nobody before its day', () => {
    expect(draw('check', ready())).toContain(t('agent.freightSteps.seeNowInstant'));
    expect(draw('check', ready({ negotiate: true }))).toContain(t('agent.freightSteps.seeNowNegotiate'));
    const planned = draw('check', ready({ freightWhen: 'planned', freightDate: '2026-11-10T09:00', allowEarlyClaim: false }));
    expect(planned).toContain(t('agent.freightSteps.seeNotEarly'));
    expect(draw('check', ready({ freightWhen: 'planned', freightDate: '2026-11-10T09:00' }))).toContain(t('agent.freightSteps.seeEarly'));
  });
});
