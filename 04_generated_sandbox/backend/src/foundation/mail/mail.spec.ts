import { MAIL_TEMPLATES, MailTemplateId, formatWhen, renderMail } from './mail.templates';
import { MailService, maskAddress } from './mail.service';
import { OutboxMailSender } from './outbox-mail.sender';
import { toZeptoMailRequest } from './zeptomail';
import { MailSender } from './mail.types';

describe('the network’s emails', () => {
  const ids = Object.keys(MAIL_TEMPLATES) as MailTemplateId[];

  it('renders every email with its sample, with nothing left unfilled', () => {
    for (const id of ids) {
      const mail = renderMail(id, MAIL_TEMPLATES[id].sample as never);
      expect(mail.subject.length).toBeGreaterThan(5);
      for (const body of [mail.html, mail.text, mail.subject, mail.preheader]) expect(body).not.toMatch(/undefined|NaN|\[object Object\]/);
      expect(mail.html).toContain(`<title>`);
      expect(mail.text).toContain('Please do not reply');
    }
  });

  it('puts the reset code in both the HTML and the plain text', () => {
    const mail = renderMail('password-reset', { email: 'a@example.com', code: 'RST-12345678', minutes: 30, app: 'mdp' });
    expect(mail.html).toContain('RST-12345678');
    expect(mail.text).toContain('Reset code: RST-12345678');
    expect(mail.text).toContain('Hub app');
  });

  it('escapes whatever it is given, and never makes a link from anything but a web address', () => {
    const mail = renderMail('order-on-its-way', { store: '<script>alert(1)</script>', shop: 'O’Brien & Sons', trackingUrl: 'javascript:alert(1)' });
    expect(mail.html).not.toContain('<script>alert(1)</script>');
    expect(mail.html).toContain('&lt;script&gt;');
    expect(mail.html).toContain('O’Brien &amp; Sons');
    expect(mail.html).not.toContain('javascript:');
  });

  it('never puts a fleet code or a password in an email that announces one', () => {
    const issued = renderMail('fleet-code-issued', { company: 'Kilima', when: '2026-09-13T17:42:00Z', byStaff: true });
    expect(issued.text).toMatch(/not in this email/);
    expect(issued.text).not.toMatch(/FM-[0-9A-F]{6}/);
    const added = renderMail('staff-account-added', MAIL_TEMPLATES['staff-account-added'].sample);
    expect(added.text).toMatch(/never sent by email/);
  });

  it('writes one unambiguous time for every reader', () => {
    expect(formatWhen('2026-09-13T07:05:00Z')).toBe('13 Sep 2026, 07:05 UTC');
  });

  it('builds exactly the request ZeptoMail takes, with tracking off', () => {
    const mail = { ...renderMail('welcome', MAIL_TEMPLATES.welcome.sample), template: 'welcome' as const, to: { address: 'amina@example.com', name: 'Amina' }, reference: 'welcome:abc', tracking: false };
    expect(toZeptoMailRequest(mail, { address: 'noreply@seebuyget.com', name: 'SeeBuyGet' })).toEqual({
      from: { address: 'noreply@seebuyget.com', name: 'SeeBuyGet' },
      to: [{ email_address: { address: 'amina@example.com', name: 'Amina' } }],
      subject: mail.subject,
      htmlbody: mail.html,
      textbody: mail.text,
      client_reference: 'welcome:abc',
      track_clicks: false,
      track_opens: false,
      // The logo, inside the email: what the HTML's `cid:` points at (mail.brand.spec.ts).
      inline_images: mail.images.map((i) => ({ mime_type: i.mimeType, name: i.name, content: i.base64, cid: i.cid })),
    });
    expect(mail.images).toHaveLength(1);
  });

  it('records what it would send, and never throws when sending fails', async () => {
    const outbox = new OutboxMailSender();
    expect(await new MailService(outbox).send('fleet-code-due', { address: 'ops@kilima.example' }, { company: 'Kilima', days: 120 })).toBe(true);
    expect(outbox.recent('OPS@kilima.example')[0]).toMatchObject({ template: 'fleet-code-due', tracking: false });

    const broken: MailSender = { send: async () => Promise.reject(new Error('provider down')) };
    const quiet = new MailService(broken);
    (quiet as unknown as { logger: { error: () => void } }).logger = { error: () => undefined };
    await expect(quiet.send('fleet-code-due', { address: 'ops@kilima.co.ke' }, { company: 'Kilima', days: 120 })).resolves.toBe(false);
    expect(await quiet.send('fleet-code-due', { address: 'not-an-address' }, { company: 'Kilima', days: 120 })).toBe(false);
    expect(maskAddress('amina@example.com')).toBe('a…@example.com');
  });

  describe('where an email goes, as staff are shown it', () => {
    const env = { ...process.env };
    afterEach(() => {
      process.env = { ...env };
    });
    const due = { company: 'Kilima', days: 120 };

    it('says nothing leaves while the outbox is the sender — whatever is set in the environment', async () => {
      delete process.env.ZEPTOMAIL_TOKEN;
      delete process.env.MAIL_FROM_ADDRESS;
      const mail = new MailService(new OutboxMailSender());
      expect(mail.connection()).toEqual({ sends: false, tokenSet: false, from: 'noreply@seebuyget.example', fromIsPlaceholder: true, written: 0, failed: 0, reserved: 0 });

      // A token and a real address are settings. Neither is a sender: emails are still kept, and that is still said.
      process.env.ZEPTOMAIL_TOKEN = ' a-token ';
      process.env.MAIL_FROM_ADDRESS = 'noreply@kilima.co.ke';
      expect(mail.connection()).toMatchObject({ sends: false, tokenSet: true, from: 'noreply@kilima.co.ke', fromIsPlaceholder: false });
      // An address of the operator's own choosing on a domain nobody can own is no better than the one it starts with.
      process.env.MAIL_FROM_ADDRESS = 'noreply@kilima.example';
      expect(mail.connection()).toMatchObject({ from: 'noreply@kilima.example', fromIsPlaceholder: true });
      process.env.MAIL_FROM_ADDRESS = 'noreply@kilima.co.ke';
      process.env.ZEPTOMAIL_TOKEN = '   ';
      expect(mail.connection().tokenSet).toBe(false);

      // What it wrote is counted, and the last is named by what it was — never by who it was for.
      await mail.send('fleet-code-due', { address: 'ops@kilima.example' }, due);
      const said = mail.connection();
      expect(said).toMatchObject({ written: 1, failed: 0, last: { ok: true, what: MAIL_TEMPLATES['fleet-code-due'].title } });
      expect(JSON.stringify(said)).not.toContain('ops@kilima.example');
      expect(JSON.stringify(said)).not.toContain('a-token');
    });

    it('says it sends once anything but the outbox is the sender, and counts what could not be handed over', async () => {
      let down = false;
      const real: MailSender = { send: async () => (down ? Promise.reject(new Error('provider down')) : undefined) };
      const mail = new MailService(real);
      (mail as unknown as { logger: { error: () => void } }).logger = { error: () => undefined };
      expect(mail.connection()).toMatchObject({ sends: true, written: 0, failed: 0 });
      expect(mail.connection().last).toBeUndefined();

      await mail.send('fleet-code-due', { address: 'ops@kilima.co.ke' }, due);
      expect(mail.connection()).toMatchObject({ written: 1, failed: 0, last: { ok: true } });
      down = true;
      await mail.send('fleet-code-due', { address: 'ops@kilima.co.ke' }, due);
      expect(mail.connection()).toMatchObject({ written: 2, failed: 1, last: { ok: false, what: MAIL_TEMPLATES['fleet-code-due'].title } });
      down = false;
      await mail.send('fleet-code-due', { address: 'ops@kilima.co.ke' }, due);
      expect(mail.connection()).toMatchObject({ written: 3, failed: 1, last: { ok: true } });

      // Something that is not an address was never an email: it is not counted as one that failed.
      await mail.send('fleet-code-due', { address: 'not-an-address' }, due);
      expect(mail.connection()).toMatchObject({ written: 3, failed: 1 });
      // What is handed back is a copy: nobody reading it can change what the next reader is told.
      mail.connection().last!.ok = false;
      expect(mail.connection().last!.ok).toBe(true);
    });
  });
});
