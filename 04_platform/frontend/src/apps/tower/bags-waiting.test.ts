import { describe, expect, it } from 'vitest';
import { t } from '../../shared/i18n';
import { eventWords } from '../business/system';
import { kindWords } from './cases';
import { flagLabel } from './network';

/*
 * 2026-11-06 — the owner's "go ahead": closed bags waiting long for a driver, flagged to operations; and a parcel that will
 * be late, said to a business's own system before the time comes.
 */
describe('closed bags waiting, and a parcel that will be late, in words', () => {
  it('names the flag and its case as staff read them', () => {
    expect(flagLabel('Bags_Waiting', t)).toBe('Closed bags waiting for a driver');
    expect(kindWords('Bags_Waiting', t)).toBe('Closed bags waiting long for a driver');
  });

  it('names the message a business’s system hears before a parcel is late', () => {
    expect(eventWords('parcel.delayed', t)).toBe('A parcel that will be late');
  });
});
