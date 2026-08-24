import { useState } from 'preact/hooks';
import { Button, Card, ErrorNote, Note, Pill, PlaceMap } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import { DURABLE_NATURES, consignmentProgress, natureLabel, pinAfterRename, type PinSource } from '../logic';
import type { GeoPoint } from '../../../shared/geo';
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
 * Where the truckload goes, as a PLACE and not just a word.
 *
 * The lot's destination is usually a market, not a network PUDO, so nothing on the platform can resolve it
 * for us — and the eventual haul is priced off the distance to it. A name alone was a silent trap: a typo
 * geocoded to somewhere else (or to nothing, and the driver hauls the whole route paid only the deadhead).
 * So the name still names it for the humans, and the map says where it actually is: tap "Find it" to have
 * the name looked up, or drop the pin by hand when the name is not on the map. The lot cannot open until
 * the destination has a point — the shopkeeper can SEE what the haul will be priced against.
 */
function DestPicker({
  actions,
  label,
  onLabel,
  pin,
  onPin,
  origin,
}: {
  actions: AgentActions;
  label: string;
  pin: GeoPoint | null;
  onLabel: (v: string) => void;
  onPin: (p: GeoPoint, from: 'name' | 'map') => void;
  /** The co-op's own site — the orange locator, so the map opens on the town the goods leave from. */
  origin: GeoPoint | null;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  // What a match MEANS here is money: the haul is priced to this point. So the note says how sure we are —
  // an approximate or guessed pin is named as such, with the map right there to correct it.
  const find = async () => {
    setBusy(true);
    const g = await actions.geocodePlace(label);
    setBusy(false);
    if (!g) {
      setNote(t('agent.toast.geoNotFound'));
      return;
    }
    const where = g.matched ?? label.trim();
    setNote(g.confidence === 'exact' ? t('agent.consignments.geoExact', { where }) : g.confidence === 'approx' ? t('agent.consignments.geoApprox', { where }) : t('agent.consignments.geoGuess'));
    onPin(g.location, 'name');
  };

  return (
    <>
      <div class="field" style="margin-top:12px">
        <label class="field__label" for="lot-dest">
          {t('agent.consignments.whereGo')}
        </label>
        <input
          id="lot-dest"
          class="input"
          value={label}
          onInput={(e) => {
            onLabel(e.currentTarget.value);
            setNote(null);
          }}
          placeholder={t('agent.consignments.destPh')}
          autocapitalize="words"
        />
        <Button variant="outline" chevron={false} disabled={!label.trim()} busy={busy} onClick={() => void find()}>
          {t('agent.consignments.findOnMap')}
        </Button>
      </div>

      <PlaceMap label={t('agent.consignments.mapLabel')} pins={[]} reference={origin} onDrop={(p) => { onPin(p, 'map'); setNote(null); }} dropped={pin} />
      <p class="card__note">{note ?? (pin ? t('agent.consignments.pinned') : t('agent.consignments.noPin'))}</p>
    </>
  );
}

function OpenLotCard({ state, actions }: ConsignmentsScreenProps) {
  const t = useT();
  const [nature, setNature] = useState<string>(DURABLE_NATURES[0]);
  const [dest, setDest] = useState('');
  // The pin, and where it came from — which decides whether it survives an edit to the name (pinAfterRename).
  const [pin, setPin] = useState<GeoPoint | null>(null);
  const [pinFrom, setPinFrom] = useState<PinSource>(null);
  const [target, setTarget] = useState('');
  const [cap, setCap] = useState('');
  const targetKg = Number(target);
  const ready = dest.trim().length > 0 && targetKg > 0 && pin !== null;
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
      <DestPicker
        actions={actions}
        label={dest}
        pin={pin}
        origin={state.agent?.location ?? null}
        onLabel={(v) => {
          setDest(v);
          setPin((p) => pinAfterRename(p, pinFrom));
        }}
        onPin={(p, from) => {
          setPin(p);
          setPinFrom(from);
        }}
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
            void actions.openConsignment({ natureCode: nature, destLabel: dest, destLocation: pin ?? undefined, targetKg, maxSpend: cap.trim() && capN > 0 ? capN : undefined });
            setDest('');
            setPin(null);
            setPinFrom(null);
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
