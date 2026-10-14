import { describe, expect, it } from 'vitest';
import { t } from '../../shared/i18n'; // English is the base catalog, so the real `t` yields the English literals
import { STORES_PAGE, callbackTone, findStores, floatState, keyState, storePage, storesInOrder, storeTroubles, type StoreDesk, type StoreRow } from './stores';

const row = (over: Partial<StoreRow>): StoreRow => ({
  vendorId: 'ven_a1',
  name: 'Nairobi Threads',
  country: 'KE',
  companyName: 'SeeBuyGet Kenya',
  balance: 40,
  currency: 'KES',
  hasAccount: true,
  hasCallback: true,
  hasDock: false,
  address: 'Biashara St 12',
  createdAt: '2026-08-01T09:00:00.000Z',
  ...over,
});

const ROWS = [
  row({}),
  row({ vendorId: 'ven_b2', name: 'kampala Threads', country: 'UG', companyName: undefined, balance: null, currency: undefined, address: 'Luwum St 4' }),
  row({ vendorId: 'ven_c3', name: 'Addis Leather', country: 'ET', companyName: 'SeeBuyGet Ethiopia', currency: 'ETB', balance: 0, address: undefined }),
];

describe('finding a store', () => {
  it('lists them by name, the way a caller gives it — whatever the capitals, and without reordering what it was handed', () => {
    expect(storesInOrder(ROWS).map((r) => r.name)).toEqual(['Addis Leather', 'kampala Threads', 'Nairobi Threads']);
    expect(ROWS.map((r) => r.vendorId)).toEqual(['ven_a1', 'ven_b2', 'ven_c3']);
    // Two stores of one name stay in one order, by their number: a list that shuffles is a list nobody can point at.
    const twins = [row({ vendorId: 'ven_z9', name: 'Twin' }), row({ vendorId: 'ven_a0', name: 'Twin' })];
    expect(storesInOrder(twins).map((r) => r.vendorId)).toEqual(['ven_a0', 'ven_z9']);
  });

  it('finds by name, store number, street, country or the company it pays — every word, in any order', () => {
    const found = (q: string) => findStores(ROWS, q).map((r) => r.vendorId);
    expect(found('threads')).toEqual(['ven_a1', 'ven_b2']);
    expect(found('THREADS ke')).toEqual(['ven_a1']);
    expect(found('ke threads')).toEqual(['ven_a1']);
    expect(found('ven_c3')).toEqual(['ven_c3']);
    expect(found('luwum')).toEqual(['ven_b2']);
    expect(found('ethiopia')).toEqual(['ven_c3']);
    // A word that is nowhere finds nothing, whatever the other words match.
    expect(found('threads tz')).toEqual([]);
    expect(found('zanzibar')).toEqual([]);
  });

  it('nothing typed is everything, and so is a field of spaces', () => {
    expect(findStores(ROWS, '')).toBe(ROWS);
    expect(findStores(ROWS, '   ')).toBe(ROWS);
  });

  it('pages what was found, says how many pages, and never lands past the end', () => {
    const many = Array.from({ length: 45 }, (_, i) => i);
    expect(STORES_PAGE).toBe(20);
    expect(storePage(many, 0)).toMatchObject({ page: 0, pages: 3 });
    expect(storePage(many, 0).shown).toHaveLength(20);
    expect(storePage(many, 2).shown).toEqual([40, 41, 42, 43, 44]);
    // A search that shrank the list while page 3 was open reads as its last page, not as an empty one.
    expect(storePage(many.slice(0, 5), 2)).toEqual({ shown: [0, 1, 2, 3, 4], page: 0, pages: 1 });
    expect(storePage([], 0)).toEqual({ shown: [], page: 0, pages: 1 });
    expect(storePage(many, -1).page).toBe(0);
  });
});

