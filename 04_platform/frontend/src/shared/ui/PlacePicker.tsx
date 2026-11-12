import { useState } from 'preact/hooks';
import type { GeoPoint } from '../geo';
import { useT } from '../i18n';
import { canLocate, currentPosition } from '../position';
import { Button } from './Button';
import { PlaceMap } from './PlaceMap';
import { Sheet } from './Sheet';
import { Note } from './ErrorNote';

/** What the geocoder came back with, or nothing at all — the caller turns this into its own words. */
export type PlaceNote =
  | { kind: 'idle' }
  | { kind: 'pinned' }
  | { kind: 'notFound' }
  | { kind: 'found'; confidence: 'exact' | 'approx' | 'fallback'; where: string };

export interface PlacePickerProps {
  id: string;
  fieldLabel: string;
  placeholder: string;
  /** AT description of the map surface. */
  mapLabel: string;
  /** The button that asks the geocoder to place the typed name. */
  findLabel: string;
  label: string;
  pin: GeoPoint | null;
  onLabel: (value: string) => void;
  onPin: (point: GeoPoint, from: 'name' | 'map') => void;
  /** The orange locator — somewhere the user recognises, so the map opens in the right part of the world. */
  reference?: GeoPoint | null;
  /** Resolve a typed place. Null = we could not place it at all. */
  geocode: (query: string) => Promise<{ location: GeoPoint; confidence: 'exact' | 'approx' | 'fallback'; matched?: string } | null>;
  /** The one line under the map, in the caller's language — what a match MEANS differs per screen. */
  noteText: (note: PlaceNote) => string;
  /**
   * 2026-11-12 — where the phone is, as the place itself (a road's start): opened with no pin, the map drops it there. Unset,
   * the map only opens there, for the person to tap the place (a road's end).
   */
  startHere?: boolean;
}

/**
 * Somewhere with a name AND a point.
 *
 * The places this network runs between mostly have names but no addresses: a co-op shed, a market, a
 * junction where a road leaves town. A name alone is a silent trap — a typo geocodes to somewhere else, or
 * to nothing — and a bare pin is unsayable to another human. So both, always: the name names it for people,
 * the pin is what routes and prices are computed against. Tap "find it" to have the name looked up, or tap
 * the map to place it by hand, which for a farm gate is the normal case.
 *
 * The component owns the mechanics only. What a match MEANS — money on a haul, a road on a shift — is the
 * caller's to say, through `noteText`.
 */
export function PlacePicker({
  id,
  fieldLabel,
  placeholder,
  mapLabel,
  findLabel,
  label,
  pin,
  onLabel,
  onPin,
  reference,
  geocode,
  noteText,
  startHere,
}: PlacePickerProps) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<PlaceNote | null>(null);
  // 2026-11-12 — THE MAP, FULL SCREEN (the owner: "the 'Find it on the map' button should open a full screen slide up
  // sheet"), opened where the phone is when nothing else says where (the owner: "geo aware").
  const [open, setOpen] = useState(false);
  const [here, setHere] = useState<{ state: 'idle' | 'asking' | 'off'; point?: GeoPoint }>({ state: 'idle' });

  const locate = async (drop: boolean) => {
    if (!canLocate()) return setHere({ state: 'off' });
    setHere({ state: 'asking' });
    const point = await currentPosition(10_000);
    if (!point) return setHere({ state: 'off' });
    setHere({ state: 'idle', point });
    if (drop) {
      onPin(point, 'map');
      setNote(null);
    }
  };

  const find = async () => {
    let placed = Boolean(pin);
    if (label.trim()) {
      setBusy(true);
      const found = await geocode(label);
      setBusy(false);
      if (!found) setNote({ kind: 'notFound' });
      else {
        setNote({ kind: 'found', confidence: found.confidence, where: found.matched ?? label.trim() });
        onPin(found.location, 'name');
        placed = true;
      }
    }
    setOpen(true);
    // Nothing places it yet: where the phone is — the place itself for a road's start, the map's middle otherwise.
    if (!placed) void locate(Boolean(startHere));
  };

  return (
    <>
      <div class="field" style="margin-top:12px">
        <label class="field__label" for={id}>
          {fieldLabel}
        </label>
        <input
          id={id}
          class="input"
          value={label}
          onInput={(e) => {
            onLabel(e.currentTarget.value);
            setNote(null);
          }}
          placeholder={placeholder}
          autocapitalize="words"
        />
        <Button variant="outline" chevron={false} busy={busy} onClick={() => void find()}>
          {findLabel}
        </Button>
      </div>
      <p class="card__note">{noteText(note ?? (pin ? { kind: 'pinned' } : { kind: 'idle' }))}</p>

      <Sheet open={open} onClose={() => setOpen(false)} title={label.trim() || findLabel} full>
        <PlaceMap
          label={mapLabel}
          pins={[]}
          reference={reference ?? null}
          onDrop={(p) => {
            onPin(p, 'map');
            setNote(null);
          }}
          dropped={pin}
          start={here.point ? { point: here.point, zoom: 14 } : undefined}
        />
        <p class="card__note">{noteText(note ?? (pin ? { kind: 'pinned' } : { kind: 'idle' }))}</p>
        {here.state === 'asking' ? <Note tone="info" icon="pin" title={t('place.sheet.locating')} /> : null}
        {here.state === 'off' ? <Note tone="info" icon="pin" title={t('place.sheet.locOff')} /> : null}
        <Button variant="outline" chevron={false} busy={here.state === 'asking'} onClick={() => void locate(true)}>
          {t('place.sheet.here')}
        </Button>
        <Button chevron={false} disabled={!pin} onClick={() => setOpen(false)}>
          {t('place.sheet.use')}
        </Button>
      </Sheet>
    </>
  );
}
