import { useRef, useState } from 'preact/hooks';
import { AuthImage, Button, Card, ErrorNote, Icon, Note, OptionInfo, OptionPicker, Pill, QrBlock, ReadAloud, Sheet } from '../../../shared/ui';
import { Abbreviated } from '../../../shared/ui/Abbr';
import { MOYALE_COUNTRIES } from '../../../shared/manifestGaps';
import { useT } from '../../../shared/i18n';
import { qrPayload } from '../../../shared/qr';
import { cash, perKmText } from '../../../shared/money';
import type { MediaKind } from '../../../lib/sbg/personas/media';
import { failedWords, mediaIdOf } from '../../../shared/upload';
import { fleetConfig } from '../api';
import { equipmentFits, equipmentWords } from '../../../shared/equipment';
import { bodyPickerOptions, equipmentHelp, equipmentOptions, paperLine, paperLineClass, papersToShow, subtypeLine, vehicleMissing } from '../logic';
import { VEHICLE_CLASSES, type VehicleRow } from '../types';
import type { FleetActions, FleetState } from '../useFleetApp';
import type { SbgClient } from '../../../lib/sbg';
import { VehicleCareSheet } from '../../../shared/upkeep/VehicleCare';
import { UpkeepRulesCard } from './UpkeepRulesCard';
import { EnergyChoice } from '../../../shared/ui/EnergyChoice';
import { energyFits, energyWord } from '../../../shared/vehicleEnergy';
import { BrokenDownCard } from './BrokenDownCard';

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
  // Why the last photo did not go, under the pad (2026-11-02, the owner: "It silently refused").
  const [failed, setFailed] = useState<string | null>(null);
  const canAdd = multi || refs.length === 0;

  const pick = async (file: File) => {
    setBusy(true);
    setFailed(null);
    const up = await actions.uploadPhoto(kind, file);
    setBusy(false);
    const mediaId = mediaIdOf(up);
    if (mediaId) onChange([...refs, mediaId]);
    else setFailed(failedWords(up) ?? t('upload.failed'));
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
        data-upload="photo"
        accept="image/*"
        capture="environment"
        onChange={(e) => {
          const file = e.currentTarget.files?.[0];
          e.currentTarget.value = '';
          if (file) void pick(file);
        }}
      />
      {failed ? <Note tone="warn" icon="camera" title={failed} /> : null}
    </div>
  );
}

export interface VehiclesScreenProps {
  state: FleetState;
  actions: FleetActions;
  /** For the upkeep sheet, which reads and writes on its own. */
  sbg?: SbgClient | null;
}

