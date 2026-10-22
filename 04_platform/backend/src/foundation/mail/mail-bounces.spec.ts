import { Logger } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';
import { EVENT_MAX_AGE_MS, EVENT_MAX_AHEAD_MS, bodyForms, producerSignatureFor, readBounces, readProducerSignature, readSignedEvent } from './mail-bounces';
import { MailBounces, SOFT_BOUNCE_PAUSE_H } from './mail-bounces.service';
import { MailService } from './mail.service';
import { MAIL_TEMPLATES, MailTemplateId } from './mail.templates';
import { MailSendError, MailSender, OutgoingMail } from './mail.types';
import { OutboxMailSender } from './outbox-mail.sender';
import { PROVIDER_EVENTS_PATH } from './provider-events.raw';

/*
 * HANDED OVER IS NOT ARRIVED. The provider tells us when an email comes back — and that notice is the one thing on
 * this server that is told, from outside and with nobody signed in, which addresses to stop writing to.
 *
 * So two things are tested. That a notice is believed ONLY when it is signed with the key, in the forms the
 * provider's documentation implies (none has ever been received for real). And what a bounce then does: the address
 * is not written to again, a code still goes, the address can prove itself, and nothing is kept that names it.
 */

const KEY = 'the-authentication-key-set-on-the-webhook';
const T0 = Date.parse('2026-10-07T09:00:00Z');
const HOUR = 3_600_000;

/** The provider's own two samples, as its documentation prints them (webhooks-instant-notification, read 2026-10-07). */
const sample = (kind: 'hardbounce' | 'softbounce', recipient = 'nate@zohomail.com', id = `2d6f.w1.${kind}`) => ({
  event_name: [kind],
  event_message: [
    {
      email_info: {
        cc: [{ email_address: { address: 'alia@zohomail.com', name: 'Alia' } }],
        client_reference: 'customer-unique-reference-to-identify-the-mail',
        bcc: [{ email_address: { address: 'richard@zohomail.com', name: 'Richard' } }],
        is_smtp_trigger: false,
        subject: 'Zylker Orders',
        bounce_address: 'orders@zylker.com',
        email_reference: '2d6f.2f584a3cd668e3a6.m1.13e7de70@zylker.com',
        reply_to: [{ address: 'replyto@zylker.com', name: 'ReplyTo' }],
        from: { address: 'orders@zylker.com', name: 'Zylker Orders' },
        to: [{ email_address: { address: 'nikki@zohomail.com', name: 'Nikki' } }, { email_address: { address: recipient, name: 'Nate' } }],
        tag: 'unknown',
        processed_time: '2024-10-29T07:47:42Z',
        object: 'email',
      },
      event_data: [{ details: [{ reason: 'relaying-issues', bounced_recipient: recipient, time: '2024-10-29T07:47:42Z', diagnostic_message: kind === 'hardbounce' ? 'bad-mailbox' : 'policy-related' }], object: kind }],
      request_id: '2d6f.2f584a3cd668e3a6.m1.13e7de70',
    },
  ],
  mailagent_key: '2d6f.2f584a3cd668e3a6.52e320a75dbd1cc9',
  webhook_request_id: id,
});

/** A notice as the documentation's own sample code reads one: the JSON as a form field, URL-encoded, signed over the JSON. */
const wrapped = (event: unknown, key = KEY, ts = T0) => {
  const json = JSON.stringify(event);
  return { body: Buffer.from(`payload=${encodeURIComponent(json)}`), signature: producerSignatureFor(json, key, ts) };
};

