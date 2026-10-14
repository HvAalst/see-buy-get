import type { Funding } from '../../foundation/funding/funding.types';
import type { MerchantScorecard } from './merchant-rating.service';
import type { ApiKeyView, Parcel } from './pudo.types';
import { DESK_RECENT, storeDeskOf, storeRowOf, type StoreRecord } from './store-desk';
import type { VendorCallback, VendorSettlement } from './vendor.service';

/**
 * A STORE AS NETWORK STAFF SEE IT — what the view carries, and above all what it does not.
 *
 * Every input below is the real record a store's own routes are built from, complete with the things a
 * support desk has no business reading. The assertions that matter most are the ones over the WHOLE
 * serialised answer: a field that leaks does not leak under the name a test thought to check.
 */
describe('a store, as network staff see it', () => {
  const SECRETS = {
    ownerPhone: '+254711222333',
    buyerPhone: '+254722000111',
    buyerEmail: 'buyer@example.com',
    collectionCode: 'COL-7F3A91',
    trackingKey: 'T-9A8B7C6D5E',
    signature: 'sha256=4f1c0de',
    keyValue: 'pk_live_0123456789abcdef',
    did: 'did:glos:store-desk',
  };

  const vendor: StoreRecord = {
    vendorId: 'ven_desk',
    did: SECRETS.did,
    name: 'Nairobi Threads',
    callbackUrl: 'https://threads.example/hooks/sbg',
    secretRotatedAt: '2026-09-01T10:00:00.000Z',
    location: { lat: -1.28, lng: 36.82 },
    address: 'Biashara St 12',
    collection: { label: 'Gate 2', zone: 'NorthTown', location: { lat: -1.28, lng: 36.82 }, bays: 3, enabledAt: '2026-09-10T08:00:00.000Z' },
    country: 'KE',
    entityId: 'sbg-ke',
    contactMobile: SECRETS.ownerPhone,
    balance: 40,
    shippingPolicy: {} as never,
    createdAt: '2026-08-01T09:00:00.000Z',
  };
  const standing = { companyName: 'SeeBuyGet Kenya', currency: 'KES', balance: 40, hasAccount: true };

  const parcel = (n: number, over: Partial<Parcel> = {}): Parcel =>
    ({
      parcelId: `PUD-${n}`,
      externalOrderId: `ORD-${n}`,
      status: 'At_Dest_PUDO',
      paidStatus: 'ParcelPaid',
      destZone: 'SouthTown',
      acceptedAt: `2026-10-0${n}T12:00:00.000Z`,
      vendorId: 'ven_desk',
      senderMobile: SECRETS.ownerPhone,
      receiverMobile: SECRETS.buyerPhone,
      buyerEmail: SECRETS.buyerEmail,
      collectionCode: SECRETS.collectionCode,
      trackingKey: SECRETS.trackingKey,
      otp: '4453',
      ...over,
    }) as Parcel;
  const callback = (n: number, over: Partial<VendorCallback> = {}): VendorCallback => ({
    id: `cb_${n}`,
    vendorId: 'ven_desk',
    url: vendor.callbackUrl!,
    event: 'ready_for_pickup',
    signature: SECRETS.signature,
    body: JSON.stringify({ parcelId: `PUD-${n}`, collectionCode: SECRETS.collectionCode, buyer: SECRETS.buyerPhone }),
    at: `2026-10-0${n}T13:00:00.000Z`,
    state: 'delivered',
    attempts: 1,
    nextTryAt: `2026-10-0${n}T13:05:00.000Z`,
    deliveredAt: `2026-10-0${n}T13:00:02.000Z`,
    ...over,
  });
  const funding = (over: Partial<Funding>): Funding =>
    ({ fundingId: 'fun_1', entityId: 'sbg-ke', payerKind: 'vendor', payerDid: 'ven_desk', payerName: 'Nairobi Threads', purpose: 'float', amount: 500, currency: 'KES', status: 'awaiting', reference: 'SBG-4471', provider: 'mpesa', instructions: 'Paybill 400200, account SBG-4471', railRef: 'ws_CO_secret_handle', openedAt: '2026-10-09T08:00:00.000Z', ...over }) as Funding;
  const ledger: VendorSettlement[] = [
    { id: 's1', vendorId: 'ven_desk', country: 'KE', type: 'TOP_UP', sign: '+', amount: 100, currency: 'KES', at: '2026-10-01T08:00:00.000Z' },
    { id: 's2', vendorId: 'ven_desk', country: 'KE', type: 'BILLING', sign: '-', amount: 4, parcelId: 'PUD-1', at: '2026-10-02T08:00:00.000Z' },
  ];
  const keys: ApiKeyView[] = [
    { keyId: 'key_1', kind: 'publishable', mode: 'live', label: 'Shop site', hint: 'cdef', value: SECRETS.keyValue, createdAt: '2026-09-02T08:00:00.000Z', lastUsedAt: '2026-10-10T08:00:00.000Z' },
    { keyId: 'key_2', kind: 'secret', mode: 'live', hint: '9f0a', createdAt: '2026-09-03T08:00:00.000Z', revokedAt: '2026-09-20T08:00:00.000Z' },
  ];
  const scorecard: MerchantScorecard = { vendorId: 'ven_desk', name: 'Nairobi Threads', shipments: 7, tags: [], rating: { average: 4.5, count: 6, isNew: false } };

  const open = (over: Partial<Parameters<typeof storeDeskOf>[0]> = {}) =>
    storeDeskOf({
      vendor,
      standing,
      funding: [funding({}), funding({ fundingId: 'fun_0', status: 'confirmed', reference: 'SBG-1000', openedAt: '2026-10-01T08:00:00.000Z' })],
      ledger,
      parcels: [1, 2, 3, 4, 5, 6, 7].map((n) => parcel(n, n === 7 ? { paidStatus: 'unpaid', status: 'Created' as never } : {})),
      stats: { total: 7, unpaid: 1, active: 3 },
      callbacks: [callback(1), callback(2, { state: 'failed', attempts: 8, deliveredAt: undefined, lastError: 'The store’s address answered 500' }), callback(3, { state: 'pending', attempts: 2, deliveredAt: undefined, lastError: 'Timed out' })],
      keys,
      returnsWaiting: 2,
      scorecard,
      ...over,
    });

  describe('the row in the list', () => {
    it('says who the store is, who settles it, what its float is and in what money, and how it signs in', () => {
      expect(storeRowOf(vendor, standing)).toEqual({
        vendorId: 'ven_desk',
        name: 'Nairobi Threads',
        country: 'KE',
        companyName: 'SeeBuyGet Kenya',
        balance: 40,
        currency: 'KES',
        hasAccount: true,
        hasCallback: true,
        hasDock: true,
        address: 'Biashara St 12',
        createdAt: '2026-08-01T09:00:00.000Z',
      });
    });

    it('carries nothing personal and nothing a list has no use for', () => {
      const said = JSON.stringify(storeRowOf(vendor, standing));
      for (const secret of [SECRETS.ownerPhone, '222333', SECRETS.did, vendor.callbackUrl!]) expect(said).not.toContain(secret);
      expect(Object.keys(storeRowOf(vendor, standing))).not.toEqual(expect.arrayContaining(['did']));
      expect(Object.keys(storeRowOf(vendor, standing))).not.toEqual(expect.arrayContaining(['contactMobile']));
    });

    it('a store with no till in its country has no float and no currency: “none held” is not “empty”', () => {
      const row = storeRowOf({ ...vendor, entityId: undefined, country: 'UG', collection: undefined, callbackUrl: undefined, address: undefined }, { balance: null, currency: 'UGX', hasAccount: false });
      expect(row.balance).toBeNull();
      expect(row).not.toHaveProperty('currency');
      expect(row).not.toHaveProperty('companyName');
      expect(row).toMatchObject({ hasAccount: false, hasCallback: false, hasDock: false });
      // An empty float is a different fact, and keeps its money's name.
      expect(storeRowOf(vendor, { ...standing, balance: 0 })).toMatchObject({ balance: 0, currency: 'KES' });
    });
  });

  describe('the store, opened', () => {
    it('never carries the things a support desk must not read — searched for over the whole answer', () => {
      const said = JSON.stringify(open());
      for (const [what, value] of Object.entries(SECRETS)) {
        expect({ what, leaked: said.includes(value) }).toEqual({ what, leaked: false });
      }
      // …nor the pieces they are made of, under any name.
      for (const fragment of ['whsec', 'collectionCode', 'signature', '"body"', 'buyer', 'otp', 'hash', 'instructions', 'ws_CO_secret_handle', 'contactMobile', '"value"']) expect(said).not.toContain(fragment);
    });

    it('says how it signs in and gives the END of the number on file, never the number', () => {
      const desk = open();
      expect(desk.signIn).toEqual({ hasAccount: true, secretRotatedAt: '2026-09-01T10:00:00.000Z' });
      expect(desk.contact).toEqual({ phoneEnding: '333' });
      expect(open({ vendor: { ...vendor, contactMobile: undefined } }).contact).toEqual({});
    });

    it('money: the payments it has started and that have not arrived, and its last entries — in each entry’s own money', () => {
      const { money } = open();
      // Only what is still awaited: a payment already confirmed is not something staff are being asked about.
      expect(money.open).toEqual([{ reference: 'SBG-4471', amount: 500, currency: 'KES', openedAt: '2026-10-09T08:00:00.000Z' }]);
      expect(money.recent).toEqual([
        { type: 'BILLING', sign: '-', amount: 4, currency: 'KES', parcelId: 'PUD-1', at: '2026-10-02T08:00:00.000Z' }, // an old row with no currency reads its country's
        { type: 'TOP_UP', sign: '+', amount: 100, currency: 'KES', at: '2026-10-01T08:00:00.000Z' },
      ]);
    });

    it('shipments: the store-wide counts, and its newest few by what a parcel is known as', () => {
      const { shipments } = open();
      expect(shipments).toMatchObject({ total: 7, unpaid: 1, active: 3 });
      expect(shipments.recent).toHaveLength(DESK_RECENT);
      expect(shipments.recent.map((p) => p.parcelId)).toEqual(['PUD-7', 'PUD-6', 'PUD-5', 'PUD-4', 'PUD-3']);
      expect(shipments.recent[0]).toEqual({ parcelId: 'PUD-7', externalOrderId: 'ORD-7', status: 'Created', paid: false, destZone: 'SouthTown', at: '2026-10-07T12:00:00.000Z' });
      expect(shipments.recent[1].paid).toBe(true);
    });

    it('callbacks: where they go, how many arrived and how many did not, and why the last ones failed — in our words', () => {
      const { callbacks } = open();
      expect(callbacks).toMatchObject({ url: 'https://threads.example/hooks/sbg', carriesCode: true, pending: 1, failed: 1, delivered: 1, lastDeliveredAt: '2026-10-01T13:00:02.000Z' });
      expect(callbacks.recent).toEqual([
        { event: 'ready_for_pickup', at: '2026-10-03T13:00:00.000Z', state: 'pending', attempts: 2, nextTryAt: '2026-10-03T13:05:00.000Z', lastError: 'Timed out' },
        { event: 'ready_for_pickup', at: '2026-10-02T13:00:00.000Z', state: 'failed', attempts: 8, lastError: 'The store’s address answered 500' },
        { event: 'ready_for_pickup', at: '2026-10-01T13:00:00.000Z', state: 'delivered', attempts: 1, deliveredAt: '2026-10-01T13:00:02.000Z' },
      ]);
      // A store that switched the code off, and one with no address at all.
      expect(open({ vendor: { ...vendor, callbackCarriesCode: false } }).callbacks.carriesCode).toBe(false);
      const silent = open({ vendor: { ...vendor, callbackUrl: undefined }, callbacks: [] }).callbacks;
      expect(silent).toEqual({ carriesCode: true, pending: 0, failed: 0, delivered: 0, recent: [] });
    });

    it('keys: which exist, when each was last used and which are revoked — never a key', () => {
      expect(open().keys).toEqual([
        { keyId: 'key_1', kind: 'publishable', mode: 'live', label: 'Shop site', hint: 'cdef', createdAt: '2026-09-02T08:00:00.000Z', lastUsedAt: '2026-10-10T08:00:00.000Z' },
        { keyId: 'key_2', kind: 'secret', mode: 'live', hint: '9f0a', createdAt: '2026-09-03T08:00:00.000Z', revokedAt: '2026-09-20T08:00:00.000Z' },
      ]);
    });

    it('the dock, what is waiting on the store, and how it is rated', () => {
      const desk = open();
      expect(desk.dock).toEqual({ label: 'Gate 2', zone: 'NorthTown', bays: 3, enabledAt: '2026-09-10T08:00:00.000Z' });
      expect(desk.returnsWaiting).toBe(2);
      expect(desk.reputation).toEqual({ shipments: 7, average: 4.5, count: 6, isNew: false });
      expect(open({ vendor: { ...vendor, collection: undefined } }).dock).toBeNull();
    });

    it('opens on the same facts as its row in the list', () => {
      expect(open()).toMatchObject(storeRowOf(vendor, standing));
    });
  });
});
