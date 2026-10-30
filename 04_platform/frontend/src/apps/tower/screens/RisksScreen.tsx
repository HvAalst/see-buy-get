import { Abbreviated } from '../../../shared/ui/Abbr';
import { useState } from 'preact/hooks';
import { Icon } from '../../../shared/ui';
import { formatDate, useT } from '../../../shared/i18n';
import { LEVEL_KEY, RISK_LEVELS, RISK_THREATS, THREAT_KEY, levelTone, riskChanges, type RiskLevel, type RiskProposalRow, type RiskRow, type RiskThreat } from '../risks';
import type { TowerActions, TowerState } from '../useTowerApp';

/**
 * Round 39 — THE RISK REGISTER (the user: "Staff rate, high asks seals"). What incidents have proposed comes first: a
 * person decides each. Then every corridor and hub, its rating for each threat, and when it is due to be looked at again.
 * A row rated high asks for seals and no night running — the server holds everybody to it; this says so where it is set.
 */
export function RisksScreen({ state, actions }: { state: TowerState; actions: TowerActions }) {
  const t = useT();
  const v = state.risk;
  const corridors = v?.rows.filter((r) => r.subject === 'corridor') ?? [];
  const hubs = v?.rows.filter((r) => r.subject === 'hub') ?? [];

  return (
    <>
      <header class="cons__head">
        <h1 class="cons__title">{t('tower.risks.title')}</h1>
        <p class="cons__lede">{t('tower.risks.lede')}</p>
      </header>
      {state.done ? (
        <p class="twr-done">
          <Icon name="check" size={16} />
          {state.done}
        </p>
      ) : null}
      {state.queueError ? <p class="cerr"><Abbreviated text={state.queueError} /></p> : null}

      {v && v.proposals.length ? (
        <section class="cons__panel">
          <div class="cons__panelhead">
            <span class="cons__panelt">{t('tower.risks.proposedTitle')}</span>
            <span class="ctag ctag--warn">{v.proposals.length}</span>
          </div>
          <p class="cons__lede">{t('tower.risks.proposedLede')}</p>
          <table class="ctbl ctbl--stack">
            <tbody>
              {v.proposals.map((p) => (
                <ProposalRow key={p.proposalId} p={p} state={state} actions={actions} />
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {v === null ? <p class="cons__empty">{t('tower.queues.loading')}</p> : null}
      {v ? <RiskTable title={t('tower.risks.corridorsTitle')} count={t('tower.risks.countCorridors', { n: corridors.length })} empty={t('tower.risks.noCorridors')} rows={corridors} state={state} actions={actions} /> : null}
      {v ? <RiskTable title={t('tower.risks.hubsTitle')} count={t('tower.risks.countHubs', { n: hubs.length })} empty={t('tower.risks.noHubs')} rows={hubs} state={state} actions={actions} /> : null}
    </>
  );
}

function ProposalRow({ p, state, actions }: { p: RiskProposalRow; state: TowerState; actions: TowerActions }) {
  const t = useT();
  const busy = state.busyId === p.proposalId;
  const [why, setWhy] = useState<string | null>(null);
  return (
    <>
      <tr>
        <td>
          <div class="ctbl__strong">{p.name}</div>
          <div class="ctbl__sub">{t(p.subject === 'hub' ? 'tower.risks.hub' : 'tower.risks.corridor')}</div>
        </td>
        <td class="ctbl__sub">
          {t('tower.risks.raise', { threat: t(THREAT_KEY[p.threat]), from: p.from ? t(LEVEL_KEY[p.from]) : t('tower.risks.unrated'), to: t(LEVEL_KEY[p.to]) })}
          <div>{p.because}</div>
          <div>{formatDate(p.at)}</div>
        </td>
        <td>
          <span class="twr-clear__act">
            <button type="button" class="cbtn cbtn--primary cbtn--sm" disabled={busy} onClick={() => void actions.decideRisk(p.proposalId, true)}>
              {t('tower.risks.accept', { to: t(LEVEL_KEY[p.to]) })}
            </button>
            <button type="button" class="cbtn cbtn--ghost cbtn--sm" disabled={busy} aria-expanded={why != null} onClick={() => setWhy(why == null ? '' : null)}>
              {t('tower.risks.keep')}
            </button>
          </span>
        </td>
      </tr>
      {why != null ? (
        <tr class="ctbl__editor">
          <td colSpan={3}>
            <label class="cfield">
              <span class="cfield__label">{t('tower.risks.keepWhy')}</span>
              <textarea class="ctextarea" rows={2} value={why} disabled={busy} onInput={(e) => setWhy((e.target as HTMLTextAreaElement).value)} />
            </label>
            <span class="twr-clear__act">
              <button type="button" class="cbtn cbtn--ghost cbtn--sm" disabled={busy || !why.trim()} onClick={() => void actions.decideRisk(p.proposalId, false, why.trim())}>
                {t('tower.risks.keepConfirm')}
              </button>
            </span>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function RiskTable({ title, count, empty, rows, state, actions }: { title: string; count: string; empty: string; rows: RiskRow[]; state: TowerState; actions: TowerActions }) {
  const t = useT();
  return (
    <section class="cons__panel">
      <div class="cons__panelhead">
        <span class="cons__panelt">{title}</span>
        <span class="ctbl__sub">{count}</span>
      </div>
      {rows.length === 0 ? (
        <p class="cons__empty">{empty}</p>
      ) : (
        <table class="ctbl ctbl--stack">
          <thead>
            <tr>
              <th>{t('tower.risks.col.name')}</th>
              {RISK_THREATS.map((th) => (
                <th key={th}>{t(THREAT_KEY[th])}</th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <RiskRowView key={`${r.subject}:${r.id}`} row={r} state={state} actions={actions} />
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function RiskRowView({ row, state, actions }: { row: RiskRow; state: TowerState; actions: TowerActions }) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [chosen, setChosen] = useState<Partial<Record<RiskThreat, RiskLevel>>>({});
  const [why, setWhy] = useState('');
  const busy = state.busyId === row.id;
  const open = () => {
    setChosen(Object.fromEntries(row.ratings.filter((c) => c.level).map((c) => [c.threat, c.level])) as Partial<Record<RiskThreat, RiskLevel>>);
    setWhy('');
    setEditing(true);
  };
  const changes = riskChanges(row, chosen);
  return (
    <>
      <tr>
        <td>
          <div class="ctbl__strong">{row.name}</div>
          {row.high ? <span class="ctag ctag--warn">{t('tower.risks.asks')}</span> : null}
        </td>
        {row.ratings.map((c) => (
          <td key={c.threat}>
            <span class="ctbl__lbl">{t(THREAT_KEY[c.threat])}</span>
            <span class={`ctag ${levelTone(c.level)}`}>{c.level ? t(LEVEL_KEY[c.level]) : t('tower.risks.unrated')}</span>
            {c.level && c.overdue ? (
              <div>
                <span class="ctag ctag--warn">{t('tower.risks.reviewDue')}</span>
                <button type="button" class="cbtn cbtn--ghost cbtn--sm" style="margin-top:6px;display:block" disabled={busy} onClick={() => void actions.rateRisk(row.subject, row.id, c.threat, c.level!)}>
                  {t('tower.risks.stillRight')}
                </button>
              </div>
            ) : c.reviewBy ? (
              <div class="ctbl__sub">{t('tower.risks.reviewBy', { day: formatDate(c.reviewBy), who: c.ratedBy ?? '' })}</div>
            ) : null}
          </td>
        ))}
        <td>
          <button type="button" class="cbtn cbtn--ghost cbtn--sm" aria-expanded={editing} onClick={() => (editing ? setEditing(false) : open())}>
            {editing ? t('tower.presence.cancel') : t('tower.risks.rate')}
          </button>
        </td>
      </tr>
      {editing ? (
        <tr class="ctbl__editor">
          <td colSpan={6}>
            {RISK_THREATS.map((th) => (
              <div key={th} class="cfield">
                <span class="cfield__label">{t(THREAT_KEY[th])}</span>
                <span class="twr-panelend" style="justify-content:flex-start">
                  {RISK_LEVELS.map((lv) => (
                    <button key={lv} type="button" class={`cbtn cbtn--ghost cbtn--sm${chosen[th] === lv ? ' cbtn--on' : ''}`} aria-pressed={chosen[th] === lv} onClick={() => setChosen({ ...chosen, [th]: lv })}>
                      {t(LEVEL_KEY[lv])}
                    </button>
                  ))}
                </span>
              </div>
            ))}
            <label class="cfield">
              <span class="cfield__label">{t('tower.risks.why')}</span>
              <input class="cinput" value={why} onInput={(e) => setWhy((e.target as HTMLInputElement).value)} placeholder={t('tower.risks.whyPh')} />
            </label>
            {Object.values(chosen).includes('high') ? <p class="chint">{t(row.subject === 'hub' ? 'tower.risks.highHub' : 'tower.risks.highCorridor')}</p> : null}
            <span class="twr-clear__act">
              <button
                type="button"
                class="cbtn cbtn--primary cbtn--sm"
                disabled={busy || changes.length === 0}
                onClick={async () => {
                  for (const c of changes) await actions.rateRisk(row.subject, row.id, c.threat, c.level, why.trim() || undefined);
                  setEditing(false);
                }}
              >
                {t('tower.risks.save')}
              </button>
            </span>
          </td>
        </tr>
      ) : null}
    </>
  );
}
