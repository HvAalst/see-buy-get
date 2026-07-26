import { AuthImage } from './AuthImage';
import { Button } from './Button';
import { Card } from './Card';
import { Pill } from './Pill';
import type { MediaView } from '../media';
import { groupByBin, retentionLabel } from '../media-logic';

export interface MediaLibraryProps {
  media: MediaView[];
  /** Authenticated byte loader (persona.mediaBlob) — a media endpoint needs the bearer. */
  load: (mediaId: string) => Promise<{ data: Blob | null; error: unknown }>;
  /** Remove an item early — only shown for deletable (asset) bins. Omit to make the library view-only. */
  onRemove?: (mediaId: string) => void;
  removingId?: string | null;
  emptyText?: string;
  /** Injectable clock for deterministic tests. */
  nowMs?: number;
}

/**
 * The media library (S27) — all a person's images in one place, grouped by retention BIN, each carrying a
 * plain-language chip ("Kept 42 more days", "Removing…", "Saved") so the retention is VISIBLE: the user
 * can see the network keeps proof for a while and then clears it, never that it hoards their photos.
 * Evidence bins are view-only; asset bins get a Remove action (when onRemove is wired).
 */
export function MediaLibrary({ media, load, onRemove, removingId, emptyText = 'No photos yet.', nowMs }: MediaLibraryProps) {
  const groups = groupByBin(media);
  const now = nowMs ?? Date.now();
  if (!groups.length) return <p class="hint">{emptyText}</p>;

  return (
    <div class="medlib">
      {groups.map((g) => (
        <Card key={g.bin} title={g.meta.title}>
          <p class="hint">{g.meta.blurb}</p>
          <div class="medgrid" role="list">
            {g.items.map((it) => {
              const r = retentionLabel(it, now);
              return (
                <figure key={it.mediaId} class="medcell" role="listitem">
                  <AuthImage mediaId={it.mediaId} load={load} alt={`${g.meta.title} photo`} class="medcell__img" />
                  <figcaption class="medcell__cap">
                    <Pill tone={r.tone}>{r.text}</Pill>
                    {g.meta.deletable && onRemove ? (
                      <Button
                        variant="link"
                        full={false}
                        busy={removingId === it.mediaId}
                        disabled={Boolean(removingId)} /* single-flight: no concurrent removes while one is running */
                        onClick={() => onRemove(it.mediaId)}
                      >
                        Remove
                      </Button>
                    ) : null}
                  </figcaption>
                </figure>
              );
            })}
          </div>
        </Card>
      ))}
    </div>
  );
}
