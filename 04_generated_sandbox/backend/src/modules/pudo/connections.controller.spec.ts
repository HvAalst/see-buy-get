import { MailService } from '../../foundation/mail/mail.service';
import { OutboxMailSender } from '../../foundation/mail/outbox-mail.sender';
import { ConnectionsController } from './connections.controller';
import { NotificationService } from './notification.service';
import { OutboxPushSender } from './push-sender';

/**
 * What staff are shown of mail and push is put together here from what each service says of itself — and whether
 * this server is a sandbox, which decides how "kept, not sent" is read: as the way it is meant to run, or as people
 * who are never told.
 */
describe('what this server is connected to — mail, push, and whether it is a sandbox', () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });

  const controller = () => {
    const roads = { status: () => ({ configured: false, profile: 'driving', maxPoints: 100 }) };
    const adviser = { connection: () => ({ configured: false, model: 'a-model' }) };
    const mail = new MailService(new OutboxMailSender());
    const notifications = new NotificationService(new OutboxPushSender());
    return { mail, notifications, connections: new ConnectionsController(roads as never, adviser as never, {} as never, mail, notifications) };
  };

  it('carries what each service says of itself, as it stands when it is read', async () => {
    const { mail, connections } = controller();
    const first = connections.view();
    expect(first.mail).toMatchObject({ sends: false, written: 0, failed: 0 });
    expect(first.push).toMatchObject({ sends: false, keys: 'built_in', handed: 0, failed: 0 });
    expect(Date.parse(first.since)).toBeLessThanOrEqual(Date.now());
    await mail.send('fleet-code-due', { address: 'ops@kilima.example' }, { company: 'Kilima', days: 120 });
    expect(connections.view().mail).toMatchObject({ written: 1, last: { ok: true } });
  });

  it('says whether this is a sandbox by the one switch the whole server obeys', () => {
    const { connections } = controller();
    delete process.env.GLOS_ENV;
    expect(connections.view().sandbox).toBe(true);
    process.env.GLOS_ENV = 'development';
    expect(connections.view().sandbox).toBe(true);
    // Outside a sandbox nothing else about it changes: mail and push are still kept, and it is still said that they are.
    process.env.GLOS_ENV = ' Production ';
    const live = connections.view();
    expect(live.sandbox).toBe(false);
    expect([live.mail.sends, live.push.sends]).toEqual([false, false]);
  });
});
