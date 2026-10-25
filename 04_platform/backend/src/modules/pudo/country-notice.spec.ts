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
    { did: 'did:shop:ug', shopName: 'Kampala Shop', country: 'UG', status: 'ACTIVE' },
    { did: 'did:shop:ke', shopName: 'Nairobi Shop', country: 'KE', status: 'ACTIVE' },
  ];
  const hubs = [{ did: 'did:hub:ug', name: 'Kampala Sort', country: 'UG', vetting: { state: 'approved' } }];
  const stores = [{ did: 'did:store:ug', name: 'Kampala Threads', country: 'UG' }];
  // Its papers are in and not yet looked at: not ready, the day its country opens.
  const fleets = [{ did: 'did:fleet:ug', companyName: 'Entebbe Haulage', jurisdiction: 'UG', contactEmail: 'office@entebbe.example', status: 'KYC_PENDING' }];
  const drivers = [
    { did: 'did:driver:ug', displayName: 'Okello', jurisdiction: 'UG', status: 'ACTIVE' },
    { did: 'did:driver:ke', displayName: 'Amos', jurisdiction: 'KE', status: 'ACTIVE' },
  ];
  const emails: Record<string, string> = { 'did:shop:ug': 'shop@kampala.example', 'did:shop:ke': 'shop@nairobi.example' };

  const build = () => {
    const notifications = new NotificationService(new OutboxPushSender());
    const outbox = new OutboxMailSender();
    const notice = new CountryNoticeService(
      notifications,
      { list: () => shops, countryOf: (a: { country: string }) => a.country } as never,
      { list: () => hubs, countryOf: (m: { country: string }) => m.country, isApproved: (m: { vetting: { state: string } }) => m.vetting.state === 'approved' } as never,
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

/**
 * PRE-REGISTRATION (the user, 2026-10-25: "Then we have those on the network immediately"). A country marked coming takes
 * sign-ups; the day it opens, everybody who signed up there is told — each whether they can start today.
 */
describe('a country opened tells everybody who signed up while it was coming', () => {
  const build = () => {
    const notifications = new NotificationService(new OutboxPushSender());
    const outbox = new OutboxMailSender();
    const notice = new CountryNoticeService(
      notifications,
      { list: () => [{ did: 'did:shop:tz', shopName: 'Arusha Corner', country: 'TZ', status: 'APPROVED_UNFUNDED' }, { did: 'did:shop:new', shopName: 'Moshi Kiosk', country: 'TZ', status: 'KYC_PENDING' }], countryOf: (a: { country: string }) => a.country } as never,
      { list: () => [{ did: 'did:hub:tz', name: 'Arusha Sort', country: 'TZ', vetting: { state: 'draft' } }], countryOf: (m: { country: string }) => m.country, isApproved: (m: { vetting: { state: string } }) => m.vetting.state === 'approved' } as never,
      { list: () => [{ did: 'did:store:tz', name: 'Arusha Threads', country: 'TZ' }] } as never,
      { list: () => [{ did: 'did:fleet:tz', companyName: 'Kili Haulage', jurisdiction: 'TZ', contactEmail: 'ops@kili.example', status: 'ACTIVE' }] } as never,
      { list: () => [{ did: 'did:driver:tz', displayName: 'Baraka', jurisdiction: 'TZ', status: 'DRAFT' }] } as never,
      { emailForDid: (did: string) => ({ 'did:shop:tz': 'corner@arusha.example', 'did:shop:new': 'kiosk@moshi.example' })[did] } as never,
      new MailService(outbox),
    );
    return { notifications, outbox, notice };
  };

  it('tells the ones whose papers were checked that they can start today, and the rest that they start the day their sign-up is finished', async () => {
    const { notifications, notice } = build();
    expect((await notice.tellOpened({ jurisdiction: 'tz', level: 'matched' })).told).toBe(6);
    for (const did of ['did:shop:tz', 'did:store:tz', 'did:fleet:tz']) {
      const [said] = notifications.inboxFor(did);
      expect(said).toMatchObject({ kind: 'country_changed', title: 'SeeBuyGet is open in Tanzania from today', data: { country: 'TZ', level: 'matched' } });
      expect(said.body).toMatch(/^You signed up before it opened, and your papers are checked: you can start today./);
    }
    for (const did of ['did:shop:new', 'did:hub:tz', 'did:driver:tz']) {
      expect(notifications.inboxFor(did)[0].body).toMatch(/^You signed up before it opened, and your sign-up is not finished yet: you start the day it is./);
    }
  });

  it('says plainly that no company of ours handles money there yet — and names the company where one stands', async () => {
    const without = build();
    await without.notice.tellOpened({ jurisdiction: 'TZ', level: 'matched' });
    expect(without.notifications.inboxFor('did:shop:tz')[0].body).toContain('No company of ours handles money there yet');
    const mail = without.outbox.recent('corner@arusha.example').find((m) => m.template === 'country-opened');
    expect(mail?.text).toContain('Work yes, money no');

    const withCompany = build();
    await withCompany.notice.tellOpened({ jurisdiction: 'TZ', level: 'partnered', company: 'SeeBuyGet Tanzania Ltd' });
    expect(withCompany.notifications.inboxFor('did:shop:tz')[0].body).toContain('SeeBuyGet Tanzania Ltd is the company you work with there.');
    expect(withCompany.outbox.recent('corner@arusha.example').find((m) => m.template === 'country-opened')?.text).not.toContain('Work yes, money no');
  });

  it('emails the ones who gave an address, each with their own answer', async () => {
    const { outbox, notice } = build();
    expect((await notice.tellOpened({ jurisdiction: 'TZ', level: 'matched' })).emailed).toBe(3);
    const sent = outbox.recent().filter((m) => m.template === 'country-opened');
    expect(sent.map((m) => m.to.address).sort()).toEqual(['corner@arusha.example', 'kiosk@moshi.example', 'ops@kili.example']);
    expect(outbox.recent('kiosk@moshi.example')[0].text).toContain('your sign-up is not finished yet');
    expect(outbox.recent('ops@kili.example')[0].text).toContain('you can start today');
  });
});
