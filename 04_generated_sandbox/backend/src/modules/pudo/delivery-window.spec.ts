import { clockWords, windowOf, windowWords } from './delivery-window';

/**
 * A DELIVERY WINDOW, READ. What is pinned is both halves of "it does not guess": the forms people write ARE read, and
 * the words that could mean two things are NOT — because a plan made to a window nobody asked for is worse than a plan
 * that says it did not read one.
 */
describe('reading a delivery window', () => {
  const read = (s: string) => {
    const w = windowOf(s);
    return w ? windowWords(w) : null;
  };

  it('reads a range the ways people write one', () => {
    for (const s of ['8-12', '08:00-12:00', '8:00 – 12:00', '8.00-12.00', '8h-12h', '8h00 - 12h00', '0800-1200', '8 to 12', '8 till 12', '08:00 / 12:00', 'between 8 and 12', 'from 8 to 12', 'van 8 tot 12', 'tussen 8 en 12', '8am-12pm', '8 am - 12 pm', '8 uur - 12 uur', '  8-12.  ']) {
      expect([s, read(s)]).toEqual([s, '08:00–12:00']);
    }
    expect(read('9:30-11:15')).toBe('09:30–11:15');
    expect(read('13-17')).toBe('13:00–17:00');
    expect(read('14:00-16:30')).toBe('14:00–16:30');
    expect(read('0-24')).toBe('00:00–24:00');
  });

  it('reads one end alone: not after, or not before', () => {
    for (const s of ['before 12', 'by 12:00', 'until 12', 'no later than 12:00', 'latest 12', 'voor 12', 'uiterlijk 12:00']) expect([s, read(s)]).toEqual([s, 'before 12:00']);
    for (const s of ['after 14', 'from 14:00', 'not before 14', 'na 14', 'vanaf 14:00', 'after 2pm']) expect([s, read(s)]).toEqual([s, 'from 14:00']);
  });

  it('lets an am or pm on one end speak for the other, where that makes a window', () => {
    expect(read('2-5pm')).toBe('14:00–17:00');
    expect(read('2pm-5pm')).toBe('14:00–17:00');
    expect(read('9-5pm')).toBe('09:00–17:00');
    expect(read('9am-5')).toBe('09:00–17:00');
    expect(read('11am-1')).toBe('11:00–13:00');
    expect(read('12pm-2pm')).toBe('12:00–14:00');
    expect(read('12am-6am')).toBe('00:00–06:00');
    // Read as written: twelve to eight in the morning is midnight to eight.
    expect(read('12-8am')).toBe('00:00–08:00');
  });

  it('reads "10-2" as it can only be meant, and across midday without help', () => {
    expect(read('10-2')).toBe('10:00–14:00');
    expect(read('11-13')).toBe('11:00–13:00');
    expect(read('8-1')).toBe('08:00–13:00');
  });

  it('does not read what could mean two things, or is not a time at all', () => {
    // A bare small hour is morning or afternoon and nothing says which.
    for (const s of ['1-5', '2-4', 'before 5', 'after 3', 'by 6']) expect([s, read(s)]).toEqual([s, null]);
    // Said properly, the same hours are read.
    expect([read('01:00-05:00'), read('1pm-5pm'), read('before 17'), read('before 5pm'), read('after 03:00')]).toEqual(['01:00–05:00', '13:00–17:00', 'before 17:00', 'before 17:00', 'from 03:00']);
    for (const s of ['', '   ', 'morning', 'afternoon', 'asap', 'call first', 'anytime', '12', 'noon', '8-', '-12', '25-26', 'before 30', 'after 25:00', '8:75-12', '14-9', '14:00-14:00', 'before', 'gate 3-7 building 2', 'tomorrow 8-12 or thursday']) expect([s, read(s)]).toEqual([s, null]);
  });

  it('says a time back as a clock', () => {
    expect([clockWords(0), clockWords(485), clockWords(1439), clockWords(1440)]).toEqual(['00:00', '08:05', '23:59', '24:00']);
  });
});
