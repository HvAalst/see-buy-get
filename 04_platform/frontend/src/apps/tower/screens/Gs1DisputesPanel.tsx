import { useState } from 'preact/hooks';
import { Abbreviated } from '../../../shared/ui/Abbr';
import { formatDate, useT } from '../../../shared/i18n';
import { GS1_STATE, gs1Step, gs1Waiting, licenceRefs, mayApprove, sideWords, type Gs1DisputeRow, type Gs1PartyRow, type Gs1Side } from '../gs1Disputes';
import type { TowerActions, TowerState } from '../useTowerApp';
import { DocumentStrip } from './DocumentStrip';

/**
 * Round 18 — TWO BUSINESSES SAY ONE GS1 COMPANY PREFIX IS THEIRS. On the Businesses screen, where staff already check
 * businesses two at a time: each side's licence, what it said, the digit it prints under now; one member of staff says
 * whose the prefix is and why, a different one approves or sends it back. Shown only while there is a dispute to read,
 * and counted on the Businesses badge while one waits to be decided.
 */
export function Gs1DisputesPanel({ state, actions }: { state: TowerState; actions: TowerActions }) {
  const t = useT();
  // Read with the queues, so the Businesses badge and this panel never disagree; a decision reads them again.
  const rows = state.gs1Disputes;
  if (!rows?.length) return null;
  return (
    <section class="cons__panel">
      <div class="cons__panelhead">
        <span class="cons__panelt">{t('tower.gs1.title')}</span>
        <span class="chint">{t('tower.gs1.waiting', { n: gs1Waiting(rows) })}</span>
      </div>
      <p class="cons__lede"><Abbreviated text={t('tower.gs1.lede')} /></p>
      {rows.map((row) => (
        <Dispute key={row.disputeId} row={row} state={state} actions={actions} onChanged={() => void actions.refresh()} />
      ))}
    </section>
  );
}

function Dispute({ row, state, actions, onChanged }: { row: Gs1DisputeRow; state: TowerState; actions: TowerActions; onChanged: () => void }) {
  const t = useT();
  const client = actions.client();
  const me = state.who?.name;
  const [to, setTo] = useState<Gs1Side | null>(null);
  const [what, setWhat] = useState('');
  const [reason, setReason] = useState('');
  const [why, setWhy] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const day = (iso: string) => formatDate(iso, { day: 'numeric', month: 'long', year: 'numeric' });
  const tag = GS1_STATE[row.state];
  const act = async (key: string, fn: () => Promise<{ error?: { detail?: string; title?: string } | null }>) => {
    setBusy(key);
    setError(null);
    const r = await fn();
    setBusy(null);
    if (r.error) return setError(r.error.detail || r.error.title || null);
    setTo(null);
    setWhat('');
    setReason('');
    setWhy('');
    onChanged();
  };
  const party = (p: Gs1PartyRow, side: 'claimant' | 'holder') => (
    <div key={p.entityId} style="margin-top:8px">
      <p class="crow__t">
        {p.name}
        <span class="chint">
          {' · '}
          {t(side === 'claimant' ? 'tower.gs1.claimant' : 'tower.gs1.holder')}
          {p.digitNow !== undefined ? ` · ${t('tower.gs1.digitNow', { digit: p.digitNow })}` : ''}
          {p.forwarder ? ` · ${t('tower.gs1.forwarder', { name: p.forwarder })}` : ''}
          {p.store ? ` · ${t('tower.gs1.store')}` : ''}
        </span>
      </p>
      {p.note ? <p class="chint">“{p.note}”</p> : null}
      <DocumentStrip refs={licenceRefs(p)} state={state} actions={actions} titleKey="tower.gs1.licences" emptyKey="tower.gs1.noLicence" />
    </div>
  );
  return (
    <div class="cnote" style="margin-top:12px">
      <div class="cons__panelhead">
        <span class="crow__t mono-t">{t('tower.gs1.prefix', { prefix: row.companyPrefix, digit: row.extensionDigit })}</span>
        <span class={`ctag ctag--${tag.tone}`}>{t(tag.key)}</span>
      </div>
      <p class="crow__sub">{gs1Step(row, t, day)}</p>
      {row.decided ? <p class="chint">{t('tower.gs1.reason', { reason: row.decided.reason })}</p> : null}
      {row.sentBack && !row.decided ? <p class="chint">{t('tower.gs1.sentBack', { by: row.sentBack.by, why: row.sentBack.why })}</p> : null}
      {party(row.claimant, 'claimant')}
      {row.holders.map((h) => party(h, 'holder'))}

      {row.state === 'open' && row.mayDecide && client ? (
        <div style="margin-top:10px">
          <p class="cfield__label">{t('tower.gs1.whose')}</p>
          <div class="twr-panelend" style="justify-content:flex-start">
            {(['claimant', 'holders'] as const).map((side) => (
              <button key={side} type="button" class={`cbtn ${to === side ? 'cbtn--primary' : 'cbtn--ghost'}`} aria-pressed={to === side} onClick={() => setTo(side)}>
                {sideWords(row, side)}
              </button>
            ))}
          </div>
          <label class="cfield">
            <span class="cfield__label">{t('tower.gs1.what')}</span>
            <textarea id={`gs1-what-${row.disputeId}`} class="cinput" rows={2} maxLength={500} value={what} onInput={(e) => setWhat((e.target as HTMLTextAreaElement).value)} />
          </label>
          <label class="cfield">
            <span class="cfield__label">{t('tower.gs1.reasonLabel')}</span>
            <textarea id={`gs1-reason-${row.disputeId}`} class="cinput" rows={2} maxLength={500} value={reason} onInput={(e) => setReason((e.target as HTMLTextAreaElement).value)} />
            <span class="chint">{t('tower.gs1.reasonHint')}</span>
          </label>
          <div class="twr-panelend">
            <button type="button" class="cbtn cbtn--primary" disabled={!to || !what.trim() || !reason.trim() || busy !== null} onClick={() => void act('propose', () => client.api.proposeGs1(row.disputeId, { to: to!, what: what.trim(), reason: reason.trim() }, me) as never)}>
              {t('tower.gs1.propose')}
            </button>
          </div>
        </div>
      ) : null}

      {row.state === 'proposed' && row.proposal && client ? (
        <div style="margin-top:10px">
          <p class="chint">{t('tower.gs1.checked', { what: row.proposal.what })}</p>
          <p class="chint">{t('tower.gs1.reason', { reason: row.proposal.reason })}</p>
          {mayApprove(row, me) ? (
            <>
              <label class="cfield">
                <span class="cfield__label">{t('tower.gs1.whyBack')}</span>
                <input id={`gs1-why-${row.disputeId}`} class="cinput" maxLength={300} value={why} onInput={(e) => setWhy((e.target as HTMLInputElement).value)} />
              </label>
              <div class="twr-panelend">
                <button type="button" class="cbtn cbtn--ghost" disabled={!why.trim() || busy !== null} onClick={() => void act('back', () => client.api.sendBackGs1(row.disputeId, why.trim(), me) as never)}>
                  {t('tower.gs1.sendBack')}
                </button>
                <button type="button" class="cbtn cbtn--primary" disabled={busy !== null} onClick={() => void act('approve', () => client.api.approveGs1(row.disputeId, me) as never)}>
                  {t('tower.gs1.approve', { whose: sideWords(row, row.proposal.to) })}
                </button>
              </div>
            </>
          ) : (
            <p class="chint">{t('tower.gs1.notYou')}</p>
          )}
        </div>
      ) : null}
      {error ? <p class="cerr"><Abbreviated text={error} /></p> : null}
    </div>
  );
}
