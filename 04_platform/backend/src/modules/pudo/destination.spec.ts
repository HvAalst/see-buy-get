import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http';
import { createHmac } from 'crypto';
import { EventBus } from '../../foundation/events/event-bus.service';
import { FieldEncryption } from '../../foundation/data-firewall/field-encryption.service';
import { IdentityVault } from '../../foundation/data-firewall/identity-vault.service';
import { CargoService } from './cargo.service';
import { ConsignmentNoteService } from './consignment-note.service';
import { CorridorService } from './corridor.service';
import { DepartureNoteService } from './departure-note.service';
import { DepartureService } from './departure.service';
import { DestinationService } from './destination.service';
import { NoteArchiveService } from './note-archive.service';
import { NoteBundleService } from './note-bundle.service';
import { requiredUnloadKeys } from './heavy-cargo';
import { MAX_ATTEMPTS } from './destination.types';
import type { DispatchService } from './dispatch.service';
import type { AgentService } from './agent.service';
import type { DriverService } from './driver.service';
import type { FleetManagerService } from './fleet-manager.service';
import type { MediaService } from './media.service';
import type { VehicleService } from './vehicle.service';
import type { VendorService } from './vendor.service';
import type { PresenceService } from '../../foundation/presence/presence.service';
import type { IntrospectionResult } from '../../foundation/auth/auth.types';

/**
 * DELIVERY TO SOMEBODY'S OWN STORAGE, AGAINST A REAL SERVER.
 *
 * The defect this file exists to prevent is already in this codebase once: the store callback has been
 * built, signed and pushed to an outbox since the click-and-collect work, and nothing has ever posted
 * it. From the inside a queue nobody drains is indistinguishable from a working integration — every
 * unit test passes, the outbox fills up, and the far end never hears a thing.
 *
 * So nothing here is mocked at the HTTP boundary. A real server is started on a real port, the service
 * is pointed at it, and the assertions are about BYTES THAT ARRIVED.
 */
