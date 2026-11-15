import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { t } from '../../shared/i18n';
import { HeldProblemsCard, type HeldProblem } from './screens/HeldProblems';
import type { DriverActions, DriverState } from './useDriverApp';

/*
 * 2026-11-15 — PROBLEMS REPORTED, on the driver's loads: a delivered load whose pay is held for what the sender reported,
 * answered once (rule-both-sides-heard), with the page that explains how it is decided.
 */
const problem = (over: Partial<HeldProblem> = {}): HeldProblem => ({
  freightId: 'f1',
  code: 'FRT-101',
  description: 'A fridge, upright',
  heldUntil: '2026-11-16T09:00:00.000Z',
  problem: { kind: 'short', description: 'One box of three missing', at: '2026-11-15T12:00:00.000Z' },
  answered: false,
  ...over,
});
const actions = { loadHeldProblems: async () => undefined } as unknown as DriverActions;
const card = (items: HeldProblem[] | null) => renderToString(<HeldProblemsCard state={{ heldProblems: items, busy: null } as unknown as DriverState} actions={actions} />);

describe('problems reported on a driver’s delivered loads', () => {
  it('says what was reported, offers one answer, and links how it is decided', () => {
    const html = card([problem()]);
    expect(html).toContain(t('driver.hold.title'));
    expect(html).toContain(t('driver.hold.kindShort'));
    expect(html).toContain('One box of three missing');
    expect(html).toContain(t('driver.hold.answer'));
    expect(html).toContain('help/when-something-goes-wrong/');
  });

  it('answered: says so, and offers no second answer', () => {
    const html = card([problem({ answered: true })]);
    expect(html).toContain(t('driver.hold.answered'));
    expect(html).not.toContain(`>${t('driver.hold.answer')}<`);
  });

  it('nothing reported, or not read yet: no card', () => {
    expect(card([])).toBe('');
    expect(card(null)).toBe('');
  });
});
