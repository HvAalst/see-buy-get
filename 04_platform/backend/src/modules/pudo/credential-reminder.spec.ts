import { CredentialReminderService } from './credential-reminder.service';
import { FleetManagerService } from './fleet-manager.service';
import { MailService } from '../../foundation/mail/mail.service';
import { OutboxMailSender } from '../../foundation/mail/outbox-mail.sender';

/** A fleet's code, reminded about by email once it is over 90 days old — once per code, never again for the same one. */
describe('the fleet code reminder', () => {
  const DAY = 86_400_000;
  const now = Date.parse('2026-09-13T12:00:00Z');
  const fleet = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    did: `did:glos:fleet-${Math.random().toString(36).slice(2, 8)}`,
    companyName: 'Kilima Logistics',
    contactEmail: 'ops@kilima.example',
    loginCode: 'FM-E4A7D6',
    status: 'ACTIVE',
    createdAt: new Date(now - 120 * DAY).toISOString(),
    ...over,
  });

  const harness = (rows: Array<Record<string, unknown>>) => {
    process.env.GLOS_PERSIST = 'off';
    const outbox = new OutboxMailSender();
    const managers = { list: () => rows } as unknown as FleetManagerService;
    return { outbox, reminders: new CredentialReminderService(managers, new MailService(outbox)) };
  };

  it('tells a fleet whose code is over 90 days old, once, without the code', async () => {
    const f = fleet();
    const { outbox, reminders } = harness([f]);
    expect(await reminders.sweep(now)).toBe(1);
    expect(await reminders.sweep(now + DAY)).toBe(0);
    const [mail] = outbox.recent('ops@kilima.example');
    expect(mail.subject).toBe('Time for a new Kilima Logistics fleet code');
    expect(mail.text).toContain('120 days old');
    expect(mail.text).not.toContain('FM-E4A7D6');
  });

  it('starts a new clock when the code changes', async () => {
    const f = fleet();
    const { reminders } = harness([f]);
    expect(await reminders.sweep(now)).toBe(1);
    f.codeRotatedAt = new Date(now - 10 * DAY).toISOString();
    expect(await reminders.sweep(now)).toBe(0); // a fresh code is not due
    expect(await reminders.sweep(now + 95 * DAY)).toBe(1); // …until it is
  });

  it('leaves alone a young code, a fleet with no contact email, and a fleet that is not active', async () => {
    const { reminders } = harness([
      fleet({ createdAt: new Date(now - 30 * DAY).toISOString() }),
      fleet({ contactEmail: undefined }),
      fleet({ status: 'SUSPENDED' }),
    ]);
    expect(await reminders.sweep(now)).toBe(0);
  });
});
