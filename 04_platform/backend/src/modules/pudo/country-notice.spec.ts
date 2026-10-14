import { MailService } from '../../foundation/mail/mail.service';
import { OutboxMailSender } from '../../foundation/mail/outbox-mail.sender';
import { CountryNoticeService } from './country-notice.service';
import { NotificationService } from './notification.service';
import { OutboxPushSender } from './push-sender';

/**
 * NOBODY USED TO BE TOLD THAT THEIR COUNTRY WAS BEING WOUND DOWN: the impact counted them and nothing messaged them.
 * Now everybody registered there hears what stops for them, and what does not — in their app, and by email where
 * they gave an address.
 */
describe('a country lowered tells everybody registered there', () => {
  const shops = [
    { did: 'did:shop:ug', shopName: 'Kampala Shop', country: 'UG' },
    { did: 'did:shop:ke', shopName: 'Nairobi Shop', country: 'KE' },
  ];
  const hubs = [{ did: 'did:hub:ug', name: 'Kampala Sort', country: 'UG' }];
  const stores = [{ did: 'did:store:ug', name: 'Kampala Threads', country: 'UG' }];
  const fleets = [{ did: 'did:fleet:ug', companyName: 'Entebbe Haulage', jurisdiction: 'UG', contactEmail: 'office@entebbe.example' }];
  const drivers = [
    { did: 'did:driver:ug', displayName: 'Okello', jurisdiction: 'UG' },
    { did: 'did:driver:ke', displayName: 'Amos', jurisdiction: 'KE' },
  ];
  const emails: Record<string, string> = { 'did:shop:ug': 'shop@kampala.example', 'did:shop:ke': 'shop@nairobi.example' };

  const build = () => {
    const notifications = new NotificationService(new OutboxPushSender());
    const outbox = new OutboxMailSender();
    const notice = new CountryNoticeService(
      notifications,
      { list: () => shops, countryOf: (a: { country: string }) => a.country } as never,
      { list: () => hubs, countryOf: (m: { country: string }) => m.country } as never,
      { list: () => stores } as never,
      { list: () => fleets } as never,
      { list: () => drivers } as never,
      { emailForDid: (did: string) => emails[did] } as never,
      new MailService(outbox),
    );
    return { notifications, outbox, notice };
  };

  it('tells every shop, hub, store, fleet and driver there what stops for them, and what does not — and nobody elsewhere', async () => {
    const { notifications, notice } = build();
    const result = await notice.tellLowered({ jurisdiction: 'ug', level: 'matched', lost: ['holdFloat', 'payouts'] });
    expect(result.told).toBe(5);
    for (const did of ['did:shop:ug', 'did:hub:ug', 'did:store:ug', 'did:fleet:ug', 'did:driver:ug']) {
      const [said] = notifications.inboxFor(did);
      expect(said).toMatchObject({ kind: 'country_changed', title: 'What changes for you in Uganda from today', data: { country: 'UG', level: 'matched' } });
      expect(said.body).toBe(
        'From today a shop here can no longer keep a float with us; we cannot pay out here for now, so what is owed waits. Parcels already on a shelf stay there to be collected, and what is owed to you stays owed.',
      );
    }
    for (const did of ['did:shop:ke', 'did:driver:ke']) expect(notifications.inboxFor(did)).toEqual([]);
  });

  it('emails the ones who gave an address — the Hub app has no inbox to read it in — and says the same two lists', async () => {
    const { outbox, notice } = build();
    const result = await notice.tellLowered({ jurisdiction: 'UG', level: 'observed', lost: ['takeIn'] });
    // The Kampala shop's account address and the fleet's own contact address; the driver and the hub gave none.
    expect(result.emailed).toBe(2);
    const sent = outbox.recent().filter((m) => m.template === 'country-changed');
    expect(sent.map((m) => m.to.address).sort()).toEqual(['office@entebbe.example', 'shop@kampala.example']);
    expect(sent[0].subject).toBe('What changes for you in Uganda from today');
    expect(sent[0].text).toContain('No new parcel can be taken in or sent from here');
    expect(sent[0].text).toContain('Parcels already on a shelf stay there to be collected');
    expect(outbox.recent('shop@nairobi.example')).toEqual([]);
  });

  it('says nothing for a change that takes nothing away', async () => {
    const { notifications, outbox, notice } = build();
    expect(await notice.tellLowered({ jurisdiction: 'UG', level: 'established', lost: [] })).toEqual({ told: 0, emailed: 0 });
    expect(notifications.inboxFor('did:shop:ug')).toEqual([]);
    expect(outbox.recent()).toEqual([]);
  });
});