describe('an email that came back', () => {
  const env = { ...process.env };
  beforeAll(() => void jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined));
  afterAll(() => jest.restoreAllMocks());
  afterEach(() => {
    process.env = { ...env };
  });

  describe('whether a notice is the provider’s', () => {
    it('reads the signature header as documented — three parts, in any order — and nothing that is not one', () => {
      expect(readProducerSignature('ts=1596109465823;s=dN0yVozgabP5NPlxMDfP1r5u65bVO9kTGEZMIQlqI2o%3D;s-algorithm=HmacSHA256')).toEqual({ ts: 1596109465823, s: 'dN0yVozgabP5NPlxMDfP1r5u65bVO9kTGEZMIQlqI2o%3D', algorithm: 'HmacSHA256' });
      expect(readProducerSignature('s-algorithm=HmacSHA256; s=abc= ; ts=5')).toEqual({ ts: 5, s: 'abc=', algorithm: 'HmacSHA256' });
      for (const not of [undefined, '', 'ts=1;s=a', 's=a;s-algorithm=HmacSHA256', 'ts=soon;s=a;s-algorithm=HmacSHA256', 'ts=0;s=a;s-algorithm=HmacSHA256', 'ts=1;s=;s-algorithm=HmacSHA256', `ts=1;s=${'a'.repeat(700)};s-algorithm=HmacSHA256`]) expect(readProducerSignature(not)).toBeUndefined();
    });

    it('takes one signed the way the documentation’s own sample checks it: a form field, URL-encoded, signed over the notice inside', () => {
      const { body, signature } = wrapped(sample('hardbounce'));
      const read = readSignedEvent(body, signature, KEY, T0);
      expect(read).toMatchObject({ ok: true, event: { event_name: ['hardbounce'], webhook_request_id: '2d6f.w1.hardbounce' } });
    });

    it('takes the other forms that documentation leaves open — and each still needs the key', () => {
      const json = JSON.stringify(sample('softbounce'));
      const forms: Array<[string, Buffer, string]> = [
        ['the notice as plain JSON, signed as it came', Buffer.from(json), producerSignatureFor(json, KEY, T0)],
        ['a form field that was not URL-encoded', Buffer.from(`data=${json}`), producerSignatureFor(json, KEY, T0)],
        ['a form field, signed with its wrapping', Buffer.from(`payload=${encodeURIComponent(json)}`), producerSignatureFor(`payload=${encodeURIComponent(json)}`, KEY, T0)],
        ['a signature that was not URL-encoded', Buffer.from(json), decodeURIComponent(producerSignatureFor(json, KEY, T0))],
      ];
      for (const [, body, signature] of forms) {
        expect(readSignedEvent(body, signature, KEY, T0)).toMatchObject({ ok: true, event: { event_name: ['softbounce'] } });
        expect(readSignedEvent(body, signature, 'another-key', T0)).toEqual({ ok: false, why: 'mismatch' });
      }
      // The key as the bytes it stands for, where it is written as base64.
      const b64 = Buffer.from('sixteen-bytes-or-more-of-key').toString('base64');
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const signedWithBytes = `ts=${T0};s=${encodeURIComponent(require('crypto').createHmac('sha256', Buffer.from(b64, 'base64')).update(json, 'utf8').digest('base64'))};s-algorithm=HmacSHA256`;
      expect(readSignedEvent(Buffer.from(json), signedWithBytes, b64, T0).ok).toBe(true);
    });

    it('refuses everything else, and says which way — to us, never to whoever sent it', () => {
      const { body, signature } = wrapped(sample('hardbounce'));
      const why = (b: Buffer, s: string | undefined, key = KEY, now = T0) => {
        const r = readSignedEvent(b, s, key, now);
        return r.ok ? 'TAKEN' : r.why;
      };
      expect(why(body, undefined)).toBe('unsigned');
      expect(why(body, 'not a signature')).toBe('unsigned');
      expect(why(body, signature, '')).toBe('unsigned');
      expect(why(body, signature.replace('HmacSHA256', 'HmacMD5'))).toBe('algorithm');
      expect(why(body, signature, 'the-wrong-key')).toBe('mismatch');
      // One address changed in a signed notice: it is another notice, and nobody signed that one.
      expect(why(Buffer.from(body.toString().replace('nate%40zohomail.com', 'boss%40zohomail.com')), signature)).toBe('mismatch');
      expect(why(Buffer.from('payload=%7B%22event_name%22%3A%5B%22hardbounce%22%5D%7D'), signature)).toBe('mismatch');
      // Junk is refused as unsigned-for, not looked into: nothing is parsed before a signature has matched it.
      expect(why(Buffer.from('<html>not a notice</html>'), signature)).toBe('mismatch');
      // Signed with the key, and not a notice.
      expect(why(Buffer.from('payload=hello'), producerSignatureFor('hello', KEY, T0))).toBe('unreadable');
      expect(why(Buffer.from('[1,2,3]'), producerSignatureFor('[1,2,3]', KEY, T0))).toBe('unreadable');
    });

    it('refuses one whose time is not now — to the millisecond, either way', () => {
      const event = sample('hardbounce');
      const at = (ts: number) => {
        const { body, signature } = wrapped(event, KEY, ts);
        const r = readSignedEvent(body, signature, KEY, T0);
        return r.ok ? 'taken' : r.why;
      };
      expect(at(T0 - EVENT_MAX_AGE_MS)).toBe('taken');
      expect(at(T0 - EVENT_MAX_AGE_MS - 1)).toBe('stale');
      expect(at(T0 + EVENT_MAX_AHEAD_MS)).toBe('taken');
      expect(at(T0 + EVENT_MAX_AHEAD_MS + 1)).toBe('stale');
    });

    it('never takes a “=” inside a notice for a form field’s', () => {
      const json = JSON.stringify({ event_name: ['hardbounce'], note: 'a=b' });
      expect(bodyForms(Buffer.from(json))).toEqual([json]);
      expect(bodyForms(Buffer.from(`payload=${json}`))).toEqual([`payload=${json}`, json]);
    });
  });

  describe('what a notice says', () => {
    it('is read from the provider’s own samples: who it came back from, for good or for now, and its short word for why', () => {
      expect(readBounces(sample('hardbounce'))).toEqual({ id: '2d6f.w1.hardbounce', bounces: [{ address: 'nate@zohomail.com', kind: 'hard', reason: 'bad-mailbox' }] });
      expect(readBounces(sample('softbounce'))).toEqual({ id: '2d6f.w1.softbounce', bounces: [{ address: 'nate@zohomail.com', kind: 'soft', reason: 'policy-related' }] });
    });

    it('takes only the address that came back — never the others the email went to', () => {
      const all = JSON.stringify(readBounces(sample('hardbounce')));
      for (const other of ['nikki@', 'alia@', 'richard@', 'orders@', 'replyto@']) expect(all).not.toContain(other);
    });

    it('does not depend on a list being a list: a provider that changed that would be one whose bounces we stopped hearing', () => {
      const one = { event_name: 'hard bounce', event_message: { event_data: { details: { bounced_recipient: ' Nate@ZohoMail.com ' } } }, webhook_request_id: 'w1' };
      expect(readBounces(one)).toEqual({ id: 'w1', bounces: [{ address: 'nate@zohomail.com', kind: 'hard' }] });
      // What the entry says it is comes before the notice's name: a notice may carry both kinds.
      const mixed = { event_name: ['hardbounce'], event_message: [{ event_data: [{ object: 'softbounce', details: [{ bounced_recipient: 'a@kilima.co.ke' }] }, { object: 'hardbounce', details: [{ bounced_recipient: 'b@kilima.co.ke' }] }] }] };
      expect(readBounces(mixed).bounces).toEqual([{ address: 'a@kilima.co.ke', kind: 'soft' }, { address: 'b@kilima.co.ke', kind: 'hard' }]);
    });

    it('reads an open, a click, or anything else as no bounce at all — and junk without falling over', () => {
      const open = { event_name: ['email_open'], event_message: [{ event_data: [{ object: 'email_open', details: [{ bounced_recipient: 'nate@zohomail.com', time: 'x' }] }] }] };
      expect(readBounces(open).bounces).toEqual([]);
      // A hard-bounce notice whose entry says it is something else is not a bounce either.
      expect(readBounces({ event_name: ['hardbounce'], event_message: [{ event_data: [{ object: 'email_link_click', details: [{ bounced_recipient: 'nate@zohomail.com' }] }] }] }).bounces).toEqual([]);
      for (const junk of [{}, { event_name: 7, event_message: 'x' }, { event_name: ['hardbounce'], event_message: [null, 3, { event_data: [null, { details: [null, { bounced_recipient: 7 }, { bounced_recipient: 'not an address' }, { bounced_recipient: 'a@b' }] }] }] }]) {
        expect(readBounces(junk as Record<string, unknown>).bounces).toEqual([]);
      }
    });

    it('keeps the provider’s reason only when it is a word: a sentence can name the person', () => {
      const withReason = (reason: unknown, diagnostic?: unknown) => readBounces({ event_name: ['hardbounce'], event_message: [{ event_data: [{ details: [{ bounced_recipient: 'a@kilima.co.ke', reason, diagnostic_message: diagnostic }] }] }] }).bounces[0].reason;
      expect(withReason('relaying-issues', 'bad-mailbox')).toBe('bad-mailbox');
      expect(withReason('Mailbox-Full')).toBe('mailbox-full');
      expect(withReason('550 5.1.1 <amina@kilima.co.ke>: user unknown')).toBeUndefined();
      expect(withReason('relaying-issues', '550 5.1.1 <amina@kilima.co.ke>: user unknown')).toBe('relaying-issues');
      expect(withReason(404)).toBeUndefined();
    });
  });

  describe('listening for them', () => {
    const listening = () => {
      process.env.ZEPTOMAIL_WEBHOOK_KEY = ` ${KEY} `;
      return new MailBounces();
    };
    const refused = (fn: () => unknown) => {
      try {
        fn();
        return 'TAKEN';
      } catch (e) {
        return (e as { code?: string }).code;
      }
    };

    it('is not there at all until a key is set: the address answers as one that does not exist, and counts nothing', () => {
      delete process.env.ZEPTOMAIL_WEBHOOK_KEY;
      const bounces = new MailBounces();
      const { body, signature } = wrapped(sample('hardbounce'));
      expect(refused(() => bounces.take(body, signature, T0))).toBe('NOT_FOUND');
      expect(bounces.connection(T0)).toEqual({ listening: false, stopped: 0, received: 0, refused: 0, unsigned: 0 });
      expect(bounces.stopped('nate@zohomail.com', T0)).toBeUndefined();
    });

    it('takes a signed notice: the address is stopped, and what is kept does not name it', () => {
      const bounces = listening();
      const { body, signature } = wrapped(sample('hardbounce'));
      expect(bounces.take(body, signature, T0)).toBe(1);
      expect(bounces.stopped('nate@zohomail.com', T0)).toBe('hard');
      expect(bounces.stopped(' Nate@ZohoMail.COM ', T0)).toBe('hard');
      expect(bounces.stopped('nikki@zohomail.com', T0)).toBeUndefined();
      const kept = JSON.stringify([...(bounces as unknown as { addresses: Map<string, unknown> }).addresses.entries()]);
      expect(kept).not.toMatch(/nate|zohomail/i);
      expect(kept).toContain('bad-mailbox');
      expect(bounces.connection(T0)).toEqual({ listening: true, stopped: 1, received: 1, refused: 0, unsigned: 0, lastAt: new Date(T0).toISOString() });
    });

    it('refuses what is not signed with the key — counted, with why, and nothing is stopped by it', () => {
      const bounces = listening();
      const { body } = wrapped(sample('hardbounce'));
      expect(refused(() => bounces.take(body, wrapped(sample('hardbounce'), 'somebody-elses-key').signature, T0 + 1000))).toBe('UNAUTHORIZED');
      expect(bounces.stopped('nate@zohomail.com', T0)).toBeUndefined();
      expect(bounces.connection(T0)).toEqual({ listening: true, stopped: 0, received: 0, refused: 1, unsigned: 0, lastRefused: 'mismatch', lastRefusedAt: new Date(T0 + 1000).toISOString() });
    });

    it('counts a request with no signature apart: the address is public, and that one is anybody’s — it does not write over why the provider’s own was refused', () => {
      const bounces = listening();
      const { body } = wrapped(sample('hardbounce'));
      expect(refused(() => bounces.take(body, wrapped(sample('hardbounce'), 'somebody-elses-key').signature, T0))).toBe('UNAUTHORIZED');
      // Then the internet finds the address: nothing, junk, a header that is not one.
      for (const header of [undefined, '', 'Bearer abc', 'ts=1;s=a']) expect(refused(() => bounces.take(body, header, T0 + 5000))).toBe('UNAUTHORIZED');
      // …and with no signature it is anybody's whatever its body is — bytes or not.
      expect(refused(() => bounces.take({ payload: 'x' }, undefined, T0 + 6000))).toBe('UNAUTHORIZED');
      expect(bounces.connection(T0)).toEqual({ listening: true, stopped: 0, received: 0, refused: 1, unsigned: 5, lastRefused: 'mismatch', lastRefusedAt: new Date(T0).toISOString() });
      expect(bounces.stopped('nate@zohomail.com', T0)).toBeUndefined();
    });

    it('refuses a body that is not the bytes it arrived in — a signature cannot be checked against what a parser made of it', () => {
      const bounces = listening();
      const { signature } = wrapped(sample('hardbounce'));
      // What the server's ordinary parsers would have handed over, had the address not been read raw.
      expect(refused(() => bounces.take({ payload: JSON.stringify(sample('hardbounce')) }, signature, T0))).toBe('UNAUTHORIZED');
      expect(refused(() => bounces.take(sample('hardbounce'), signature, T0))).toBe('UNAUTHORIZED');
      expect(refused(() => bounces.take(undefined, signature, T0))).toBe('UNAUTHORIZED');
      expect(bounces.connection(T0)).toMatchObject({ refused: 3, unsigned: 0, lastRefused: 'not_raw', stopped: 0 });
    });

    it('acts once on a notice sent twice', () => {
      const bounces = listening();
      const first = wrapped(sample('softbounce'), KEY, T0);
      expect(bounces.take(first.body, first.signature, T0)).toBe(1);
      // The same notice again, an hour on, with a new time on it (which nobody signed).
      const again = wrapped(sample('softbounce'), KEY, T0 + HOUR);
      expect(bounces.take(again.body, again.signature, T0 + HOUR)).toBe(0);
      // So the pause still ends a day after the FIRST, not the second.
      expect(bounces.stopped('nate@zohomail.com', T0 + SOFT_BOUNCE_PAUSE_H * HOUR - 1)).toBe('soft');
      expect(bounces.stopped('nate@zohomail.com', T0 + SOFT_BOUNCE_PAUSE_H * HOUR)).toBeUndefined();
    });

    it('pauses an address for a day after a soft bounce, and stops it for good after a hard one — which a later soft one never softens', () => {
      const bounces = listening();
      bounces.record('full@kilima.co.ke', 'soft', 'mailbox-full', T0);
      expect(bounces.stopped('full@kilima.co.ke', T0)).toBe('soft');
      expect(bounces.connection(T0).stopped).toBe(1);
      expect(bounces.connection(T0 + SOFT_BOUNCE_PAUSE_H * HOUR).stopped).toBe(0);
      bounces.record('gone@kilima.co.ke', 'hard', undefined, T0);
      bounces.record('gone@kilima.co.ke', 'soft', undefined, T0 + HOUR);
      expect(bounces.stopped('gone@kilima.co.ke', T0 + 1000 * HOUR)).toBe('hard');
      // An address proves itself: email to it starts again.
      bounces.works('GONE@kilima.co.ke');
      expect(bounces.stopped('gone@kilima.co.ke', T0 + HOUR)).toBeUndefined();
      bounces.works('never-bounced@kilima.co.ke');
    });
  });

  describe('what a bounce changes about sending', () => {
    /** A sender that takes everything, and says what it was given. */
    const sending = (bounces: MailBounces) => {
      const got: OutgoingMail[] = [];
      const sender: MailSender = { send: async (m) => void got.push(m) };
      const mail = new MailService(sender, bounces);
      return { mail, got };
    };
    const notice = (mail: MailService, address: string, at = T0) => mail.send('password-changed', { address }, MAIL_TEMPLATES['password-changed'].sample, at);
    const code = (mail: MailService, address: string, at = T0) => mail.send('email-code', { address }, MAIL_TEMPLATES['email-code'].sample, at);

    it('does not write again to an address email came back from — and counts what it held back', async () => {
      const bounces = new MailBounces();
      bounces.record('gone@kilima.co.ke', 'hard', undefined, T0);
      const { mail, got } = sending(bounces);
      expect(await notice(mail, 'gone@kilima.co.ke')).toBe(false);
      expect(await notice(mail, 'GONE@Kilima.co.ke ')).toBe(false);
      expect(await notice(mail, 'fine@kilima.co.ke')).toBe(true);
      expect(got.map((m) => m.to.address)).toEqual(['fine@kilima.co.ke']);
      expect(mail.connection(T0)).toMatchObject({ written: 1, failed: 0, bounced: 2, bounces: { stopped: 1 } });
    });

    it('still sends a code there: somebody is at a screen asking for it, and reading it is how the address proves itself', async () => {
      const bounces = new MailBounces();
      bounces.record('gone@kilima.co.ke', 'hard', undefined, T0);
      const { mail, got } = sending(bounces);
      expect(await code(mail, 'gone@kilima.co.ke')).toBe(true);
      expect(await mail.send('password-reset', { address: 'gone@kilima.co.ke' }, MAIL_TEMPLATES['password-reset'].sample, T0)).toBe(true);
      expect(got.map((m) => m.template)).toEqual(['email-code', 'password-reset']);
      // It read the code: it works. The next notice goes.
      mail.addressWorks('gone@kilima.co.ke');
      expect(await notice(mail, 'gone@kilima.co.ke')).toBe(true);
      expect(mail.connection(T0)).toMatchObject({ bounced: 0, bounces: { stopped: 0 } });
    });

    it('says which emails are asked for at a screen: the two codes — and such an email is never one that is sent late', () => {
      const asked = (Object.keys(MAIL_TEMPLATES) as MailTemplateId[]).filter((id) => MAIL_TEMPLATES[id].asked);
      expect(asked.sort()).toEqual(['email-code', 'password-reset']);
      for (const id of asked) expect(MAIL_TEMPLATES[id].sendLater).toBe(false);
    });

    it('holds an address back for the day after a soft bounce, and then writes to it again', async () => {
      const bounces = new MailBounces();
      bounces.record('full@kilima.co.ke', 'soft', undefined, T0);
      const { mail, got } = sending(bounces);
      expect(await notice(mail, 'full@kilima.co.ke', T0 + SOFT_BOUNCE_PAUSE_H * HOUR - 1)).toBe(false);
      expect(await notice(mail, 'full@kilima.co.ke', T0 + SOFT_BOUNCE_PAUSE_H * HOUR)).toBe(true);
      expect(got).toHaveLength(1);
    });

    it('holds nothing back where nothing is sent: the outbox keeps every email, as a sandbox should', async () => {
      const bounces = new MailBounces();
      bounces.record('gone@kilima.co.ke', 'hard', undefined, T0);
      const outbox = new OutboxMailSender();
      const mail = new MailService(outbox, bounces);
      expect(await notice(mail, 'gone@kilima.co.ke')).toBe(true);
      expect(outbox.recent('gone@kilima.co.ke')).toHaveLength(1);
      expect(mail.connection(T0)).toMatchObject({ sends: false, bounced: 0 });
    });

    it('gives up on an email that was waiting when its address came back — it is not sent to bounce too', async () => {
      const bounces = new MailBounces();
      let up = false;
      const got: string[] = [];
      const sender: MailSender = { send: async (m) => (up ? void got.push(m.to.address) : Promise.reject(new MailSendError('unreachable', 'the mail provider could not be reached', undefined, true))) };
      const mail = new MailService(sender, bounces);
      await notice(mail, 'gone@kilima.co.ke');
      await notice(mail, 'fine@kilima.co.ke');
      expect(mail.connection(T0).waiting).toBe(2);
      bounces.record('gone@kilima.co.ke', 'hard', undefined, T0 + 1000);
      up = true;
      await mail.tryWaiting(T0 + 60_000);
      expect(got).toEqual(['fine@kilima.co.ke']);
      expect(mail.connection(T0 + 60_000)).toMatchObject({ waiting: 0, sentLater: 1, gaveUp: 1 });
      mail.onModuleDestroy();
    });

    it('holds nothing back when it was built without the list — and says nothing is listened for', async () => {
      const got: OutgoingMail[] = [];
      const mail = new MailService({ send: async (m) => void got.push(m) });
      expect(await notice(mail, 'gone@kilima.co.ke')).toBe(true);
      expect(mail.connection(T0)).toMatchObject({ bounced: 0, bounces: { listening: false, stopped: 0, received: 0, refused: 0, unsigned: 0 } });
    });
  });

  it('is read as raw bytes where the server starts, before anything else reads a body — or nothing could be checked', () => {
    const main = readFileSync(join(__dirname, '..', '..', 'main.ts'), 'utf8');
    const raw = main.indexOf('readProviderEventsRaw(app);');
    expect(raw).toBeGreaterThan(0);
    // Before every other body parser the server puts in.
    expect(raw).toBeLessThan(main.indexOf('app.use('));
    expect(main.indexOf('json(', raw)).toBeGreaterThan(raw);
    expect(PROVIDER_EVENTS_PATH).toBe('/v1/mail/provider/events');
  });
});
