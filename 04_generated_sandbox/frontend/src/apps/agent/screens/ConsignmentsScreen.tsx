import { useState } from 'preact/hooks';
import { Button, Card, ErrorNote, Note, Pill } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import { DURABLE_NATURES, consignmentProgress, natureLabel } from '../logic';
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

function OpenLotCard({ state, actions }: ConsignmentsScreenProps) {
  const t = useT();
  const [nature, setNature] = useState<string>(DURABLE_NATURES[0]);
  const [dest, setDest] = useState('');
  const [target, setTarget] = useState('');
  const [cap, setCap] = useState('');
  const targetKg = Number(target);
  const ready = dest.trim().length > 0 && targetKg > 0;
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
      <div class="field" style="margin-top:12px">
        <label class="field__label" for="lot-dest">
          {t('agent.consignments.whereGo')}
        </label>
        <input id="lot-dest" class="input" value={dest} onInput={(e) => setDest(e.currentTarget.value)} placeholder={t('agent.consignments.destPh')} autocapitalize="words" />
      </div>
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
            void actions.openConsignment({ natureCode: nature, destLabel: dest, targetKg, maxSpend: cap.trim() && capN > 0 ? capN : undefined });
            setDest('');
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
