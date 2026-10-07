import { describe, expect, it } from 'vitest';
import { t } from '../../shared/i18n';
import { adviserSays, checkSays, countWords, mailAddressWords, mailAgainWords, mailSays, momentWords, plausible, pushSays, refusedWhy, routerSays, waitingWords, type AdviserConnection, type MailConnection, type PushConnection, type RouterConnection } from './connections';

const since = '2026-10-06T06:00:00Z';
const at = '2026-10-06T08:15:00Z';
const router = (over: Partial<RouterConnection> = {}): RouterConnection => ({ configured: true, host: 'osrm.example:5000', profile: 'driving', maxPoints: 100, ...over });
const adviser = (over: Partial<AdviserConnection> = {}): AdviserConnection => ({ configured: true, model: 'claude-opus-5-5', ...over });
// As a server that really sends, with nothing wrong: each test says what is different about its own.
const mail = (over: Partial<MailConnection> = {}): MailConnection => ({ sends: true, tokenSet: true, from: 'noreply@kilima.example', fromIsPlaceholder: false, written: 0, failed: 0, reserved: 0, waiting: 0, sentLater: 0, gaveUp: 0, ...over });
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

    it('never takes a token for sending: set and not used, it is said with why it is not used', () => {
      const kept = (over: Partial<MailConnection>, sandbox = false) => mailSays(mail({ sends: false, tokenSet: true, ...over }), sandbox, since, t);
      const noAddress = kept({ problem: 'no_address' });
      expect([noAddress.tone, noAddress.tag]).toEqual(['danger', 'Kept, not sent']);
      expect(noAddress.line).toMatch(/A token is set and the provider’s sending address is not, so nothing uses the token\. Set ZEPTOMAIL_URL to the address your provider account shows on its API page, and restart the server\.$/);
      expect(kept({ problem: 'not_an_address' }).line).toMatch(/is not a web address, so nothing is sent to it\./);
      expect(kept({ problem: 'not_https', host: 'api.zeptomail.com' }).line).toMatch(/is not an https address\. The token would travel where anybody on the way could read it, so nothing is sent to it\.$/);
      // No reason known: still said, and never passed over as fine.
      expect(kept({}).line).toMatch(/A provider’s token is set, and this server is not sending with it\. It reads the token when it starts: restart it\.$/);
      // On a sandbox, kept with nothing set is how it should be; kept with a token set is somebody's unfinished setup.
      expect([kept({ problem: 'no_address' }, true).tone, kept({}, true).tone, mailSays(mail({ sends: false, tokenSet: false }), true, since, t).tone]).toEqual(['warn', 'warn', 'info']);
      expect(mailSays(mail({ sends: false, tokenSet: false }), false, since, t).line).not.toMatch(/token is set/);
      // The address, as the screen may show it: a host, or what is wrong with what was set — never the address itself.
      expect(mailAddressWords(mail({ host: 'api.zeptomail.eu' }), t)).toBe('api.zeptomail.eu');
      expect(mailAddressWords(mail({ sends: false, problem: 'no_address' }), t)).toBe('None set');
      expect(mailAddressWords(mail({ sends: false, problem: 'not_an_address' }), t)).toBe('Set, and not a web address');
      expect(mailAddressWords(mail({ sends: false, problem: 'not_https', host: 'api.zeptomail.com' }), t)).toBe('api.zeptomail.com — not an https address');
      // Kept is said before anything else that is wrong with it, and before any old success.
      expect(mailSays(mail({ sends: false, fromIsPlaceholder: true, last: { at, ok: true, what: 'A code' } }), true, since, t).tag).toBe('Kept, not sent');
    });

    it('sends as an address nobody delivers for: said loudest, whatever the last email met', () => {
      const s = mailSays(mail({ from: 'noreply@seebuyget.example', fromIsPlaceholder: true, last: { at, ok: true, what: 'A code' } }), false, since, t);
      expect([s.tone, s.tag]).toEqual(['danger', 'No sender address']);
      expect(s.line).toBe('Email is sent as noreply@seebuyget.example. That is on a domain set aside for examples, which nobody owns, so no provider delivers for it. Set MAIL_FROM_ADDRESS to an address on a domain your provider has verified.');
    });

    it('says nothing has been sent yet rather than that it works, then what the last email met', () => {
      const none = mailSays(mail(), false, since, t);
      expect([none.tone, none.tag]).toEqual(['info', 'Set up, nothing sent yet']);
      expect(none.line).toBe(`No email has been written since this server started (${momentWords(since)}).`);
      const good = mailSays(mail({ written: 3, last: { at, ok: true, what: 'A code for your email address' } }), false, since, t);
      expect([good.tone, good.tag]).toEqual(['ok', 'Sending']);
      // Handed over is not arrived, and is not called it.
      expect(good.line).toBe(`The last email, at ${momentWords(at)}, was handed to the provider: “A code for your email address”. Whether it arrived is the provider’s to say.`);
      // It is getting through again: the earlier failures are still said.
      expect(mailSays(mail({ written: 9, failed: 2, last: { at, ok: true, what: 'A code' } }), false, since, t)).toMatchObject({ tone: 'ok', line: expect.stringMatching(/2 of 9 could not be handed over at the first try\.$/) });
    });

    it('says a failed email by whose it is: the account’s in red, one email or a bad minute as that', () => {
      const what = 'A code for your email address';
      const failed = (last: Partial<NonNullable<MailConnection['last']>>, over: Partial<MailConnection> = {}) => mailSays(mail({ written: 3, failed: 1, last: { at, ok: false, what, ...last }, ...over }), false, since, t);
      const when = momentWords(at);
      const counted = ' Since this server started, 1 of 3 could not be handed over at the first try.';
      const lost = ' That email will not be sent again, and the person it was for was not told.';

      const unreachable = failed({ failed: 'unreachable' });
      expect([unreachable.tone, unreachable.tag]).toEqual(['warn', 'Not getting through']);
      expect(unreachable.line).toBe(`The last email, at ${when}, could not be handed over: the provider could not be reached, or did not answer in time. It was “${what}”.${lost}${counted}`);
      const fault = failed({ failed: 'failed', code: 'TM_5001' });
      expect([fault.tone, fault.tag]).toEqual(['warn', 'Not getting through']);
      expect(fault.line).toBe(`The last email, at ${when}, could not be handed over: what came back from the provider’s address was a fault, or was not the provider’s answer at all. It was “${what}”. The provider’s code for it: TM_5001.${lost}${counted}`);
      // A sender that did not say why is said as a fault, never left blank.
      expect(failed({}).line).toMatch(/was a fault, or was not the provider’s answer at all/);

      const turnedDown = failed({ failed: 'rejected', code: 'GE_102' });
      expect([turnedDown.tone, turnedDown.tag]).toEqual(['warn', 'One email turned down']);
      expect(turnedDown.line).toBe(`The last email, at ${when}, was turned down by the provider. It was “${what}”. That is one email: others may be going. The provider’s code for it: GE_102.${lost}${counted}`);

      const limit = failed({ failed: 'limit', code: 'LE_102' });
      expect([limit.tone, limit.tag]).toEqual(['danger', 'Sending limit reached']);
      expect(limit.line).toBe(`The last email, at ${when}, was not taken: the provider’s sending limit or credit is used up, and nothing is delivered until that is put right. It was “${what}”. The provider’s code for it: LE_102.${lost}${counted}`);

      const refused = failed({ failed: 'refused', code: 'SERR_157' });
      expect([refused.tone, refused.tag]).toEqual(['danger', 'Refused by the provider']);
      expect(refused.line).toBe(`The last email, at ${when}, was refused by the provider, and nothing is delivered until that is put right. It was “${what}”. It did not accept the token. The provider’s code for it: SERR_157.${lost}${counted}`);
    });

    it('says of the email that failed whether THAT one is kept to be tried again, or lost — from what the server did with it', () => {
      const failed = (last: Partial<NonNullable<MailConnection['last']>>, over: Partial<MailConnection> = {}) => mailSays(mail({ written: 3, failed: 1, last: { at, ok: false, what: 'Password changed', ...last }, ...over }), false, since, t).line;
      const kept = failed({ failed: 'refused', code: 'SERR_157', again: true }, { waiting: 1, waitingSince: at });
      expect(kept).toContain('That email is kept, and will be tried again.');
      expect(kept).not.toContain('was not told');
      // The same failure, of an email that is not kept — a code — is said as lost. The kind of failure does not decide it.
      const lostOne = failed({ failed: 'refused', code: 'SERR_157' });
      expect(lostOne).toContain('That email will not be sent again, and the person it was for was not told.');
      expect(lostOne).not.toContain('is kept');
    });

    it('says how many wait to be tried again and since when — and that a restart loses them', () => {
      const waiting = mail({ written: 5, failed: 3, waiting: 3, waitingSince: at, last: { at, ok: false, what: 'Password changed', failed: 'unreachable', again: true } });
      expect(mailAgainWords(waiting, t)).toEqual([`Waiting to be tried again: 3, the oldest since ${momentWords(at)}. They wait in this server’s memory: restarting it loses them.`]);
      expect(mailSays(waiting, false, since, t).line).toMatch(/could not be handed over at the first try\. Waiting to be tried again: 3, the oldest since .*restarting it loses them\.$/);
      expect(waitingWords(waiting, t)).toBe(`3 — the oldest since ${momentWords(at)}`);
      // One reads the same way as many: a count, not a sentence that needs a plural.
      expect(mailAgainWords(mail({ waiting: 1, waitingSince: at }), t)[0]).toMatch(/^Waiting to be tried again: 1, the oldest since /);
      expect(waitingWords(mail(), t)).toBe('None');
      // Nothing waiting, nothing went late, nothing lost: nothing is said.
      expect(mailAgainWords(mail({ written: 9, failed: 2 }), t)).toEqual([]);
    });

    it('does not call it a clean bill while some are still waiting or were given up on, even though the last one went', () => {
      const last = { at, ok: true, what: 'Password changed' };
      const catching = mailSays(mail({ written: 6, failed: 2, waiting: 1, waitingSince: at, sentLater: 1, last }), false, since, t);
      expect([catching.tone, catching.tag]).toEqual(['warn', 'Sending, and catching up']);
      expect(catching.line).toMatch(/2 of 6 could not be handed over at the first try\. Waiting to be tried again: 1, .* Handed over on a later try since it started: 1\.$/);
      // All caught up: sending, and the ones that went late are still said — they were late.
      const caughtUp = mailSays(mail({ written: 6, failed: 2, sentLater: 2, last }), false, since, t);
      expect([caughtUp.tone, caughtUp.tag]).toEqual(['ok', 'Sending']);
      expect(caughtUp.line).toMatch(/Handed over on a later try since it started: 2\.$/);
      // Some were lost for good: sending again, and not a clean bill.
      const lostSome = mailSays(mail({ written: 6, failed: 2, gaveUp: 2, last }), false, since, t);
      expect([lostSome.tone, lostSome.tag]).toEqual(['warn', 'Sending']);
      expect(lostSome.line).toMatch(/Given up on since it started: 2 — turned down, possibly already sent, or no longer worth sending\.$/);
    });

    it('says what a refusal is about only where the provider’s code says — and what is known otherwise', () => {
      expect([refusedWhy('SERR_157'), refusedWhy('SM_111'), refusedWhy('SM_128'), refusedWhy('AE_101'), refusedWhy('TM_4001'), refusedWhy(undefined)]).toEqual(['token', 'sender', 'review', 'blocked', 'unknown', 'unknown']);
      const line = (code?: string) => mailSays(mail({ written: 1, failed: 1, last: { at, ok: false, what: 'A code', failed: 'refused', ...(code ? { code } : {}) } }), false, since, t).line;
      expect(line('SM_111')).toMatch(/The address email is sent as is on a domain the provider has not verified for this account\. The provider’s code for it: SM_111\./);
      expect(line('SM_128')).toMatch(/The provider has not approved the account for sending yet\./);
      expect(line('AE_101')).toMatch(/The provider has blocked the account\./);
      // A refusal with no code, or one whose meaning is not stated: not blamed on the token alone.
      expect(line()).toMatch(/It will not send for this account as it is set up\. Check the token, that the sending address is the one your account shows, and that email is sent as an address on a domain the provider has verified\. That email will not be sent again, and the person it was for was not told\. Since/);
      expect(line()).not.toMatch(/code for it/);
      expect(line('TM_4001')).toMatch(/It will not send for this account as it is set up\..* The provider’s code for it: TM_4001\./);
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
    // Email is tried again, so its count is of the first try — and a count with no failures says neither.
    expect(countWords(7, 2, t, true)).toBe('7 — 2 could not be handed over at the first try');
    expect(countWords(7, 0, t, true)).toBe('7');
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
