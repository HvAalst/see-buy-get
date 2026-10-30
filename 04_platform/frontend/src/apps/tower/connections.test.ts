import { describe, expect, it } from 'vitest';
import { t } from '../../shared/i18n';
import { adviserSays, bounceListenWords, checkSays, countWords, mailBounceWords, mailAddressWords, mailAgainWords, mailSays, momentWords, plausible, approvedSays, pushSays, refusedWhy, routerSays, smsCapWords, smsCountryWords, smsRefusedWhy, smsSays, waitingWords, type AdviserConnection, type MailConnection, type PushConnection, type RouterConnection, type SmsConnection } from './connections';

const since = '2026-10-06T06:00:00Z';
const at = '2026-10-06T08:15:00Z';
const router = (over: Partial<RouterConnection> = {}): RouterConnection => ({ configured: true, host: 'osrm.example:5000', profile: 'driving', maxPoints: 100, ...over });
const adviser = (over: Partial<AdviserConnection> = {}): AdviserConnection => ({ configured: true, model: 'claude-opus-5-5', ...over });
// As a server that really sends, with nothing wrong: each test says what is different about its own.
const mail = (over: Partial<MailConnection> = {}): MailConnection => ({ sends: true, tokenSet: true, from: 'noreply@kilima.example', fromIsPlaceholder: false, written: 0, failed: 0, reserved: 0, bounced: 0, bounces: { listening: true, stopped: 0, received: 0, refused: 0, unsigned: 0 }, waiting: 0, sentLater: 0, gaveUp: 0, ...over });
const push = (over: Partial<PushConnection> = {}): PushConnection => ({ sends: true, keys: 'own', devices: 0, people: 0, handed: 0, failed: 0, ...over });
// As a server that really texts, through Twilio, with nothing wrong.
const sms = (over: Partial<SmsConnection> = {}): SmsConnection => ({ sends: true, accountSet: true, credential: 'api_key', sender: 'service', standIn: false, countries: ['+254'], written: 0, failed: 0, fenced: 0, ...over });
const noSms: Partial<SmsConnection> = { sends: false, accountSet: false, credential: undefined, sender: undefined, countries: [] };

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

    it('says when nothing listens for email that comes back — a server that sends, and goes on writing to addresses that bounce', () => {
      const deaf = { listening: false, stopped: 0, received: 0, refused: 0, unsigned: 0 };
      const words = 'Nothing listens for email that comes back, so an address that bounces goes on being written to.';
      expect(mailBounceWords(mail({ bounces: deaf }), t)).toEqual([words]);
      // Before anything was sent, and after: said either way, and it is never a clean bill.
      expect(mailSays(mail({ bounces: deaf }), false, since, t)).toMatchObject({ tone: 'warn', tag: 'Set up, nothing sent yet', line: expect.stringContaining(words) });
      const sending = mailSays(mail({ written: 2, bounces: deaf, last: { at, ok: true, what: 'Password changed' } }), false, since, t);
      expect([sending.tone, sending.tag]).toEqual(['warn', 'Sending']);
      expect(sending.line.endsWith(words)).toBe(true);
      // Listening, and nothing wrong: nothing is said, and sending is a clean bill.
      expect(mailBounceWords(mail(), t)).toEqual([]);
      expect(mailSays(mail({ written: 2, last: { at, ok: true, what: 'Password changed' } }), false, since, t).tone).toBe('ok');
      // Where nothing is sent at all, there is nothing to come back: kept is kept, and that is what is said.
      expect(mailSays(mail({ sends: false, tokenSet: false, bounces: deaf }), true, since, t).line).not.toContain('comes back');
      expect([bounceListenWords(mail({ bounces: deaf }), t), bounceListenWords(mail(), t)]).toEqual(['Not listened for — no key is set', 'Listened for — none has come since it started']);
    });

    it('says when bounce notices come and are refused — how many, when the last, and what to compare', () => {
      const refused = (lastRefused: MailConnection['bounces']['lastRefused'], n = 4, over: Partial<MailConnection['bounces']> = {}) =>
        mail({ written: 2, last: { at, ok: true, what: 'Password changed' }, bounces: { listening: true, stopped: 0, received: 0, refused: n, unsigned: 0, lastRefused, lastRefusedAt: at, ...over } });
      const says = mailSays(refused('mismatch'), false, since, t);
      expect(says.tone).toBe('warn');
      expect(says.line).toMatch(new RegExp(`Signed bounce notices are being refused: 4 since it started, the last at ${momentWords(at)}, and none has been taken since\\. Its signature is not this server’s key’s: compare ZEPTOMAIL_WEBHOOK_KEY with the authentication key on the provider’s webhook\\.$`));
      // Each way of being refused has its own words, and ours — the server not reading raw — is said as ours.
      const whys = (['unsigned', 'algorithm', 'stale', 'mismatch', 'unreadable', 'not_raw'] as const).map((w) => mailBounceWords(refused(w), t)[0]);
      expect(new Set(whys).size).toBe(6);
      expect(whys[5]).toContain('how the server is started, not in the provider');
      expect(whys[2]).toContain('check this server’s clock');
      expect(bounceListenWords(refused('mismatch'), t)).toBe('Listened for — 0 taken, 4 signed and refused, 0 with no signature');
      // One was taken AFTER the last refusal: the key matches now. It is history, left to the counts — and a clean bill.
      const later = new Date(Date.parse(at) + 60_000).toISOString();
      const since1 = refused('mismatch', 4, { received: 1, lastAt: later });
      expect(mailBounceWords(since1, t)).toEqual([]);
      expect(mailSays(since1, false, since, t).tone).toBe('ok');
      // One taken BEFORE the last refusal does not excuse it: something changed since.
      const earlier = new Date(Date.parse(at) - 60_000).toISOString();
      expect(mailBounceWords(refused('mismatch', 4, { received: 1, lastAt: earlier }), t)).toHaveLength(1);
      // Requests with no signature are anybody's: counted, and never a warning — however many, taken or not.
      const found = mail({ written: 2, last: { at, ok: true, what: 'Password changed' }, bounces: { listening: true, stopped: 0, received: 0, refused: 0, unsigned: 250 } });
      expect(mailBounceWords(found, t)).toEqual([]);
      expect(mailSays(found, false, since, t).tone).toBe('ok');
      expect(bounceListenWords(found, t)).toBe('Listened for — 0 taken, 0 signed and refused, 250 with no signature');
      // Taken, and none refused: a fact on the screen, and nothing to warn of.
      const fine = mail({ bounces: { listening: true, stopped: 3, received: 5, refused: 0, unsigned: 0, lastAt: at } });
      expect(mailBounceWords(fine, t)).toEqual([]);
      expect(bounceListenWords(fine, t)).toBe('Listened for — 5 taken, 0 signed and refused, 0 with no signature');
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
      expect(builtIn.line).toMatch(/anybody who can read the code can sign with it too/);
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

  describe('the text that carries a code', () => {
    it('says texting paused at its cap first, in red, with how many and what to do — and the cap as a fact', () => {
      const cap = { perHour: 100, perDay: 500, lastHour: 100, lastDay: 140, held: 3, pausedBy: 'hour' as const, pausedSince: '2026-10-25T14:00:00' };
      const s = smsSays(sms({ written: 140, last: { at: '2026-10-25T14:05:00', ok: false, failed: 'paused' }, cap }), false, '2026-10-25T08:00:00', t);
      expect(s.tone).toBe('danger');
      expect(s.tag).toBe(t('tower.conn.tag.smsPaused'));
      expect(s.line).toContain('100 codes in the last hour reached the cap of 100');
      expect(s.line).toContain('3 codes were not sent');
      expect(s.line).toContain('GLOS_SMS_PER_HOUR');
      expect(smsCapWords(sms({ cap: { ...cap, pausedBy: undefined, lastHour: 12, lastDay: 40 } }), t)).toBe('12 of 100 in the last hour · 40 of 500 in the last day');
      // Lifted, the last text that met it is said like any other failure, in amber.
      expect(smsSays(sms({ written: 2, failed: 0, last: { at: '2026-10-25T14:05:00', ok: false, failed: 'paused' }, cap: { ...cap, pausedBy: undefined } }), false, '2026-10-25T08:00:00', t).tone).toBe('warn');
    });

    it('on a sandbox, kept is how it is meant to run: the code is shown on the screen that asked', () => {
      const s = smsSays(sms({ ...noSms, written: 4 }), true, since, t);
      expect([s.tone, s.tag]).toEqual(['info', 'Kept, not sent']);
      expect(s.line).toBe('No text leaves this server. A code is handed back to the app that asked for it and shown on its screen; the text that would have carried it is kept here — 4 since it started. That is how a sandbox is meant to run.');
    });

    it('off a sandbox with the review code on, it says new accounts get in with 000000, until when, and that it opens no account', () => {
      const s = smsSays(sms(noSms), false, since, t, { until: '2026-11-30' });
      expect([s.tone, s.tag]).toEqual(['warn', 'Review code 000000']);
      expect(s.line).toMatch(/^No text leaves this server, and the review code is on until the end of 2026-11-30 \(UTC\): a NEW account’s number/);
      expect(s.line).toContain('It never signs in to an account that exists');
      // Off (null), and on a sandbox, it is not said at all.
      expect(smsSays(sms(noSms), false, since, t, null).tag).toBe('No code can be sent');
      expect(smsSays(sms(noSms), true, since, t, { until: '2026-11-30' }).tag).not.toBe('Review code 000000');
    });

    it('off a sandbox, kept is nobody getting in — said in red, and not as "kept"', () => {
      const s = smsSays(sms(noSms), false, since, t);
      expect([s.tone, s.tag]).toEqual(['danger', 'No code can be sent']);
      expect(s.line).toMatch(/^No text leaves this server, and this is not a sandbox: a code has no other way to a phone\. Nobody can sign up, confirm a new phone or browser, or replace a PIN/);
      // With part of an account set, which part is missing is said after it.
      const half = smsSays(sms({ ...noSms, accountSet: true, problem: 'no_credential' }), false, since, t);
      expect(half.tone).toBe('danger');
      expect(half.line).toMatch(/before this server is relied on\. Twilio’s account is set and there is nothing to sign with\. Set TWILIO_API_KEY_SID with TWILIO_API_KEY_SECRET, or TWILIO_AUTH_TOKEN, and restart the server\.$/);
    });

    it('says which part of a half-made set-up is missing — and that a sandbox with a whole account still does not text', () => {
      const line = (problem: SmsConnection['problem']) => smsSays(sms({ ...noSms, accountSet: true, problem }), true, since, t);
      expect(line('no_account').line).toMatch(/Set TWILIO_ACCOUNT_SID, and restart the server\.$/);
      expect(line('no_sender').line).toMatch(/nothing says who a text is from\. Set TWILIO_MESSAGING_SERVICE_SID, or TWILIO_FROM/);
      expect(line('not_twilio').line).toMatch(/TWILIO_URL is set\. It is only for a stand-in on the same machine as a sandbox.*Remove it, and restart the server\.$/);
      for (const problem of ['no_account', 'no_credential', 'no_sender', 'not_twilio'] as const) expect([problem, line(problem).tone]).toEqual([problem, 'warn']);
      // A whole account on a sandbox is nobody's mistake.
      const whole = line('sandbox');
      expect([whole.tone, whole.tag]).toEqual(['info', 'Kept, not sent']);
      expect(whole.line).toMatch(/That is how a sandbox is meant to run\. Twilio’s account is set, and this is a sandbox, which does not text: its people are made up, and a made-up number may be somebody’s\.$/);
    });

    it('says nothing has been texted yet, then that the last was handed over — and that handed over is not delivered', () => {
      const none = smsSays(sms(), false, since, t);
      expect([none.tone, none.tag, none.line]).toEqual(['info', 'Set up, nothing sent yet', `No code has been texted since this server started (${momentWords(since)}).`]);
      const good = smsSays(sms({ written: 9, failed: 2, last: { at, ok: true } }), false, since, t);
      expect([good.tone, good.tag]).toEqual(['ok', 'Sending']);
      expect(good.line).toBe(`The last code, at ${momentWords(at)}, was handed to Twilio. Whether it reached the phone is Twilio’s to say: this server does not hear of it. Since this server started, 2 of 9 could not be handed over.`);
    });

    it('says a failure by whose it is: the account’s in red, one number’s as that number’s, a bad minute as a bad minute', () => {
      const met = (failed: NonNullable<SmsConnection['last']>['failed'], code?: string) => smsSays(sms({ written: 3, failed: 1, last: { at, ok: false, failed, code } }), false, since, t);
      const refused = met('refused', '20003');
      expect([refused.tone, refused.tag]).toEqual(['danger', 'Refused by the provider']);
      expect(refused.line).toBe(`The last code, at ${momentWords(at)}, was refused by Twilio, and the person was told it could not be sent. It did not accept the credential, or the credential may not send. Nobody is texted until that is put right. Twilio’s number for it: 20003. Since this server started, 1 of 3 could not be handed over.`);
      // A country that is not switched on stops that country, not everybody — and is said so.
      expect(met('refused', '21408').line).toMatch(/not switched on in the Twilio account’s SMS Geo Permissions\. Numbers in other countries may be going\. Twilio’s number for it: 21408\./);
      expect(met('refused', '21606').line).toMatch(/What texts are sent from is not something this Twilio account can send messages with/);
      expect(met('refused', '21608').line).toMatch(/texts only numbers that were verified with it, until it is upgraded/);
      // A refusal with no number, or one whose meaning is not stated: not blamed on any one thing.
      expect(met('refused').line).toMatch(/It will not text for this account as it is set up\. Check the credential, and what texts are sent from\. Since/);
      expect(met('refused').line).not.toMatch(/number for it/);
      expect(met('refused', '21612').line).toMatch(/It will not text for this account as it is set up\..* Twilio’s number for it: 21612\./);

      const number = met('rejected', '21614');
      expect([number.tone, number.tag]).toEqual(['info', 'One number turned down']);
      expect(number.line).toMatch(/Twilio cannot text that number\. The person was told to check it\. That is one number: others may be going\. Twilio’s number for it: 21614\./);

      expect([met('limit', '20429').tone, met('limit', '20429').tag]).toEqual(['warn', 'Asked to slow down']);
      expect([met('unreachable').tone, met('unreachable').tag]).toEqual(['warn', 'Not getting through']);
      expect(met('unreachable').line).toMatch(/Twilio could not be reached, or did not answer in time\. The person was told it could not be sent, and can ask again at once\./);
      expect(met('failed').line).toMatch(/was a fault, or was not Twilio’s answer at all/);
      // A failure nobody named is said as a fault.
      expect(met(undefined).line).toBe(met('failed').line);
    });

    it('says a stand-in is a stand-in before anything a text met: none of them was handed to Twilio', () => {
      const none = smsSays(sms({ standIn: true }), true, since, t);
      expect(none.line).toMatch(/^Texts go to a stand-in on this machine, not to Twilio: no phone receives one\. No code has been texted/);
      const good = smsSays(sms({ standIn: true, written: 1, last: { at, ok: true } }), true, since, t);
      expect([good.tone, good.tag]).toEqual(['info', 'Sending']);
      expect(good.line).toBe(`Texts go to a stand-in on this machine, not to Twilio: no phone receives one. The last code, at ${momentWords(at)}, was taken by it.`);
      expect(good.line).not.toMatch(/handed to Twilio/);
      expect(smsSays(sms({ standIn: true, written: 1, failed: 1, last: { at, ok: false, failed: 'refused' } }), true, since, t).line).toMatch(/^Texts go to a stand-in on this machine/);
    });

    it('reads a refusal’s number only where Twilio states what it means, and says the countries that were set — or that none was', () => {
      expect(['20003', '21408', '21606', '21608', '21612', '30008', undefined].map(smsRefusedWhy)).toEqual(['credential', 'country', 'sender', 'trial', 'unknown', 'unknown', 'unknown']);
      expect(smsCountryWords(sms({ countries: ['KE +254', 'TZ +255'] }), t)).toBe('KE +254, TZ +255');
      expect(smsCountryWords(sms({ countries: [] }), t)).toBe('None — no country is switched on');
    });
  });

  it('says, when a country is switched on, that its numbers are texted from now — and that Twilio’s own list is changed by hand', () => {
    const on = approvedSays({ jurisdiction: 'TZ', gains: ['takeIn', 'fieldEvidence'] }, t);
    expect(on).toBe('TZ approved — every screen that asks now gets the new answer. Codes are now texted to numbers in TZ. Switch TZ on in the Twilio console too, under SMS Geo Permissions: Twilio does not let anybody do that for you, and until it is done it refuses those texts.');
    // A change that did not switch the country on — it was on already, or only a trade term changed — says no such thing.
    for (const not of [{ jurisdiction: 'KE', gains: ['claims', 'payouts'] }, { jurisdiction: 'KE', gains: [] }, { jurisdiction: 'KE' }]) {
      expect(approvedSays(not, t)).toBe('KE approved — every screen that asks now gets the new answer.');
    }
    expect(approvedSays(undefined, t)).toBe(' approved — every screen that asks now gets the new answer.');
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

describe('the owner’s stand-in codes on the Connections screen (2026-10-30)', () => {
  const plain = { sends: false, written: 0, failed: 0 } as never;
  it('says they are on, how many and until when — never which — in amber, beside the review code too', () => {
    const owner = { numbers: 1, addresses: 1, until: '2026-11-30' };
    const s = smsSays(plain, false, '2026-10-30T08:00:00', t, null, owner);
    expect(s.tone).toBe('warn');
    expect(s.tag).toBe('Stand-in codes');
    expect(s.line).toContain('until the end of 2026-11-30');
    expect(s.line).toContain('1 number and 1 address');
    expect(smsSays(plain, false, '2026-10-30T08:00:00', t, { until: '2026-11-30' }, owner).line).toContain('Stand-in codes are on');
    // On a sandbox, and when off, nothing is said of them.
    expect(smsSays(plain, true, '2026-10-30T08:00:00', t, null, owner).line).not.toContain('Stand-in');
    expect(smsSays(plain, false, '2026-10-30T08:00:00', t, null, null).tag).not.toBe('Stand-in codes');
  });
});
