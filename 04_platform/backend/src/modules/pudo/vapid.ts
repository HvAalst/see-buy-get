import { createECDH } from 'crypto';
import { deploymentSecret } from '../../foundation/runtime/secrets';

/**
 * WHO THIS SERVER IS TO A PUSH SERVICE (VAPID, RFC 8292) — one P-256 key.
 *
 * A browser subscribes against the PUBLIC half (`applicationServerKey`, served openly). The server signs every push
 * with the PRIVATE half, and a push service delivers only what that signature matches. So the private half is a
 * secret like any other this server signs with: whoever holds it, and the address of a device, can light that device
 * up in this network's name.
 *
 * It was read as `process.env.GLOS_VAPID_PRIVATE || <a pair written here>`, which is the very shape the deployment
 * rule exists to refuse — and the test that hunts for that shape did not see it, because the name says neither
 * "secret" nor "key" and the fallback was a constant, not a quoted string. It did no harm while no push ever left
 * the building. Now one does, so it is read through the rule: outside a sandbox this server does not start on the
 * pair printed below.
 *
 * ONE VALUE, NOT TWO. The public half is worked out from the private half and never configured: a public key set
 * beside a private key that is not its partner enrols every browser against a key the server cannot sign for, and
 * nothing shows it until a push service refuses each push. `GLOS_VAPID_PUBLIC` is no longer read.
 *
 * ANY 32 RANDOM BYTES ARE A KEY (all but a vanishing few), so the secret is made the way the others are —
 * `openssl rand -hex 32` — and is taken as those 64 hex characters, or as base64url, which is how a browser tool
 * prints one.
 */
export const BUILT_IN_PUBLIC = 'BGdKs8o8SwKFtZWmRYPEy5j8tccJ2bbBzExTX0xJW2qzb6ft9Rot26iGI9p4u5_5e0jXTskaRLJrNW7p3oIP37U';
export const BUILT_IN_PRIVATE = 'oREOkpH8LKZI0b2iVJ8hPeuhCqJTMLBppOQsoml4Cc8';
const DEFAULT_SUBJECT = 'mailto:ops@seebuyget.example';

export interface VapidIdentity {
  /** The `applicationServerKey`: the uncompressed point, base64url. Public by design. */
  publicKey: string;
  /** The 32 bytes this server signs with. */
  privateKey: Buffer;
  /** Who a push service may write to about this sender: a `mailto:` or an `https:` address. */
  subject: string;
}

/** A private key as its 32 bytes — from 64 hex characters or from base64url — or null when it is neither. */
export function privateKeyBytes(value: string): Buffer | null {
  const v = (value ?? '').trim();
  const bytes = /^[0-9a-f]{64}$/i.test(v) ? Buffer.from(v, 'hex') : /^[A-Za-z0-9_-]{43}=?$/.test(v) ? Buffer.from(v, 'base64url') : Buffer.alloc(0);
  return bytes.length === 32 ? bytes : null;
}

/** The public half a private key makes, base64url — or null when it is not a key on this curve. */
export function publicKeyOf(privateKey: Buffer): string | null {
  try {
    const ecdh = createECDH('prime256v1');
    ecdh.setPrivateKey(privateKey);
    return ecdh.getPublicKey().toString('base64url');
  } catch {
    return null;
  }
}

type Env = Record<string, string | undefined>;

/** Read where it is used, like every other secret: a server that cannot sign a push says so when it starts. */
export function vapidIdentity(env: Env = process.env): VapidIdentity {
  const value = deploymentSecret('GLOS_VAPID_PRIVATE', BUILT_IN_PRIVATE, env);
  const privateKey = privateKeyBytes(value);
  const publicKey = privateKey ? publicKeyOf(privateKey) : null;
  if (!privateKey || !publicKey) {
    throw new Error('GLOS_VAPID_PRIVATE is not a key. It signs every push this server sends: give it 32 random bytes, as 64 hex characters (openssl rand -hex 32) or as base64url');
  }
  return { publicKey, privateKey, subject: (env.GLOS_VAPID_SUBJECT ?? '').trim() || DEFAULT_SUBJECT };
}

/** Whether this is the pair printed above, which anybody who has read the source can sign with. */
export function isBuiltIn(identity: Pick<VapidIdentity, 'publicKey'>): boolean {
  return identity.publicKey === BUILT_IN_PUBLIC;
}
