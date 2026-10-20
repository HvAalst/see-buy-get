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

/** …over the wire, as the Store app sends it: at the store's own sign-in. */
export async function contentPhotoOver(server: Parameters<typeof request>[0], auth: Record<string, string>): Promise<string> {
  return (await request(server).post('/v1/sbg/media').set(auth).send({ kind: 'content', dataUrl: CONTENTS_PNG }).expect(201)).body.mediaId as string;
}

/** …and as a store's own system sends it, with its secret key. */
export async function shipmentPhotoOver(server: Parameters<typeof request>[0], key: string): Promise<string> {
  return (await request(server).post('/v1/sbg/shipping/photos').set('x-sbg-key', key).send({ dataUrl: CONTENTS_PNG }).expect(201)).body.photoId as string;
}
