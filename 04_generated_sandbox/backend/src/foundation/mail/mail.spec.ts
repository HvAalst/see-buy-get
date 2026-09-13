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
    });
  });

  it('records what it would send, and never throws when sending fails', async () => {
    const outbox = new OutboxMailSender();
    expect(await new MailService(outbox).send('fleet-code-due', { address: 'ops@kilima.example' }, { company: 'Kilima', days: 120 })).toBe(true);
    expect(outbox.recent('OPS@kilima.example')[0]).toMatchObject({ template: 'fleet-code-due', tracking: false });

    const broken: MailSender = { send: async () => Promise.reject(new Error('provider down')) };
    const quiet = new MailService(broken);
    (quiet as unknown as { logger: { error: () => void } }).logger = { error: () => undefined };
    await expect(quiet.send('fleet-code-due', { address: 'ops@kilima.example' }, { company: 'Kilima', days: 120 })).resolves.toBe(false);
    expect(await quiet.send('fleet-code-due', { address: 'not-an-address' }, { company: 'Kilima', days: 120 })).toBe(false);
    expect(maskAddress('amina@example.com')).toBe('a…@example.com');
  });
});
