import { createDecipheriv, createECDH, createHmac, randomBytes, type ECDH } from 'crypto';

/**
 * THE BROWSER'S SIDE OF A PUSH, for tests — written from RFC 8291 and RFC 8188 with HMAC by hand, sharing no code
 * with the sender (web-push.ts). If the two disagree about one byte of the key schedule, nothing opens.
 */

/** A device as a browser makes one: what `pushManager.subscribe(...)` hands back, and the private half it keeps. */
export function aDevice(): { ecdh: ECDH; auth: Buffer; keys: { p256dh: string; auth: string } } {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = randomBytes(16);
  return { ecdh, auth, keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: auth.toString('base64url') } };
}

/** HKDF (RFC 5869) by hand, one block — every length asked for here fits in one. */
const extract = (salt: Buffer, ikm: Buffer) => createHmac('sha256', salt).update(ikm).digest();
const expand = (prk: Buffer, info: Buffer, length: number) => createHmac('sha256', prk).update(Buffer.concat([info, Buffer.from([1])])).digest().subarray(0, length);

/** Open a push body the way the browser it was sealed to does. Throws when it was not sealed to this device. */
export function openAsBrowser(body: Buffer, device: { ecdh: ECDH; auth: Buffer }): { text: string; recordSize: number; senderKey: Buffer } {
  const salt = body.subarray(0, 16);
  const recordSize = body.readUInt32BE(16);
  const idLength = body[20];
  const senderKey = body.subarray(21, 21 + idLength);
  const sealed = body.subarray(21 + idLength);

  const shared = device.ecdh.computeSecret(senderKey);
  const ikm = expand(extract(device.auth, shared), Buffer.concat([Buffer.from('WebPush: info\0'), device.ecdh.getPublicKey(), senderKey]), 32);
  const prk = extract(salt, ikm);
  const key = expand(prk, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = expand(prk, Buffer.from('Content-Encoding: nonce\0'), 12);

  const decipher = createDecipheriv('aes-128-gcm', key, nonce);
  decipher.setAuthTag(sealed.subarray(sealed.length - 16));
  const padded = Buffer.concat([decipher.update(sealed.subarray(0, sealed.length - 16)), decipher.final()]);
  // The last record ends with 0x02 and then only zeroes.
  let end = padded.length - 1;
  while (end >= 0 && padded[end] === 0) end -= 1;
  if (padded[end] !== 2) throw new Error('the record does not end as a last record must');
  return { text: padded.subarray(0, end).toString('utf8'), recordSize, senderKey };
}
