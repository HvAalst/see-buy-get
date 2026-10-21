import { describe, expect, it } from 'vitest';
import { levelTone, riskChanges, riskWaiting, type RiskRow } from './risks';

const row: RiskRow = {
  subject: 'hub',
  id: 'mdp_1',
  name: 'Central Sort',
  high: false,
  ratings: [
    { threat: 'pilferage', level: 'medium', overdue: false },
    { threat: 'hijacking', overdue: false },
    { threat: 'unrest', level: 'low', overdue: true },
    { threat: 'extortion', overdue: false },
  ],
};

describe('the risk register on the console (round 39)', () => {
  it('counts what waits for a person: proposals, and ratings past their quarter — nothing while unread', () => {
    expect(riskWaiting(null)).toBeNull();
    expect(riskWaiting({ rows: [row], proposals: [], overdue: 0 })).toBe(0);
    expect(riskWaiting({ rows: [row], proposals: [{ proposalId: 'p', subject: 'hub', id: 'mdp_1', name: 'Central Sort', threat: 'pilferage', to: 'high', because: 'x', at: 'y' }], overdue: 1 })).toBe(2);
  });

  it('draws high as a warning, and an unrated threat as quiet', () => {
    expect(levelTone('high')).toBe('ctag--warn');
    expect(levelTone('medium')).toBe('ctag--info');
    expect(levelTone('low')).toBe('ctag--ok');
    expect(levelTone(undefined)).toBe('ctag--quiet');
  });

  it('sends only what the editor changed', () => {
    expect(riskChanges(row, {})).toEqual([]);
    expect(riskChanges(row, { pilferage: 'medium', hijacking: 'high', unrest: 'low' })).toEqual([{ threat: 'hijacking', level: 'high' }]);
    expect(riskChanges(row, { pilferage: 'high', extortion: 'low' })).toEqual([
      { threat: 'pilferage', level: 'high' },
      { threat: 'extortion', level: 'low' },
    ]);
  });
});
