import { useCallback, useEffect, useState } from 'preact/hooks';
import { useT } from '../../../shared/i18n';
import { ConsoleDetail } from '../ConsoleDetail';
import { MOVE_LABEL, MOVE_TONE, endedWords, idWords, isOpen, moveStep, moveSub, moveWarnings, roleLines, type MoveRow } from '../accountMoves';
import type { TowerActions, TowerState } from '../useTowerApp';

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/**
 * ACCOUNT MOVES — somebody with no number, no PIN and no inbox they can read has asked for their account to be moved
 * to a new number, and it takes two of us.
 *
 * The user, 2026-10-01: "2 seebuyget staff can move an account." One member of staff checks who is asking and writes
 * down what they checked; a second, different one approves, and the account moves. Either may refuse, with a reason
 * the person reads against their reference.
 *
 * It is also exactly what somebody after another person's account would ask for. So a request opens on what there is
 * to check the asker against and on whatever speaks against them — the account's PIN used since it was asked, an ID
 * that differs — before it offers anything to press.
 */
export function AccountMovesScreen({ state, actions }: { state: TowerState; actions: TowerActions }) {
  const t = useT();
  const rows = state.accountMoves;
  const [open, setOpen] = useState<string | null>(null);
  const waiting = rows?.filter(isOpen) ?? [];
  const rest = rows?.filter((r) => !isOpen(r)) ?? [];

  return (
    <>
      <header class="cons__head">
        <h1 class="cons__title">{t('tower.moves.title')}</h1>
        <p class="cons__lede">{t('tower.moves.lede')}</p>
      </header>

      <section class="cons__panel">
        <div class="cons__panelhead">
          <span class="cons__panelt">{t('tower.moves.waitingTitle')}</span>
          {rows ? <span class="chint">{t('tower.moves.waitingCount', { n: waiting.length })}</span> : null}
        </div>
        {rows === null ? <p class="cons__empty">{t('tower.imports.loading')}</p> : waiting.length === 0 ? <p class="cons__empty">{t('tower.moves.waitingNone')}</p> : <Rows rows={waiting} onOpen={setOpen} />}
      </section>

      {rest.length ? (
        <section class="cons__panel">
          <div class="cons__panelhead">
            <span class="cons__panelt">{t('tower.moves.doneTitle')}</span>
            <span class="chint">{t('tower.moves.doneCount', { n: rest.length })}</span>
          </div>
          <Rows rows={rest} onOpen={setOpen} />
        </section>
      ) : null}

      {open ? <MoveDetail moveId={open} state={state} actions={actions} onClose={() => setOpen(null)} /> : null}
    </>
  );
}

