import { STAFF_AREAS } from './staff-areas.table';
import { staffMay, staffRefusal } from './staff-roles';

/**
 * 2026-11-03 — A PROOFREADER'S ACCOUNT (the owner: "we have credits for the proofreader accounts"): the `languages` role opens
 * the Languages review and the account's own doors, and none of the working doors — `any` means any of the four working
 * roles, never a proofreader alone.
 */
describe('a proofreader', () => {
  it('reviews the words, sees their own account, and opens nothing of the work', () => {
    const proofreader = ['languages'];
    expect(staffMay(proofreader, STAFF_AREAS['PUT sbg/words/:locale/:country/:key'])).toBe(true);
    expect(staffMay(proofreader, STAFF_AREAS['GET sbg/words/:locale/:country/reviews'])).toBe(true);
    expect(staffMay(proofreader, STAFF_AREAS['GET sbg/operators/me'])).toBe(true);
    expect(staffMay(proofreader, STAFF_AREAS['POST sbg/operators/me/two-step'])).toBe(true);
    expect(staffMay(proofreader, 'any')).toBe(false);
    expect(staffMay(proofreader, 'support')).toBe(false);
    expect(staffMay(proofreader, 'admin')).toBe(false);
    expect(staffRefusal('any')).toMatch(/one of the working roles/);
  });

  it('is a role of its own: the working roles alone do not open the review', () => {
    expect(staffMay(['support', 'vetting', 'money', 'admin'], STAFF_AREAS['PUT sbg/words/:locale/:country/:key'])).toBe(false);
    expect(staffMay(['admin'], 'any')).toBe(true);
    expect(staffMay(['admin'], 'self')).toBe(true);
    expect(staffMay([], 'self')).toBe(false);
  });
});