describe('delivering a consignment note to your own storage', () => {
  const MANAGER = 'did:glos:fleet-dst';
  const DRIVER = 'did:glos:driver-dst';
  const SHIPPER = 'did:glos:shipper-dst';
  const asShipper = { role: 'pudo', did: SHIPPER, active: true } as unknown as IntrospectionResult;

  /* ---------------------------------------------------------- the far end -- */

  interface Landed {
    method: string;
    url: string;
    headers: Record<string, string>;
    body: Buffer;
  }
  let server: Server;
  let origin: string;
  let landed: Landed[] = [];
  let answer: { status: number } = { status: 201 };

  beforeAll(async () => {
    server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        landed.push({
          method: req.method ?? '',
          url: req.url ?? '',
          headers: req.headers as Record<string, string>,
          body: Buffer.concat(chunks),
        });
        res.writeHead(answer.status);
        res.end();
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const address = server.address();
    origin = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  });

  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  beforeEach(() => {
    landed = [];
    answer = { status: 201 };
    // Loopback is only reachable in a sandbox, which is the gate this whole test relies on.
    process.env.GLOS_ENV = 'sandbox';
  });

  /* ------------------------------------------------------------ the network -- */

  let lanes = 0;
  const setUp = () => {
    lanes += 1;
    const bus = new EventBus();
    const corridors = new CorridorService();
    const managers = { get: () => ({ jurisdiction: 'KE' }), tradingBlocks: () => [], assertMayTakeWork: () => undefined } as unknown as FleetManagerService;
    const drivers = { canOperate: () => true, offRoadReasons: () => [] } as unknown as DriverService;
    const presence = { can: () => true } as unknown as PresenceService;
    const media = {
      adopt: () => undefined,
      // Round 31 — every photo is held here: the check itself is the media service's, tested there and over the wire.
      requireHeld: () => undefined,
      anchorFreightTerminal: () => undefined,
      holdFreightForDispute: () => undefined,
      get: () => undefined,
      blob: () => {
        throw new Error('no bytes');
      },
    } as unknown as MediaService;
    const agents = { get: () => ({ shopName: 'Mama Sarah Shop', did: SHIPPER }) } as unknown as AgentService;
    const vendors = { has: () => false, get: () => ({}) } as unknown as VendorService;
    const vehicles = {
      get: () => ({ vehicleId: 'veh_d', plate: 'KDA 777N', vehicleClass: 'truck', capacityKg: 8000, managerDid: MANAGER, status: 'ACTIVE' }),
      isUsable: () => true,
      offRoadReasons: () => [],
    } as unknown as VehicleService;

    const departures = new DepartureService(corridors, managers, drivers, vehicles, new CargoService(), media, presence, bus);
    const renderer = new ConsignmentNoteService(
      undefined as never, undefined as never, undefined as never, undefined as never,
      undefined as never, undefined as never, undefined as never,
    );
    const departureNotes = new DepartureNoteService(departures, renderer, new CargoService(), agents, vendors);
    const dispatch = { requireFreightPublic: () => ({ freightId: 'frt_d' }) } as unknown as DispatchService;
    const notes = { build: () => ({}), partiesOf: () => [], htmlFor: () => '<html></html>' } as unknown as ConsignmentNoteService;

    const archive = new NoteArchiveService(dispatch, notes, departures, departureNotes, bus);
    archive.onModuleInit();
    const bundles = new NoteBundleService(archive, renderer, media);
    const vault = new IdentityVault(new FieldEncryption(), bus);
    const destinations = new DestinationService(vault, archive, bundles, bus);
    destinations.onModuleInit();

    const proposed = corridors.proposeLine({ managerDid: MANAGER, company: 'Dst Haulage', name: `Dst line ${lanes}`, originZone: 'Nairobi', destZone: 'Mombasa', vehicleType: 'truck' });
    const corridor = corridors.publish(proposed.corridorId, 'did:glos:network-staff');
    const run = departures.declare({
      managerDid: MANAGER,
      corridorId: corridor.corridorId,
      vehicleId: 'veh_d',
      leavesAt: new Date(Date.now() + 86_400_000).toISOString(),
      basis: 'per_trip',
      amount: 900,
    });
    const booking = departures.book(run.departureId, { shipperDid: SHIPPER, description: 'Solar panels', weightKg: 800 }).booking;
    departures.assignDriver(run.departureId, MANAGER, { did: DRIVER, name: 'Wanjiru' });
    return { archive, departures, destinations, departureId: run.departureId, bookingId: booking.bookingId };
  };

  const webdav = (ctx: ReturnType<typeof setUp>) =>
    ctx.destinations.connect(asShipper, { kind: 'webdav', endpoint: `${origin}/dav/`, username: 'me', password: 'hunter2', prefix: 'freight' });

  /* ------------------------------------------------------------ connecting -- */

  describe('connecting somewhere', () => {
    it('refuses a kind nobody implements, and names the ones that exist', async () => {
      const ctx = setUp();
      await expect(ctx.destinations.connect(asShipper, { kind: 'dropbox', endpoint: origin })).rejects.toThrow(/s3, webdav, webhook/);
    });

    it('refuses S3 without a bucket or a key, rather than failing at the first delivery', async () => {
      const ctx = setUp();
      await expect(ctx.destinations.connect(asShipper, { kind: 's3', endpoint: origin })).rejects.toThrow(/bucket/);
      await expect(ctx.destinations.connect(asShipper, { kind: 's3', endpoint: origin, bucket: 'b' })).rejects.toThrow(/access key/);
    });

    it('REFUSES AN ADDRESS INSIDE A PRIVATE NETWORK even though it is reachable from here', async () => {
      const ctx = setUp();
      process.env.GLOS_ENV = 'production';
      try {
        await expect(ctx.destinations.connect(asShipper, { kind: 'webdav', endpoint: `${origin}/dav/`, username: 'u', password: 'p' })).rejects.toThrow(
          /https|private network/,
        );
      } finally {
        process.env.GLOS_ENV = 'sandbox';
      }
    });

    it('never puts the password in the record a screen can read', async () => {
      const ctx = setUp();
      const view = await webdav(ctx);
      expect(JSON.stringify(view)).not.toContain('hunter2');
      expect(JSON.stringify(view)).not.toContain('vaultRef');
      expect(view).toMatchObject({ connected: true, kind: 'webdav', prefix: 'freight' });
    });
  });

  /* ------------------------------------------------------- the test button -- */

  describe('the test button', () => {
    it('WRITES A REAL FILE, because a ping does not find a key that cannot write', async () => {
      const ctx = setUp();
      await webdav(ctx);
      const result = await ctx.destinations.test(asShipper);

      expect(result.ok).toBe(true);
      expect(landed).toHaveLength(1);
      expect(landed[0].method).toBe('PUT');
      expect(landed[0].url).toBe('/dav/freight/seebuyget-check.txt');
      expect(landed[0].body.toString()).toContain('check that it can deliver your consignment notes here');
      expect(landed[0].headers.authorization).toBe(`Basic ${Buffer.from('me:hunter2').toString('base64')}`);
    });

    it('reports a refusal in words somebody can act on, and never the remote body', async () => {
      const ctx = setUp();
      await webdav(ctx);
      answer = { status: 403 };
      const result = await ctx.destinations.test(asShipper);
      expect(result.ok).toBe(false);
      expect(result.detail).toMatch(/refused the credentials/);
    });
  });

  /* --------------------------------------------------------- the deliveries -- */

  describe('a finished consignment', () => {
    it('LANDS IN THEIR STORAGE AS A ZIP, without anybody pressing anything', async () => {
      const ctx = setUp();
      await webdav(ctx);
      landed = [];

      ctx.departures.deliver(ctx.departureId, ctx.bookingId, DRIVER, { receiverName: 'Joseph', photoRef: 'med_x', confirmed: requiredUnloadKeys() });
      await flush();
      const drained = await ctx.destinations.drain();

      expect(drained.sent).toBe(1);
      expect(landed).toHaveLength(1);
      expect(landed[0].url).toMatch(/^\/dav\/freight\/\d{4}\/CMR-[A-Z0-9]+\.zip$/);
      expect(landed[0].headers['content-type']).toBe('application/zip');
      // A real archive: the local file header signature, and the end record at the tail.
      expect(landed[0].body.readUInt32LE(0)).toBe(0x04034b50);
      expect(landed[0].body.readUInt32LE(landed[0].body.length - 22)).toBe(0x06054b50);
    });

    it('does NOT deliver mid-journey — an incomplete document is one somebody files and forgets', async () => {
      const ctx = setUp();
      await webdav(ctx);
      landed = [];
      await ctx.departures.setStatus(ctx.departureId, 'departed', MANAGER);
      await flush();
      expect((await ctx.destinations.drain()).sent).toBe(0);
      expect(landed).toHaveLength(0);
    });

    it('delivers nothing to somebody who has connected nothing', async () => {
      const ctx = setUp();
      ctx.departures.deliver(ctx.departureId, ctx.bookingId, DRIVER, { receiverName: 'Joseph', photoRef: 'med_x', confirmed: requiredUnloadKeys() });
      await flush();
      expect((await ctx.destinations.drain()).sent).toBe(0);
      expect(ctx.destinations.deliveriesFor(asShipper)).toHaveLength(0);
    });

    it('queues one delivery per document, not one per copy', async () => {
      const ctx = setUp();
      await webdav(ctx);
      ctx.departures.deliver(ctx.departureId, ctx.bookingId, DRIVER, { receiverName: 'Joseph', photoRef: 'med_x', confirmed: requiredUnloadKeys() });
      await flush();
      expect(ctx.destinations.deliveriesFor(asShipper).filter((d) => d.state === 'pending')).toHaveLength(1);
    });
  });

  /* ------------------------------------------------------ when it goes wrong -- */

  describe('when the storage is down', () => {
    const deliverOnce = async (ctx: ReturnType<typeof setUp>) => {
      ctx.departures.deliver(ctx.departureId, ctx.bookingId, DRIVER, { receiverName: 'Joseph', photoRef: 'med_x', confirmed: requiredUnloadKeys() });
      await flush();
    };

    it('backs off rather than hammering it, and keeps the reason', async () => {
      const ctx = setUp();
      await webdav(ctx);
      await deliverOnce(ctx);
      answer = { status: 503 };

      await ctx.destinations.drain();
      const [one] = ctx.destinations.deliveriesFor(asShipper);
      expect(one.state).toBe('pending');
      expect(one.attempts).toBe(1);
      expect(one.lastError).toMatch(/error of its own/);
      expect(Date.parse(one.nextTryAt)).toBeGreaterThan(Date.now());

      // Not due yet: a second drain a second later must not try again.
      await ctx.destinations.drain();
      expect(ctx.destinations.deliveriesFor(asShipper)[0].attempts).toBe(1);
    });

    it('GIVES UP AND SAYS SO, rather than retrying for ever behind a busy queue', async () => {
      const ctx = setUp();
      await webdav(ctx);
      await deliverOnce(ctx);
      answer = { status: 500 };

      let at = Date.now();
      for (let i = 0; i < MAX_ATTEMPTS; i++) {
        await ctx.destinations.drain(at);
        at += 2 * 24 * 60 * 60 * 1000; // well past any backoff
      }
      const [one] = ctx.destinations.deliveriesFor(asShipper);
      expect(one.state).toBe('failed');
      expect(one.attempts).toBe(MAX_ATTEMPTS);
      expect(one.lastError).toBeTruthy();
    });

    it('stops owing anything once they disconnect', async () => {
      const ctx = setUp();
      await webdav(ctx);
      await deliverOnce(ctx);
      expect(ctx.destinations.deliveriesFor(asShipper)).toHaveLength(1);

      ctx.destinations.disconnect(asShipper);
      expect(ctx.destinations.deliveriesFor(asShipper)).toHaveLength(0);
      expect((await ctx.destinations.drain()).sent).toBe(0);
      expect(landed).toHaveLength(0);
    });
  });

  /* ------------------------------------------------------- the other protocols -- */

  describe('S3-compatible', () => {
    it('signs the PUT and puts the bucket in the path, which is what self-hosted servers need', async () => {
      const ctx = setUp();
      await ctx.destinations.connect(asShipper, {
        kind: 's3',
        endpoint: origin,
        bucket: 'freight-archive',
        region: 'eu-west-1',
        accessKeyId: 'AKIAEXAMPLE',
        secretAccessKey: 'shhh',
        prefix: 'notes',
      });
      const result = await ctx.destinations.test(asShipper);

      expect(result.ok).toBe(true);
      expect(landed[0].url).toBe('/freight-archive/notes/seebuyget-check.txt');
      expect(landed[0].headers.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIAEXAMPLE\/\d{8}\/eu-west-1\/s3\/aws4_request/);
      expect(landed[0].headers['x-amz-content-sha256']).toMatch(/^[0-9a-f]{64}$/);
      expect(landed[0].headers['x-amz-date']).toMatch(/^\d{8}T\d{6}Z$/);
    });
  });

  describe('a webhook, for whoever would rather receive', () => {
    it('signs the body with a secret we generate, and shows it once', async () => {
      const ctx = setUp();
      await ctx.destinations.connect(asShipper, { kind: 'webhook', endpoint: `${origin}/hook` });
      const { secret } = ctx.destinations.webhookSecret(asShipper);
      expect(secret).toMatch(/^whs_[0-9a-f]{48}$/);

      await ctx.destinations.test(asShipper);
      expect(landed[0].method).toBe('POST');
      expect(landed[0].headers['x-sbg-signature']).toBe(createHmac('sha256', secret).update(landed[0].body).digest('hex'));
      expect(landed[0].headers['x-sbg-document']).toContain('seebuyget-check.txt');
    });
  });
});

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
  await new Promise((r) => setImmediate(r));
}
