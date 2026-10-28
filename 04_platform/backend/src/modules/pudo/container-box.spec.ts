import { BOX_WARN_DAYS, BoxTimes, boxClock, boxDueSoon, checkDigitFor, exportBoxClock, normaliseContainerNo, parseContainerNo } from './container-box';

const DAY = 86_400_000;
const NOW = Date.parse('2026-09-18T09:00:00.000Z');
const ago = (days: number) => new Date(NOW - days * DAY).toISOString();

/**
 * Y0 + Y1 — the number, and the clock.
 *
 * Both halves are arithmetic, which is why they are a pure module with a pure test: the check digit is the
 * standard's own, and the clock is dates and whole days with no money in it anywhere. What these tests
 * actually defend is the pair of silent failures — a mistyped number that still looks like a container
 * number, and a countdown that would invent a date nobody gave us.
 */
describe('a container number, checked by its own arithmetic', () => {
  /**
   * THE ANCHOR CASE, and it is a real one. CSQU3054383 is the number ISO's own examples use, so if the
   * table of letter values or the weighting were wrong this is the test that would say so.
   */
  it('computes the standard’s own example', () => {
    expect(checkDigitFor('CSQU305438')).toBe(3);
    expect(parseContainerNo('CSQU3054383')).toMatchObject({ ok: true, ownerCode: 'CSQU', category: 'freight container', serial: '305438', check: 3 });
  });

  /**
   * THE NUMBER THIS PROJECT WROTE IN ITS OWN DESIGN NOTE WAS A TYPO, which is the whole argument for the
   * slice: MSCU1234567 looks exactly like a container number, and it checks to 6. Every document that
   * carries a made-up container number carries one of these, and until now so did the database.
   */
  it('refuses the plausible-looking typo, and says what the digit should be', () => {
    const bad = parseContainerNo('MSCU1234567');
    expect(bad.ok).toBe(false);
    expect(bad.expected).toBe(6);
    expect(bad.why).toContain('checks to 6, not 7');
    expect(parseContainerNo('MSCU1234566').ok).toBe(true);
  });

  it('treats the shape and the digit as two different mistakes', () => {
    expect(parseContainerNo('MSCU12345').why).toContain('not the shape');
    expect(parseContainerNo('MS1U1234566').why).toContain('not the shape');
    // The fourth letter is the equipment category, and a wrong one is invisible: an owner code reads as
    // plausible whatever it is. Said before the check digit, because it is the more specific fault.
    expect(parseContainerNo('MSCA1234567').why).toContain('fourth letter');
  });

  it('is written as people write it, and stored one way', () => {
    expect(normaliseContainerNo(' mscu 123456-6 ')).toBe('MSCU1234566');
    expect(parseContainerNo('mscu 123456-6')).toMatchObject({ ok: true, containerNo: 'MSCU1234566' });
  });

  it('says what a container number is, when given nothing', () => {
    expect(parseContainerNo('').why).toContain('four letters, six digits');
  });
});

