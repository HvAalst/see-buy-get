import { useState } from 'preact/hooks';
import { Button, Card, ErrorNote, Note, Pill, PlacePicker, type PlaceNote } from '../../../shared/ui';
import { useT, type Translate } from '../../../shared/i18n';
import { DURABLE_NATURES, consignmentProgress, natureLabel } from '../logic';
import { pinAfterRename, type GeoPoint, type PinSource } from '../../../shared/geo';
import type { ConsignmentView } from '../types';
import type { AgentActions, AgentState } from '../useAgentApp';

export interface ConsignmentsScreenProps {
  state: AgentState;
  actions: AgentActions;
}

/**
 * F3 — the cooperative's consolidation lots. Members pool a durable dry commodity (grain, dry food, cement)
 * into a lot until it reaches a truckload; the lot then books a freight truck on its own (or when the sweep
 * ages it out). Perishables are not offered here — they book freight directly. Money settles off the app: the
 * co-op reconciles member deposits and payout, and pays the eventual haul (capped by the optional cash cap).
 */
export function ConsignmentsScreen({ state, actions }: ConsignmentsScreenProps) {
  const t = useT();
  return (
    <div class="scr">
      <h1 class="scr__title">{t('agent.consignments.title')}</h1>
      <p class="scr__lede">{t('agent.consignments.lede')}</p>

      {state.error ? <ErrorNote error={state.error} /> : null}

      <OpenLotCard state={state} actions={actions} />

      {state.consignmentsState === 'loading' ? <p class="hint" style="margin-top:12px">{t('agent.consignments.loading')}</p> : null}
      {state.consignmentsState === 'error' ? (
        <p class="hint" style="margin-top:12px">
          {t('agent.consignments.loadFail')} <button type="button" class="linkbtn" onClick={() => void actions.loadConsignments()}>{t('agent.tryAgain')}</button>
        </p>
      ) : null}
      {state.consignmentsState === 'ready' && state.consignments.length === 0 ? (
        <p class="hint" style="margin-top:12px">{t('agent.consignments.empty')}</p>
      ) : null}

      {state.consignments.map((lot) => (
        <LotCard key={lot.consignmentId} lot={lot} state={state} actions={actions} />
      ))}
    </div>
  );
}

/**
 * What a placed (or unplaced) end MEANS on this screen: money. The haul is priced between these two points,
 * so an approximate or guessed pin is named as such, with the map right there to correct it.
 */
function lotNote(t: Translate, note: PlaceNote): string {
  switch (note.kind) {
    case 'notFound':
      return t('agent.toast.geoNotFound');
    case 'pinned':
      return t('agent.consignments.pinned');
    case 'found':
      return note.confidence === 'exact'
        ? t('agent.consignments.geoExact', { where: note.where })
        : note.confidence === 'approx'
          ? t('agent.consignments.geoApprox', { where: note.where })
          : t('agent.consignments.geoGuess');
    default:
      return t('agent.consignments.noPin');
  }
}

/**
 * One end of the haul as editable state: the name, the pin, and where the pin came from — which is what
 * decides whether it survives an edit to the name (see pinAfterRename).
 */
function usePlaceEnd(initialLabel: string, initialPin: GeoPoint | null) {
  const [label, setLabel] = useState(initialLabel);
  const [pin, setPin] = useState<GeoPoint | null>(initialPin);
  const [from, setFrom] = useState<PinSource>(initialPin ? 'map' : null);
  return {
    label,
    pin,
    onLabel: (v: string) => {
      setLabel(v);
      setPin((p) => pinAfterRename(p, from));
    },
    onPin: (p: GeoPoint, src: PinSource) => {
      setPin(p);
      setFrom(src);
    },
    reset: (l: string, p: GeoPoint | null) => {
      setLabel(l);
      setPin(p);
      setFrom(p ? 'map' : null);
    },
  };
}

