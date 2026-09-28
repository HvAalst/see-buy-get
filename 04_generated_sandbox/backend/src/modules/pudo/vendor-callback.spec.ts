import { createHmac, timingSafeEqual } from 'crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http';
import { EventBus } from '../../foundation/events/event-bus.service';
import { VendorService } from './vendor.service';
import { MAX_CALLBACK_ATTEMPTS, VendorCallbackService } from './vendor-callback.service';
import type { DidService } from '../../foundation/did/did.service';
import type { OperationalStore } from '../../foundation/data-firewall/operational-store.service';
import type { EntityService } from '../../foundation/entity/entity.service';
import type { BooksService } from '../../foundation/books/books.service';
import type { PresenceService } from '../../foundation/presence/presence.service';
import type { ParcelService } from './parcel.service';

/**
 * THE STORE CALLBACK, WHICH FOR MONTHS WAS BUILT, SIGNED AND NEVER SENT.
 *
 * `notify` created the record, computed the HMAC, pushed it to an in-memory array and stopped. Nothing
 * posted it. Every merchant integration on this network was receiving nothing, and from the inside it
 * was indistinguishable from a working one: the tests passed, the outbox filled, the signature was
 * correct. The documentation was honest about it, which is how it survived — "recorded, not yet
 * delivered over HTTP".
 *
 * So this file does not test that a callback was CREATED. It stands up a real server and tests that one
 * ARRIVED, and that a merchant following the published verification instructions accepts it.
 */
