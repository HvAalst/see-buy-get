import { MailService } from '../../foundation/mail/mail.service';
import { OutboxMailSender } from '../../foundation/mail/outbox-mail.sender';
import { OutboxSmsSender } from '../../foundation/sms/outbox-sms.sender';
import { SmsService } from '../../foundation/sms/sms.service';
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
    const sms = new SmsService(new OutboxSmsSender());
    return { mail, notifications, sms, connections: new ConnectionsController(roads as never, adviser as never, {} as never, mail, notifications, sms) };
  };

  it('carries what each service says of itself, as it stands when it is read', async () => {
    const { mail, sms, connections } = controller();
    const first = connections.view();
    expect(first.sms).toMatchObject({ sends: false, accountSet: false, standIn: false, countries: [], written: 0, failed: 0, fenced: 0 });
    await sms.sendCode('+254712345678', '482615', 10);
    expect(connections.view().sms).toMatchObject({ written: 1, failed: 0, last: { ok: true } });
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
    // Outside a sandbox nothing else about it changes: mail, push and texts are still kept, and it is still said that they are.
    process.env.GLOS_ENV = ' Production ';
    const live = connections.view();
    expect(live.sandbox).toBe(false);
    expect([live.mail.sends, live.push.sends, live.sms.sends]).toEqual([false, false, false]);
  });
});

/**
 * 2026-11-15 — CHECKING THE ROUTE SERVER WITH NO FLEET YET (the owner's screen said "there is no fleet with a depot on the
 * map yet"). It asks about a depot first, as a plan would; with none, a shop, a hub, then a known town in each country —
 * and the first that has a road answers. A map that covers one country is no failure while another place answers.
 */
describe('checking the route server', () => {
  const mail = new MailService(new OutboxMailSender());
  const notifications = new NotificationService(new OutboxPushSender());
  const sms = new SmsService(new OutboxSmsSender());
  const make = (opts: { depots?: unknown[]; shops?: unknown[]; hubs?: unknown[]; answer: (a: { lat: number }) => Record<string, unknown> }) => {
    const asked: Array<{ lat: number; lng: number }> = [];
    const roads = {
      configured: () => true,
      check: async (a: { lat: number; lng: number }) => {
        asked.push(a);
        return { at: 'now', ...opts.answer(a) };
      },
    };
    const managers = { list: () => opts.depots ?? [] };
    const agents = { list: () => opts.shops ?? [] };
    const mdps = { list: () => opts.hubs ?? [] };
    return { asked, c: new ConnectionsController(roads as never, {} as never, managers as never, mail, notifications, sms, undefined, agents as never, mdps as never) };
  };

  it('with no fleet depot, asks at a shop', async () => {
    const { c, asked } = make({ shops: [{ shopName: 'Mama Sarah Shop', location: { lat: -1.29, lng: 36.82 } }], answer: () => ({ ok: true, km: 2.1 }) });
    expect(await c.checkRouter()).toMatchObject({ ok: true, km: 2.1, near: 'Mama Sarah Shop' });
    expect(asked).toEqual([{ lat: -1.29, lng: 36.82 }]);
  });

  it('a place its map has no road for is passed over for the next; nothing on the network, a known town answers', async () => {
    const { c, asked } = make({ hubs: [{ name: 'Ghala Kuu', location: { lat: 9.0, lng: 38.7 } }], answer: (a) => (a.lat > 5 ? { ok: true, noRoad: true } : { ok: true, km: 1.9 }) });
    const got = await c.checkRouter();
    expect(got).toMatchObject({ ok: true, km: 1.9 });
    expect(got.near).not.toBe('Ghala Kuu');
    expect(asked.length).toBeGreaterThan(1);
  });

  it('nothing answers anywhere: the last failure, said', async () => {
    const { c } = make({ answer: () => ({ ok: false, why: 'connection refused' }) });
    expect(await c.checkRouter()).toMatchObject({ ok: false, why: 'connection refused' });
  });
});
