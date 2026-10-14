/**
 * PLUG YOUR OWN STORAGE.
 *
 * The user's framing: *"as an OS that is something that users should be able to plug, like their
 * dropbox, google drive or onedrive or any other."* The operative words are "any other" — a connector
 * per vendor is a treadmill, and the thing that reaches all of them is a PROTOCOL. Two of those cover
 * almost everything anybody already runs:
 *
 *   S3-COMPATIBLE is the closest object storage has to a standard: MinIO, Ceph, Backblaze B2, Wasabi,
 *   Cloudflare R2, most NAS boxes, and AWS itself.
 *   WEBDAV is the oldest file-over-HTTP standard there is: Nextcloud, ownCloud, SharePoint, every NAS.
 *
 * And a WEBHOOK for anybody who would rather RECEIVE than be written to — a company whose document
 * system pulls things in rather than exposing a share.
 *
 * WHAT THIS IS NOT IS A SYNC CLIENT. A folder that installs on a laptop is a product line — file
 * watchers, conflict resolution, three platforms, installers, code signing, auto-update — and it is
 * the wrong shape for this: nothing ever comes back from the user. What is needed is one-way,
 * append-only delivery of finished documents, which is a few hundred lines rather than a team.
 *
 * WHY IT MATTERS MORE THAN A DOWNLOAD BUTTON. The document is deleted at twelve months. A retention
 * policy that depends on a person remembering to download a ZIP is a policy that destroys evidence, so
 * the copy that survives has to arrive somewhere by itself.
 */

export const DESTINATION_KINDS = ['s3', 'webdav', 'webhook'] as const;
export type DestinationKind = (typeof DESTINATION_KINDS)[number];

/** What a person sees and what the sender needs. The SECRET half is never in here — see `vaultRef`. */
export interface Destination {
  ownerDid: string;
  kind: DestinationKind;
  /** Their own words for which storage this is, because "S3" is not a place. */
  label: string;
  /** The S3 service endpoint, the WebDAV collection, or the webhook address. */
  endpoint: string;
  bucket?: string;
  region?: string;
  /** Path style (`endpoint/bucket/key`); the default, because self-hosted servers usually need it. */
  pathStyle?: boolean;
  /** The folder inside their storage. Everything we write lands under it and nothing outside it. */
  prefix: string;
  /** Where the key, password or signing secret actually lives. */
  vaultRef: string;
  createdAt: string;
  /** The last time a real file landed. Absent means nothing ever has — which is worth showing. */
  lastOkAt?: string;
  lastTriedAt?: string;
  /** Our words for the last failure. Never the remote body. */
  lastError?: string;
}

/** The view a screen gets: everything but the vault reference. */
export type DestinationView = Omit<Destination, 'vaultRef' | 'ownerDid'> & { connected: true };

export const DELIVERY_STATES = ['pending', 'delivered', 'failed'] as const;
export type DeliveryState = (typeof DELIVERY_STATES)[number];

/**
 * One bundle owed to one party.
 *
 * Durable, because the failure this exists to survive is the storage being down for a day — and
 * because the alternative is the trap this codebase already contains once: the vendor callback has
 * been built, signed and pushed to an in-memory outbox since the click-and-collect work, and nothing
 * has ever posted it. A queue nobody drains looks exactly like a working integration from the inside.
 */
export interface Delivery {
  deliveryId: string;
  ownerDid: string;
  docId: string;
  number: string;
  /** The path inside their storage, so a person can find it without asking us. */
  key: string;
  state: DeliveryState;
  attempts: number;
  /** When the next attempt is due. Backs off, so a dead endpoint is not hammered. */
  nextTryAt: string;
  queuedAt: string;
  deliveredAt?: string;
  lastError?: string;
}

/** Give up after this many tries — about a day of backoff — and say so rather than retrying for ever. */
export const MAX_ATTEMPTS = 8;

/** Backoff in minutes by attempt: a minute, then five, then a quarter hour, then hours. */
export function backoffMinutes(attempt: number): number {
  return [1, 5, 15, 60, 180, 360, 720, 1440][Math.min(attempt, 7)];
}

/**
 * Where a consignment lands in somebody's storage.
 *
 * Grouped by year so a folder opened in 2030 is not a flat list of ten thousand files, and named by the
 * note number so a person looking for one can find it without a database. Stable, so a re-delivery
 * after a claim replaces the earlier bundle rather than leaving two files that disagree.
 */
export function deliveryKey(prefix: string, number: string, at: string): string {
  const clean = prefix.replace(/^\/+|\/+$/g, '');
  const year = at.slice(0, 4);
  const safe = number.replace(/[^A-Za-z0-9._-]+/g, '-');
  return [clean, year, `${safe}.zip`].filter(Boolean).join('/');
}
