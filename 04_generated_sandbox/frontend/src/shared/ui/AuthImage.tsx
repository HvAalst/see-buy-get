import { useEffect, useRef, useState } from 'preact/hooks';
import { Icon } from './Icon';

export interface AuthImageProps {
  /** The media id to display. */
  mediaId: string;
  /** Authenticated byte loader (persona.mediaBlob) — returns a Result whose data is a Blob. */
  load: (mediaId: string) => Promise<{ data: Blob | null; error: unknown }>;
  alt: string;
  class?: string;
}

/**
 * Display a media by id. A media endpoint is owner-or-operator gated, so a bare `<img src>` (no bearer)
 * cannot load it — we fetch the bytes with the session token, wrap them in an object URL, and revoke on
 * unmount/change so blobs never leak. `load` is held in a ref so an inline loader prop does not retrigger
 * the fetch every render — only a new mediaId does.
 */
export function AuthImage({ mediaId, load, alt, class: cls = '' }: AuthImageProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    setUrl(null);
    setFailed(false);
    void loadRef.current(mediaId).then((r) => {
      if (cancelled) return;
      if (r.error || !r.data) {
        setFailed(true);
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
