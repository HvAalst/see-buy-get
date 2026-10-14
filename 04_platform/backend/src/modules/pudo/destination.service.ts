import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { IntrospectionResult } from '../../foundation/auth/auth.types';
import { actingDid } from '../../foundation/auth/acting';
import { IdentityVault } from '../../foundation/data-firewall/identity-vault.service';
import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import { GlosError } from '../../foundation/http/glos-error';
import { assertReachable } from '../../foundation/outbound/guard';
import { PutResult, postToWebhook, putToS3, putToWebdav } from '../../foundation/outbound/send';
import { PersistentMap } from '../../foundation/store/persistent-map';
import {
  DESTINATION_KINDS,
  Delivery,
  Destination,
  DestinationKind,
  DestinationView,
  MAX_ATTEMPTS,
  backoffMinutes,
  deliveryKey,
} from './destination.types';
import { NoteArchiveService } from './note-archive.service';
import { NoteBundleService } from './note-bundle.service';

/** How often the queue is drained. Deliveries are due by the minute, not the second. */
const DRAIN_MS = Number(process.env.GLOS_DELIVERY_DRAIN_MS ?? 60_000);

/** The secret half of a destination, as it sits in the vault and nowhere else. */
interface DestinationSecret extends Record<string, unknown> {
  accessKeyId?: string;
  secretAccessKey?: string;
  username?: string;
  password?: string;
  webhookSecret?: string;
}

export interface ConnectInput {
  kind: string;
  label?: string;
  endpoint: string;
  bucket?: string;
  region?: string;
  pathStyle?: boolean;
  prefix?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  username?: string;
  password?: string;
}

/**
 * THE DESTINATION, AND THE QUEUE THAT ACTUALLY DELIVERS TO IT.
 *
 * See destination.types.ts for why this is protocols rather than vendor connectors, and why it is not a
 * sync client. This service owns three things: what a party connected, a durable queue of what is owed
 * them, and a drain that really does put bytes on the wire.
 *
 * THE LAST PART IS THE ONE TO WATCH. This codebase already contains the other kind — the store callback
 * has been built, signed and pushed to an outbox for months and has never been posted — and from the
 * inside the two are indistinguishable. Every path here ends in a `fetch`, and the drive stands up a
 * server and watches a file land.
 */
