import { createHmac } from 'crypto';
import { assertReachable } from './guard';
import { signRequest } from './sigv4';

/**
 * PUTTING BYTES SOMEWHERE ELSE — the part that actually happens.
 *
 * Worth saying because this project has the other kind already: the vendor callback has been built,
 * signed and pushed to an outbox since the click-and-collect work, and nothing has ever posted it. A
 * queue that nobody drains looks exactly like a working integration from the inside. So everything here
 * ends in a real `fetch`, and the drive proves it by standing up a server and watching a file land.
 *
 * WHAT COMES BACK IS A STATUS AND OUR OWN WORDS, never the far end's body — see guard.ts. An error
 * message that quoted what the other server said would make this a reader for any address it can reach.
 */

/** Long enough for a slow link with a few megabytes of photographs; short enough not to wedge a queue. */
const TIMEOUT_MS = Number(process.env.GLOS_OUTBOUND_TIMEOUT_MS ?? 30_000);

export interface PutResult {
  ok: boolean;
  status: number;
  /** Our words, safe to show. Never the remote body. */
  detail: string;
}

/**
 * Who we were talking to, so the failure reads like something the reader can act on.
 *
 * Two callers with genuinely different problems: somebody whose S3 key cannot write to a bucket, and a
 * merchant whose webhook handler is rejecting our POST. One set of sentences for both told a shop to
 * "check the key and that it may write to this folder" about an endpoint that has no folder — which is
 * the kind of message that sends somebody looking in the wrong place for an afternoon.
 */
export type Voice = 'storage' | 'endpoint';

function refusal(voice: Voice, status: number): string {
  if (voice === 'endpoint') {
    return status === 401 || status === 403
      ? 'Your endpoint refused it. Check that it accepts our POST and is not rejecting the signature.'
      : status === 404
        ? 'Your endpoint answered "not found". Check the callback address on your store record.'
        : status === 413
          ? 'Your endpoint refused it for being too large.'
          : status >= 500
            ? 'Your endpoint had an error of its own. We will try again.'
            : `Your endpoint refused it (${status}).`;
  }
  return status === 401 || status === 403
    ? 'The storage refused the credentials. Check the key and that it may write to this folder.'
    : status === 404
      ? 'The storage says that folder or bucket does not exist.'
      : status === 413
        ? 'The storage refused the file for being too large.'
        : status >= 500
          ? 'The storage had an error of its own. We will try again.'
          : `The storage refused it (${status}).`;
}

async function put(url: string, headers: Record<string, string>, body: Buffer, method = 'PUT', voice: Voice = 'storage'): Promise<PutResult> {
  const stop = AbortSignal.timeout(TIMEOUT_MS);
  const thing = voice === 'endpoint' ? 'your endpoint' : 'that storage';
  try {
    const res = await fetch(url, { method, headers, body: new Uint8Array(body), signal: stop, redirect: 'error' });
    if (res.ok) return { ok: true, status: res.status, detail: 'Delivered' };
    /*
     * The status is classified into something a person can act on. The remote body is deliberately
     * dropped on the floor — it is the only thing here that could carry somebody else's secrets back
     * out through an error message.
     */
    return { ok: false, status: res.status, detail: refusal(voice, res.status) };
  } catch (err) {
    const name = (err as Error).name;
    return {
      ok: false,
      status: 0,
      detail:
        name === 'TimeoutError' || name === 'AbortError'
          ? `${voice === 'endpoint' ? 'Your endpoint' : 'The storage'} did not answer in time. We will try again.`
          : `We could not reach ${thing}. We will try again.`,
    };
  }
}

/* ------------------------------------------------------------------ S3-compatible -- */

