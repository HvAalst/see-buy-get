import { useState } from 'preact/hooks';
import { Icon } from '../../../shared/ui';
import { useT, type MessageKey } from '../../../shared/i18n';
import { ConsoleDetail } from '../ConsoleDetail';
import { ConsolePick } from '../ConsolePick';
import { closedLine, doneBlocker, eventLine, HOLD_KIND, kindCountLine, kindWords, openFor, ownerLine, RECHECK_CHOICES, severityTone, type CaseListName, type FlagCaseRow } from '../cases';
import { TamperPanel } from './TamperPanel';
import { lostLine, lostReasonBlocker, SEARCH_KIND, type LostParcelRow } from '../lost';
import type { TowerActions, TowerState } from '../useTowerApp';

/**
 * WHAT IS ON FIRE, AS CASES (the user, 2026-10-18).
 *
 * Every automatic flag is a case here: who has it, how long it has waited, what was done. The most pressing first —
 * escalated, then nobody's, then the most severe. A case whose flag went away closes itself; one a person closes needs a
 * reason and a time to look again, and comes back as a following case if the flag is still there then.
 *
 * A network has thousands of flags. The kinds above the list are the counts of ALL of them and the way to work through
 * one kind; the list is at most a page, and says so when it is cut.
 */
export function CasesScreen({ state, actions }: { state: TowerState; actions: TowerActions }) {
  const t = useT();
  const rows = state.cases;
  const closed = state.caseWhich === 'closed';
  // The case open beside the list, as last read. Held here too: one somebody takes leaves the first page of the live list,
  // and must not vanish from under the person who just took it.
  const [held, setHeld] = useState<FlagCaseRow | null>(null);
  const open = held ? (rows?.find((c) => c.caseId === held.caseId) ?? held) : null;
  const total = state.casesTotal ?? rows?.length ?? 0;
  // Another list, or another kind: what was open beside the old one is put away.
  const pick = (which: CaseListName, kind: string | null) => {
    setHeld(null);
    actions.caseFilter(which, kind);
  };
  const lists: Array<{ which: CaseListName; key: MessageKey }> = [
    { which: 'live', key: 'tower.cases.live' },
    { which: 'taken', key: 'tower.cases.taken' },
    { which: 'closed', key: 'tower.cases.closed' },
  ];

  return (
    <>
      <header class="cons__head">
        <h1 class="cons__title">{t('tower.cases.title')}</h1>
        <p class="cons__lede">{t('tower.cases.lede')}</p>
      </header>

      {state.caseKinds && state.caseKinds.length > 1 ? (
        <nav class="twr-sisters" aria-label={t('tower.cases.pickKind')}>
          <button type="button" class={`twr-sister${state.caseKind === null ? ' twr-sister--on' : ''}`} aria-pressed={state.caseKind === null} onClick={() => pick(state.caseWhich, null)}>
            <span class="twr-sister__n">{t('tower.cases.allKinds')}</span>
            <span class="twr-sister__m">{t('tower.cases.kindCount', { n: state.caseKinds.reduce((n, k) => n + k.count, 0) })}</span>
          </button>
          {state.caseKinds.map((k) => (
            <button
              key={k.kind}
              type="button"
              class={`twr-sister${state.caseKind === k.kind ? ' twr-sister--on' : ''}`}
              aria-pressed={state.caseKind === k.kind}
              onClick={() => pick(state.caseWhich, k.kind)}
            >
              <span class="twr-sister__n">{kindWords(k.kind, t)}</span>
              <span class={k.escalated ? 'twr-sister__m cerr' : 'twr-sister__m'}>{kindCountLine(k, t)}</span>
            </button>
          ))}
        </nav>
      ) : null}

      <section class="cons__panel">
        <div class="cons__panelhead">
          <span class="cons__panelt">
            {state.caseWhich === 'closed'
              ? t('tower.cases.closedCount', { n: total })
              : state.caseWhich === 'taken'
                ? t('tower.cases.takenCount', { n: total, waiting: state.casesWaiting ?? 0 })
                : t('tower.cases.count', { n: total, waiting: state.casesWaiting ?? 0 })}
          </span>
          <span class="twr-panelend">
            {lists.map((l) => (
              <button
                key={l.which}
                type="button"
                class={`cbtn cbtn--ghost cbtn--sm${state.caseWhich === l.which ? ' cbtn--on' : ''}`}
                aria-pressed={state.caseWhich === l.which}
                onClick={() => pick(l.which, null)}
              >
                {t(l.key)}
              </button>
            ))}
            <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => void actions.refresh()} disabled={state.loading}>
              <Icon name="refresh" size={16} />
              {t('tower.hazards.refresh')}
            </button>
          </span>
        </div>
        {state.caseError ? <p class="cerr">{state.caseError}</p> : null}
        {rows && rows.length < total ? <p class="chint">{t(closed ? 'tower.cases.closedCut' : 'tower.cases.cut', { shown: rows.length })}</p> : null}
        {closed ? <p class="chint">{t('tower.cases.closedKept')}</p> : null}
        {rows === null ? (
          <p class="cons__empty">{t('tower.queues.loading')}</p>
        ) : rows.length === 0 ? (
          <div class="cons__empty">
            <p class="cons__emptyt">{t(closed ? 'tower.cases.closedEmptyTitle' : 'tower.cases.emptyTitle')}</p>
            <p>{t(closed ? 'tower.cases.closedEmptyBody' : 'tower.cases.emptyBody')}</p>
          </div>
        ) : (
          <div class="crows">
            {rows.map((c) => (
              <button type="button" class="crow" key={c.caseId} aria-pressed={held?.caseId === c.caseId} onClick={() => setHeld(c)}>
                <span class="crow__body">
                  <span class="crow__top">
                    <span class={`ctag ctag--${severityTone(c.severity)}`}>{t(`tower.cases.severity.${c.severity}` as never)}</span>
                    <span class="crow__name">{kindWords(c.kind, t)}</span>
                    <span class="ctbl__mono">{c.subject}</span>
                  </span>
                  <span class="crow__sub">{c.detail}</span>
                  {closed ? (
                    <span class="crow__sub">
                      {c.closedAt ? new Date(c.closedAt).toLocaleString() : ''} · {closedLine(c, t)}
                    </span>
                  ) : (
                    <span class={c.escalatedAt && c.state === 'open' ? 'crow__sub cerr' : 'crow__sub'}>
                      {t('tower.cases.openFor', { time: openFor(c.openHours, t) })} · {ownerLine(c, t)}
                    </span>
                  )}
                </span>
              </button>
            ))}
          </div>
        )}
      </section>

      {state.lostParcels && state.lostParcels.length ? <LostPanel rows={state.lostParcels} state={state} actions={actions} /> : null}

      {open ? <CaseDetail row={open} state={state} actions={actions} onActed={(r) => setHeld({ ...open, ...r })} onClose={() => setHeld(null)} /> : null}
    </>
  );
}