describe('the clock on a box, in dates and never in money', () => {
  const times = (over: Partial<BoxTimes> = {}): BoxTimes => ({ freeDays: [], ...over });
  const claim = (kind: 'demurrage' | 'detention', days: number, by = 'Yukel Trading', at = ago(20)) => ({
    kind,
    days,
    by,
    byEntityId: 'ent_importer',
    at,
  });

  it('runs nothing at all until something happened', () => {
    const clock = boxClock(times(), NOW);
    expect(clock.kind).toBe('unknown');
    expect(clock.overdue).toBe(false);
    expect(clock.dueBackAt).toBeUndefined();
    // The honest absence: an ETA is an expectation, and counting from one would be an invented start.
    expect(clock.basis).toContain('we do not guess');
  });

  it('counts demurrage inside the terminal and detention outside it, and never merges them', () => {
    expect(boxClock(times({ arrivedAt: ago(4) }), NOW)).toMatchObject({ kind: 'demurrage', daysElapsed: 4 });
    const out = boxClock(times({ arrivedAt: ago(9), outGatedAt: ago(6) }), NOW);
    expect(out).toMatchObject({ kind: 'detention', daysElapsed: 6, demurrageDays: 3 });
    // The spell inside the terminal is closed and reported, not added to the running one: 6 days out is
    // 6 days out, whatever happened before the gate.
    expect(out.basis).toContain('3 days inside the terminal');
  });

  it('will not count to a date nobody gave us', () => {
    const clock = boxClock(times({ outGatedAt: ago(30) }), NOW);
    expect(clock).toMatchObject({ kind: 'detention', daysElapsed: 30, overdue: false });
    expect(clock.dueBackAt).toBeUndefined();
    expect(clock.daysLeft).toBeUndefined();
    expect(clock.basis).toContain('Nobody has said how many free days');
  });

  it('counts down to the claimed date, and says whose number it is', () => {
    const clock = boxClock(times({ outGatedAt: ago(10), freeDays: [claim('detention', 14)] }), NOW);
    expect(clock).toMatchObject({ kind: 'detention', daysElapsed: 10, freeDays: 14, daysLeft: 4, overdue: false });
    expect(clock.dueBackAt!.slice(0, 10)).toBe(new Date(Date.parse(ago(10)) + 14 * DAY).toISOString().slice(0, 10));
    expect(clock.freeDaysBy).toBe('Yukel Trading');
    // A countdown with nobody's name on it gets read as ours, and it is a figure from a contract we have
    // never seen.
    expect(clock.basis).toContain('Yukel Trading says it was given');
    expect(clock.basis).toContain('a contract we have not seen');
  });

  it('never mentions money, in any state', () => {
    const states: BoxTimes[] = [
      times(),
      times({ arrivedAt: ago(3) }),
      times({ outGatedAt: ago(30), freeDays: [claim('detention', 7)] }),
      times({ outGatedAt: ago(3), freeDays: [claim('detention', 7)] }),
      times({ outGatedAt: ago(30), ending: { kind: 'returned', at: ago(1), by: 'Addis Clearing' }, freeDays: [] }),
    ];
    for (const s of states) {
      const said = boxClock(s, NOW).basis;
      expect(said).not.toMatch(/\$|USD|ETB|charge of|per day|amount|invoice/i);
    }
  });

  it('takes the latest claim of a kind, and keeps the two kinds apart', () => {
    const corrected = boxClock(times({ outGatedAt: ago(10), freeDays: [claim('detention', 7, 'Yukel Trading', ago(9)), claim('detention', 21, 'Yukel Trading', ago(2))] }), NOW);
    // A correction is a second claim rather than an edit, so the live figure is the last one stated.
    expect(corrected).toMatchObject({ freeDays: 21, overdue: false });
    // And a demurrage figure must never feed the detention countdown: different clocks, different faults.
    const wrongKind = boxClock(times({ outGatedAt: ago(10), freeDays: [claim('demurrage', 14)] }), NOW);
    expect(wrongKind.freeDays).toBeUndefined();
    expect(wrongKind.overdue).toBe(false);
  });

  it('says it is over when it is over, and by how much', () => {
    const clock = boxClock(times({ outGatedAt: ago(20), freeDays: [claim('detention', 14)] }), NOW);
    expect(clock).toMatchObject({ overdue: true, daysLeft: -6 });
    expect(clock.basis).toContain('6 over');
    expect(clock.basis).toContain('what it costs is between them');
  });

  it('stops on a return, with the days it was out', () => {
    const clock = boxClock(times({ arrivedAt: ago(30), outGatedAt: ago(25), ending: { kind: 'returned', at: ago(4), by: 'Addis Clearing', where: 'Modjo depot' } }), NOW);
    expect(clock).toMatchObject({ kind: 'stopped', overdue: false });
    expect(clock.basis).toContain('Returned to Modjo depot');
    expect(clock.basis).toContain('21 days after it left');
  });

  /**
   * THE USER'S CORRECTION, AND THE TEST THAT MATTERS MOST.
   *
   * "Containers are demanded objects and are very often sold in the market and are never returned." A box
   * that was bought is not late — and this case is deliberately built so that every other branch would
   * have called it forty days overdue.
   */
  it('a box that was sold is never overdue', () => {
    const clock = boxClock(
      times({ outGatedAt: ago(60), freeDays: [claim('detention', 14)], ending: { kind: 'bought', at: ago(30), by: 'Yukel Trading', note: 'Sold to the consignee' } }),
      NOW,
    );
    expect(clock).toMatchObject({ kind: 'stopped', overdue: false });
    expect(clock.daysLeft).toBeUndefined();
    expect(clock.basis).toContain('No return is owed');
    expect(clock.basis).toContain('containers are traded goods');
  });

  it('warns before the date and not after it', () => {
    const at = (daysOut: number, free: number) => boxClock(times({ outGatedAt: ago(daysOut), freeDays: [claim('detention', free)] }), NOW);
    expect(boxDueSoon(at(11, 14))).toBe(true); // 3 left
    expect(boxDueSoon(at(14, 14))).toBe(true); // due today
    expect(boxDueSoon(at(10, 14))).toBe(false); // 4 left — not yet
    // Overdue is a different message with different advice, so this predicate deliberately excludes it.
    expect(boxDueSoon(at(20, 14))).toBe(false);
    expect(BOX_WARN_DAYS).toBe(3);
  });
});