export interface S3Target {
  /** The service endpoint, e.g. https://s3.eu-west-1.amazonaws.com or a MinIO address. */
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  /**
   * Path style (`endpoint/bucket/key`) rather than virtual host (`bucket.endpoint/key`).
   *
   * Most self-hosted S3-compatible servers — MinIO, Ceph — only do path style, and AWS itself still
   * accepts it. Defaulting to it is what makes "compatible" mean something.
   */
  pathStyle?: boolean;
}

export async function putToS3(target: S3Target, key: string, body: Buffer, contentType: string): Promise<PutResult> {
  const base = new URL(target.endpoint);
  const pathStyle = target.pathStyle !== false;
  const url = pathStyle
    ? `${base.origin}/${encodeURIComponent(target.bucket)}/${key.split('/').map(encodeURIComponent).join('/')}`
    : `${base.protocol}//${target.bucket}.${base.host}/${key.split('/').map(encodeURIComponent).join('/')}`;

  await assertReachable(url);
  const signed = signRequest({
    method: 'PUT',
    url,
    body,
    accessKeyId: target.accessKeyId,
    secretAccessKey: target.secretAccessKey,
    region: target.region,
    service: 's3',
    ...(target.sessionToken ? { sessionToken: target.sessionToken } : {}),
    headers: { 'content-type': contentType },
  });
  return put(signed.url, signed.headers, body);
}

/* ------------------------------------------------------------------------ WebDAV -- */

export interface WebdavTarget {
  /** The collection to write into, e.g. https://cloud.example.com/remote.php/dav/files/me/freight/ */
  baseUrl: string;
  username: string;
  password: string;
}

/**
 * Nextcloud, ownCloud, SharePoint, most NAS boxes and anything else that speaks the oldest
 * file-over-HTTP standard there is. A PUT with Basic auth, and that really is all of it.
 */
export async function putToWebdav(target: WebdavTarget, key: string, body: Buffer, contentType: string): Promise<PutResult> {
  const base = target.baseUrl.endsWith('/') ? target.baseUrl : `${target.baseUrl}/`;
  const url = `${base}${key.split('/').map(encodeURIComponent).join('/')}`;
  await assertReachable(url);
  return put(url, {
    authorization: `Basic ${Buffer.from(`${target.username}:${target.password}`).toString('base64')}`,
    'content-type': contentType,
    // Overwrite the previous delivery of the same consignment rather than failing: the bundle is
    // cumulative, so the newest always contains everything the older one did.
    overwrite: 'T',
  }, body);
}

/* --------------------------------------------------------------- a signed POST -- */

/**
 * POST a body somebody else has already signed, to an address they gave us.
 *
 * For the store status callbacks, whose signature is computed when the event happens rather than when
 * it is sent — a retry must carry the SAME bytes and therefore the same signature, so the caller owns
 * both and this only puts them on the wire. Same guard, and the same rule about never returning what
 * the far end said.
 */
export async function postSigned(url: string, body: Buffer, headers: Record<string, string>): Promise<PutResult> {
  try {
    await assertReachable(url);
  } catch (err) {
    return { ok: false, status: 0, detail: (err as Error).message };
  }
  return put(url, headers, body, 'POST', 'endpoint');
}

/* ----------------------------------------------------------------------- webhook -- */

export interface WebhookTarget {
  url: string;
  /** Ours, generated when the destination is made, so the receiver can prove the bundle came from us. */
  secret: string;
}

/**
 * For anybody who would rather RECEIVE than be written to — a company with its own document system.
 *
 * Signed over the raw body with the same scheme the store callbacks use, so a receiver who has already
 * implemented one has implemented both. Compared in constant time on their side, which the docs say.
 */
export async function postToWebhook(target: WebhookTarget, key: string, body: Buffer, contentType: string): Promise<PutResult> {
  await assertReachable(target.url);
  const signature = createHmac('sha256', target.secret).update(body).digest('hex');
  return put(
    target.url,
    {
      'content-type': contentType,
      'x-sbg-signature': signature,
      'x-sbg-document': key,
    },
    body,
    'POST',
  );
}
