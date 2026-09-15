import { useRef, useState } from 'preact/hooks';
import { AuthImage, Button, Card, ErrorNote, Icon, Note, OptionInfo, OptionPicker, Pill, QrBlock, ReadAloud, Sheet } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import { qrPayload } from '../../../shared/qr';
import type { MediaKind } from '../../../lib/sbg/personas/media';
import { fleetConfig } from '../api';
import { bodyPickerOptions, equipmentHelp, equipmentOptions, paperLine, paperLineClass, papersToShow, subtypeLine, vehicleMissing } from '../logic';
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
  const [papersFor, setPapersFor] = useState<VehicleRow | null>(null);
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
              <span class="field__label" id="v-sub-label">
                {t('fleet.vehicles.truckBody')}
              </span>
              {/* Twenty-five bodies is not a dropdown (user, 2026-08-30). A native select shows one line of
                  jargon at a time and cannot carry a picture — and the whole difficulty is that people
                  RECOGNISE a curtain-side without being able to name one. So the picker IS the help sheet:
                  you choose by looking, and it filters once the list is long. */}
              <OptionPicker
                id="v-sub"
                labelledBy="v-sub-label"
                topic="body"
                title={t('fleet.vehicles.pickBodySheet')}
                options={bodyPickerOptions(state.subtypes, t)}
                value={f.truckSubtype}
                onChange={(key) => actions.setVForm({ truckSubtype: key })}
                placeholder={t('fleet.vehicles.pickBody')}
                config={fleetConfig()}
              />
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
            {/* Equipment is ticked, not chosen — there is no single selection and no "not sure", so the
                sheet always shows all seven. That is the right answer here anyway: a manager deciding what
                their truck carries is comparing across the list, not checking one word. */}
            <p class="info-row">
              <span class="field__label">{t('fleet.vehicles.equipmentLabel')}</span>
              <OptionInfo topic="equipment" title={t('fleet.vehicles.equipmentLabel')} config={fleetConfig()} options={equipmentHelp(t)} />
            </p>
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
        {/* FP4 — the papers, asked for here because here is where the vehicle is described. Optional: a blank
            date switches nothing off (we cannot enforce what we never asked for), and the list says so as a gap. */}
        <div class="grid2" style="margin-top:12px">
          <div class="field">
            <label class="field__label" for="v-ins-ref">
              {t('fleet.vehicles.insuranceRef')}
            </label>
            <input id="v-ins-ref" class="input input--mono" value={f.insuranceRef} onInput={(e) => actions.setVForm({ insuranceRef: e.currentTarget.value })} spellcheck={false} />
          </div>
          <div class="field">
            <label class="field__label" for="v-ins-exp">
              {t('fleet.vehicles.insuranceExpires')}
            </label>
            <input id="v-ins-exp" class="input" type="date" value={f.insuranceExpiresAt} onInput={(e) => actions.setVForm({ insuranceExpiresAt: e.currentTarget.value })} />
          </div>
        </div>
        <div class="grid2" style="margin-top:12px">
          <div class="field">
            <label class="field__label" for="v-insp-ref">
              {t('fleet.vehicles.inspectionRef')}
            </label>
            <input id="v-insp-ref" class="input input--mono" value={f.inspectionRef} onInput={(e) => actions.setVForm({ inspectionRef: e.currentTarget.value })} spellcheck={false} />
          </div>
          <div class="field">
            <label class="field__label" for="v-insp-exp">
              {t('fleet.vehicles.inspectionExpires')}
            </label>
            <input id="v-insp-exp" class="input" type="date" value={f.inspectionExpiresAt} onInput={(e) => actions.setVForm({ inspectionExpiresAt: e.currentTarget.value })} />
          </div>
        </div>
        <p class="hint" style="margin-top:6px">{t('fleet.vehicles.papersHint')}</p>
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
            {/* A figure in the box and what it multiplies beside it — a bare "0.8" read as a price, not a factor. */}
            <div class="grid2">
              {(
                [
                  ['minMultiplier', 'fleet.vehicles.minMultiplierAria', 'fleet.vehicles.minPh'],
                  ['maxMultiplier', 'fleet.vehicles.maxMultiplierAria', 'fleet.vehicles.maxPh'],
                ] as const
              ).map(([key, aria, ph]) => (
                <div key={key} style="position:relative">
                  <input
                    aria-label={t(aria)}
                    class="input"
                    style="padding-right:84px"
                    type="number"
                    inputMode="decimal"
                    min="0.1"
                    step="0.1"
                    placeholder={t(ph)}
                    value={f[key]}
                    onInput={(e) => actions.setVForm({ [key]: e.currentTarget.value } as never)}
                  />
                  <span class="hint" aria-hidden="true" style="position:absolute; right:12px; top:50%; transform:translateY(-50%); margin:0; pointer-events:none">
                    {t('fleet.vehicles.multiplierUnit')}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
        {/* The multipliers turned into money, once there is a rate to multiply. */}
        {Number(f.pricePerKm) > 0 && Number(f.minMultiplier) > 0 && Number(f.maxMultiplier) > 0 ? (
          <p class="hint" style="margin-top:6px">
            {t('fleet.vehicles.multiplierRates', {
              low: (Number(f.pricePerKm) * Number(f.minMultiplier)).toFixed(2),
              high: (Number(f.pricePerKm) * Number(f.maxMultiplier)).toFixed(2),
            })}
          </p>
        ) : null}
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
                  {/* FP4 — a paper that has lapsed, is running out, or was never dated. In date says nothing. */}
                  {papersToShow(v.papers).map((p) => (
                    <span key={p.kind} class={paperLineClass(p.state)}>
                      {paperLine(p, t)}
                    </span>
                  ))}
                  {photos.length ? (
                    <span class="photos photos--sm">
                      {photos.slice(0, 4).map((id) => (
                        <AuthImage key={id} mediaId={id} load={actions.loadMedia} alt={t('fleet.vehicles.photoAlt', { plate: v.plate })} class="photos__thumb photos__thumb--sm" />
                      ))}
                    </span>
                  ) : null}
                  {/* The three things you do to a vehicle, under its name rather than beside it: the trailing
                      column never shrinks, and three links plus a pill there left the plate two letters wide. */}
                  <span style="display:flex;flex-wrap:wrap;gap:2px 16px;margin-top:6px">
                    <Button variant="link" full={false} onClick={() => setQrFor(v)}>
                      {t('fleet.vehicles.qrBtn')}
                    </Button>
                    <Button variant="link" full={false} onClick={() => setPapersFor(v)}>
                      {t('fleet.vehicles.papersBtn')}
                    </Button>
                    <Button variant="link" full={false} onClick={() => setPriceFor(v)}>
                      {t('fleet.vehicles.rateBtn')}
                    </Button>
                  </span>
                </span>
                <span class="row__end">
                  <Pill tone={v.offRoad?.length ? 'danger' : v.status === 'ACTIVE' ? 'ok' : 'idle'} dot>
                    {v.offRoad?.length ? t('fleet.papers.offRoad') : v.verified ? t('fleet.vehicles.verified') : v.status.toLowerCase()}
                  </Pill>
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
      <PapersSheet vehicle={papersFor} onClose={() => setPapersFor(null)} state={state} actions={actions} />
    </div>
  );
}

/**
 * FP4 — the vehicle's papers. Four fields and one rule, said on the sheet: the day after a date passes, the
 * vehicle is off the road until the renewal is recorded HERE. So this sheet is also the renewal — there is no
 * separate "put it back" because the date is the switch in both directions.
 */
function PapersSheet({ vehicle, onClose, state, actions }: { vehicle: VehicleRow | null; onClose: () => void; state: FleetState; actions: FleetActions }) {
  const t = useT();
  const [draft, setDraft] = useState<{ insuranceRef: string; insuranceExpiresAt: string; inspectionRef: string; inspectionExpiresAt: string } | null>(null);
  const d = draft ?? {
    insuranceRef: vehicle?.documents?.insuranceRef ?? '',
    insuranceExpiresAt: (vehicle?.documents?.insuranceExpiresAt ?? '').slice(0, 10),
    inspectionRef: vehicle?.documents?.inspectionRef ?? '',
    inspectionExpiresAt: (vehicle?.documents?.inspectionExpiresAt ?? '').slice(0, 10),
  };
  const patch = (p: Partial<typeof d>) => setDraft({ ...d, ...p });
  const close = () => {
    setDraft(null);
    onClose();
  };
  return (
    <Sheet open={Boolean(vehicle)} onClose={close} title={vehicle ? t('fleet.vehicles.papersSheetTitle', { plate: vehicle.plate }) : ''}>
      <p class="t-body">{t('fleet.vehicles.papersBody')}</p>
      {vehicle?.offRoad?.length ? <Note tone="danger" icon="clock" title={t('fleet.papers.offRoad')} detail={vehicle.offRoad.join(' · ')} /> : null}
      <div class="grid2">
        <div class="field">
          <label class="field__label" for="p-ins-ref">
            {t('fleet.vehicles.insuranceRef')}
          </label>
          <input id="p-ins-ref" class="input input--mono" value={d.insuranceRef} onInput={(e) => patch({ insuranceRef: e.currentTarget.value })} spellcheck={false} />
        </div>
        <div class="field">
          <label class="field__label" for="p-ins-exp">
            {t('fleet.vehicles.insuranceExpires')}
          </label>
          <input id="p-ins-exp" class="input" type="date" value={d.insuranceExpiresAt} onInput={(e) => patch({ insuranceExpiresAt: e.currentTarget.value })} />
        </div>
      </div>
      <div class="grid2" style="margin-top:12px">
        <div class="field">
          <label class="field__label" for="p-insp-ref">
            {t('fleet.vehicles.inspectionRef')}
          </label>
          <input id="p-insp-ref" class="input input--mono" value={d.inspectionRef} onInput={(e) => patch({ inspectionRef: e.currentTarget.value })} spellcheck={false} />
        </div>
        <div class="field">
          <label class="field__label" for="p-insp-exp">
            {t('fleet.vehicles.inspectionExpires')}
          </label>
          <input id="p-insp-exp" class="input" type="date" value={d.inspectionExpiresAt} onInput={(e) => patch({ inspectionExpiresAt: e.currentTarget.value })} />
        </div>
      </div>
      <p class="hint" style="margin-top:6px">{t('fleet.vehicles.papersHint')}</p>
      <Button
        chevron={false}
        disabled={!draft}
        busy={vehicle ? state.busy === 'papers:' + vehicle.vehicleId : false}
        onClick={() => {
          if (!vehicle) return;
          const body = {
            insuranceRef: d.insuranceRef.trim() || undefined,
            insuranceExpiresAt: d.insuranceExpiresAt || undefined,
            inspectionRef: d.inspectionRef.trim() || undefined,
            inspectionExpiresAt: d.inspectionExpiresAt || undefined,
          };
          close();
          void actions.setVehiclePapers(vehicle.vehicleId, body);
        }}
      >
        {t('fleet.vehicles.savePapers')}
      </Button>
      <Button variant="link" onClick={close}>
        {t('common.cancel')}
      </Button>
    </Sheet>
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
