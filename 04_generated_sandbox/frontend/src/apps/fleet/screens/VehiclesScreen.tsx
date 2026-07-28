import { useRef, useState } from 'preact/hooks';
import { AuthImage, Button, Card, ErrorNote, Icon, Pill, QrBlock, ReadAloud, Sheet } from '../../../shared/ui';
import { qrPayload } from '../../../shared/qr';
import type { MediaKind } from '../../../lib/sbg/personas/media';
import { EQUIPMENT_OPTIONS, subtypeLine, vehicleMissing } from '../logic';
import { VEHICLE_CLASSES, type VehicleRow } from '../types';
import type { FleetActions, FleetState } from '../useFleetApp';

/**
 * Capture pad (S26) — one (registration) or many (vehicle/trailer) photos. Each capture is downscaled,
 * EXIF-stripped and uploaded; the pad holds the returned mediaIds and previews them via AuthImage (a
 * media endpoint needs the bearer). Removing a not-yet-registered photo deletes it, so we don't orphan
 * bytes on the server — the whole point of the retention model is that nothing lingers unused.
 */
function PhotoPad({
  label,
  kind,
  refs,
  multi,
  actions,
  onChange,
}: {
  label: string;
  kind: MediaKind;
  refs: string[];
  multi?: boolean;
  actions: FleetActions;
  onChange: (refs: string[]) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const canAdd = multi || refs.length === 0;

  const pick = async (file: File) => {
    setBusy(true);
    const mediaId = await actions.uploadPhoto(kind, file);
    setBusy(false);
    if (mediaId) onChange([...refs, mediaId]);
  };
  const remove = (id: string) => {
    onChange(refs.filter((r) => r !== id));
    void actions.deleteMedia(id); // it was never linked to the vehicle yet — drop the orphan bytes
  };

  return (
    <div class="field">
      <span class="field__label">{label}</span>
      <div class="photos">
        {refs.map((id) => (
          <div key={id} class="photos__item">
            <AuthImage mediaId={id} load={actions.loadMedia} alt={label} class="photos__thumb" />
            <button type="button" class="photos__x" aria-label="Remove photo" onClick={() => remove(id)}>
              <Icon name="close" size={16} />
            </button>
          </div>
        ))}
        {canAdd ? (
          <button type="button" class="photos__add" disabled={busy} onClick={() => input.current?.click()}>
            <Icon name={busy ? 'clock' : 'camera'} size={22} />
            <span>{busy ? 'Uploading…' : 'Add photo'}</span>
          </button>
        ) : null}
      </div>
      <input
        ref={input}
        class="photo__input"
        type="file"
        accept="image/*"
        capture="environment"
        onChange={(e) => {
          const file = e.currentTarget.files?.[0];
          e.currentTarget.value = '';
          if (file) void pick(file);
        }}
      />
    </div>
  );
}

export interface VehiclesScreenProps {
  state: FleetState;
  actions: FleetActions;
}

/** Fleet data: register vehicles (QR for the dashboard) and manage the open per-km rate. */
export function VehiclesScreen({ state, actions }: VehiclesScreenProps) {
  const [priceFor, setPriceFor] = useState<VehicleRow | null>(null);
  const [qrFor, setQrFor] = useState<VehicleRow | null>(null);
  const f = state.vForm;
  const missing = vehicleMissing(f);
  const isTruck = f.vehicleClass === 'truck';
  const sub = isTruck ? state.subtypes.find((s) => s.id === f.truckSubtype) : undefined;
  const subLine = subtypeLine(sub);

  return (
    <div class="scr">
      {state.error ? <ErrorNote error={state.error} onRetry={actions.refresh} /> : null}

      <Card title="Register a vehicle">
        <p class="card__note">
          The vehicle gets its own ID and a dashboard QR — drivers scan it to start a shift. Full papers plus a factory number mark it
          verified (dispatch priority).
        </p>
        <div class="field">
          <label class="field__label" for="v-plate">
            Number plate
          </label>
          <input id="v-plate" class="input input--mono" value={f.plate} onInput={(e) => actions.setVForm({ plate: e.currentTarget.value })} autocapitalize="characters" spellcheck={false} />
        </div>
        <div class="grid2" style="margin-top:12px">
          <div class="field">
            <label class="field__label" for="v-class">
              Class
            </label>
            <select id="v-class" class="select" value={f.vehicleClass} onChange={(e) => actions.setVForm({ vehicleClass: e.currentTarget.value as typeof f.vehicleClass, truckSubtype: '', equipment: [] })}>
              {VEHICLE_CLASSES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          {isTruck ? (
            <div class="field">
              <label class="field__label" for="v-sub">
                Truck body
              </label>
              <select id="v-sub" class="select" value={f.truckSubtype} onChange={(e) => actions.setVForm({ truckSubtype: e.currentTarget.value })}>
                <option value="">Pick the body…</option>
                {state.subtypes.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div class="field">
              <label class="field__label" for="v-owner-type">
                Owner type
              </label>
              <select id="v-owner-type" class="select" value={f.ownerType} onChange={(e) => actions.setVForm({ ownerType: e.currentTarget.value })}>
                <option value="driver_owned">Driver owned</option>
                <option value="fleet_owned">Fleet owned</option>
                <option value="third_party">Third party</option>
              </select>
            </div>
          )}
        </div>
        {subLine ? <p class="hint" style="margin-top:8px">{subLine}</p> : null}
        {isTruck ? (
          <div class="field" style="margin-top:12px">
            <span class="field__label">Load/unload equipment on board</span>
            <div class="chips">
              {EQUIPMENT_OPTIONS.map((eq) => {
                const on = f.equipment.includes(eq.key);
                return (
                  <button
                    key={eq.key}
                    type="button"
                    class={`chip chip--tap${on ? ' chip--on' : ''}`}
                    aria-pressed={on}
                    onClick={() => actions.setVForm({ equipment: on ? f.equipment.filter((e) => e !== eq.key) : [...f.equipment, eq.key] })}
                  >
                    {eq.label}
                  </button>
                );
              })}
            </div>
            <p class="hint" style="margin-top:6px">Needed to be offered heavy dedicated-freight jobs. Manual handling is always assumed.</p>
          </div>
        ) : null}
        <div class="grid2" style="margin-top:12px">
          <div class="field">
            <label class="field__label" for="v-owner">
              Owner name
            </label>
            <input id="v-owner" class="input" value={f.ownerName} onInput={(e) => actions.setVForm({ ownerName: e.currentTarget.value })} />
          </div>
          <div class="field">
            <label class="field__label" for="v-cap">
              Capacity kg (optional)
            </label>
            <input id="v-cap" class="input" type="number" inputMode="numeric" min="1" placeholder="computed if blank" value={f.capacityKg} onInput={(e) => actions.setVForm({ capacityKg: e.currentTarget.value })} />
          </div>
        </div>
        <div class="grid2" style="margin-top:12px">
          <div class="field">
            <label class="field__label" for="v-price">
              Price per km (public)
            </label>
            <input id="v-price" class="input" type="number" inputMode="decimal" min="0" step="0.01" placeholder="default if blank" value={f.pricePerKm} onInput={(e) => actions.setVForm({ pricePerKm: e.currentTarget.value })} />
          </div>
          <div class="field">
            <label class="field__label" for="v-vin">
              Factory / VIN (verifies)
            </label>
            <input id="v-vin" class="input input--mono" value={f.factoryId} onInput={(e) => actions.setVForm({ factoryId: e.currentTarget.value })} placeholder="VIN-…" spellcheck={false} />
          </div>
        </div>
        <div style="margin-top:12px">
          <PhotoPad
            label="Registration papers (verifies)"
            kind="registration"
            refs={f.registrationPhotoRef ? [f.registrationPhotoRef] : []}
            actions={actions}
            onChange={(refs) => actions.setVForm({ registrationPhotoRef: refs[0] ?? '' })}
          />
        </div>
        <div style="margin-top:12px">
          <PhotoPad
            label="Vehicle photos"
            kind="vehicle"
            refs={f.vehiclePhotoRefs}
            multi
            actions={actions}
            onChange={(refs) => actions.setVForm({ vehiclePhotoRefs: refs })}
          />
        </div>
        <div style="margin-top:12px">
          <PhotoPad
            label="Trailer photos (if any)"
            kind="trailer"
            refs={f.trailerPhotoRefs}
            multi
            actions={actions}
            onChange={(refs) => actions.setVForm({ trailerPhotoRefs: refs })}
          />
        </div>
        <div style="margin-top:14px">
          <Button chevron={false} onClick={() => void actions.submitVehicle()} disabled={Boolean(missing)} busy={state.busy === 'vehicle'}>
            Register vehicle
          </Button>
          {missing ? <p class="hint" style="margin-top:8px">{missing}</p> : null}
        </div>
      </Card>

      <Card title={`Vehicles · ${state.vehicles.length}`}>
        <p class="card__note">Print each QR and stick it on the dashboard. The per-km rate is open data — shippers quote against it.</p>
        {state.vehicles.length === 0 ? (
          <p class="hint">No vehicles yet.</p>
        ) : (
          <div class="rows" role="list">
            {state.vehicles.map((v) => {
              const photos = [...(v.vehiclePhotoRefs ?? []), ...(v.trailerPhotoRefs ?? [])];
              return (
              <div key={v.vehicleId} class="row row--static" role="listitem">
                <span class="row__body">
                  <span class="row__t mono">{v.plate}</span>
                  <span class="row__s">
                    {`${v.vehicleClass}${v.truckSubtype ? ` · ${v.truckSubtype.replace(/_/g, ' ')}` : ''} · ${v.capacityKg} kg · QR ${v.qr} · ${Number(v.pricePerKm ?? 0).toFixed(3)}/km`}
                  </span>
                  {photos.length ? (
                    <span class="photos photos--sm">
                      {photos.slice(0, 4).map((id) => (
                        <AuthImage key={id} mediaId={id} load={actions.loadMedia} alt={`${v.plate} photo`} class="photos__thumb photos__thumb--sm" />
                      ))}
                    </span>
                  ) : null}
                </span>
                <span class="row__end">
                  <Pill tone={v.status === 'ACTIVE' ? 'ok' : 'idle'} dot>
                    {v.verified ? 'Verified' : v.status.toLowerCase()}
                  </Pill>
                  <Button variant="link" full={false} onClick={() => setQrFor(v)}>
                    QR
                  </Button>
                  <Button variant="link" full={false} onClick={() => setPriceFor(v)}>
                    Rate
                  </Button>
                </span>
              </div>
              );
            })}
          </div>
        )}
      </Card>

      <div class="scr__foot">
        <ReadAloud text={() => `${state.vehicles.length} vehicles in the fleet.`} label="Read this aloud" />
      </div>

      {/* The dashboard sticker: this is the code a driver scans to start their shift, so
          the console has to be able to PRINT it — not just display the string. */}
      <Sheet open={Boolean(qrFor)} onClose={() => setQrFor(null)} title={qrFor ? `Dashboard QR — ${qrFor.plate}` : ''}>
        {qrFor ? (
          <>
            <p class="t-body">Print this and stick it on the dashboard. Drivers scan it to start a shift on this vehicle.</p>
            <QrBlock
              value={qrPayload('vehicle', qrFor.qr)}
              size={200}
              caption={qrFor.qr}
              label={`Dashboard code for ${qrFor.plate}`}
            />
            <Button chevron={false} onClick={() => window.print()}>
              Print this sticker
            </Button>
            <Button variant="link" onClick={() => setQrFor(null)}>
              Close
            </Button>
          </>
        ) : null}
      </Sheet>

      <PriceSheet vehicle={priceFor} onClose={() => setPriceFor(null)} state={state} actions={actions} />
    </div>
  );
}

function PriceSheet({ vehicle, onClose, state, actions }: { vehicle: VehicleRow | null; onClose: () => void; state: FleetState; actions: FleetActions }) {
  const [price, setPrice] = useState('');
  const value = Number(price);
  const current = vehicle ? Number(vehicle.pricePerKm ?? 0).toFixed(3) : '';
  return (
    <Sheet open={Boolean(vehicle)} onClose={onClose} title={vehicle ? `Rate for ${vehicle.plate}` : ''}>
      <p class="t-body">{`This vehicle currently charges ${current} per kilometre. The rate is public — shippers compare before offering work.`}</p>
      <div class="field">
        <label class="field__label" for="rate">
          New price per km
        </label>
        <input id="rate" class="input" type="number" inputMode="decimal" min="0" step="0.001" placeholder={current} value={price} onInput={(e) => setPrice(e.currentTarget.value)} />
      </div>
      <Button
        chevron={false}
        disabled={!(value >= 0) || price === ''}
        busy={vehicle ? state.busy === `price:${vehicle.vehicleId}` : false}
        onClick={() => {
          if (!vehicle) return;
          onClose();
          setPrice('');
          void actions.setVehiclePrice(vehicle.vehicleId, Math.round(value * 1000) / 1000);
        }}
      >
        Save the new rate
      </Button>
      <Button variant="link" onClick={onClose}>
        Keep it as it is
      </Button>
    </Sheet>
  );
}
