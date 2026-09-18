import { useEffect, useRef, useState } from 'preact/hooks';
import { Icon } from './Icon';

export interface AuthImageProps {
  /** The media id to display. */
  mediaId: string;
  /** Authenticated byte loader (persona.mediaBlob) — returns a Result whose data is a Blob. */
  load: (mediaId: string) => Promise<{ data: Blob | null; error: unknown }>;
  alt: string;
  class?: string;
  /**
   * Told when these bytes could not be fetched, so a CALLER can say so in words.
   *
   * Without this the failure is a grey tile with a camera in it, under a heading that counts the
   * photographs as if they were all there — which is the "2 photos, none shown" defect a layer up: the
   * count is a claim about evidence, and only the thing that fetched it knows whether the claim holds.
   */
  onFailed?: (mediaId: string) => void;
}

/**
 * Display a media by id. A media endpoint is owner-or-operator gated, so a bare `<img src>` (no bearer)
 * cannot load it — we fetch the bytes with the session token, wrap them in an object URL, and revoke on
 * unmount/change so blobs never leak. `load` is held in a ref so an inline loader prop does not retrigger
 * the fetch every render — only a new mediaId does.
 */
export function AuthImage({ mediaId, load, alt, class: cls = '', onFailed }: AuthImageProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const loadRef = useRef(load);
  loadRef.current = load;
  // Held in a ref for the same reason `load` is: an inline arrow would otherwise re-run the fetch on
  // every render of the parent.
  const failedRef = useRef(onFailed);
  failedRef.current = onFailed;

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    setUrl(null);
    setFailed(false);
    void loadRef.current(mediaId).then((r) => {
      if (cancelled) return;
      if (r.error || !r.data) {
        setFailed(true);
        failedRef.current?.(mediaId);
        return;
      }
      objectUrl = URL.createObjectURL(r.data);
      setUrl(objectUrl);
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [mediaId]);

  if (failed) {
    return (
      <div class={`authimg authimg--failed ${cls}`} role="img" aria-label={alt} title="Image unavailable">
        <Icon name="camera" size={20} />
      </div>
    );
  }
  if (!url) return <div class={`authimg authimg--loading ${cls}`} aria-hidden="true" />;
  return <img class={`authimg ${cls}`} src={url} alt={alt} loading="lazy" />;
}