describe('what a store’s float says', () => {
  it('none held here is not an empty one, and an empty one is not a float', () => {
    expect(floatState({ balance: null })).toBe('none');
    expect(floatState({ balance: 0 })).toBe('empty');
    expect(floatState({ balance: 0.01 })).toBe('held');
    expect(floatState({ balance: -3 })).toBe('empty');
  });
});

describe('what is likely wrong with a store', () => {
  const desk = (over: { unpaid?: number; total?: number; open?: number; failed?: number; url?: string | null; returns?: number }): Pick<StoreDesk, 'shipments' | 'money' | 'callbacks' | 'returnsWaiting'> => ({
    shipments: { total: over.total ?? 3, unpaid: over.unpaid ?? 0, active: 1, recent: [] },
    money: { open: Array.from({ length: over.open ?? 0 }, (_, i) => ({ reference: `SBG-${i}`, amount: 100, currency: 'KES', openedAt: '2026-10-09T08:00:00.000Z' })), recent: [] },
    callbacks: { ...(over.url === null ? {} : { url: over.url ?? 'https://store.example/hook' }), carriesCode: true, pending: 0, failed: over.failed ?? 0, delivered: 2, recent: [] },
    returnsWaiting: over.returns ?? 0,
  });

  it('says nothing about a store nothing is wrong with', () => {
    expect(storeTroubles(desk({}))).toEqual([]);
  });

  it('names each thing by itself, in the order a caller would complain of it', () => {
    expect(storeTroubles(desk({ unpaid: 2 }))).toEqual(['unpaid']);
    expect(storeTroubles(desk({ open: 1 }))).toEqual(['awaited']);
    expect(storeTroubles(desk({ failed: 4 }))).toEqual(['failing']);
    expect(storeTroubles(desk({ returns: 1 }))).toEqual(['returns']);
    expect(storeTroubles(desk({ unpaid: 1, open: 1, failed: 1, returns: 1 }))).toEqual(['unpaid', 'awaited', 'failing', 'returns']);
  });

  it('a store with no address for systems of its own has nothing wrong with it: most have no systems', () => {
    expect(storeTroubles(desk({ url: null }))).toEqual([]);
    expect(storeTroubles(desk({ url: null, total: 0 }))).toEqual([]);
    // …and an empty float is not a fault either, until a label is waiting on it.
    expect(storeTroubles(desk({ unpaid: 0 }))).toEqual([]);
  });

  it('says each one in words that carry the number and no plural left for the reader to finish', () => {
    const says = (key: 'unpaid' | 'awaited' | 'failing' | 'returns') => t(`tower.stores.says.${key}`, { unpaid: 1, open: 1, failed: 1, returns: 1 });
    expect(says('unpaid')).toBe('Shipments not paid for: 1. Their labels are held back, and print by themselves once its float covers them. It pays in from the Store app.');
    expect(says('awaited')).toMatch(/^Payments it started that have not arrived: 1\. .*Money in/);
    for (const key of ['unpaid', 'awaited', 'failing', 'returns'] as const) expect(says(key)).not.toMatch(/\(s\)/);
    expect(t('tower.stores.cbTries', { n: 1 })).toBe('tries: 1');
  });
});

describe('a message to a store’s systems, and a key', () => {
  it('one that arrived is quiet, one still owed is a wait, one given up on is the thing to look at', () => {
    expect(callbackTone('delivered')).toBe('ok');
    expect(callbackTone('pending')).toBe('quiet');
    expect(callbackTone('failed')).toBe('warn');
  });

  it('a revoked key is history whatever it was used for; one never used may be the one the store thinks it is using', () => {
    expect(keyState({})).toBe('unused');
    expect(keyState({ lastUsedAt: '2026-10-10T08:00:00.000Z' })).toBe('used');
    expect(keyState({ lastUsedAt: '2026-10-10T08:00:00.000Z', revokedAt: '2026-10-11T08:00:00.000Z' })).toBe('revoked');
    expect(keyState({ revokedAt: '2026-10-11T08:00:00.000Z' })).toBe('revoked');
  });
});