describe('status callbacks to a store', () => {
  interface Landed {
    method: string;
    headers: Record<string, string>;
    raw: Buffer;
  }
  let server: Server;
  let origin: string;
  let landed: Landed[] = [];
  let answer = 200;

  beforeAll(async () => {
    server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        landed.push({ method: req.method ?? '', headers: req.headers as Record<string, string>, raw: Buffer.concat(chunks) });
        res.writeHead(answer);
        res.end('ok');
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const a = server.address();
    origin = `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`;
  });

  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  beforeEach(() => {
    landed = [];
    answer = 200;
    process.env.GLOS_ENV = 'sandbox';
  });

  const setUp = () => {
    const bus = new EventBus();
    const vendors = new VendorService(
      { generate: () => ({ id: `did:glos:ven${Math.random().toString(16).slice(2)}` }) } as unknown as DidService,
      { upsert: () => undefined } as unknown as OperationalStore,
      { forJurisdiction: () => undefined } as unknown as EntityService,
      {} as unknown as BooksService,
      { can: () => true } as unknown as PresenceService,
    );
    const callbacks = new VendorCallbackService(bus, {} as unknown as ParcelService, vendors);
    return { vendors, callbacks };
  };

  const store = (vendors: VendorService, url?: string) =>
    vendors.register({ name: 'Kisumu Hardware', country: 'KE', ...(url !== undefined ? { callbackUrl: url } : {}) });

  /* ---------------------------------------------------------------- arriving -- */

  describe('a milestone', () => {
    it('ACTUALLY ARRIVES AT THE STORE — the assertion this whole file exists for', async () => {
      const { vendors, callbacks } = setUp();
      const v = store(vendors, `${origin}/hooks/sbg`);
      vendors.notify(v.vendorId, 'ready_for_pickup', { parcelId: 'PUD-A1B2C3D4E5', collectionCode: '8412' });

      const drained = await callbacks.drain();

      expect(drained).toMatchObject({ sent: 1, failed: 0 });
      expect(landed).toHaveLength(1);
      expect(landed[0].method).toBe('POST');
      expect(JSON.parse(landed[0].raw.toString())).toMatchObject({
        event: 'ready_for_pickup',
        data: { parcelId: 'PUD-A1B2C3D4E5', collectionCode: '8412' },
      });
    });

    it('verifies the way the documentation tells a merchant to verify it', async () => {
      const { vendors, callbacks } = setUp();
      const v = store(vendors, `${origin}/hooks/sbg`);
      vendors.notify(v.vendorId, 'collected', { parcelId: 'PUD-1' });
      await callbacks.drain();

      /*
       * Verbatim from shipping-api.html: HMAC-SHA256 over the EXACT request body, keyed with the store
       * secret, hex, compared in constant time. Re-serialising the JSON first changes the whitespace and
       * the signature would not match — which is why the body is stored as a string and never rebuilt.
       */
      const expected = createHmac('sha256', v.secret).update(landed[0].raw).digest('hex');
      const received = landed[0].headers['x-sbg-signature'];
      expect(received).toHaveLength(64);
      expect(timingSafeEqual(Buffer.from(expected), Buffer.from(received))).toBe(true);
    });

    it('names the event and carries a delivery id a handler can be idempotent on', async () => {
      // The docs have been telling merchants to be idempotent since before anything was delivered.
      const { vendors, callbacks } = setUp();
      const v = store(vendors, `${origin}/hooks/sbg`);
      vendors.notify(v.vendorId, 'disputed', { parcelId: 'PUD-2' });
      await callbacks.drain();
      expect(landed[0].headers['x-sbg-event']).toBe('disputed');
      expect(landed[0].headers['x-sbg-delivery']).toMatch(/^cb_[0-9a-f]{12}$/);
      expect(landed[0].headers['content-type']).toBe('application/json');
    });

    it('sends nothing for a store that registered no callback URL', async () => {
      const { vendors, callbacks } = setUp();
      const v = store(vendors);
      expect(vendors.notify(v.vendorId, 'collected', { parcelId: 'PUD-3' })).toBeNull();
      expect((await callbacks.drain()).sent).toBe(0);
      expect(landed).toHaveLength(0);
    });

    it('shows the merchant that it arrived, which the outbox could never say before', async () => {
      const { vendors, callbacks } = setUp();
      const v = store(vendors, `${origin}/hooks/sbg`);
      vendors.notify(v.vendorId, 'collected', { parcelId: 'PUD-4' });
      expect(vendors.outboxFor(v.vendorId)[0]).toMatchObject({ state: 'pending', attempts: 0 });

      await callbacks.drain();
      expect(vendors.outboxFor(v.vendorId)[0]).toMatchObject({ state: 'delivered', attempts: 1 });
      expect(vendors.outboxFor(v.vendorId)[0].deliveredAt).toBeTruthy();
    });
  });

  /* ------------------------------------------------------------ when it fails -- */

  describe('when the store is down', () => {
    it('keeps the SAME body and signature on a retry, so a late delivery still verifies', async () => {
      const { vendors, callbacks } = setUp();
      const v = store(vendors, `${origin}/hooks/sbg`);
      vendors.notify(v.vendorId, 'ready_for_pickup', { parcelId: 'PUD-5' });

      answer = 500;
      await callbacks.drain();
      answer = 200;
      await callbacks.drain(Date.now() + 10 * 60_000);

      expect(landed).toHaveLength(2);
      // Byte-identical, which is what makes the merchant's own check pass on the second try.
      expect(landed[1].raw.equals(landed[0].raw)).toBe(true);
      expect(landed[1].headers['x-sbg-signature']).toBe(landed[0].headers['x-sbg-signature']);
      expect(landed[1].headers['x-sbg-delivery']).toBe(landed[0].headers['x-sbg-delivery']);
    });

    it('backs off rather than hammering a dead endpoint', async () => {
      const { vendors, callbacks } = setUp();
      const v = store(vendors, `${origin}/hooks/sbg`);
      vendors.notify(v.vendorId, 'collected', { parcelId: 'PUD-6' });
      answer = 503;

      await callbacks.drain();
      await callbacks.drain(); // not due yet
      expect(landed).toHaveLength(1);
      expect(vendors.outboxFor(v.vendorId)[0]).toMatchObject({ state: 'pending', attempts: 1 });
    });

    it('gives up and SAYS so, rather than retrying for ever', async () => {
      const { vendors, callbacks } = setUp();
      const v = store(vendors, `${origin}/hooks/sbg`);
      vendors.notify(v.vendorId, 'collected', { parcelId: 'PUD-7' });
      answer = 500;

      let at = Date.now();
      for (let i = 0; i < MAX_CALLBACK_ATTEMPTS; i++) {
        await callbacks.drain(at);
        at += 2 * 24 * 60 * 60 * 1000;
      }
      expect(vendors.outboxFor(v.vendorId)[0]).toMatchObject({ state: 'failed', attempts: MAX_CALLBACK_ATTEMPTS });
      expect(vendors.outboxFor(v.vendorId)[0].lastError).toBeTruthy();
    });

    it('never puts the store’s own response body in the outbox', async () => {
      // An error that quoted the far end would make the outbox a reader for whatever it can reach.
      const { vendors, callbacks } = setUp();
      const v = store(vendors, `${origin}/hooks/sbg`);
      vendors.notify(v.vendorId, 'collected', { parcelId: 'PUD-8' });
      answer = 403;
      await callbacks.drain();
      const said = vendors.outboxFor(v.vendorId)[0].lastError as string;
      // A merchant's problem is their handler, not a bucket — the words have to match the reader.
      expect(said).toBe('Your endpoint refused it. Check that it accepts our POST and is not rejecting the signature.');
      expect(said).not.toMatch(/storage|bucket|folder/);
      expect(said).not.toContain('ok');
    });

    it('refuses a callback URL inside a private network outside a sandbox', async () => {
      const { vendors, callbacks } = setUp();
      const v = store(vendors, `${origin}/hooks/sbg`);
      vendors.notify(v.vendorId, 'collected', { parcelId: 'PUD-9' });
      process.env.GLOS_ENV = 'production';
      try {
        await callbacks.drain();
        expect(landed).toHaveLength(0);
        expect(vendors.outboxFor(v.vendorId)[0].lastError).toMatch(/https|private network/);
      } finally {
        process.env.GLOS_ENV = 'sandbox';
      }
    });
  });
});
