import { describe, expect, it } from 'vitest';
import { t } from '../../shared/i18n';
import { adviserSays, checkSays, momentWords, plausible, routerSays, type AdviserConnection, type RouterConnection } from './connections';

const since = '2026-10-06T06:00:00Z';
const at = '2026-10-06T08:15:00Z';
const router = (over: Partial<RouterConnection> = {}): RouterConnection => ({ configured: true, host: 'osrm.example:5000', profile: 'driving', maxPoints: 100, ...over });
const adviser = (over: Partial<AdviserConnection> = {}): AdviserConnection => ({ configured: true, model: 'claude-opus-5-5', ...over });

describe('what this server is connected to', () => {
  describe('the routing server', () => {
    it('is not set up: every plan is an estimate, and that is said rather than left as a blank', () => {
      const s = routerSays({ configured: false, profile: 'driving', maxPoints: 100 }, since, t);
      expect([s.tone, s.tag]).toEqual(['quiet', 'Not set up']);
      expect(s.line).toMatch(/every day’s plan is made on estimated distances/);
    });

    it('is never called fine for being set: an address that is not one is said loudest', () => {
      const s = routerSays(router({ host: undefined, invalid: true }), since, t);
      expect([s.tone, s.tag]).toEqual(['danger', 'Set, and not an address']);
      expect(s.line).toMatch(/no plan can use it/);
      // Even with an old good answer on record: what is set now is what plans will meet.
      expect(routerSays(router({ invalid: true, last: { at, ok: true, places: 5 } }), since, t).tone).toBe('danger');
    });

    it('says it has not been asked, rather than that it works, until a plan has asked', () => {
      const s = routerSays(router(), since, t);
      expect([s.tone, s.tag]).toEqual(['info', 'Set up, not asked yet']);
      expect(s.line).toBe(`No plan has asked it since this server started (${momentWords(since)}). Check it now to see whether it answers.`);
    });

    it('says what the last plan met: an answer, or the plan’s own reason for being an estimate', () => {
      const good = routerSays(router({ last: { at, ok: true, places: 23 } }), since, t);
      expect([good.tone, good.tag]).toEqual(['ok', 'Answering']);
      expect(good.line).toBe(`The last plan to ask, at ${momentWords(at)}, was answered: road distances for its 23 places.`);
      const bad = routerSays(router({ last: { at, ok: false, places: 23, why: 'the routing server did not answer in time' } }), since, t);
      expect([bad.tone, bad.tag]).toEqual(['warn', 'Not answering']);
      expect(bad.line).toBe(`The last plan to ask, at ${momentWords(at)}, got no road distances for its 23 places: the routing server did not answer in time. It was made on estimated distances, and said so.`);
      expect(routerSays(router({ last: { at, ok: false, places: 2 } }), since, t).line).toContain('no reason was given');
    });
  });

  describe('a check of the routing server', () => {
    const near = { near: 'Kilima Logistics', apartKm: 1.6, ms: 180 };
    it('says an answer with its figure, and how far apart the two places really are', () => {
      expect(checkSays({ at, ok: true, km: 2.3, ...near }, t)).toEqual({ tone: 'ok', line: 'It answered in 180 ms: 2.3 km by road between two places 1.6 km apart, near the depot of Kilima Logistics.' });
    });
    it('does not call an answer good when the figure cannot be the road between them — another country’s map answers too', () => {
      const far = checkSays({ at, ok: true, km: 4120.5, ...near }, t);
      expect(far.tone).toBe('warn');
      expect(far.line).toMatch(/4120.5 km by road between two places that are 1.6 km apart.*another country’s map/);
      expect(checkSays({ at, ok: true, km: 0, ...near }, t).tone).toBe('warn');
      const none = checkSays({ at, ok: true, noRoad: true, ...near }, t);
      expect(none.tone).toBe('warn');
      expect(none.line).toMatch(/knows no road between two places 1.6 km apart/);
    });
    it('says why it did not answer, in the words a plan would have carried', () => {
      expect(checkSays({ at, ok: false, why: 'the routing server could not be reached' }, t)).toEqual({ tone: 'warn', line: 'It did not answer: the routing server could not be reached.' });
    });
    it('judges a figure by the straight line: never much shorter, not many times longer', () => {
      expect([plausible(1.6, 1.6), plausible(0.8, 1.6), plausible(12.8, 1.6)]).toEqual([true, true, true]);
      expect([plausible(0.7, 1.6), plausible(13, 1.6), plausible(0, 1.6)]).toEqual([false, false, false]);
      // With nothing to judge it by, it is not called wrong.
      expect([plausible(500, undefined), plausible(500, 0)]).toEqual([true, true]);
    });
  });

  describe('the adviser', () => {
    it('is not set up: the office is told so, and plans are made all the same', () => {
      const s = adviserSays({ configured: false, model: 'claude-opus-5-5' }, since, t);
      expect([s.tone, s.tag]).toEqual(['quiet', 'Not set up']);
      expect(s.line).toMatch(/told it is not set up\. Plans are made all the same/);
    });
    it('says it has not been asked, and why it is not checked from here', () => {
      const s = adviserSays(adviser(), since, t);
      expect([s.tone, s.tag]).toEqual(['info', 'Set up, not asked yet']);
      expect(s.line).toMatch(/a question to it is a question paid for/);
    });
    it('says what the last office met — and a refused key louder than a busy service', () => {
      expect(adviserSays(adviser({ last: { at, ok: true } }), since, t)).toMatchObject({ tone: 'ok', tag: 'Answering' });
      const refused = adviserSays(adviser({ last: { at, ok: false, failed: 'not_configured' } }), since, t);
      expect([refused.tone, refused.tag]).toEqual(['danger', 'Key refused']);
      expect(refused.line).toMatch(/the key set on this server was refused\. Check the key\./);
      const busy = adviserSays(adviser({ last: { at, ok: false, failed: 'busy' } }), since, t);
      expect([busy.tone, busy.tag]).toEqual(['warn', 'Not answering']);
      expect(busy.line).toMatch(/told it is busy/);
      expect(adviserSays(adviser({ last: { at, ok: false, failed: 'unreachable' } }), since, t).line).toMatch(/could not be reached, or failed/);
    });
  });

  it('says a moment as a day and a time, and leaves alone what is not one', () => {
    expect(momentWords('2026-10-06T08:15:00')).toBe('2026-10-06 08:15');
    expect(momentWords('soon')).toBe('soon');
  });
});
