import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'crypto';
import { isoCBOR } from '@simplewebauthn/server/helpers';

/**
 * A PHONE'S FINGERPRINT READER, IN SOFTWARE — for the tests of unlocking with fingerprint or face (2026-11-02). It makes
 * a P-256 key pair the way a phone's platform authenticator does, answers a "make a passkey" ceremony with attestation
 * 'none', and signs an unlock challenge — every byte built here by hand from the WebAuthn spec, so the server's real
 * checks (@simplewebauthn/server) are what read them. `verified: false` says the finger or face was NOT checked (the
 * UV flag off); `origin` and `rpId` can be set wrong to see a foreign site refused.
 */
const b64url = (b: Uint8Array | Buffer): string => Buffer.from(b).toString('base64url');
const FLAG_UP = 0x01;
const FLAG_UV = 0x04;
const FLAG_AT = 0x40;

export class SoftAuthenticator {
  readonly credentialId = randomBytes(16);
  private readonly privateKey: KeyObject;
  private readonly publicKey: KeyObject;
  private counter = 0;

  constructor(
    readonly origin = 'http://localhost:5176',
    readonly rpId = 'localhost',
  ) {
    const pair = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    this.privateKey = pair.privateKey;
    this.publicKey = pair.publicKey;
  }

  get id(): string {
    return b64url(this.credentialId);
  }

  private clientData(type: 'webauthn.create' | 'webauthn.get', challenge: string, origin: string): Buffer {
    return Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
  }

  private rpIdHash(rpId: string): Buffer {
    return createHash('sha256').update(rpId).digest();
  }

  private coseKey(): Uint8Array {
    const jwk = this.publicKey.export({ format: 'jwk' }) as { x: string; y: string };
    // kty: EC2 (2), alg: ES256 (-7), crv: P-256 (1), x, y
    return isoCBOR.encode(new Map<number, number | Uint8Array>([[1, 2], [3, -7], [-1, 1], [-2, new Uint8Array(Buffer.from(jwk.x, 'base64url'))], [-3, new Uint8Array(Buffer.from(jwk.y, 'base64url'))]]));
  }

  /** Answer `navigator.credentials.create()` for these options, as the browser's JSON. */
  register(options: { challenge: string; rp?: { id?: string } }, opts: { verified?: boolean; origin?: string } = {}): Record<string, unknown> {
    const flags = FLAG_UP | FLAG_AT | (opts.verified === false ? 0 : FLAG_UV);
    const count = Buffer.alloc(4);
    const idLen = Buffer.alloc(2);
    idLen.writeUInt16BE(this.credentialId.length);
    const authData = Buffer.concat([this.rpIdHash(options.rp?.id ?? this.rpId), Buffer.from([flags]), count, Buffer.alloc(16), idLen, this.credentialId, Buffer.from(this.coseKey())]);
    const attestationObject = isoCBOR.encode(new Map<string, unknown>([['fmt', 'none'], ['attStmt', new Map()], ['authData', new Uint8Array(authData)]]) as never);
    return {
      id: this.id,
      rawId: this.id,
      type: 'public-key',
      authenticatorAttachment: 'platform',
      clientExtensionResults: {},
      response: { clientDataJSON: b64url(this.clientData('webauthn.create', options.challenge, opts.origin ?? this.origin)), attestationObject: b64url(attestationObject), transports: ['internal'] },
    };
  }

  /** Answer `navigator.credentials.get()` for this challenge, as the browser's JSON. */
  assert(challenge: string, opts: { verified?: boolean; origin?: string; rpId?: string; tamper?: boolean } = {}): Record<string, unknown> {
    this.counter += 1;
    const flags = FLAG_UP | (opts.verified === false ? 0 : FLAG_UV);
    const count = Buffer.alloc(4);
    count.writeUInt32BE(this.counter);
    const authData = Buffer.concat([this.rpIdHash(opts.rpId ?? this.rpId), Buffer.from([flags]), count]);
    const clientDataJSON = this.clientData('webauthn.get', challenge, opts.origin ?? this.origin);
    const signature = sign('sha256', Buffer.concat([authData, createHash('sha256').update(clientDataJSON).digest()]), this.privateKey);
    if (opts.tamper) signature[signature.length - 1] ^= 0xff;
    return {
      id: this.id,
      rawId: this.id,
      type: 'public-key',
      authenticatorAttachment: 'platform',
      clientExtensionResults: {},
      response: { clientDataJSON: b64url(clientDataJSON), authenticatorData: b64url(authData), signature: b64url(signature) },
    };
  }
}
