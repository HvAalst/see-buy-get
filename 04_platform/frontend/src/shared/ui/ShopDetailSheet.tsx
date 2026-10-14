import type { GeoPoint } from '../geo';
import { Sheet } from './Sheet';
import { Checklist } from './Checklist';
import { Button } from './Button';
import { OpenInMaps } from './OpenInMaps';

export interface ShopDetailSheetProps {
  open: boolean;
  title: string;
  /** A one-line lede under the title (zone / landmark). */
  subtitle?: string;
  /** The detail rows — consumer-formatted (price, distance, open, rating, …), so each screen keeps its
   *  own money/distance formatting and its own emphasis. */
  lines: string[];
  /** Shown as a "Navigate there" deep link when present (G3b). */
  location?: GeoPoint | null;
  /** The confirm action. OMIT for an info-only sheet (e.g. reference pins with nothing to choose). */
  onChoose?: () => void;
  chooseLabel?: string;
  chooseDisabled?: boolean;
  onClose: () => void;
}

/**
 * The shop preview sheet a map pin opens (G4). Shared across every shop picker so tapping a pin behaves
 * the same everywhere — a dead tap reads as a bug. The picker owns the DATA (it builds `lines` + supplies
 * `onChoose`); this owns the LAYOUT + the design contract (exactly one solid-blue CTA — the choose action;
 * Navigate is an outline link, Close is a link). No `onChoose` → an information-only sheet.
 */
export function ShopDetailSheet({ open, title, subtitle, lines, location, onChoose, chooseLabel = 'Choose', chooseDisabled, onClose }: ShopDetailSheetProps) {
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      {subtitle ? <p class="scr__lede">{subtitle}</p> : null}
      {lines.length ? <Checklist items={lines} /> : null}
      {location ? (
        <div style="margin:12px 0">
          <OpenInMaps point={location} label="Navigate there" />
        </div>
      ) : null}
      {onChoose ? (
        <Button chevron={false} disabled={chooseDisabled} onClick={onChoose}>
          {chooseLabel}
        </Button>
      ) : null}
      <Button variant="link" onClick={onClose}>
        Close
      </Button>
    </Sheet>
  );
}
