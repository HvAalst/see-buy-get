import { useRef, useState } from 'preact/hooks';
import { AuthImage, Button, Card, ErrorNote, Icon, Pill, QrBlock, ReadAloud, Sheet } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import { qrPayload } from '../../../shared/qr';
import type { MediaKind } from '../../../lib/sbg/personas/media';
import { equipmentOptions, subtypeLine, vehicleMissing } from '../logic';
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
  const t = useT();
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
            <button type="button" class="photos__x" aria-label={t('fleet.vehicles.removePhoto')} onClick={() => remove(id)}>
              <Icon name="close" size={16} />
            </button>
          </div>
        ))}
        {canAdd ? (
          <button type="button" class="photos__add" disabled={busy} onClick={() => input.current?.click()}>
            <Icon name={busy ? 'clock' : 'camera'} size={22} />
            <span>{busy ? t('fleet.vehicles.uploading') : t('fleet.vehicles.addPhoto')}</span>
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
  const t = useT();
  const [priceFor, setPriceFor] = useState<VehicleRow | null>(null);
  const [qrFor, setQrFor] = useState<VehicleRow | null>(null);
  const f = state.vForm;
  const missing = vehicleMissing(f, t);
  const isTruck = f.vehicleClass === 'truck';
  const sub = isTruck ? state.subtypes.find((s) => s.id === f.truckSubtype) : undefined;
  const subLine = subtypeLine(sub, t);

  return (
    <div class="scr">
      {state.error ? <ErrorNote error={state.error} onRetry={actions.refresh} /> : null}

      <Card title={t('fleet.vehicles.registerTitle')}>
        <p class="card__note">{t('fleet.vehicles.registerNote')}</p>
        <div class="field">
          <label class="field__label" for="v-plate">
            {t('fleet.vehicles.plate')}
          </label>
          <input id="v-plate" class="input input--mono" value={f.plate} onInput={(e) => actions.setVForm({ plate: e.currentTarget.value })} autocapitalize="characters" spellcheck={false} />
        </div>
        <div class="grid2" style="margin-top:12px">
          <div class="field">
            <label class="field__label" for="v-class">
              {t('fleet.vehicles.class')}
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
                {t('fleet.vehicles.truckBody')}
              </label>
              <select id="v-sub" class="select" value={f.truckSubtype} onChange={(e) => actions.setVForm({ truckSubtype: e.currentTarget.value })}>
                <option value="">{t('fleet.vehicles.pickBody')}</option>
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
                {t('fleet.vehicles.ownerType')}
              </label>
              <select id="v-owner-type" class="select" value={f.ownerType} onChange={(e) => actions.setVForm({ ownerType: e.currentTarget.value })}>
                <option value="driver_owned">{t('fleet.vehicles.ownerDriver')}</option>
                <option value="fleet_owned">{t('fleet.vehicles.ownerFleet')}</option>
                <option value="third_party">{t('fleet.vehicles.ownerThird')}</option>
              </select>
            </div>
          )}
        </div>
        {subLine ? <p class="hint" style="margin-top:8px">{subLine}</p> : null}
        {isTruck ? (
          <div class="field" style="margin-top:12px">
            <span class="field__label">{t('fleet.vehicles.equipmentLabel')}</span>
            <div class="chips">
              {equipmentOptions(t).map((eq) => {
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
            <p class="hint" style="margin-top:6px">{t('fleet.vehicles.equipmentHint')}</p>
          </div>
        ) : null}
        <div class="grid2" style="margin-top:12px">
          <div class="field">
            <label class="field__label" for="v-owner">
              {t('fleet.vehicles.ownerName')}
            </label>
            <input id="v-owner" class="input" value={f.ownerName} onInput={(e) => actions.setVForm({ ownerName: e.currentTarget.value })} />
          </div>
          <div class="field">
            <label class="field__label" for="v-cap">
              {t('fleet.vehicles.capacity')}
            </label>
            <input id="v-cap" class="input" type="number" inputMode="numeric" min="1" placeholder={t('fleet.vehicles.capacityPh')} value={f.capacityKg} onInput={(e) => actions.setVForm({ capacityKg: e.currentTarget.value })} />
          </div>
        </div>
        <div class="grid2" style="margin-top:12px">
          <div class="field">
            <label class="field__label" for="v-price">
              {t('fleet.vehicles.pricePerKm')}
            </label>
            <input id="v-price" class="input" type="number" inputMode="decimal" min="0" step="0.01" placeholder={t('fleet.vehicles.pricePh')} value={f.pricePerKm} onInput={(e) => actions.setVForm({ pricePerKm: e.currentTarget.value })} />
          </div>
          <div class="field">
            <label class="field__label" for="v-vin">
              {t('fleet.vehicles.factory')}
            </label>
            <input id="v-vin" class="input input--mono" value={f.factoryId} onInput={(e) => actions.setVForm({ factoryId: e.currentTarget.value })} placeholder="VIN-…" spellcheck={false} />
          </div>
        </div>
        {/* S34 — the freight-pricing profile. All optional; each defaults per class. The base fee starts every
            freight price; the market may only flex the per-km rate between the two multipliers the fleet owns. */}
        <div class="grid2" style="margin-top:12px">
          <div class="field">
            <label class="field__label" for="v-basefee">
              {t('fleet.vehicles.baseFee')}
            </label>
            <input id="v-basefee" class="input" type="number" inputMode="decimal" min="0" step="0.1" placeholder={t('fleet.vehicles.baseFeePh')} value={f.baseFee} onInput={(e) => actions.setVForm({ baseFee: e.currentTarget.value })} />
          </div>
          <div class="field">
            <span class="field__label">{t('fleet.vehicles.multiplierRange')}</span>
            <div class="grid2">
              <input aria-label={t('fleet.vehicles.minMultiplierAria')} class="input" type="number" inputMode="decimal" min="0.1" step="0.1" placeholder={t('fleet.vehicles.minPh')} value={f.minMultiplier} onInput={(e) => actions.setVForm({ minMultiplier: e.currentTarget.value })} />
              <input aria-label={t('fleet.vehicles.maxMultiplierAria')} class="input" type="number" inputMode="decimal" min="0.1" step="0.1" placeholder={t('fleet.vehicles.maxPh')} value={f.maxMultiplier} onInput={(e) => actions.setVForm({ maxMultiplier: e.currentTarget.value })} />
            </div>
          </div>
        </div>
        <p class="hint" style="margin-top:6px">{t('fleet.vehicles.multiplierHint')}</p>
        <div style="margin-top:12px">
          <PhotoPad
            label={t('fleet.vehicles.regPapers')}
            kind="registration"
            refs={f.registrationPhotoRef ? [f.registrationPhotoRef] : []}
            actions={actions}
            onChange={(refs) => actions.setVForm({ registrationPhotoRef: refs[0] ?? '' })}
          />
        </div>
        <div style="margin-top:12px">
          <PhotoPad
            label={t('fleet.vehicles.vehiclePhotos')}
            kind="vehicle"
            refs={f.vehiclePhotoRefs}
            multi
            actions={actions}
            onChange={(refs) => actions.setVForm({ vehiclePhotoRefs: refs })}
          />
        </div>
        <div style="margin-top:12px">
          <PhotoPad
            label={t('fleet.vehicles.trailerPhotos')}
            kind="trailer"
            refs={f.trailerPhotoRefs}
            multi
            actions={actions}
            onChange={(refs) => actions.setVForm({ trailerPhotoRefs: refs })}
          />
        </div>
        <div style="margin-top:14px">
          <Button chevron={false} onClick={() => void actions.submitVehicle()} disabled={Boolean(missing)} busy={state.busy === 'vehicle'}>
            {t('fleet.vehicles.registerCta')}
          </Button>
          {missing ? <p class="hint" style="margin-top:8px">{missing}</p> : null}
        </div>
      </Card>

      <Card title={t('fleet.vehicles.listTitle', { count: state.vehicles.length })}>
        <p class="card__note">{t('fleet.vehicles.listNote')}</p>
        {state.vehicles.length === 0 ? (
          <p class="hint">{t('fleet.vehicles.empty')}</p>
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
                        <AuthImage key={id} mediaId={id} load={actions.loadMedia} alt={t('fleet.vehicles.photoAlt', { plate: v.plate })} class="photos__thumb photos__thumb--sm" />
                      ))}
                    </span>
                  ) : null}
                </span>
                <span class="row__end">
                  <Pill tone={v.status === 'ACTIVE' ? 'ok' : 'idle'} dot>
                    {v.verified ? t('fleet.vehicles.verified') : v.status.toLowerCase()}
                  </Pill>
                  <Button variant="link" full={false} onClick={() => setQrFor(v)}>
                    {t('fleet.vehicles.qrBtn')}
                  </Button>
                  <Button variant="link" full={false} onClick={() => setPriceFor(v)}>
                    {t('fleet.vehicles.rateBtn')}
                  </Button>
                </span>
              </div>
              );
            })}
          </div>
        )}
      </Card>

      <div class="scr__foot">
        <ReadAloud text={() => t('fleet.vehicles.aloud', { count: state.vehicles.length })} label={t('fleet.readAloud')} />
      </div>

      {/* The dashboard sticker: this is the code a driver scans to start their shift, so
          the console has to be able to PRINT it — not just display the string. */}
      <Sheet open={Boolean(qrFor)} onClose={() => setQrFor(null)} title={qrFor ? t('fleet.vehicles.qrSheetTitle', { plate: qrFor.plate }) : ''}>
        {qrFor ? (
          <>
            <p class="t-body">{t('fleet.vehicles.qrBody')}</p>
            <QrBlock
              value={qrPayload('vehicle', qrFor.qr)}
              size={200}
              caption={qrFor.qr}
              label={t('fleet.vehicles.qrBlockLabel', { plate: qrFor.plate })}
            />
            <Button chevron={false} onClick={() => window.print()}>
              {t('fleet.vehicles.printSticker')}
            </Button>
            <Button variant="link" onClick={() => setQrFor(null)}>
              {t('fleet.vehicles.close')}
            </Button>
          </>
        ) : null}
      </Sheet>

      <PriceSheet vehicle={priceFor} onClose={() => setPriceFor(null)} state={state} actions={actions} />
    </div>
  );
}

function PriceSheet({ vehicle, onClose, state, actions }: { vehicle: VehicleRow | null; onClose: () => void; state: FleetState; actions: FleetActions }) {
  const t = useT();
  const [price, setPrice] = useState('');
  const value = Number(price);
  const current = vehicle ? Number(vehicle.pricePerKm ?? 0).toFixed(3) : '';
  return (
    <Sheet open={Boolean(vehicle)} onClose={onClose} title={vehicle ? t('fleet.vehicles.priceSheetTitle', { plate: vehicle.plate }) : ''}>
      <p class="t-body">{t('fleet.vehicles.priceBody', { rate: current })}</p>
      <div class="field">
        <label class="field__label" for="rate">
          {t('fleet.vehicles.newPrice')}
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
        {t('fleet.vehicles.saveRate')}
      </Button>
      <Button variant="link" onClick={onClose}>
        {t('fleet.vehicles.keepRate')}
      </Button>
    </Sheet>
  );
}