/**
 * DECLARED LOST (the user, 2026-10-18): the parcels lost now, and those found again in the last thirty days. One that
 * turns up is marked found here, with where it was and in whose hands — and carries on from where it was lost.
 */
function LostPanel({ rows, state, actions }: { rows: LostParcelRow[]; state: TowerState; actions: TowerActions }) {
  const t = useT();
  const [finding, setFinding] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const day = (iso: string) => new Date(iso).toLocaleDateString();
  return (
    <section class="cons__panel">
      <div class="cons__panelhead">
        <span class="cons__panelt">{t('tower.lost.title', { n: rows.filter((r) => r.status === 'Lost').length })}</span>
      </div>
      <p class="chint">{t('tower.lost.lede')}</p>
      <div class="crows">
        {rows.map((r) => (
          <div class="crow" key={r.parcelId}>
            <span class="crow__body">
              <span class="crow__top">
                <span class={`ctag ctag--${r.status === 'Lost' ? 'danger' : 'ok'}`}>{t(r.status === 'Lost' ? 'tower.lost.isLost' : 'tower.lost.isFound')}</span>
                <span class="ctbl__mono">{r.parcelId}</span>
                {r.from || r.to ? <span class="ctbl__sub">{[r.from, r.to].filter(Boolean).join(' → ')}</span> : null}
              </span>
              <span class="crow__sub">{lostLine(r, t, day)}</span>
              <span class="crow__sub">{r.status === 'Lost' ? r.reason : r.foundNote}</span>
              {finding === r.parcelId ? (
                <span class="crow__sub" style="display:block;margin-top:8px">
                  <label class="cfield">
                    <span class="cfield__label">{t('tower.lost.foundLabel')}</span>
                    <textarea class="cinput" rows={2} maxLength={300} value={note} onInput={(e) => setNote((e.target as HTMLTextAreaElement).value)} />
                  </label>
                  <span class="twr-panelend">
                    <button
                      type="button"
                      class="cbtn cbtn--primary cbtn--sm"
                      disabled={state.caseBusy === r.parcelId || note.trim().length < 3}
                      onClick={async () => {
                        if (await actions.lostAct(r.parcelId, 'found', note.trim())) {
                          setFinding(null);
                          setNote('');
                        }
                      }}
                    >
                      {t('tower.lost.foundConfirm')}
                    </button>
                    <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => setFinding(null)}>
                      {t('tower.lost.notNow')}
                    </button>
                  </span>
                </span>
              ) : null}
            </span>
            {r.status === 'Lost' && finding !== r.parcelId ? (
              <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => { setFinding(r.parcelId); setNote(''); }}>
                {t('tower.lost.foundCta')}
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}

/** One case: its history, and what can be done with it now — nothing, once it is closed. */
function CaseDetail({ row, state, actions, onActed, onClose }: { row: FlagCaseRow; state: TowerState; actions: TowerActions; onActed: (r: FlagCaseRow) => void; onClose: () => void }) {
  const t = useT();
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [recheck, setRecheck] = useState<number>(24);
  const [closing, setClosing] = useState(false);
  // The search case: what was found decides between closing it and declaring the parcel lost.
  const [declaring, setDeclaring] = useState(false);
  const [looked, setLooked] = useState('');
  const search = row.kind === SEARCH_KIND;
  // Round 35 — a held unit: its case closes only by the release, from the panel below.
  const hold = row.kind === HOLD_KIND;
  const busy = state.caseBusy === row.caseId || state.caseBusy === row.subject;
  const blocker = doneBlocker(reason, recheck, t);
  const live = row.state === 'open' || row.state === 'taken';
  // Every act answers with the case as it now is; that is what stays open here.
  const act = async (what: 'take' | 'let-go' | 'note' | 'done', body?: Record<string, unknown>) => {
    const r = await actions.caseAct(row.caseId, what, body);
    if (r) onActed(r);
    return r;
  };

  return (
    <ConsoleDetail openKey={row.caseId} title={`${kindWords(row.kind, t)} · ${row.subject}`} onClose={onClose}>
      <section class="cons__panel">
        <div class="cons__panelhead">
          <span class={`ctag ctag--${severityTone(row.severity)}`}>{t(`tower.cases.severity.${row.severity}` as never)}</span>
          <span class="ctbl__sub">{live ? ownerLine(row, t) : closedLine(row, t)}</span>
        </div>
        <p>{row.detail}</p>
        {row.follows ? <p class="chint">{t('tower.cases.follows')}</p> : null}
        <ol class="chint" style="padding-left:18px;margin:10px 0">
          {row.history.map((e, i) => (
            <li key={i}>
              <span class="ctbl__sub">{new Date(e.at).toLocaleString()}</span> {eventLine(e, t)}
            </li>
          ))}
        </ol>
        {live ? (
          <div class="twr-panelend">
            {row.state === 'taken' ? (
              <button type="button" class="cbtn cbtn--ghost cbtn--sm" disabled={busy} onClick={() => void act('let-go')}>
                {t('tower.cases.letGo')}
              </button>
            ) : (
              <button type="button" class="cbtn cbtn--primary cbtn--sm" disabled={busy} onClick={() => void act('take')}>
                {t('tower.cases.take')}
              </button>
            )}
            {!hold ? (
              <button type="button" class="cbtn cbtn--ghost cbtn--sm" disabled={busy} onClick={() => setClosing((x) => !x)}>
                {t('tower.cases.closeCta')}
              </button>
            ) : null}
            {search ? (
              <button type="button" class="cbtn cbtn--ghost cbtn--sm" disabled={busy} onClick={() => setDeclaring((x) => !x)}>
                {t('tower.lost.declareCta')}
              </button>
            ) : null}
          </div>
        ) : null}
      </section>

      {hold ? <TamperPanel subject={row.subject} live={live} state={state} actions={actions} onReleased={onClose} /> : null}

      {live && search && declaring ? (
        <section class="cons__panel">
          <p class="chint">{t('tower.lost.declareLede')}</p>
          <label class="cfield">
            <span class="cfield__label">{t('tower.lost.reasonLabel')}</span>
            <textarea class="cinput" rows={3} maxLength={500} value={looked} onInput={(e) => setLooked((e.target as HTMLTextAreaElement).value)} />
          </label>
          {looked && lostReasonBlocker(looked, t) ? <p class="cerr">{lostReasonBlocker(looked, t)}</p> : null}
          <div class="twr-panelend">
            <button
              type="button"
              class="cbtn cbtn--danger cbtn--sm"
              disabled={busy || Boolean(lostReasonBlocker(looked, t))}
              onClick={async () => {
                if (await actions.lostAct(row.subject, 'lost', looked.trim())) onClose();
              }}
            >
              {t('tower.lost.declareConfirm')}
            </button>
          </div>
        </section>
      ) : null}

      {live ? (
        <section class="cons__panel">
          <label class="cfield">
            <span class="cfield__label">{t('tower.cases.noteLabel')}</span>
            <textarea class="cinput" rows={2} maxLength={500} value={note} onInput={(e) => setNote((e.target as HTMLTextAreaElement).value)} />
          </label>
          <div class="twr-panelend">
            <button
              type="button"
              class="cbtn cbtn--ghost cbtn--sm"
              disabled={busy || !note.trim()}
              onClick={async () => {
                if (await act('note', { text: note.trim() })) setNote('');
              }}
            >
              {t('tower.cases.addNote')}
            </button>
          </div>
        </section>
      ) : null}

      {live && closing ? (
        <section class="cons__panel">
          <label class="cfield">
            <span class="cfield__label">{t('tower.cases.reasonLabel')}</span>
            <textarea class="cinput" rows={2} maxLength={500} value={reason} onInput={(e) => setReason((e.target as HTMLTextAreaElement).value)} />
          </label>
          <ConsolePick
            label={t('tower.cases.recheckLabel')}
            value={String(recheck)}
            onChange={(v) => setRecheck(Number(v))}
            options={RECHECK_CHOICES.map((h) => ({ value: String(h), label: t('tower.cases.recheckIn', { when: openFor(h, t) }) }))}
          />
          {reason && blocker ? <p class="cerr">{blocker}</p> : null}
          <div class="twr-panelend">
            <button
              type="button"
              class="cbtn cbtn--primary cbtn--sm"
              disabled={busy || Boolean(blocker)}
              onClick={async () => {
                if (await act('done', { reason: reason.trim(), recheckHours: recheck })) onClose();
              }}
            >
              {t('tower.cases.closeConfirm')}
            </button>
          </div>
        </section>
      ) : null}
    </ConsoleDetail>
  );
}
