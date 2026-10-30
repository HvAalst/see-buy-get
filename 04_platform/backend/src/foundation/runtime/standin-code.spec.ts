import { standInCode, standInEntries, standInKey, standInState, standInUntil } from './standin-code';

/**
 * THE OWNER'S STAND-IN CODES (2026-10-30): set on the server, never in the repository; a number's code while no text can
 * leave, an address's while no mail can; off on a sandbox, without a day, after it.
 */
describe('the owner’s stand-in codes', () => {
  const before = process.env.GLOS_ENV;
  const live = { GLOS_STANDIN_CODES: '+31 6 00000000:123456, owner@example.com:654321', GLOS_STANDIN_CODES_UNTIL: '2026-11-30' };
  const day = Date.parse('2026-11-01T12:00:00Z');
  beforeEach(() => {
    process.env.GLOS_ENV = 'production';
  });
  afterAll(() => {
    if (before === undefined) delete process.env.GLOS_ENV;
    else process.env.GLOS_ENV = before;
  });

  it('reads number:code and address:code pairs, and nothing that is not one', () => {
    expect(standInEntries(live)).toEqual([
      { key: '31600000000', code: '123456' },
      { key: 'owner@example.com', code: '654321' },
    ]);
    expect(standInEntries({ GLOS_STANDIN_CODES: '+316000:123456, +31600000000:12345, +31600000000:abcdef, nobody@:123456, +31600000000' })).toEqual([]);
    expect(standInKey(' +31 (6) 00-000-000 ')).toBe('31600000000');
    expect(standInKey('Owner@Example.COM')).toBe('owner@example.com');
  });

  it('gives the number’s code however the number is written, only while its channel cannot send', () => {
    expect(standInCode('+31600000000', false, day, live)).toBe('123456');
    expect(standInCode('+31 6 0000 0000', false, day, live)).toBe('123456');
    expect(standInCode('OWNER@example.com', false, day, live)).toBe('654321');
    expect(standInCode('+31600000001', false, day, live)).toBeUndefined();
    // Twilio wired in (or mail leaving): the real code goes, as for everybody.
    expect(standInCode('+31600000000', true, day, live)).toBeUndefined();
  });

  it('is off without a day, after it, with a day that is not one, and on a sandbox', () => {
    expect(standInCode('+31600000000', false, day, { GLOS_STANDIN_CODES: live.GLOS_STANDIN_CODES })).toBeUndefined();
    expect(standInCode('+31600000000', false, Date.parse('2026-12-01T00:00:00Z'), live)).toBeUndefined();
    expect(standInCode('+31600000000', false, Date.parse('2026-11-30T23:59:00Z'), live)).toBe('123456');
    expect(standInUntil({ GLOS_STANDIN_CODES_UNTIL: '2026-11-31' })).toBeUndefined();
    process.env.GLOS_ENV = 'sandbox';
    expect(standInCode('+31600000000', false, day, live)).toBeUndefined();
  });

  it('tells the console how many and until when — never which, never a code', () => {
    expect(standInState(day, live)).toEqual({ numbers: 1, addresses: 1, until: '2026-11-30' });
    expect(JSON.stringify(standInState(day, live))).not.toMatch(/123456|654321|31600000000|owner/);
    expect(standInState(day, { GLOS_STANDIN_CODES_UNTIL: '2026-11-30' })).toBeNull();
  });
});
