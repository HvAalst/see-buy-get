import { describe, expect, it } from 'vitest';
import { t } from '../../shared/i18n';
import { adviserSays, checkSays, countWords, mailSays, momentWords, plausible, pushSays, routerSays, type AdviserConnection, type MailConnection, type PushConnection, type RouterConnection } from './connections';

const since = '2026-10-06T06:00:00Z';
const at = '2026-10-06T08:15:00Z';
const router = (over: Partial<RouterConnection> = {}): RouterConnection => ({ configured: true, host: 'osrm.example:5000', profile: 'driving', maxPoints: 100, ...over });
const adviser = (over: Partial<AdviserConnection> = {}): AdviserConnection => ({ configured: true, model: 'claude-opus-5-5', ...over });
// As a server that really sends, with nothing wrong: each test says what is different about its own.
const mail = (over: Partial<MailConnection> = {}): MailConnection => ({ sends: true, tokenSet: true, from: 'noreply@kilima.example', fromIsPlaceholder: false, written: 0, failed: 0, ...over });
const push = (over: Partial<PushConnection> = {}): PushConnection => ({ sends: true, keys: 'own', devices: 0, people: 0, handed: 0, failed: 0, ...over });

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

  describe('email', () => {
    it('is kept, not sent: said as how a sandbox runs — and, off a sandbox, as people who are not being told', () => {
      const s = mailSays(mail({ sends: false, tokenSet: false, written: 4 }), true, since, t);
      expect([s.tone, s.tag]).toEqual(['info', 'Kept, not sent']);
      expect(s.line).toBe('No email leaves this server. Each one is written and kept here instead, and reaches nobody — 4 since it started. That is how a sandbox is meant to run.');
      const live = mailSays(mail({ sends: false, tokenSet: false, written: 4 }), false, since, t);
      expect([live.tone, live.tag]).toEqual(['danger', 'Kept, not sent']);
      expect(live.line).toMatch(/reach nobody — 4 since it started\. This is not a sandbox: the people they were for are waiting\./);
    });

    it('never takes a token for sending: set, with nothing using it, is said in so many words', () => {
      const s = mailSays(mail({ sends: false, tokenSet: true }), false, since, t);
      expect(s.tone).toBe('danger');
      expect(s.line).toMatch(/A provider’s token is set, and nothing on this server uses it: setting it does not start the sending\.$/);
      expect(mailSays(mail({ sends: false, tokenSet: false }), false, since, t).line).not.toMatch(/token/);
      // Kept is said before anything else that is wrong with it, and before any old success.
      expect(mailSays(mail({ sends: false, fromIsPlaceholder: true, last: { at, ok: true, what: 'A code' } }), true, since, t).tag).toBe('Kept, not sent');
    });

    it('sends as an address nobody delivers for: said loudest, whatever the last email met', () => {
      const s = mailSays(mail({ from: 'noreply@seebuyget.example', fromIsPlaceholder: true, last: { at, ok: true, what: 'A code' } }), false, since, t);
      expect([s.tone, s.tag]).toEqual(['danger', 'No sender address']);
      expect(s.line).toMatch(/^Email is sent as noreply@seebuyget\.example, the address this server starts with\./);
    });

    it('says nothing has been sent yet rather than that it works, then what the last email met', () => {
      const none = mailSays(mail(), false, since, t);
      expect([none.tone, none.tag]).toEqual(['info', 'Set up, nothing sent yet']);
      expect(none.line).toBe(`No email has been written since this server started (${momentWords(since)}).`);
      const good = mailSays(mail({ written: 3, last: { at, ok: true, what: 'A code for your email address' } }), false, since, t);
      expect([good.tone, good.tag]).toEqual(['ok', 'Sending']);
      // Handed over is not arrived, and is not called it.
      expect(good.line).toBe(`The last email, at ${momentWords(at)}, was handed to the provider: “A code for your email address”. Whether it arrived is the provider’s to say.`);
      const bad = mailSays(mail({ written: 3, failed: 1, last: { at, ok: false, what: 'A code for your email address' } }), false, since, t);
      expect([bad.tone, bad.tag]).toEqual(['warn', 'Not getting through']);
      expect(bad.line).toBe(`The last email, at ${momentWords(at)}, could not be handed to the provider: “A code for your email address”. The person it was for was not told. Since this server started, 1 of 3 could not be handed over.`);
      // It is getting through again: the earlier failures are still said.
      expect(mailSays(mail({ written: 9, failed: 2, last: { at, ok: true, what: 'A code' } }), false, since, t)).toMatchObject({ tone: 'ok', line: expect.stringMatching(/2 of 9 could not be handed over\.$/) });
    });
  });

  describe('push to a phone', () => {
    it('is kept, not sent: the bell is still written to — and off a sandbox no phone is woken', () => {
      const s = pushSays(push({ sends: false }), true, since, t);
      expect([s.tone, s.tag]).toEqual(['info', 'Kept, not sent']);
      expect(s.line).toMatch(/always written to the person’s bell in their app; the push that would light a phone whose app is closed is kept here instead\. That is how a sandbox is meant to run\./);
      const live = pushSays(push({ sends: false, keys: 'mismatched' }), false, since, t);
      expect([live.tone, live.tag]).toEqual(['danger', 'Kept, not sent']);
      expect(live.line).toMatch(/no phone is woken\. This is not a sandbox/);
    });

    it('says keys that are wrong before anything a push met: two that do not belong together, then the pair anybody can read', () => {
      const lastOk = { at, ok: true };
      const mismatched = pushSays(push({ keys: 'mismatched', last: lastOk }), false, since, t);
      expect([mismatched.tone, mismatched.tag]).toEqual(['danger', 'Keys do not match']);
      expect(mismatched.line).toMatch(/every push is refused\. Set both, from the same pair\.$/);
      const builtIn = pushSays(push({ keys: 'built_in', last: lastOk }), true, since, t);
      expect([builtIn.tone, builtIn.tag]).toEqual(['danger', 'Keys anybody can read']);
      expect(builtIn.line).toMatch(/anybody who can read the code can sign with them too/);
    });

    it('says nothing has been sent yet, then what the last push met — and that the bell has it either way', () => {
      const none = pushSays(push(), false, since, t);
      expect([none.tone, none.tag]).toEqual(['info', 'Set up, nothing sent yet']);
      expect(none.line).toBe(`No push has been handed to a phone since this server started (${momentWords(since)}).`);
      const good = pushSays(push({ handed: 5, last: { at, ok: true } }), false, since, t);
      expect([good.tone, good.tag, good.line]).toEqual(['ok', 'Sending', `The last push, at ${momentWords(at)}, was handed to the phone’s push service.`]);
      const bad = pushSays(push({ handed: 5, failed: 2, last: { at, ok: false } }), false, since, t);
      expect([bad.tone, bad.tag]).toEqual(['warn', 'Not getting through']);
      expect(bad.line).toBe(`The last push, at ${momentWords(at)}, could not be handed over. The notification is in the person’s bell all the same. Since this server started, 2 of 5 could not be handed over.`);
    });
  });

  it('says a count plainly, and how many of them failed only when some did', () => {
    expect(countWords(7, 0, t)).toBe('7');
    expect(countWords(7, 2, t)).toBe('7 — 2 could not be handed over');
    expect(countWords(0, 0, t)).toBe('0');
  });

  it('has words for every state the keys can be in', () => {
    for (const k of ['own', 'built_in', 'mismatched'] as const) expect(t(`tower.conn.fact.keys.${k}`)).not.toContain('tower.conn');
  });

  it('says a moment as a day and a time, and leaves alone what is not one', () => {
    expect(momentWords('2026-10-06T08:15:00')).toBe('2026-10-06 08:15');
    expect(momentWords('soon')).toBe('soon');
  });
});