/** Fleet data: register vehicles (QR for the dashboard) and manage the open per-km rate. */
export function VehiclesScreen({ state, actions, sbg = null }: VehiclesScreenProps) {
  const t = useT();
  const [careFor, setCareFor] = useState<VehicleRow | null>(null);
  // Bumped whenever the upkeep sheet changes something, so the "broken down now" card reads again.
  const [upkeepChanged, setUpkeepChanged] = useState(0);
  const [priceFor, setPriceFor] = useState<VehicleRow | null>(null);
  const [qrFor, setQrFor] = useState<VehicleRow | null>(null);
  const [papersFor, setPapersFor] = useState<VehicleRow | null>(null);
  const [energyFor, setEnergyFor] = useState<VehicleRow | null>(null);
  // 2026-11-13 — its loading equipment, changed after it is registered (the owner: "build loading equipment").
  const [equipmentFor, setEquipmentFor] = useState<VehicleRow | null>(null);
  const f = state.vForm;
  const missing = vehicleMissing(f, t);
  const isTruck = f.vehicleClass === 'truck';
  const sub = isTruck ? state.subtypes.find((s) => s.id === f.truckSubtype) : undefined;
  const subLine = subtypeLine(sub, t);

  return (
    <div class="scr">
      {state.error ? <ErrorNote error={state.error} onRetry={actions.refresh} /> : null}
      <BrokenDownCard sbg={sbg} fleetDid={state.manager?.did} reload={upkeepChanged} onOpen={(id) => setCareFor((state.vehicles.find((v) => v.vehicleId === id) as VehicleRow | undefined) ?? null)} />

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
            <select id="v-class" class="select" value={f.vehicleClass} onChange={(e) => { const vehicleClass = e.currentTarget.value as typeof f.vehicleClass; actions.setVForm({ vehicleClass, truckSubtype: '', equipment: [], ...(energyFits(vehicleClass, f.energy) ? {} : { energy: '' }) }); }}>
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
        {/* 2026-11-03 — what it runs on: asked of every vehicle, chosen by nobody but the office. */}
        <div style="margin-top:12px">
          <EnergyChoice id="v-energy" vehicleClass={f.vehicleClass} value={f.energy} onChange={(energy) => actions.setVForm({ energy })} />
        </div>
        {/* 2026-11-13 — vans carry equipment too (the owner: "build loading equipment"): what this kind can carry, ticked. */}
        {equipmentOptions(t, f.vehicleClass).length ? (
          <div class="field" style="margin-top:12px">
            {/* Equipment is ticked, not chosen — there is no single selection and no "not sure", so the
                sheet shows every piece this kind can carry. That is the right answer here anyway: a manager deciding what
                their vehicle carries is comparing across the list, not checking one word. */}
            <p class="info-row">
              <span class="field__label">{t('fleet.vehicles.equipmentLabel')}</span>
              <OptionInfo topic="equipment" title={t('fleet.vehicles.equipmentLabel')} config={fleetConfig()} options={equipmentHelp(t, f.vehicleClass)} />
            </p>
            <div class="chips">
              {equipmentOptions(t, f.vehicleClass).map((eq) => {
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
          {/* THE DECK. Asked for because the crowd-sourced bridge map cannot answer without it: what
              matters under a low bridge is the load PLUS the deck it stands on, and until a vehicle knows
              its own deck the map has to answer "we do not know how tall this is on your deck" — which is
              the truth, and is also why a 40ft high-cube used to book like any other box. Blank stays
              blank: a class average would clear a load on arithmetic about somebody else's truck. */}
          <div class="field">
            <label class="field__label" for="v-deck">
              {t('fleet.vehicles.deck')}
            </label>
            <input id="v-deck" class="input" type="number" inputMode="decimal" min="0.1" max="3" step="0.05" placeholder={t('fleet.vehicles.deckPh')} value={f.deckM} onInput={(e) => actions.setVForm({ deckM: e.currentTarget.value })} />
            <p class="card__note">{t('fleet.vehicles.deckHint')}</p>
          </div>
          {/* 2026-11-01 — the load space, as the fleet measured it: absent, the board says it is not on record. */}
          <div class="field">
            <label class="field__label" for="v-volume">
              {t('fleet.vehicles.volume')}
            </label>
            <input id="v-volume" class="input" type="number" inputMode="decimal" min="0.1" max="150" step="0.1" placeholder={t('fleet.vehicles.volumePh')} value={f.volumeM3} onInput={(e) => actions.setVForm({ volumeM3: e.currentTarget.value })} />
            <p class="hint">{t('fleet.vehicles.volumeHint')}</p>
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
              low: cash(Number(f.pricePerKm) * Number(f.minMultiplier), state.dashboard?.currency),
              high: cash(Number(f.pricePerKm) * Number(f.maxMultiplier), state.dashboard?.currency),
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

      <UpkeepRulesCard sbg={sbg} fleetDid={state.manager?.did} />

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
                    {`${v.vehicleClass}${v.truckSubtype ? ` · ${v.truckSubtype.replace(/_/g, ' ')}` : ''}${v.energy ? ` · ${energyWord(v.energy, t).toLowerCase()}` : ''} · ${v.capacityKg} kg · QR ${v.qr} · ${perKmText(Number(v.pricePerKm ?? 0), state.dashboard?.currency)}/km`}
                  </span>
                  {/* 2026-11-13 — what it carries for loading, said under its name; nothing where it is loaded by hand only. */}
                  {equipmentWords(v.equipment, t) ? <span class="row__s">{t('equipment.line', { list: equipmentWords(v.equipment, t) })}</span> : null}
                  {/* Registered before it was asked: said as a gap, with the way to close it under the name. */}
                  {v.energy ? null : <span class={paperLineClass('due')}>{t('vehicle.energy.notOnRecord')}</span>}
                  {/* FP4 — a paper that has lapsed, is running out, or was never dated. In date says nothing. */}
                  {papersToShow(v.papers).map((p) => (
                    <span key={p.kind} class={paperLineClass(p.state)}>
                      {paperLine(p, t)}
                    </span>
                  ))}
                  {/* What keeps it off the road besides its papers: in the workshop, a defect, a service overdue. */}
                  {(v.upkeep ?? []).map((line) => (
                    <span key={line} class={paperLineClass('lapsed')}>
                      {line}
                    </span>
                  ))}
                  {/* What to know that does not keep it off the road: a service due soon. */}
                  {(v.notes ?? []).map((line) => (
                    <span key={line} class={paperLineClass('due')}>
                      {line}
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
                    <Button variant="link" full={false} onClick={() => setCareFor(v)}>
                      {t('fleet.vehicles.careBtn')}
                    </Button>
                    <Button variant="link" full={false} onClick={() => setEnergyFor(v)}>
                      {v.energy ? t('vehicle.energy.change') : t('vehicle.energy.add')}
                    </Button>
                    {equipmentFits(v.vehicleClass).length ? (
                      <Button variant="link" full={false} onClick={() => setEquipmentFor(v)}>
                        {t('equipment.change')}
                      </Button>
                    ) : null}
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
      <EnergySheet vehicle={energyFor} onClose={() => setEnergyFor(null)} state={state} actions={actions} />
      {equipmentFor ? <EquipmentSheet vehicle={equipmentFor} onClose={() => setEquipmentFor(null)} state={state} actions={actions} /> : null}
      <PapersSheet vehicle={papersFor} onClose={() => setPapersFor(null)} state={state} actions={actions} />
      <VehicleCareSheet
        vehicle={careFor}
        sbg={sbg}
        onClose={() => setCareFor(null)}
        onChanged={async () => {
          setUpkeepChanged((n) => n + 1);
          await actions.refresh();
        }}
        uploadPhoto={actions.uploadPhoto}
      />
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
  const [draft, setDraft] = useState<{ insuranceRef: string; insuranceExpiresAt: string; inspectionRef: string; inspectionExpiresAt: string; registrationCountry: string; trailerPlate: string; yellowCardNumber: string; yellowCardExpiresAt: string; customsLicenceKind: '' | 'C28' | 'C40'; customsLicenceNumber: string; customsLicenceExpiresAt: string } | null>(null);
  const docs = vehicle?.documents as { insuranceRef?: string; insuranceExpiresAt?: string; inspectionRef?: string; inspectionExpiresAt?: string; registrationCountry?: string; trailerPlate?: string; yellowCardNumber?: string; yellowCardExpiresAt?: string; customsLicenceKind?: 'C28' | 'C40'; customsLicenceNumber?: string; customsLicenceExpiresAt?: string } | undefined;
  const d = draft ?? {
    insuranceRef: docs?.insuranceRef ?? '',
    insuranceExpiresAt: (docs?.insuranceExpiresAt ?? '').slice(0, 10),
    inspectionRef: docs?.inspectionRef ?? '',
    inspectionExpiresAt: (docs?.inspectionExpiresAt ?? '').slice(0, 10),
    registrationCountry: docs?.registrationCountry ?? '',
    trailerPlate: docs?.trailerPlate ?? '',
    yellowCardNumber: docs?.yellowCardNumber ?? '',
    yellowCardExpiresAt: (docs?.yellowCardExpiresAt ?? '').slice(0, 10),
    customsLicenceKind: docs?.customsLicenceKind ?? '',
    customsLicenceNumber: docs?.customsLicenceNumber ?? '',
    customsLicenceExpiresAt: (docs?.customsLicenceExpiresAt ?? '').slice(0, 10),
  };
  // 2026-11-11 — Kenya's own: KRA's licence for a vehicle carrying goods under customs control.
  const kenya = state.dashboard?.country === 'KE';
  // 2026-11-10 — a fleet in Kenya or Ethiopia records what a load across the Moyale border prints of its vehicle.
  const moyale = MOYALE_COUNTRIES.includes(state.dashboard?.country ?? '');
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
      {moyale ? (
        <>
          <p class="field__label" style="margin-top:14px">
            <Abbreviated text={t('fleet.vehicles.borderTitle')} />
          </p>
          <div class="grid2">
            <div class="field">
              <label class="field__label" for="p-reg-c">
                {t('fleet.vehicles.regCountry')}
              </label>
              <input id="p-reg-c" class="input input--mono" maxLength={2} value={d.registrationCountry} onInput={(e) => patch({ registrationCountry: e.currentTarget.value.toUpperCase() })} spellcheck={false} />
            </div>
            <div class="field">
              <label class="field__label" for="p-trailer">
                {t('fleet.vehicles.trailerPlate')}
              </label>
              <input id="p-trailer" class="input input--mono" maxLength={20} value={d.trailerPlate} onInput={(e) => patch({ trailerPlate: e.currentTarget.value })} spellcheck={false} />
            </div>
          </div>
          <div class="grid2" style="margin-top:12px">
            <div class="field">
              <label class="field__label" for="p-yc">
                <Abbreviated text={t('fleet.vehicles.yellowCard')} />
              </label>
              <input id="p-yc" class="input input--mono" maxLength={40} value={d.yellowCardNumber} onInput={(e) => patch({ yellowCardNumber: e.currentTarget.value })} spellcheck={false} />
            </div>
            <div class="field">
              <label class="field__label" for="p-yc-exp">
                {t('fleet.vehicles.yellowCardExpires')}
              </label>
              <input id="p-yc-exp" class="input" type="date" value={d.yellowCardExpiresAt} onInput={(e) => patch({ yellowCardExpiresAt: e.currentTarget.value })} />
            </div>
          </div>
          {kenya ? (
            <>
              <div class="grid2" style="margin-top:12px">
                <div class="field">
                  <label class="field__label" for="p-cl-kind">
                    <Abbreviated text={t('fleet.vehicles.customsLicence')} />
                  </label>
                  <select id="p-cl-kind" class="input" value={d.customsLicenceKind} onChange={(e) => patch({ customsLicenceKind: e.currentTarget.value as '' | 'C28' | 'C40' })}>
                    <option value="">{t('fleet.vehicles.customsLicenceNone')}</option>
                    <option value="C28">{t('fleet.vehicles.customsLicenceC28')}</option>
                    <option value="C40">{t('fleet.vehicles.customsLicenceC40')}</option>
                  </select>
                </div>
                <div class="field">
                  <label class="field__label" for="p-cl-num">
                    {t('fleet.vehicles.customsLicenceNumber')}
                  </label>
                  <input id="p-cl-num" class="input input--mono" maxLength={40} value={d.customsLicenceNumber} onInput={(e) => patch({ customsLicenceNumber: e.currentTarget.value })} spellcheck={false} disabled={!d.customsLicenceKind} />
                </div>
              </div>
              <div class="field" style="margin-top:12px">
                <label class="field__label" for="p-cl-exp">
                  {t('fleet.vehicles.customsLicenceExpires')}
                </label>
                <input id="p-cl-exp" class="input" type="date" value={d.customsLicenceExpiresAt} onInput={(e) => patch({ customsLicenceExpiresAt: e.currentTarget.value })} disabled={!d.customsLicenceKind} />
              </div>
            </>
          ) : null}
        </>
      ) : null}
      <Button
        chevron={false}
        disabled={!draft || (moyale && Boolean(d.registrationCountry) && !/^[A-Z]{2}$/.test(d.registrationCountry))}
        busy={vehicle ? state.busy === 'papers:' + vehicle.vehicleId : false}
        onClick={() => {
          if (!vehicle) return;
          const body = {
            insuranceRef: d.insuranceRef.trim() || undefined,
            insuranceExpiresAt: d.insuranceExpiresAt || undefined,
            inspectionRef: d.inspectionRef.trim() || undefined,
            inspectionExpiresAt: d.inspectionExpiresAt || undefined,
            ...(moyale
              ? { registrationCountry: d.registrationCountry || undefined, trailerPlate: d.trailerPlate.trim(), yellowCardNumber: d.yellowCardNumber.trim(), yellowCardExpiresAt: d.yellowCardExpiresAt || undefined }
              : {}),
            ...(kenya && d.customsLicenceKind && d.customsLicenceNumber.trim()
              ? { customsLicenceKind: d.customsLicenceKind, customsLicenceNumber: d.customsLicenceNumber.trim(), customsLicenceExpiresAt: d.customsLicenceExpiresAt || undefined }
              : {}),
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

/** 2026-11-03 — what a vehicle runs on, said by its office: one registered before it was asked, or a correction. */
function EnergySheet({ vehicle, onClose, state, actions }: { vehicle: VehicleRow | null; onClose: () => void; state: FleetState; actions: FleetActions }) {
  const t = useT();
  const [energy, setEnergy] = useState('');
  const chosen = energy || vehicle?.energy || '';
  const close = () => {
    setEnergy('');
    onClose();
  };
  return (
    <Sheet open={Boolean(vehicle)} onClose={close} title={vehicle ? vehicle.plate : ''}>
      {vehicle ? <EnergyChoice id="v-energy-later" vehicleClass={vehicle.vehicleClass} value={chosen} onChange={setEnergy} /> : null}
      <Button
        chevron={false}
        disabled={!vehicle || !energy || energy === vehicle.energy}
        busy={vehicle ? state.busy === `energy:${vehicle.vehicleId}` : false}
        onClick={() => {
          if (!vehicle || !energy) return;
          const v = vehicle;
          close();
          void actions.setVehicleEnergy(v, energy);
        }}
      >
        {t('vehicle.energy.save')}
      </Button>
      <Button variant="link" onClick={close}>
        {t('common.cancel')}
      </Button>
    </Sheet>
  );
}

/** 2026-11-13 — the loading equipment of a registered vehicle: every piece its kind can carry, ticked; saved as the whole list. */
function EquipmentSheet({ vehicle, onClose, state, actions }: { vehicle: VehicleRow; onClose: () => void; state: FleetState; actions: FleetActions }) {
  const t = useT();
  const before = (vehicle.equipment ?? []).filter((e) => e !== 'MAN');
  const [picked, setPicked] = useState<string[]>(before);
  const same = picked.length === before.length && picked.every((e) => before.includes(e));
  return (
    <Sheet open onClose={onClose} title={t('fleet.vehicles.equipmentSheet', { plate: vehicle.plate })}>
      <p class="t-body">{t('equipment.body')}</p>
      <p class="info-row">
        <span class="field__label">{t('fleet.vehicles.equipmentLabel')}</span>
        <OptionInfo topic="equipment" title={t('fleet.vehicles.equipmentLabel')} config={fleetConfig()} options={equipmentHelp(t, vehicle.vehicleClass)} />
      </p>
      <div class="chips">
        {equipmentOptions(t, vehicle.vehicleClass).map((eq) => {
          const on = picked.includes(eq.key);
          return (
            <button key={eq.key} type="button" class={`chip chip--tap${on ? ' chip--on' : ''}`} aria-pressed={on} onClick={() => setPicked(on ? picked.filter((e) => e !== eq.key) : [...picked, eq.key])}>
              {eq.label}
            </button>
          );
        })}
      </div>
      <Button
        chevron={false}
        disabled={same}
        busy={state.busy === `equipment:${vehicle.vehicleId}`}
        onClick={() => {
          onClose();
          void actions.setVehicleEquipment(vehicle, picked);
        }}
      >
        {t('equipment.save')}
      </Button>
      <Button variant="link" onClick={onClose}>
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
  const currency = state.dashboard?.currency;
  return (
    <Sheet open={Boolean(vehicle)} onClose={onClose} title={vehicle ? t('fleet.vehicles.priceSheetTitle', { plate: vehicle.plate }) : ''}>
      <p class="t-body">{t('fleet.vehicles.priceBody', { rate: vehicle ? perKmText(Number(vehicle.pricePerKm ?? 0), currency) : '' })}</p>
      <div class="field">
        <label class="field__label" for="rate">
          {currency ? t('fleet.vehicles.newPriceIn', { currency }) : t('fleet.vehicles.newPrice')}
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
