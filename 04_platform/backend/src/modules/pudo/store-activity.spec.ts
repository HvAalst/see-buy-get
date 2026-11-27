import type { IntrospectionResult } from '../../foundation/auth/auth.types';
import type { MailService } from '../../foundation/mail/mail.service';
import type { AccountService } from './account.service';
import type { NotificationService } from './notification.service';
import type { VendorService } from './vendor.service';
import { StoreActivityService } from './store-activity.service';
import { ENGLISH_MAIL_WORDS } from '../../foundation/mail/mail.kit';
import type { SayValue } from './notice-words/say';

/*
 * 2026-11-15 — THE OWNER TOLD AT ONCE (the owner: "good one, build the notice"): when a developer makes a live key, or
 * changes or removes where order updates go, the store's bell says so, naming the developer and opening Connect. A test
 * key, a test message or the code setting are only written in the history; what the owner does is never told to them.
 */
describe('the store owner told what a developer did', () => {
  const STORE = 'did:glos:store-duka';
  const developer = { role: 'genesis', did: STORE, actorName: 'Brian Studio (developer)', revocationKey: 'storedev:sdv_1' } as unknown as IntrospectionResult;
  const owner = { role: 'genesis', did: STORE } as unknown as IntrospectionResult;
  const setup = () => {
    const told: Array<{ did: string; kind: string; title: string; body: string; link?: string; data?: Record<string, unknown> }> = [];
    const notifications = { notify: async (did: string, n: { kind: string; title: string; body: string; link?: string; data?: Record<string, unknown> }) => void told.push({ did, ...n }) } as unknown as NotificationService;
    return { told, activity: new StoreActivityService(notifications) };
  };
  const vendorId = () => `ven_${Math.random().toString(36).slice(2, 8)}`;

  it('a developer’s live key: the owner’s bell names them and the key by its last characters, and opens Connect', () => {
    const { told, activity } = setup();
    const id = vendorId();
    activity.note(id, developer, { act: 'key_made', kind: 'secret', mode: 'live', hint: 'x9z8', label: 'Checkout' });
    expect(told).toEqual([expect.objectContaining({ did: STORE, kind: 'store_connection', title: 'Brian Studio made a live key', link: '/?go=connect', data: { vendorId: id, act: 'key_made' } })]);
    expect(told[0].body).toContain('secret key …x9z8 “Checkout”');
  });

  it('a developer’s new update address, or none: told, with where they go now', () => {
    const { told, activity } = setup();
    activity.note(vendorId(), developer, { act: 'address_set', url: 'https://studio.example/hooks' });
    activity.note(vendorId(), developer, { act: 'address_cleared' });
    expect(told.map((n) => n.title)).toEqual(['Brian Studio changed where order updates go', 'Brian Studio stopped your order updates']);
    expect(told[0].body).toContain('https://studio.example/hooks');
  });

  it('a test key, a test message, the code setting, a revoked key: written down, not told', () => {
    const { told, activity } = setup();
    const id = vendorId();
    activity.note(id, developer, { act: 'key_made', kind: 'secret', mode: 'test', hint: 'a1b2' });
    activity.note(id, developer, { act: 'test_sent' });
    activity.note(id, developer, { act: 'code_setting', on: false });
    activity.note(id, developer, { act: 'key_revoked', kind: 'secret', mode: 'live', hint: 'x9z8' });
    expect(told).toEqual([]);
    expect(activity.list(id)).toHaveLength(4);
  });

  it('what the owner does themselves: never told to them', () => {
    const { told, activity } = setup();
    activity.note(vendorId(), owner, { act: 'key_made', kind: 'secret', mode: 'live', hint: 'x9z8' });
    activity.note(vendorId(), owner, { act: 'address_set', url: 'https://duka.example/hooks' });
    expect(told).toEqual([]);
  });
});

/*
 * 2026-11-16 — THE OWNER EMAILED, ONCE AND RARELY (the owner: "take it easy on the notifications … implement the common
 * procedures as PSPs and code hosts do"): only when their developer makes a LIVE SECRET key — as a code host emails "a
 * personal access token has been added". Never the key itself; nothing for a publishable key, the update address, or
 * what the owner does.
 */
describe('the store owner emailed of a developer’s live secret key — and of nothing else', () => {
  const STORE = 'did:glos:store-duka';
  const developer = { role: 'genesis', did: STORE, actorName: 'Brian Studio (developer)', revocationKey: 'storedev:sdv_1' } as unknown as IntrospectionResult;
  const owner = { role: 'genesis', did: STORE } as unknown as IntrospectionResult;
  const setup = (ownerEmail: string | null = 'owner@duka.example') => {
    const mails: Array<{ template: string; to: string; params: Record<string, string> }> = [];
    const mail = { send: async (template: string, to: { address: string }, params: Record<string, string>) => (mails.push({ template, to: to.address, params }), true) } as unknown as MailService;
    const accounts = { emailForDid: (did: string) => (did === STORE ? (ownerEmail ?? undefined) : undefined) } as unknown as AccountService;
    const vendors = { get: () => ({ name: 'Duka Bora' }) } as unknown as VendorService;
    const notifications = { notify: async () => undefined } as unknown as NotificationService;
    return { mails, activity: new StoreActivityService(notifications, mail, accounts, vendors) };
  };

  it('a developer’s live secret key: one email to the owner, naming the developer and the key by its last characters', () => {
    const { mails, activity } = setup();
    activity.note('ven_1', developer, { act: 'key_made', kind: 'secret', mode: 'live', hint: 'x9z8', label: 'Checkout' });
    expect(mails).toEqual([expect.objectContaining({ template: 'store-live-key', to: 'owner@duka.example', params: expect.objectContaining({ store: 'Duka Bora', developer: 'Brian Studio', link: expect.stringMatching(/\?go=connect$/) }) })]);
    // 2026-11-27 — the key named as a phrase (the owner reads it in their language); its English as before.
    expect(ENGLISH_MAIL_WORDS.text((mails[0] as unknown as { params: { key: SayValue } }).params.key)).toBe('secret key …x9z8 “Checkout”');
  });

  it('a live publishable key, a test key, the update address, a revoked key, the owner’s own live key: no email', () => {
    const { mails, activity } = setup();
    activity.note('ven_1', developer, { act: 'key_made', kind: 'publishable', mode: 'live', hint: 'p1q2' });
    activity.note('ven_1', developer, { act: 'key_made', kind: 'secret', mode: 'test', hint: 'a1b2' });
    activity.note('ven_1', developer, { act: 'address_set', url: 'https://studio.example/hooks' });
    activity.note('ven_1', developer, { act: 'key_revoked', kind: 'secret', mode: 'live', hint: 'x9z8' });
    activity.note('ven_1', owner, { act: 'key_made', kind: 'secret', mode: 'live', hint: 'o0o0' });
    expect(mails).toEqual([]);
  });

  it('a store with no sign-in address: no email, and the history is still written', () => {
    const { mails, activity } = setup(null);
    activity.note('ven_2', developer, { act: 'key_made', kind: 'secret', mode: 'live', hint: 'x9z8' });
    expect(mails).toEqual([]);
    expect(activity.list('ven_2')).toHaveLength(1);
  });
});