function Rows({ rows, onOpen }: { rows: MoveRow[]; onOpen: (moveId: string) => void }) {
  const t = useT();
  return (
    <div class="crows">
      {rows.map((r) => (
        <button type="button" class="crow" key={r.moveId} onClick={() => onOpen(r.moveId)}>
          <span class="crow__body">
            <span class="crow__top">
              <span class="crow__name">{r.reference}</span>
              <span class={`ctag ctag--${MOVE_TONE[r.state]}`}>{t(MOVE_LABEL[r.state])}</span>
            </span>
            <span class="crow__sub">{moveSub(r, t)}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

function MoveDetail({ moveId, state, actions, onClose }: { moveId: string; state: TowerState; actions: TowerActions; onClose: () => void }) {
  const t = useT();
  const client = actions.client();
  const me = state.who?.name;
  const [row, setRow] = useState<MoveRow | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [what, setWhat] = useState('');
  const [reason, setReason] = useState('');

  // The account behind a request is read one request at a time: it is somebody's, and the list does not carry it.
  const load = useCallback(async () => {
    if (!client) return;
    const r = await client.api.accountMove(moveId);
    if (r.error || !r.data) return setError(r.error?.detail || r.error?.title || t('tower.moves.unread'));
    setRow(r.data as unknown as MoveRow);
  }, [client, moveId]);

  useEffect(() => {
    setRow(null);
    setError(null);
    setWhat('');
    setReason('');
    void load();
  }, [load]);

  const act = async (key: string, fn: () => Promise<{ data?: unknown; error?: { detail?: string; title?: string } | null }>) => {
    setBusy(key);
    setError(null);
    const r = await fn();
    setBusy(null);
    // A refusal may itself have ended the request (its PIN was used since): read it again either way.
    if (r.error) setError(r.error.detail || r.error.title || null);
    await load();
    await actions.refresh();
    return !r.error;
  };

  if (!row) {
    return (
      <ConsoleDetail openKey={moveId} title={t('tower.moves.title')} onClose={onClose}>
        {error ? <p class="cerr">{error}</p> : <p class="cons__empty">{t('tower.imports.loading')}</p>}
      </ConsoleDetail>
    );
  }
  const step = moveStep(row, me);
  const warnings = moveWarnings(row, t, when);
  const a = row.account;

  return (
    <ConsoleDetail openKey={moveId} title={row.reference} onClose={onClose}>
      <section class="cons__panel">
        <div class="cons__panelhead">
          <span class="cons__panelt">{row.reference}</span>
          <span class={`ctag ctag--${MOVE_TONE[row.state]}`}>{t(MOVE_LABEL[row.state])}</span>
        </div>
        <dl class="cons__facts">
          <Fact k={t('tower.moves.fact.asked')} v={when(row.askedAt)} />
          {isOpen(row) ? <Fact k={t('tower.moves.fact.lapses')} v={when(row.lapsesAt)} /> : null}
          <Fact k={t('tower.moves.fact.from')} v={t('tower.moves.fact.ends', { ends: row.oldEnds })} />
          <Fact k={t('tower.moves.fact.to')} v={t('tower.moves.fact.endsProved', { ends: row.newEnds })} />
          <Fact k={t('tower.moves.fact.id')} v={idWords(row, t)} />
          {row.note ? <Fact k={t('tower.moves.fact.note')} v={row.note} /> : null}
          {row.checkedBy ? <Fact k={t('tower.moves.fact.checked')} v={t('tower.moves.fact.checkedBy', { who: row.checkedBy, when: row.checkedAt ? when(row.checkedAt) : '' })} hint={row.checkedWhat} /> : null}
          {!isOpen(row) ? <Fact k={t('tower.moves.fact.ended')} v={endedWords(row, t, when)} hint={row.reason} /> : null}
        </dl>
        <p class="chint">{t('tower.moves.numbersHint')}</p>
      </section>

      <section class="cons__panel">
        <div class="cons__panelhead">
          <span class="cons__panelt">{t('tower.moves.accountTitle')}</span>
        </div>
        {!row.namesAccount ? (
          <p class="cons__caveat">{t('tower.moves.noAccount')}</p>
        ) : a ? (
          <>
            <dl class="cons__facts">
              <Fact k={t('tower.moves.fact.who')} v={roleLines(a, t).join(' · ')} />
              <Fact k={t('tower.moves.fact.since')} v={a.since.slice(0, 10)} />
              <Fact k={t('tower.moves.fact.idOnRecord')} v={t(a.nationalIdOnRecord ? 'tower.moves.fact.idYes' : 'tower.moves.fact.idNo')} />
              <Fact k={t('tower.moves.fact.email')} v={a.email ?? t('tower.moves.fact.emailNone')} />
              <Fact k={t('tower.moves.fact.pin')} v={t(a.hasPin ? 'tower.moves.fact.pinYes' : 'tower.moves.fact.pinNo')} />
            </dl>
            {/* What speaks against moving it, before anything to press. */}
            {warnings.map((w) => (
              <p class={w.tone === 'danger' ? 'cerr' : 'cons__caveat'} key={w.text}>
                {w.text}
              </p>
            ))}
          </>
        ) : null}
      </section>

      {isOpen(row) ? (
        <section class="cons__panel">
          <div class="cons__panelhead">
            <span class="cons__panelt">{t('tower.moves.decideTitle')}</span>
          </div>
          {step === 'check' ? (
            <>
              <p class="cons__lede">{t('tower.moves.checkLede')}</p>
              <label class="cfield">
                <span class="cfield__label">{t('tower.moves.checkWhat')}</span>
                <textarea class="cinput" rows={3} maxLength={500} value={what} onInput={(e) => setWhat((e.target as HTMLTextAreaElement).value)} />
                <span class="chint">{t('tower.moves.checkHint')}</span>
              </label>
              <div class="twr-panelend">
                <button type="button" class="cbtn cbtn--primary" disabled={busy !== null || !what.trim()} onClick={() => void act('check', () => client!.api.checkAccountMove(row.moveId, what.trim(), me) as never)}>
                  {t('tower.moves.checkCta')}
                </button>
              </div>
            </>
          ) : null}
          {step === 'approve' ? (
            <>
              <p class="cons__lede">{t('tower.moves.approveLede', { who: row.checkedBy ?? '', ends: row.newEnds })}</p>
              <div class="twr-panelend">
                <button type="button" class="cbtn cbtn--primary" disabled={busy !== null} onClick={() => void act('approve', () => client!.api.approveAccountMove(row.moveId, me) as never)}>
                  {t('tower.moves.approveCta')}
                </button>
              </div>
            </>
          ) : null}
          {/* The one who checked it is told the approval is somebody else's — not invited to give it. */}
          {step === 'other' ? <p class="cons__caveat">{t('tower.moves.otherApproves')}</p> : null}
          {error ? <p class="cerr">{error}</p> : null}
          <label class="cfield" style="margin-top:12px">
            <span class="cfield__label">{t('tower.moves.refuseWhy')}</span>
            <input class="cinput" maxLength={500} value={reason} onInput={(e) => setReason((e.target as HTMLInputElement).value)} />
            <span class="chint">{t('tower.moves.refuseHint')}</span>
          </label>
          <div class="twr-panelend">
            <button
              type="button"
              class="cbtn cbtn--danger"
              disabled={busy !== null || !reason.trim()}
              onClick={async () => {
                if (await act('refuse', () => client!.api.refuseAccountMove(row.moveId, reason.trim(), me) as never)) setReason('');
              }}
            >
              {t('tower.moves.refuseCta')}
            </button>
          </div>
        </section>
      ) : error ? (
        <p class="cerr">{error}</p>
      ) : null}
    </ConsoleDetail>
  );
}

function Fact({ k, v, hint }: { k: string; v: string; hint?: string }) {
  return (
    <div class="cons__fact">
      <dt class="cons__factk">{k}</dt>
      <dd class="cons__factv">
        {v}
        {hint ? <span class="chint">{hint}</span> : null}
      </dd>
    </div>
  );
}