@Injectable()
export class DestinationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DestinationService.name);
  private readonly destinations = new PersistentMap<string, Destination>('note-destinations');
  private readonly deliveries = new PersistentMap<string, Delivery>('note-deliveries');
  private timer?: NodeJS.Timeout;
  private draining = false;

  constructor(
    private readonly vault: IdentityVault,
    private readonly archive: NoteArchiveService,
    private readonly bundles: NoteBundleService,
    private readonly events: EventBus,
  ) {}

  onModuleInit(): void {
    /*
     * A copy was frozen. Queued only once the LOAD HAS FINISHED, because a bundle delivered mid-journey
     * is an incomplete document somebody would file and forget. A claim raised afterwards freezes
     * another copy and re-queues, which replaces the file rather than leaving two that disagree.
     */
    this.events.subscribe<{ docId: string; finished: boolean; parties: string[]; number: string }>(GlosEvent.Pudo.NoteFrozen, (e) => {
      if (e.payload.finished) this.enqueueFor(e.payload.docId, e.payload.number, e.payload.parties);
    });

    this.timer = setInterval(() => void this.drain(), DRAIN_MS);
    this.timer.unref?.();
    void this.drain();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /* ------------------------------------------------------------ what they connected -- */

  view(actor: IntrospectionResult | undefined): DestinationView | null {
    const d = this.destinations.get(actingDid(actor));
    if (!d) return null;
    const { vaultRef, ownerDid, ...rest } = d;
    void vaultRef;
    void ownerDid;
    return { ...rest, connected: true };
  }

  /**
   * Connect a destination, replacing whatever was there.
   *
   * The address is checked here AND again before every delivery: a hostname that was fine in January
   * can point somewhere else in June, and the check is cheap.
   */
  async connect(actor: IntrospectionResult | undefined, input: ConnectInput): Promise<DestinationView> {
    const ownerDid = actingDid(actor);
    const kind = String(input.kind) as DestinationKind;
    if (!DESTINATION_KINDS.includes(kind)) {
      throw new GlosError('INVALID_INPUT', `Say which kind of storage: ${DESTINATION_KINDS.join(', ')}`);
    }
    const endpoint = String(input.endpoint ?? '').trim();
    if (!endpoint) throw new GlosError('FIELD_REQUIRED', 'Where should we put them? Give the address of your storage');
    await assertReachable(endpoint);

    const secret: DestinationSecret = {};
    if (kind === 's3') {
      if (!input.bucket) throw new GlosError('FIELD_REQUIRED', 'Which bucket?');
      if (!input.accessKeyId || !input.secretAccessKey) throw new GlosError('FIELD_REQUIRED', 'S3 storage needs an access key and a secret');
      secret.accessKeyId = input.accessKeyId;
      secret.secretAccessKey = input.secretAccessKey;
    } else if (kind === 'webdav') {
      if (!input.username || !input.password) throw new GlosError('FIELD_REQUIRED', 'WebDAV storage needs a username and a password');
      secret.username = input.username;
      secret.password = input.password;
    } else {
      // Ours, not theirs: the receiver checks it to prove a bundle came from us. Shown once, on connect.
      secret.webhookSecret = `whs_${randomBytes(24).toString('hex')}`;
    }

    // Replacing a destination replaces its secret too; the old vault entry is left to the vault's own
    // lifecycle rather than being reached into from here.
    const { vaultRef } = this.vault.store(secret as never);
    const destination: Destination = {
      ownerDid,
      kind,
      label: (input.label ?? '').trim() || defaultLabel(kind, endpoint),
      endpoint,
      ...(input.bucket ? { bucket: input.bucket.trim() } : {}),
      ...(input.region ? { region: input.region.trim() } : { region: 'us-east-1' }),
      ...(input.pathStyle === false ? { pathStyle: false } : { pathStyle: true }),
      prefix: (input.prefix ?? 'seebuyget/consignment-notes').replace(/^\/+|\/+$/g, ''),
      vaultRef,
      createdAt: new Date().toISOString(),
    };
    this.destinations.set(ownerDid, destination);
    return this.view(actor) as DestinationView;
  }

  disconnect(actor: IntrospectionResult | undefined): void {
    const ownerDid = actingDid(actor);
    this.destinations.delete(ownerDid);
    // Anything still owed is dropped with it: continuing to push to storage somebody disconnected is
    // the opposite of what disconnecting means.
    for (const d of [...this.deliveries.values()]) {
      if (d.ownerDid === ownerDid && d.state === 'pending') this.deliveries.delete(d.deliveryId);
    }
  }

  /** The signing secret, shown once so a webhook receiver can be set up. */
  webhookSecret(actor: IntrospectionResult | undefined): { secret: string } {
    const d = this.destinations.get(actingDid(actor));
    if (!d || d.kind !== 'webhook') throw new GlosError('NOT_FOUND', 'No webhook destination is connected');
    const secret = this.secretOf(d).webhookSecret;
    if (!secret) throw new GlosError('NOT_FOUND', 'That destination has no signing secret');
    return { secret };
  }

  /**
   * WRITE A REAL FILE AND SEE WHAT HAPPENS.
   *
   * Not a ping: the failure people actually hit is credentials that read and cannot write, or a bucket
   * that exists with a prefix that is denied. Only a real PUT finds those — and finding them at the
   * moment somebody connects, rather than a year later when the document has gone, is the point.
   */
  async test(actor: IntrospectionResult | undefined): Promise<{ ok: boolean; detail: string; key: string }> {
    const ownerDid = actingDid(actor);
    const destination = this.destinations.get(ownerDid);
    if (!destination) throw new GlosError('NOT_FOUND', 'No storage is connected');

    const key = `${destination.prefix ? `${destination.prefix}/` : ''}seebuyget-check.txt`;
    const body = Buffer.from(
      [
        'This file was written by SeeBuyGet to check that it can deliver your consignment notes here.',
        `Written ${new Date().toISOString()}.`,
        'You can delete it. Your notes will arrive alongside it, one ZIP per consignment.',
        '',
      ].join('\n'),
      'utf8',
    );

    const result = await this.send(destination, key, body, 'text/plain; charset=utf-8');
    this.record(destination, result);
    return { ok: result.ok, detail: result.detail, key };
  }

  /* -------------------------------------------------------------------- the queue -- */

  /** One delivery per party who has somewhere to put it. Collapses onto a pending one for the same doc. */
  private enqueueFor(docId: string, number: string, parties: string[]): void {
    const at = new Date().toISOString();
    for (const ownerDid of new Set(parties ?? [])) {
      const destination = this.destinations.get(ownerDid);
      if (!destination) continue;
      const already = [...this.deliveries.values()].find((d) => d.ownerDid === ownerDid && d.docId === docId && d.state === 'pending');
      if (already) continue;

      const deliveryId = `dlv_${randomBytes(8).toString('hex')}`;
      this.deliveries.set(deliveryId, {
        deliveryId,
        ownerDid,
        docId,
        number,
        key: deliveryKey(destination.prefix, number, at),
        state: 'pending',
        attempts: 0,
        nextTryAt: at,
        queuedAt: at,
      });
    }
  }

  /** Everything owed or delivered to this account, newest first — so a failure is visible. */
  deliveriesFor(actor: IntrospectionResult | undefined, limit = 50): Delivery[] {
    const ownerDid = actingDid(actor);
    return [...this.deliveries.values()]
      .filter((d) => d.ownerDid === ownerDid)
      .sort((a, b) => (a.queuedAt < b.queuedAt ? 1 : -1))
      .slice(0, limit);
  }

  /**
   * Send everything that is due. Never throws: a drain that dies takes the whole queue with it.
   *
   * Serial on purpose — a fleet with a hundred documents owed should not open a hundred sockets to
   * somebody's NAS at once, and the queue is measured in minutes rather than milliseconds.
   */
  async drain(now: number = Date.now()): Promise<{ sent: number; failed: number }> {
    if (this.draining) return { sent: 0, failed: 0 };
    this.draining = true;
    let sent = 0;
    let failed = 0;
    try {
      const due = [...this.deliveries.values()].filter((d) => d.state === 'pending' && Date.parse(d.nextTryAt) <= now);
      for (const delivery of due) {
        const destination = this.destinations.get(delivery.ownerDid);
        if (!destination) {
          this.deliveries.delete(delivery.deliveryId);
          continue;
        }
        let result: PutResult;
        try {
          const bundle = this.bundles.one(delivery.docId, asParty(delivery.ownerDid));
          result = await this.send(destination, delivery.key, bundle.bytes, 'application/zip');
        } catch (err) {
          // The document may have been swept, or the guard may now refuse the address.
          result = { ok: false, status: 0, detail: (err as Error).message };
        }
        this.record(destination, result);

        delivery.attempts += 1;
        if (result.ok) {
          delivery.state = 'delivered';
          delivery.deliveredAt = new Date(now).toISOString();
          delete delivery.lastError;
          sent += 1;
        } else if (delivery.attempts >= MAX_ATTEMPTS) {
          // Stop, and SAY so. Retrying for ever would hide a broken destination behind a busy queue.
          delivery.state = 'failed';
          delivery.lastError = result.detail;
          failed += 1;
        } else {
          delivery.nextTryAt = new Date(now + backoffMinutes(delivery.attempts) * 60_000).toISOString();
          delivery.lastError = result.detail;
        }
        this.deliveries.set(delivery.deliveryId, delivery);
      }
    } catch (err) {
      this.logger.warn(`delivery drain failed: ${(err as Error).message}`);
    } finally {
      this.draining = false;
    }
    if (sent || failed) this.logger.log(`delivery: ${sent} delivered, ${failed} given up on`);
    return { sent, failed };
  }

  /* ------------------------------------------------------------------- the wire -- */

  private async send(destination: Destination, key: string, body: Buffer, contentType: string): Promise<PutResult> {
    const secret = this.secretOf(destination);
    try {
      if (destination.kind === 's3') {
        return await putToS3(
          {
            endpoint: destination.endpoint,
            bucket: destination.bucket as string,
            region: destination.region ?? 'us-east-1',
            accessKeyId: secret.accessKeyId as string,
            secretAccessKey: secret.secretAccessKey as string,
            pathStyle: destination.pathStyle !== false,
          },
          key,
          body,
          contentType,
        );
      }
      if (destination.kind === 'webdav') {
        return await putToWebdav(
          { baseUrl: destination.endpoint, username: secret.username as string, password: secret.password as string },
          key,
          body,
          contentType,
        );
      }
      return await postToWebhook({ url: destination.endpoint, secret: secret.webhookSecret as string }, key, body, contentType);
    } catch (err) {
      // A guard refusal, or a URL that stopped resolving. Their words are already safe to show.
      return { ok: false, status: 0, detail: (err as Error).message };
    }
  }

  private secretOf(destination: Destination): DestinationSecret {
    return this.vault.reveal(destination.vaultRef, {
      purpose: 'document-delivery',
      requesterDid: destination.ownerDid,
    }) as unknown as DestinationSecret;
  }

  /** Remember how it went, so a screen can show a destination that has stopped working. */
  private record(destination: Destination, result: PutResult): void {
    destination.lastTriedAt = new Date().toISOString();
    if (result.ok) {
      destination.lastOkAt = destination.lastTriedAt;
      delete destination.lastError;
    } else {
      destination.lastError = result.detail;
    }
    this.destinations.set(destination.ownerDid, destination);
  }
}

/**
 * The party, for a read made on their behalf.
 *
 * Delivery hands them exactly what THEY could have downloaded — not an operator view — so the bundle
 * that lands in their storage is the same one the button gives them.
 */
function asParty(did: string): IntrospectionResult {
  return { role: 'pudo', did, active: true } as unknown as IntrospectionResult;
}

function defaultLabel(kind: DestinationKind, endpoint: string): string {
  const host = (() => {
    try {
      return new URL(endpoint).host;
    } catch {
      return endpoint;
    }
  })();
  return kind === 's3' ? `S3 storage at ${host}` : kind === 'webdav' ? `WebDAV at ${host}` : `Webhook to ${host}`;
}