/*
 * THE SAME BOX ON AN EXPORT (2026-10-28): it leaves the depot empty first and enters the terminal laden second, so detention
 * runs before demurrage — the import's order reversed, the import's rules kept.
 */
describe('the clock on an export box: outside until the gate, inside until loaded', () => {
  const D = 86_400_000;
  const t0 = Date.parse('2026-11-01T08:00:00Z');
  const iso = (ms: number) => new Date(ms).toISOString();
  const claim = (kind: 'detention' | 'demurrage', days: number, atMs: number, by = 'Wanjiku') => ({ kind, days, byEntityId: 'ent_x', by, at: iso(atMs) });

  it('runs nothing before the empty is out, and invents no date without a claim', () => {
    expect(exportBoxClock({ freeDays: [] }, t0)).toMatchObject({ kind: 'unknown', overdue: false });
    const c = exportBoxClock({ emptyOutAt: iso(t0), freeDays: [] }, t0 + 3 * D + 1);
    expect(c).toMatchObject({ kind: 'detention', daysElapsed: 3, overdue: false });
    expect(c.dueAt).toBeUndefined();
    expect(c.daysLeft).toBeUndefined();
  });

  it('counts detention to the latest claim, and says whose figure it is', () => {
    const c = exportBoxClock({ emptyOutAt: iso(t0), freeDays: [claim('detention', 10, t0), claim('detention', 7, t0 + D, 'Amina'), claim('demurrage', 2, t0)] }, t0 + 5 * D);
    expect(c).toMatchObject({ kind: 'detention', freeDays: 7, freeDaysBy: 'Amina', daysLeft: 2, overdue: false, dueAt: iso(t0 + 7 * D) });
    expect(boxDueSoon(c)).toBe(true);
    expect(c.basis).toContain('Amina');
    expect(c.basis).not.toMatch(/KES|USD|\$|€/);
    const late = exportBoxClock({ emptyOutAt: iso(t0), freeDays: [claim('detention', 7, t0)] }, t0 + 9 * D);
    expect(late).toMatchObject({ overdue: true, daysLeft: -2 });
    expect(boxDueSoon(late)).toBe(false);
  });

  it('hands over to demurrage at the gate, closing detention on whole days', () => {
    const c = exportBoxClock({ emptyOutAt: iso(t0), gatedInAt: iso(t0 + 4 * D + 5 * 3_600_000), freeDays: [claim('detention', 7, t0), claim('demurrage', 3, t0)] }, t0 + 6 * D);
    expect(c).toMatchObject({ kind: 'demurrage', since: iso(t0 + 4 * D + 5 * 3_600_000), daysElapsed: 1, detentionDays: 4, freeDays: 3, daysLeft: 2 });
  });

  it('runs no line’s clock on a box the exporter owns, whatever free days or dates there are', () => {
    const c = exportBoxClock({ emptyOutAt: iso(t0), gatedInAt: iso(t0 + 4 * D), owned: { by: 'Wanjiku' }, freeDays: [claim('detention', 2, t0)] }, t0 + 30 * D);
    expect(c).toMatchObject({ kind: 'owned', overdue: false });
    expect(c.dueAt).toBeUndefined();
    expect(c.basis).toContain('shipper-owned');
  });

  it('stops once loaded on board — a recorded fact, never overdue after', () => {
    const c = exportBoxClock({ emptyOutAt: iso(t0), gatedInAt: iso(t0 + 4 * D), loaded: { at: iso(t0 + 9 * D), by: 'Wanjiku' }, freeDays: [claim('demurrage', 1, t0)] }, t0 + 40 * D);
    expect(c).toMatchObject({ kind: 'stopped', overdue: false, detentionDays: 4, demurrageDays: 5 });
    expect(c.basis).toContain('Loaded on board');
  });
});
