import { describe, expect, it } from 'vitest';
import { approveBlock, stateTone, waitingOnStaff, type BusinessRow } from './businesses';

const row = (over: Partial<BusinessRow>): BusinessRow => ({
  entityId: 'biz-et-acme', name: 'Acme', country: 'ET', activities: ['importer'], registrationNo: 'R1', createdAt: '2026-10-04T08:00:00Z', createdBy: 'Abebe', state: 'asked', members: 1, missing: [], ...over,
});

describe('customers’ businesses, as staff check them', () => {
  it('counts what waits on staff, and says nothing before it has read', () => {
    expect(waitingOnStaff(null)).toBeNull();
    expect(waitingOnStaff([row({ state: 'asked' }), row({ state: 'checking' }), row({ state: 'verified' }), row({ state: 'unverified' }), row({ state: 'refused' })])).toBe(2);
    expect(waitingOnStaff([])).toBe(0);
  });

  it('says why an approval cannot be given before the button is pressed', () => {
    expect(approveBlock(row({ state: 'unverified' }), 'Amina', true)).toBe('notAsked');
    expect(approveBlock(row({ state: 'asked' }), 'Amina', false)).toBe('papers');
    expect(approveBlock(row({ state: 'asked' }), 'Amina', true)).toBeNull();
    // The second approval is somebody else's.
    expect(approveBlock(row({ state: 'checking', firstBy: 'Amina' }), 'Amina', true)).toBe('same');
    expect(approveBlock(row({ state: 'checking', firstBy: 'Amina' }), 'Brian', true)).toBeNull();
    expect(approveBlock(row({ state: 'verified' }), 'Brian', true)).toBe('done');
  });

  it('wears the tone of where it stands', () => {
    expect([stateTone('verified'), stateTone('refused'), stateTone('asked'), stateTone('unverified')]).toEqual(['ok', 'warn', 'info', 'quiet']);
  });
});
