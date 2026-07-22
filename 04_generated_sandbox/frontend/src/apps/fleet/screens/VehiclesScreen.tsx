import { useState } from 'preact/hooks';
import { Button, Card, ErrorNote, Pill, QrBlock, ReadAloud, Sheet } from '../../../shared/ui';
import { qrPayload } from '../../../shared/qr';
import { subtypeLine, vehicleMissing } from '../logic';
import { VEHICLE_CLASSES, type VehicleRow } from '../types';
import type { FleetActions, FleetState } from '../useFleetApp';

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
            <select id="v-class" class="select" value={f.vehicleClass} onChange={(e) => actions.setVForm({ vehicleClass: e.currentTarget.value as typeof f.vehicleClass, truckSubtype: '' })}>
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
        <div class="field" style="margin-top:12px">
          <label class="field__label" for="v-reg">
            Registration photo ref
          </label>
          <input id="v-reg" class="input" value={f.registrationPhotoRef} onInput={(e) => actions.setVForm({ registrationPhotoRef: e.currentTarget.value })} placeholder="reg.jpg" />
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
            {state.vehicles.map((v) => (
              <div key={v.vehicleId} class="row row--static" role="listitem">
                <span class="row__body">
                  <span class="row__t mono">{v.plate}</span>
                  <span class="row__s">
                    {`${v.vehicleClass}${v.truckSubtype ? ` · ${v.truckSubtype.replace(/_/g, ' ')}` : ''} · ${v.capacityKg} kg · QR ${v.qr} · ${Number(v.pricePerKm ?? 0).toFixed(3)}/km`}
                  </span>
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
            ))}
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
