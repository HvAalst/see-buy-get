import type { TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { MediaService } from '../src/modules/pudo/media.service';
import { VendorService } from '../src/modules/pudo/vendor.service';

/** A real 1×1 PNG — real magic bytes, so it passes the media service's signature check. */
export const CONTENTS_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/**
 * Round 30 — a store's photo of what is in the box, as the order door now requires it: one we hold, uploaded as the
 * store's own, for one parcel only. A made-up name is refused there, so a spec making a store's order photographs it.
 */
export function contentPhotos(moduleRef: TestingModule): (vendorId: string) => string {
  const media = moduleRef.get(MediaService);
  const vendors = moduleRef.get(VendorService);
  return (vendorId: string) => media.upload({ ownerDid: vendors.get(vendorId).did, kind: 'content', dataUrl: CONTENTS_PNG }).mediaId;
}

/**
 * Round 31 — any evidence photo, as every party's now must be: one we hold, uploaded by the party the act checks (the
 * shop at its counter, the driver on the load, the receiver in the Send app), for one thing only.
 */
export function evidencePhotos(moduleRef: TestingModule): (ownerDid: string) => string {
  return evidencePhotosFrom(moduleRef.get(MediaService));
}

/** …for a spec that builds its media service by hand. */
export function evidencePhotosFrom(media: MediaService): (ownerDid: string) => string {
  return (ownerDid: string) => media.upload({ ownerDid, kind: 'dropoff', dataUrl: CONTENTS_PNG }).mediaId;
}

/** …over the wire, as the Store app sends it: at the store's own sign-in. */
export async function contentPhotoOver(server: Parameters<typeof request>[0], auth: Record<string, string>): Promise<string> {
  return (await request(server).post('/v1/sbg/media').set(auth).send({ kind: 'content', dataUrl: CONTENTS_PNG }).expect(201)).body.mediaId as string;
}

/** Round 31 — an evidence photo over the wire, uploaded by whoever the token is: the shop at its counter, the driver, the receiver. */
export async function photoOver(server: Parameters<typeof request>[0], auth: Record<string, string>, kind = 'dropoff'): Promise<string> {
  return (await request(server).post('/v1/sbg/media').set(auth).send({ kind, dataUrl: CONTENTS_PNG }).expect(201)).body.mediaId as string;
}

/** …by a shop the spec does not hold a sign-in for (it acts as staff): the shop's own token, as the sandbox gives one. */
export async function shopPhotoOver(server: Parameters<typeof request>[0], agentDid: string): Promise<string> {
  const token = (await request(server).post('/v1/auth/token').send({ role: 'agent', did: agentDid }).expect(201)).body.access_token as string;
  return photoOver(server, { authorization: `Bearer ${token}` });
}

/** …and as a store's own system sends it, with its secret key. */
export async function shipmentPhotoOver(server: Parameters<typeof request>[0], key: string): Promise<string> {
  return (await request(server).post('/v1/sbg/shipping/photos').set('x-sbg-key', key).send({ dataUrl: CONTENTS_PNG }).expect(201)).body.photoId as string;
}
