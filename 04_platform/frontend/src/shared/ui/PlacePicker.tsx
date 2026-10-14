import { useState } from 'preact/hooks';
import type { GeoPoint } from '../geo';
import { Button } from './Button';
import { PlaceMap } from './PlaceMap';

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
}: PlacePickerProps) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<PlaceNote | null>(null);

  const find = async () => {
    setBusy(true);
    const found = await geocode(label);
    setBusy(false);
    if (!found) {
      setNote({ kind: 'notFound' });
      return;
    }
    setNote({ kind: 'found', confidence: found.confidence, where: found.matched ?? label.trim() });
    onPin(found.location, 'name');
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
        <Button variant="outline" chevron={false} disabled={!label.trim()} busy={busy} onClick={() => void find()}>
          {findLabel}
        </Button>
      </div>

      <PlaceMap
        label={mapLabel}
        pins={[]}
        reference={reference ?? null}
        onDrop={(p) => {
          onPin(p, 'map');
          setNote(null);
        }}
        dropped={pin}
      />
      <p class="card__note">{noteText(note ?? (pin ? { kind: 'pinned' } : { kind: 'idle' }))}</p>
    </>
  );
}
