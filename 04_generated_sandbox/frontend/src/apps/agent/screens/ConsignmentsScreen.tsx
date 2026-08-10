import { useState } from 'preact/hooks';
import { Button, Card, ErrorNote, Note, Pill } from '../../../shared/ui';
import { DURABLE_NATURES, NATURES, consignmentProgress } from '../logic';
import type { ConsignmentView } from '../types';
import type { AgentActions, AgentState } from '../useAgentApp';

const natureLabel = (key: string): string => NATURES.find((n) => n.key === key)?.label ?? key;

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
  return (
    <div class="scr">
      <h1 class="scr__title">Consolidation lots</h1>
      <p class="scr__lede">Pool members’ durable goods into a truckload. When a lot fills, it books a freight truck on its own.</p>

      {state.error ? <ErrorNote error={state.error} /> : null}

      <OpenLotCard state={state} actions={actions} />

      {state.consignmentsState === 'loading' ? <p class="hint" style="margin-top:12px">Loading your lots…</p> : null}
      {state.consignmentsState === 'error' ? (
        <p class="hint" style="margin-top:12px">
          Couldn’t load your lots. <button type="button" class="linkbtn" onClick={() => void actions.loadConsignments()}>Try again</button>
        </p>
      ) : null}
      {state.consignmentsState === 'ready' && state.consignments.length === 0 ? (
        <p class="hint" style="margin-top:12px">No lots yet. Open one above to start pooling deposits.</p>
      ) : null}

      {state.consignments.map((lot) => (
        <LotCard key={lot.consignmentId} lot={lot} state={state} actions={actions} />
      ))}
    </div>
  );
}

function OpenLotCard({ state, actions }: ConsignmentsScreenProps) {
  const [nature, setNature] = useState<string>(DURABLE_NATURES[0]);
  const [dest, setDest] = useState('');
  const [target, setTarget] = useState('');
  const [cap, setCap] = useState('');
  const targetKg = Number(target);
  const ready = dest.trim().length > 0 && targetKg > 0;
  return (
    <Card label="Open a new lot">
      <div class="field">
        <label class="field__label" for="lot-nature">
          What is being pooled?
        </label>
        <select id="lot-nature" class="select" value={nature} onChange={(e) => setNature(e.currentTarget.value)}>
          {DURABLE_NATURES.map((k) => (
            <option key={k} value={k}>
              {natureLabel(k)}
            </option>
          ))}
        </select>
      </div>
      <div class="field" style="margin-top:12px">
        <label class="field__label" for="lot-dest">
          Where does the truckload go?
        </label>
        <input id="lot-dest" class="input" value={dest} onInput={(e) => setDest(e.currentTarget.value)} placeholder="e.g. Merkato market" autocapitalize="words" />
      </div>
      <div class="dims" style="margin-top:12px">
        <div class="field">
          <label class="field__label" for="lot-target">
            Truckload target (kg)
          </label>
          <input id="lot-target" class="input" type="number" inputMode="decimal" min="1" step="100" value={target} onInput={(e) => setTarget(e.currentTarget.value)} placeholder="e.g. 10000" />
        </div>
        <div class="field">
          <label class="field__label" for="lot-cap">
            Cash cap (optional)
          </label>
          <input id="lot-cap" class="input" type="number" inputMode="decimal" min="0" step="1" value={cap} onInput={(e) => setCap(e.currentTarget.value)} placeholder="e.g. 300" />
        </div>
      </div>
      <p class="card__note">The cash cap is the most the co-op will pay a driver to move the full load. Members’ deposits and payout are settled off the app.</p>
      <div class="scr__cta">
        <Button
          disabled={!ready}
          busy={state.busy === 'open-consignment'}
          onClick={() => {
            const capN = Number(cap);
            void actions.openConsignment({ natureCode: nature, destLabel: dest, targetKg, maxSpend: cap.trim() && capN > 0 ? capN : undefined });
            setDest('');
            setTarget('');
            setCap('');
          }}
        >
          Start the lot
        </Button>
      </div>
    </Card>
  );
}

function LotCard({ lot, state, actions }: { lot: ConsignmentView; state: AgentState; actions: AgentActions }) {
  const [member, setMember] = useState('');
  const [kg, setKg] = useState('');
  const kgN = Number(kg);
  const prog = consignmentProgress(lot);
  const posted = lot.status === 'posted';
  return (
    <Card label={`${lot.code} · ${natureLabel(lot.natureCode)}`} aside={<Pill tone={posted ? 'ok' : 'info'} dot>{posted ? 'Freight booked' : 'Filling'}</Pill>}>
      <div class="kv">
        <span>To</span>
        <b>{lot.destLabel}</b>
      </div>
      <div class="kv">
        <span>Pooled</span>
        <b>{`${prog.label} (${prog.pct}%)`}</b>
      </div>
      {lot.deposits.length ? <p class="card__note">{`${lot.deposits.length} deposit${lot.deposits.length === 1 ? '' : 's'} from members.`}</p> : null}

      {posted ? (
        <Note tone="ok" icon="truck" title="Posted to drivers" detail="This lot is on the freight marketplace — a truck will pick it up." />
      ) : (
        <>
          <div class="dims" style="margin-top:12px">
            <div class="field">
              <label class="field__label" for={`m-${lot.code}`}>
                Member
              </label>
              <input id={`m-${lot.code}`} class="input" value={member} onInput={(e) => setMember(e.currentTarget.value)} placeholder="Name or receipt no." />
            </div>
            <div class="field">
              <label class="field__label" for={`k-${lot.code}`}>
                Weight (kg)
              </label>
              <input id={`k-${lot.code}`} class="input" type="number" inputMode="decimal" min="0.01" step="1" value={kg} onInput={(e) => setKg(e.currentTarget.value)} placeholder="e.g. 400" />
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
            Add deposit
          </Button>
        </>
      )}
    </Card>
  );
}
