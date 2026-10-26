import { describe, expect, it } from 'vitest';
import { weekForm } from '../fleet/sites';
import { bulkBody, openingHoursProblem, weekProblem } from './arrivals';

const week = weekForm({ mon: { open: '07:00', close: '18:00' }, sat: { open: '08:00', close: '12:00' } });

describe('a week of hours as a hub writes it: its opening hours and its bulk hours, checked the same way', () => {
  it('finds no day open, a time not HH:MM, or closing before opening on a day', () => {
    expect(weekProblem(week)).toBeNull();
    // The week a sheet starts from the first time: every day, 08:00 to 18:00.
    expect(weekProblem(weekForm(undefined))).toBeNull();
    expect(weekProblem({ ...week, mon: null, sat: null })).toBe('noDay');
    expect(weekProblem({ ...week, sat: { open: '8', close: '12:00' } })).toBe('time');
    expect(weekProblem({ ...week, sat: { open: '12:00', close: '12:00' } })).toBe('closes');
    expect(weekProblem({ ...week, sat: { open: '13:00', close: '12:00' } })).toBe('closes');
  });

  it('says it in the words of the sheet it was written on: opening hours speak of being open, bulk hours of receiving', () => {
    expect(openingHoursProblem(true, week)).toBeNull();
    expect(openingHoursProblem(true, { ...week, mon: null, sat: null })).toBe('mdp.reach.errNoDay');
    expect(openingHoursProblem(true, { ...week, sat: { open: '8', close: '12:00' } })).toBe('mdp.reach.errTime');
    expect(openingHoursProblem(true, { ...week, sat: { open: '13:00', close: '12:00' } })).toBe('mdp.reach.errCloses');
    expect(bulkBody(true, { ...week, mon: null, sat: null }, '')).toEqual({ error: 'mdp.bulk.errNoDay' });
  });

  it('checks nothing where the hub keeps no set hours: the week it left behind is not sent', () => {
    expect(openingHoursProblem(false, { ...week, mon: null, sat: null })).toBeNull();
    expect(bulkBody(false, { ...week, mon: null, sat: null }, '')).toEqual({ body: { open: true, hours: null, doors: null } });
  });
});
