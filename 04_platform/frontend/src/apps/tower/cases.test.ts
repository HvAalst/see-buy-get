import { describe, expect, it } from 'vitest';
import { t } from '../../shared/i18n';
import { closedLine, doneBlocker, eventLine, kindCountLine, kindWords, openFor, ownerLine, severityTone } from './cases';

describe('flags as cases, in the console', () => {
  it('reads only a critical case in the danger colour', () => {
    expect(['critical', 'high', 'medium', 'low'].map((s) => severityTone(s as never))).toEqual(['danger', 'warn', 'info', 'quiet']);
  });

  it('says every kind in words, and an unknown one as it came', () => {
    expect(kindWords('Ghost_Bus', t)).toBe('A bus nobody can account for');
    expect(kindWords('Something_New', t)).toBe('Something_New');
  });

  it('says how long, whose, and what happened, as a person would', () => {
    expect(openFor(5, t)).toBe('5 h');
    expect(openFor(72, t)).toBe('3 d');
    expect(ownerLine({ state: 'taken', owner: { name: 'Amina' } }, t)).toBe('Amina has it');
    expect(ownerLine({ state: 'open' }, t)).toBe('Nobody has it yet');
    expect(ownerLine({ state: 'open', escalatedAt: '2026-10-18T09:00:00Z' }, t)).toBe('Nobody has it — escalated');
    expect(eventLine({ at: '', act: 'note', by: 'Otieno', text: 'Called the shop' }, t)).toBe('Otieno noted: Called the shop');
    expect(eventLine({ at: '', act: 'escalated', text: 'Nobody took it within 1 h' }, t)).toBe('Escalated: Nobody took it within 1 h');
  });

  it('says under a kind only the counts that are not zero', () => {
    expect(kindCountLine({ count: 1, waiting: 0, escalated: 0 }, t)).toBe('1 case');
    expect(kindCountLine({ count: 1430, waiting: 1400, escalated: 12 }, t)).toBe('1430 cases · 1400 nobody has · 12 escalated');
  });

  it('says how a closed case was closed: by whom and why, or by itself', () => {
    const history = [
      { at: '', act: 'opened' as const, text: 'At_PUDO 50h' },
      { at: '', act: 'done' as const, by: 'Amina', text: 'Receiver collects tomorrow' },
    ];
    expect(closedLine({ history }, t)).toBe('Amina closed it: Receiver collects tomorrow');
    expect(closedLine({ history: [history[0], { at: '', act: 'cleared', text: 'The flag is gone' }] }, t)).toBe('Closed by itself: The flag is gone');
  });

  it('asks for a reason and a time to look again before a case is closed', () => {
    expect(doneBlocker('ok', 24, t)).toBe(t('tower.cases.needReason'));
    expect(doneBlocker('Rerouted via Voi', 500, t)).toBe(t('tower.cases.needRecheck'));
    expect(doneBlocker('Rerouted via Voi', 24, t)).toBeNull();
  });
});