function OpenLotCard({ state, actions }: ConsignmentsScreenProps) {
  const t = useT();
  const shopName = state.agent?.shopName ?? '';
  const shopAt = state.agent?.location ?? null;
  const [nature, setNature] = useState<string>(DURABLE_NATURES[0]);
  // The collection point starts at the shop — the common case, and a real place a truck can reach. A
  // cooperative aggregating at a shed or a farm gate moves it, and that is the whole point of it being here.
  const pickup = usePlaceEnd(shopName, shopAt);
  const dest = usePlaceEnd('', null);
  const [target, setTarget] = useState('');
  const [cap, setCap] = useState('');
  const targetKg = Number(target);
  const ready = pickup.label.trim().length > 0 && pickup.pin !== null && dest.label.trim().length > 0 && dest.pin !== null && targetKg > 0;
  return (
    <Card label={t('agent.consignments.openLot')}>
      <div class="field">
        <label class="field__label" for="lot-nature">
          {t('agent.consignments.whatPooled')}
        </label>
        <select id="lot-nature" class="select" value={nature} onChange={(e) => setNature(e.currentTarget.value)}>
          {DURABLE_NATURES.map((k) => (
            <option key={k} value={k}>
              {natureLabel(k, t)}
            </option>
          ))}
        </select>
      </div>
      <PlacePicker
        id="lot-pickup"
        fieldLabel={t('agent.consignments.whereCollected')}
        placeholder={t('agent.consignments.pickupPh')}
        mapLabel={t('agent.consignments.pickupMapLabel')}
        findLabel={t('agent.consignments.findOnMap')}
        label={pickup.label}
        pin={pickup.pin}
        reference={shopAt}
        onLabel={pickup.onLabel}
        onPin={pickup.onPin}
        geocode={actions.geocodePlace}
        noteText={(n) => lotNote(t, n)}
      />
      <PlacePicker
        id="lot-dest"
        fieldLabel={t('agent.consignments.whereGo')}
        placeholder={t('agent.consignments.destPh')}
        mapLabel={t('agent.consignments.mapLabel')}
        findLabel={t('agent.consignments.findOnMap')}
        label={dest.label}
        pin={dest.pin}
        reference={pickup.pin ?? shopAt}
        onLabel={dest.onLabel}
        onPin={dest.onPin}
        geocode={actions.geocodePlace}
        noteText={(n) => lotNote(t, n)}
      />
      <div class="dims" style="margin-top:12px">
        <div class="field">
          <label class="field__label" for="lot-target">
            {t('agent.consignments.targetLabel')}
          </label>
          <input id="lot-target" class="input" type="number" inputMode="decimal" min="1" step="100" value={target} onInput={(e) => setTarget(e.currentTarget.value)} placeholder={t('agent.consignments.targetPh')} />
        </div>
        <div class="field">
          <label class="field__label" for="lot-cap">
            {t('agent.consignments.capLabel')}
          </label>
          <input id="lot-cap" class="input" type="number" inputMode="decimal" min="0" step="1" value={cap} onInput={(e) => setCap(e.currentTarget.value)} placeholder={t('agent.consignments.capPh')} />
        </div>
      </div>
      <p class="card__note">{t('agent.consignments.capNote')}</p>
      <div class="scr__cta">
        <Button
          disabled={!ready}
          busy={state.busy === 'open-consignment'}
          onClick={() => {
            const capN = Number(cap);
            void actions.openConsignment({
              natureCode: nature,
              pickupLabel: pickup.label,
              pickupLocation: pickup.pin ?? undefined,
              destLabel: dest.label,
              destLocation: dest.pin ?? undefined,
              targetKg,
              maxSpend: cap.trim() && capN > 0 ? capN : undefined,
            });
            pickup.reset(shopName, shopAt); // back to the shop's own site for the next lot
            dest.reset('', null);
            setTarget('');
            setCap('');
          }}
        >
          {t('agent.consignments.startLot')}
        </Button>
      </div>
    </Card>
  );
}

function LotCard({ lot, state, actions }: { lot: ConsignmentView; state: AgentState; actions: AgentActions }) {
  const t = useT();
  const [member, setMember] = useState('');
  const [kg, setKg] = useState('');
  const kgN = Number(kg);
  const prog = consignmentProgress(lot);
  const posted = lot.status === 'posted';
  return (
    <Card label={`${lot.code} · ${natureLabel(lot.natureCode, t)}`} aside={<Pill tone={posted ? 'ok' : 'info'} dot>{posted ? t('agent.consignments.freightBooked') : t('agent.consignments.filling')}</Pill>}>
      {/* Both ends, because a co-op lot is collected where the crop is — which is the address the truck needs. */}
      <div class="kv">
        <span>{t('agent.consignments.from')}</span>
        <b>{lot.pickupLabel}</b>
      </div>
      <div class="kv">
        <span>{t('agent.consignments.to')}</span>
        <b>{lot.destLabel}</b>
      </div>
      <div class="kv">
        <span>{t('agent.consignments.pooled')}</span>
        <b>{`${prog.label} (${prog.pct}%)`}</b>
      </div>
      {lot.deposits.length ? <p class="card__note">{lot.deposits.length === 1 ? t('agent.consignments.depositsOne', { count: lot.deposits.length }) : t('agent.consignments.depositsMany', { count: lot.deposits.length })}</p> : null}

      {posted ? (
        <Note tone="ok" icon="truck" title={t('agent.consignments.postedTitle')} detail={t('agent.consignments.postedDetail')} />
      ) : (
        <>
          <div class="dims" style="margin-top:12px">
            <div class="field">
              <label class="field__label" for={`m-${lot.code}`}>
                {t('agent.consignments.member')}
              </label>
              <input id={`m-${lot.code}`} class="input" value={member} onInput={(e) => setMember(e.currentTarget.value)} placeholder={t('agent.consignments.memberPh')} />
            </div>
            <div class="field">
              <label class="field__label" for={`k-${lot.code}`}>
                {t('agent.consignments.weightLabel')}
              </label>
              <input id={`k-${lot.code}`} class="input" type="number" inputMode="decimal" min="0.01" step="1" value={kg} onInput={(e) => setKg(e.currentTarget.value)} placeholder={t('agent.consignments.weightPh')} />
            </div>
          </div>
          <Button
            variant="outline"
            chevron={false}
            disabled={!member.trim() || !(kgN > 0)}
            busy={state.busy === `deposit-${lot.code}`}
            onClick={() => {
              void actions.depositConsignment(lot.code, member, kgN);
              setMember('');
              setKg('');
            }}
          >
            {t('agent.consignments.addDeposit')}
          </Button>
        </>
      )}
    </Card>
  );
}
