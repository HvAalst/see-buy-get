import type { IntrospectionResult } from '../../foundation/auth/auth.types';
import type { NotificationService } from './notification.service';
import { StoreActivityService } from './store-activity.service';

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
