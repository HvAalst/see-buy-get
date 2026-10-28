import { useState } from 'preact/hooks';
import { Button, Card, ErrorNote, PlacePicker, type PlaceNote } from '../../../shared/ui';
import { useT, type Translate } from '../../../shared/i18n';
import type { SbgClient, SbgError } from '../../../lib/sbg';
import type { GeoPoint } from '../../../shared/geo';
import type { DriverActions, DriverState } from '../useDriverApp';

/**
 * WHERE THIS CARRIER IS, on its consignment notes (the user, 2026-10-28: "Drivers should give one if there is one.
 * Otherwise a pin of their legal station"). Asked only of a driver riding for themselves — they are the carrier, and CMR
 * names the carrier with its address. A fleet's driver carries for the fleet, whose depot is that address: never asked.
 */
export function CarrierPlaceCard({ state, actions, sbg }: { state: DriverState; actions: DriverActions; sbg: SbgClient | null }) {
  const t = useT();
  const driver = state.driver;
  const place = driver?.carrierPlace;
  const [editing, setEditing] = useState(false);
  const [address, setAddress] = useState(place?.address ?? '');
  const [label, setLabel] = useState(place?.station?.label ?? '');
  const [pin, setPin] = useState<GeoPoint | null>(place?.station ? { lat: place.station.lat, lng: place.station.lng } : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SbgError | null>(null);
  if (!driver || driver.managerDid || driver.removedFrom) return null;

  if (place && !editing) {
    const where = place.address ?? (place.station ? t('driver.carrierPlace.stationLine', { label: place.station.label ?? '', lat: place.station.lat.toFixed(5), lng: place.station.lng.toFixed(5) }) : '');
    return (
      <p class="hint">
        {t('driver.carrierPlace.set', { where })}{' '}
        <button type="button" class="linkbtn" onClick={() => setEditing(true)}>
          {t('driver.carrierPlace.change')}
        </button>
      </p>
    );
  }

  const save = async () => {
    if (!sbg || (!address.trim() && !pin)) return;
    setBusy(true);
    setError(null);
    const r = (await sbg.request((c) =>
      c.POST('/v1/sbg/fleet/drivers/{did}/carrier-place' as never, { params: { path: { did: driver.did } }, body: { ...(address.trim() ? { address: address.trim() } : {}), ...(pin ? { station: { lat: pin.lat, lng: pin.lng, ...(label.trim() ? { label: label.trim() } : {}) } } : {}) } } as never) as never,
    )) as { error?: SbgError };
    setBusy(false);
    if (r.error) return setError(r.error);
    setEditing(false);
    await actions.refresh();
  };

  return (
    <Card title={t('driver.carrierPlace.title')}>
      <p class="t-body">{t('driver.carrierPlace.body')}</p>
      <div class="field">
        <label class="field__label" for="carrier-address">
          {t('driver.carrierPlace.address')}
        </label>
        <input id="carrier-address" class="input" maxLength={300} value={address} onInput={(e) => setAddress(e.currentTarget.value)} />
      </div>
      <p class="hint" style="margin-top:8px">{t('driver.carrierPlace.or')}</p>
      <PlacePicker
        id="carrier-station"
        fieldLabel={t('driver.carrierPlace.station')}
        placeholder={t('driver.carrierPlace.stationPh')}
        mapLabel={t('driver.carrierPlace.mapLabel')}
        findLabel={t('driver.route.findOnMap')}
        label={label}
        pin={pin}
        onLabel={setLabel}
        onPin={(p) => setPin(p)}
        geocode={actions.geocodePlace}
        noteText={(n) => stationNote(t, n)}
      />
      {error ? <ErrorNote error={error} /> : null}
      <Button disabled={busy || (!address.trim() && !pin)} busy={busy} onClick={() => void save()}>
        {t('driver.carrierPlace.save')}
      </Button>
    </Card>
  );
}

function stationNote(t: Translate, note: PlaceNote): string {
  if (note.kind === 'found') return t('driver.carrierPlace.found', { where: note.where });
  if (note.kind === 'notFound') return t('driver.carrierPlace.notFound');
  if (note.kind === 'pinned') return t('driver.carrierPlace.pinned');
  return t('driver.carrierPlace.idle');
}
