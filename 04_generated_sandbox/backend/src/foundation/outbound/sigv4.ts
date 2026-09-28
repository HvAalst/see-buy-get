import { createHash, createHmac } from 'crypto';

/**
 * AWS SIGNATURE VERSION 4, by hand, for S3-compatible storage.
 *
 * "S3-compatible" is the closest thing object storage has to a standard: MinIO, Backblaze B2, Wasabi,
 * Cloudflare R2, Ceph, most NAS boxes and AWS itself all speak it. Supporting it is what lets somebody
 * plug in whatever they already run, which is the whole point — a connector per vendor would be a
 * treadmill, and this is one protocol that reaches all of them.
 *
 * WRITTEN HERE RATHER THAN PULLED IN. This backend has eight production dependencies and none of them is
 * a cloud client; adding an SDK (and its transitive tree) to sign one PUT would be a poor trade. The
 * algorithm is published, fixed, and about a hundred lines.
 *
 * It is also the one piece here that CANNOT be verified by reading it — a signature is either byte-exact
 * or worthless, and a plausible-looking wrong one fails only against a real server. So sigv4.spec.ts
 * checks it against the worked example in AWS's own documentation (PUT Object, examplebucket,
 * 20130524), which pins the canonical request, the string to sign and the final signature.
 */

export interface SignedRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
}

export interface SignInput {
  method: string;
  /** The full URL, including any query. */
  url: string;
  /** Raw body bytes; empty for a request without one. */
  body: Buffer;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  /** 's3' for object storage. Kept a parameter because the algorithm is not S3's. */
  service?: string;
  /** Extra headers to sign — content-type, x-amz-storage-class, and so on. */
  headers?: Record<string, string>;
  /** Overridable so a test can pin the clock; otherwise now. */
  now?: Date;
  /** Temporary credentials carry one; it must be signed as x-amz-security-token. */
  sessionToken?: string;
}

const sha256Hex = (data: Buffer | string): string => createHash('sha256').update(data).digest('hex');
const hmac = (key: Buffer | string, data: string): Buffer => createHmac('sha256', key).update(data, 'utf8').digest();

/**
 * Percent-encode one path segment the way SigV4 wants it.
 *
 * RFC 3986 unreserved characters pass; everything else is encoded, uppercase hex. `encodeURIComponent`
 * is close but leaves `!'()*` alone, and those must be encoded or the canonical request differs from the
 * server's by a character and the signature is silently wrong.
 */
function uriEncode(segment: string): string {
  return segment.replace(/[^A-Za-z0-9\-._~]/g, (c) => {
    const bytes = Buffer.from(c, 'utf8');
    let out = '';
    for (const b of bytes) out += `%${b.toString(16).toUpperCase().padStart(2, '0')}`;
    return out;
  });
}

/**
 * The canonical path. S3 does NOT double-encode, so each segment is encoded once and the separators
 * stay — which is exactly the detail that differs from every other AWS service.
 */
function canonicalPath(pathname: string): string {
  if (!pathname || pathname === '/') return '/';
  return pathname
    .split('/')
    .map((s) => uriEncode(decodeURIComponent(s)))
    .join('/');
}

/** Query parameters sorted by name then value, each encoded. */
function canonicalQuery(search: URLSearchParams): string {
  const pairs: Array<[string, string]> = [];
  search.forEach((v, k) => pairs.push([uriEncode(k), uriEncode(v)]));
  pairs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  return pairs.map(([k, v]) => `${k}=${v}`).join('&');
}

/** The pieces, exposed so a test can pin each step rather than only the answer. */
export interface SignatureParts {
  canonicalRequest: string;
  stringToSign: string;
  signature: string;
  signedHeaders: string;
  credentialScope: string;
  amzDate: string;
}

export function signatureParts(input: SignInput): SignatureParts {
  const service = input.service ?? 's3';
  const url = new URL(input.url);
  const now = input.now ?? new Date();
  const amzDate = `${now.toISOString().slice(0, 19).replace(/[-:]/g, '')}Z`;
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(input.body);

  const headers: Record<string, string> = {
    host: url.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    ...(input.sessionToken ? { 'x-amz-security-token': input.sessionToken } : {}),
    ...(input.headers ?? {}),
  };

  // Lowercase names, trimmed values, sorted — the server rebuilds this exact block to check us.
  const entries = Object.entries(headers)
    .map(([k, v]) => [k.toLowerCase().trim(), String(v).trim().replace(/\s+/g, ' ')] as [string, string])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const canonicalHeaders = entries.map(([k, v]) => `${k}:${v}\n`).join('');
  const signedHeaders = entries.map(([k]) => k).join(';');

  const canonicalRequest = [
    input.method.toUpperCase(),
    canonicalPath(url.pathname),
    canonicalQuery(url.searchParams),
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const credentialScope = `${dateStamp}/${input.region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, sha256Hex(canonicalRequest)].join('\n');

  const kDate = hmac(`AWS4${input.secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, input.region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');

  return { canonicalRequest, stringToSign, signature, signedHeaders, credentialScope, amzDate };
}

/** The request as it goes on the wire: the same headers that were signed, plus Authorization. */
export function signRequest(input: SignInput): SignedRequest {
  const parts = signatureParts(input);
  const url = new URL(input.url);
  const headers: Record<string, string> = {
    'x-amz-content-sha256': sha256Hex(input.body),
    'x-amz-date': parts.amzDate,
    ...(input.sessionToken ? { 'x-amz-security-token': input.sessionToken } : {}),
    ...(input.headers ?? {}),
    Authorization:
      `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${parts.credentialScope}, ` +
      `SignedHeaders=${parts.signedHeaders}, Signature=${parts.signature}`,
  };
  // `host` is signed but never set by hand: fetch sets it from the URL, and a second one is a 400.
  delete headers.host;
  return { method: input.method.toUpperCase(), url: url.toString(), headers };
}
