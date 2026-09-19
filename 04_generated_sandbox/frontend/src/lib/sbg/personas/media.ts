import type { SbgClient } from '../client';

/** The media kinds the upload contract accepts (mirrors the backend UploadMediaDto enum). */
export type MediaKind =
  | 'dropoff'
  | 'pod'
  | 'dispute'
  | 'content'
  | 'vehicle'
  | 'trailer'
  | 'registration'
  | 'kyc_id'
  | 'kyc_licence'
  | 'shop'
  | 'avatar'
  | 'securement' // S33 — a driver's photo of a secured dedicated-freight load at pickup
  | 'hazard' // a driver's photo of a road constraint — the bridge, the washout, or the road now clear
  | 'interchange'; // Y3 — a party's photo of a CONTAINER's condition at a gate, beside the driver's own

/**
 * Media facade (S26) — the operations any authenticated app shares for real image upload + display.
 * Upload sends a downscaled, EXIF-stripped data URL; fetch pulls the bytes back through the SAME auth
 * middleware (a media endpoint is owner-or-operator gated, so a plain <img src> with no bearer cannot
 * load it — hence a Blob fetch → object URL). Spread into each persona so every app can name it.
 */
export function createMediaApi(sbg: SbgClient) {
  return {
    /** Upload one prepared image (+ optional thumbnail). Returns { mediaId }. */
    uploadMedia: (kind: MediaKind, dataUrl: string, thumbDataUrl?: string) =>
      sbg.request((c) => c.POST('/v1/sbg/media', { body: { kind, dataUrl, ...(thumbDataUrl ? { thumbDataUrl } : {}) } })),

    /**
     * The bytes for one media as a Blob (authenticated) — feed to URL.createObjectURL for an <img>.
     *
     * `variant: 'thumb'` asks for the stored thumbnail instead of the full image, and it is not a nicety:
     * a driver reading hazard photos is on a connection they pay for by the megabyte, so anything shown
     * in a list asks for the small one and only a deliberate tap pulls the full frame.
     */
    mediaBlob: (mediaId: string, variant?: 'full' | 'thumb') =>
      sbg.request((c) =>
        c.GET('/v1/sbg/media/{id}', { params: { path: { id: mediaId }, query: variant ? { variant } : {} }, parseAs: 'blob' } as never),
      ),

    /** The caller's own media — the media-library source. PII-free views. */
    myMedia: () => sbg.request((c) => c.GET('/v1/sbg/media', {})),

    /** Remove one of your own asset images early (evidence bins stay locked server-side). */
    deleteMedia: (mediaId: string) => sbg.request((c) => c.DELETE('/v1/sbg/media/{id}', { params: { path: { id: mediaId } } })),
  };
}
