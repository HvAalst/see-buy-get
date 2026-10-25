import { AgreementService } from '../../foundation/documents/agreement.service';
import { DocumentsService } from '../../foundation/documents/documents.service';
import { CountryNoticeService } from './country-notice.service';
import { DocumentNoticeService } from './document-notice.service';
import { NotificationService } from './notification.service';
import { OutboxPushSender } from './push-sender';

/**
 * A NEW VERSION OF WHAT PEOPLE AGREED TO, TOLD IN THE BELL (the user, 2026-10-25: "privacy text needs to stay true, but
 * it needs a notification in the bell for the users that the terms of use are updated") — to everybody it concerns:
 * every account for the general text, everybody in the country for a country's own. Never SeeBuyGet's own companies.
 */
describe('a published version is told in the bell of everybody it concerns', () => {
  const shops = [
    { did: 'did:shop:ke', shopName: 'Nairobi Shop', country: 'KE', status: 'ACTIVE' },
    { did: 'did:shop:ug', shopName: 'Kampala Shop', country: 'UG', status: 'ACTIVE' },
  ];
  const hubs = [{ did: 'did:hub:ke', name: 'Nairobi Sort', country: 'KE', vetting: { state: 'approved' } }];
  const stores = [{ did: 'did:store:ug', name: 'Kampala Threads', country: 'UG' }];
  const fleets = [{ did: 'did:fleet:ke', companyName: 'Kilima Logistics', jurisdiction: 'KE', status: 'ACTIVE' }];
  const drivers = [
    { did: 'did:driver:ke', displayName: 'Amos', jurisdiction: 'KE', status: 'ACTIVE' },
    { did: 'did:driver:ug', displayName: 'Okello', jurisdiction: 'UG', status: 'ACTIVE' },
  ];
  const entities = [
    { did: 'did:biz:ke', kind: 'business', jurisdiction: 'KE' },
    { did: 'did:biz:ug', kind: 'business', jurisdiction: 'UG' },
    // SeeBuyGet's own company in Kenya: it writes these texts, it does not agree to them.
    { did: 'did:sbg-ke', kind: 'sister', jurisdiction: 'KE' },
  ];
  const persons = [{ personDid: 'did:person:wanjiru' }, { personDid: 'did:person:okello' }, { personDid: 'did:person:new' }];
  const amina = { name: 'Amina', key: 'operator:amina' };
  const brian = { name: 'Brian', key: 'operator:brian' };
  // The notices go out after the publish has answered: let them.
  const settle = async () => {
    for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r));
  };

  const build = () => {
    const documents = new DocumentsService();
    documents.seed();
    const agreements = new AgreementService(documents);
    const notifications = new NotificationService(new OutboxPushSender());
    const list = <T>(items: T[]) => ({ list: () => items }) as never;
    const countries = new CountryNoticeService(
      notifications,
      { list: () => shops, countryOf: (a: { country: string }) => a.country } as never,
      { list: () => hubs, countryOf: (m: { country: string }) => m.country, isApproved: () => true } as never,
      list(stores),
      list(fleets),
      list(drivers),
      { emailForDid: () => undefined } as never,
    );
    new DocumentNoticeService(
      documents,
      notifications,
      { list: () => shops } as never,
      list(hubs),
      list(stores),
      list(fleets),
      list(drivers),
      { everyone: () => persons } as never,
      list(entities),
      agreements,
      countries,
    );
    // Wanjiru agreed for Kenya, Okello for Uganda; the newest person has agreed to nothing yet.
    agreements.record('person:did:person:wanjiru', { terms: 1, privacy: 1, cookies: 1 }, 'identity/enroll', 'KE');
    agreements.record('person:did:person:okello', { terms: 1, privacy: 1, cookies: 1 }, 'identity/enroll', 'UG');
    const publish = (input: { body: string; changeNote: string; askAgain: boolean; country?: string; title?: string }) =>
      documents.publish(documents.propose('terms', { title: input.title ?? 'Terms of use', ...input }, amina).versionId, brian);
    return { notifications, publish };
  };
  const told = (notifications: NotificationService, did: string) => notifications.inboxFor(did).filter((n) => n.kind === 'terms_updated');

  it('tells every account and every person of a new general version, once each — and no company of ours', async () => {
    const { notifications, publish } = build();
    publish({ body: 'A new rule for everybody', changeNote: 'A new rule', askAgain: true });
    await settle();
    const everybody = [...shops, ...hubs, ...stores, ...fleets, ...drivers].map((x) => x.did).concat('did:biz:ke', 'did:biz:ug', ...persons.map((p) => p.personDid));
    for (const did of everybody) {
      expect(told(notifications, did)).toHaveLength(1);
      expect(told(notifications, did)[0]).toMatchObject({ title: 'Terms of use: a new version', body: 'A new rule. You are asked to agree to it the next time you open the app.', link: '/terms/', data: { key: 'terms', number: 2, askAgain: true } });
    }
    expect(told(notifications, 'did:sbg-ke')).toEqual([]);
  });

  it('says there is nothing to do when a version asks nothing new', async () => {
    const { notifications, publish } = build();
    publish({ body: 'Clearer words', changeNote: 'Clearer words.', askAgain: false });
    await settle();
    expect(told(notifications, 'did:shop:ug')[0].body).toBe('Clearer words. Nothing to do: it is there to read.');
  });

  it('tells a country’s own only to those there: its shops, hubs, fleets, couriers, businesses — and the people who agreed for it', async () => {
    const { notifications, publish } = build();
    publish({ country: 'KE', title: 'Terms of use — Kenya', body: 'What Kenyan law adds', changeNote: 'What Kenyan law adds to the general terms', askAgain: false });
    await settle();
    for (const did of ['did:shop:ke', 'did:hub:ke', 'did:fleet:ke', 'did:driver:ke', 'did:biz:ke', 'did:person:wanjiru']) {
      expect(told(notifications, did)).toHaveLength(1);
      // A country's first version asks everybody there, whatever was ticked.
      expect(told(notifications, did)[0]).toMatchObject({ title: 'Terms of use — Kenya: a new version', link: '/terms/?country=KE', data: { key: 'terms@KE', number: 1, askAgain: true } });
    }
    for (const did of ['did:shop:ug', 'did:store:ug', 'did:driver:ug', 'did:biz:ug', 'did:person:okello', 'did:person:new', 'did:sbg-ke']) expect(told(notifications, did)).toEqual([]);
  });

  it('names the country when the title does not', async () => {
    const { notifications, publish } = build();
    publish({ country: 'UG', title: 'Terms of use', body: 'What Ugandan law adds', changeNote: 'What Ugandan law adds', askAgain: true });
    await settle();
    expect(told(notifications, 'did:shop:ug')[0].title).toBe('Terms of use for Uganda: a new version');
  });
});
