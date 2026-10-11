import { useState } from 'preact/hooks';
import { Icon } from '../../../shared/ui';
import { DocumentStrip } from './DocumentStrip';
import { FleetsPanel } from './FleetsPanel';
import { useT } from '../../../shared/i18n';
import {
  CLAIM_SLOW_DAYS,
  DISPOSAL_LONG_DAYS,
  amount,
  claimBlocker,
  coverLine,
  daysWaiting,
  freightCoverLine,
  STALLED_REASON,
  documentsOf,
  missingWords,
  money,
  shelfSlots,
  stuckDays,
  carrierBearsLine,
  stuckLabel,
  type ApprovalRow,
  type ClaimDecision,
  type ClaimRow,
  type DisposalRow,
  type FreightClaimRow,
  type StalledRow,
  type DriverApplication,
} from '../queues';
import type { TowerActions, TowerState } from '../useTowerApp';

/**
 * The three queues where somebody is WAITING FOR A PERSON — migrated from the vanilla tower.
 *
 * They share a file because they share a shape: a list of situations that stop dead until somebody
 * decides, each row carrying what the decision costs and what it is checked against BEFORE it is made.
 * On this side of the console the alternative is finding out from a refusal, which is exactly what the
 * old claims panel did.
 */

/* ------------------------------------------------------------------ evidence -- */

/** The claim's own words for the same strip. Two callers, one implementation. */
function ClaimEvidence({ refs, state, actions }: { refs: string[]; state: TowerState; actions: TowerActions }) {
  return <DocumentStrip refs={refs} state={state} actions={actions} titleKey="tower.claims.evidenceTitle" emptyKey="tower.claims.evidenceNone" />;
}

/* -------------------------------------------------------------------- claims -- */

/**
 * Damage claims. The one screen in this console where a person is waiting for an ANSWER.
 *
 * Oldest first, deliberately: the case somebody has waited longest for is the one that most needs an
 * answer, and a queue sorted newest-first quietly buries exactly those.
 */
export function ClaimsScreen({ state, actions }: { state: TowerState; actions: TowerActions }) {
  const t = useT();
  const rows = state.claims;
  const now = Date.now();

  return (
    <>
      <header class="cons__head">
        <h1 class="cons__title">{t('tower.claims.title')}</h1>
        <p class="cons__lede">{t('tower.claims.lede')}</p>
      </header>

      <p class="cons__caveat">
        <Icon name="warning" size={18} />
        <span>
          <b>{t('tower.claims.caveatLead')}</b> {t('tower.claims.caveat')}
        </span>
      </p>

      <QueuePanel
        count={rows == null && state.freightClaims == null ? null : (rows?.length ?? 0) + (state.freightClaims?.length ?? 0)}
        countLabel={t('tower.claims.count', { n: (rows?.length ?? 0) + (state.freightClaims?.length ?? 0) })}
        state={state}
        actions={actions}
        emptyTitle={t('tower.claims.emptyTitle')}
        emptyBody={t('tower.claims.emptyBody')}
      >
        {rows?.length ? (
          <table class="ctbl ctbl--stack">
            <thead>
              <tr>
                <th>{t('tower.claims.col.claim')}</th>
                <th>{t('tower.claims.col.cover')}</th>
                <th>{t('tower.claims.col.evidence')}</th>
                <th>{t('tower.claims.col.waiting')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <ClaimRowView key={row.parcelId} row={row} now={now} state={state} actions={actions} />
              ))}
            </tbody>
          </table>
        ) : null}
        {/* FP3b — the freight claims, under the parcel ones: same decision, a different answer to "covered for what". */}
        {state.freightClaims?.length ? (
          <>
            <h2 class="cons__panelt" style="margin-top:20px">{t('tower.claims.freightTitle')}</h2>
            <table class="ctbl ctbl--stack">
              <thead>
                <tr>
                  <th>{t('tower.claims.col.claim')}</th>
                  <th>{t('tower.claims.col.cover')}</th>
                  <th>{t('tower.claims.col.evidence')}</th>
                  <th>{t('tower.claims.col.waiting')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {state.freightClaims.map((row) => (
                  <FreightClaimRowView key={row.freightId} row={row} now={now} state={state} actions={actions} />
                ))}
              </tbody>
            </table>
          </>
        ) : null}
      </QueuePanel>
    </>
  );
}

function ClaimRowView({ row, now, state, actions }: { row: ClaimRow; now: number; state: TowerState; actions: TowerActions }) {
  const t = useT();
  const open = state.openId === row.parcelId;
  const waited = daysWaiting(row.raisedAt, now);
  const slow = waited != null && waited >= CLAIM_SLOW_DAYS;

  return (
    <>
      <tr class={open ? 'is-open' : undefined}>
        <td>
          <div class="ctbl__strong">{row.parcelId}</div>
          <div class="ctbl__sub">
            <span class={row.origin === 'buyer' ? 'ctag ctag--warn' : 'ctag ctag--quiet'}>
              {row.origin === 'buyer' ? t('tower.claims.fromBuyer') : t('tower.claims.fromCounter')}
            </span>{' '}
            {row.reason || '—'}
          </div>
        </td>
        <td class="ctbl__sub"><span class="ctbl__lbl">{t('tower.claims.col.cover')}</span>{coverLine(row, t)}</td>
        <td class="ctbl__mono"><span class="ctbl__lbl">{t('tower.claims.col.evidence')}</span>{row.evidence?.length ? t('tower.claims.nPhotos', { n: row.evidence.length }) : t('tower.claims.noEvidence')}</td>
        <td><span class="ctbl__lbl">{t('tower.claims.col.waiting')}</span>
          <div>{waited == null ? '—' : t('tower.wait.days', { n: waited })}</div>
          {slow ? <span class="ctag ctag--warn">{t('tower.claims.slow')}</span> : null}
        </td>
        <td>
          <button type="button" class="cbtn cbtn--ghost cbtn--sm" aria-expanded={open} onClick={() => actions.open(open ? null : row.parcelId)}>
            {open ? t('common.close') : t('tower.claims.decide')}
          </button>
        </td>
      </tr>
      {open ? (
        <tr class="is-open ctbl__editor">
          <td colSpan={5}>
            {/* The evidence FIRST, above the form: look, then decide. */}
            <ClaimEvidence refs={row.evidence ?? []} state={state} actions={actions} />
            <ClaimForm
              id={row.parcelId}
              cap={row}
              body={t('tower.claims.decideBody', { max: amount(row.awardCap, row.currency) })}
              busy={state.busyId === row.parcelId}
              state={state}
              actions={actions}
              onDecide={(decision, award, note) => actions.resolveClaim(row.parcelId, decision, award, note)}
            />
          </td>
        </tr>
      ) : null}
    </>
  );
}

/** FP3b — one freight claim: what the sender says, what the driver recorded, and what it is covered for. */
function FreightClaimRowView({ row, now, state, actions }: { row: FreightClaimRow; now: number; state: TowerState; actions: TowerActions }) {
  const t = useT();
  const open = state.openId === row.freightId;
  const waited = daysWaiting(row.raisedAt, now);
  const slow = waited != null && waited >= CLAIM_SLOW_DAYS;
  const kind = row.kind === 'damaged' ? t('tower.claims.freightDamaged') : row.kind === 'short' ? t('tower.claims.freightShort') : t('tower.claims.freightNotReceived');
  return (
    <>
      <tr class={open ? 'is-open' : undefined}>
        <td>
          <div class="ctbl__strong">
            {row.code} · {row.description}
          </div>
          <div class="ctbl__sub">
            <span class="ctag ctag--warn">{kind}</span> {row.reason}
          </div>
          <div class="ctbl__sub">
            {t('tower.claims.freightParties', { sender: row.senderName, carrier: row.carrierName ?? '—', dest: row.destLabel })}
            {row.receiverName ? ` · ${t('tower.claims.freightReceivedBy', { name: row.receiverName })}` : ''}
            {row.attempts ? ` · ${t('tower.claims.freightAttempts', { n: row.attempts })}` : ''}
          </div>
        </td>
        <td class="ctbl__sub"><span class="ctbl__lbl">{t('tower.claims.col.cover')}</span>
          {freightCoverLine(row, t)}
          {/* FP8 — the other side of an award: the carrier bears it up to the haul's price. Said before deciding. */}
          {carrierBearsLine(row, t) ? <div>{carrierBearsLine(row, t)}</div> : null}
          {/* CL1 — which party owns this loss, and why. An award decided without it is decided blind. */}
          {row.standingWhy ? <div class="ctbl__sub">{row.standingWhy}</div> : null}
        </td>
        <td class="ctbl__mono"><span class="ctbl__lbl">{t('tower.claims.col.evidence')}</span>{row.evidence.length ? t('tower.claims.nPhotos', { n: row.evidence.length }) : t('tower.claims.noEvidence')}</td>
        <td><span class="ctbl__lbl">{t('tower.claims.col.waiting')}</span>
          <div>{waited == null ? '—' : t('tower.wait.days', { n: waited })}</div>
          {slow ? <span class="ctag ctag--warn">{t('tower.claims.slow')}</span> : null}
        </td>
        <td>
          <button type="button" class="cbtn cbtn--ghost cbtn--sm" aria-expanded={open} onClick={() => actions.open(open ? null : row.freightId)}>
            {open ? t('common.close') : t('tower.claims.decide')}
          </button>
        </td>
      </tr>
      {open ? (
        <tr class="is-open ctbl__editor">
          <td colSpan={5}>
            <ClaimEvidence refs={row.evidence ?? []} state={state} actions={actions} />
            <ClaimForm
              id={row.code}
              cap={row}
              body={row.coverable ? t('tower.claims.decideBody', { max: amount(row.awardCap, row.currency) }) : t('tower.claims.freightDecideBodyNoBooks')}
              busy={state.busyId === row.freightId}
              state={state}
              actions={actions}
              onDecide={(decision, award, note) => actions.resolveFreightClaim(row.freightId, decision, award, note)}
            />
          </td>
        </tr>
      ) : null}
    </>
  );
}

/**
 * The decision. Three endings, and every one of them carries a reason — including the rejection, because
 * the claimant is shown it and a person whose goods arrived broken is owed an explanation even when they
 * are not owed money.
 */
function ClaimForm({
  id,
  cap,
  body,
  busy,
  actions,
  state,
  onDecide,
}: {
  id: string;
  cap: { awardCap: number; capBasis: ClaimRow['capBasis'] | 'none'; currency?: string };
  body: string;
  busy: boolean;
  state: TowerState;
  actions: TowerActions;
  onDecide: (decision: ClaimDecision, award: number | undefined, note: string) => void;
}) {
  const t = useT();
  const [award, setAward] = useState('');
  const [note, setNote] = useState('');

  const decide = (decision: ClaimDecision) => {
    const blocker = claimBlocker(decision, award, note, cap, t);
    if (blocker) {
      actions.showQueueError(blocker);
      return;
    }
    onDecide(decision, decision === 'rejected' || !award.trim() ? undefined : Number(award), note);
  };

  return (
    <div class="twr-knobs">
      <p class="twr-clear__t">{t('tower.claims.decideTitle', { parcel: id })}</p>
      <p class="twr-clear__b">{body}</p>

      <div class="twr-knobs__row">
        <div class="twr-knob">
          <label class="cfield">
            <span class="cfield__label">{t('tower.claims.award', { currency: cap.currency ? ` (${cap.currency})` : '' })}</span>
            <input class="cinput" inputMode="decimal" value={award} onInput={(e) => setAward((e.target as HTMLInputElement).value)} />
            <span class="chint">{t('tower.claims.awardHint')}</span>
          </label>
        </div>
        <div class="twr-knob">
          <label class="cfield">
            <span class="cfield__label">{t('tower.claims.reason')}</span>
            <textarea class="ctextarea" value={note} maxLength={400} onInput={(e) => setNote((e.target as HTMLTextAreaElement).value)} />
            <span class="chint">{t('tower.claims.reasonHint')}</span>
          </label>
        </div>
      </div>

      {state.queueError ? <p class="cerr">{state.queueError}</p> : null}

      <div class="twr-clear__act">
        <button type="button" class="cbtn cbtn--primary" disabled={busy} onClick={() => decide('upheld')}>
          {t('tower.claims.uphold')}
        </button>
        <button type="button" class="cbtn cbtn--ghost" disabled={busy} onClick={() => decide('partly_upheld')}>
          {t('tower.claims.partly')}
        </button>
        <button type="button" class="cbtn cbtn--danger" disabled={busy} onClick={() => decide('rejected')}>
          {t('tower.claims.reject')}
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ disposal -- */

/**
 * Parcels nobody claimed and nobody is paying to recover.
 *
 * A QUEUE and not a status, because what happens to them is decided by the law of the sister's
 * jurisdiction rather than by this system. Modelling a disposal rule we do not know would be worse than
 * showing an operator the list and letting them apply the one they do — so the screen stops at "here they
 * are, and here is what closing one costs", and a person decides.
 */
export function DisposalScreen({ state, actions }: { state: TowerState; actions: TowerActions }) {
  const t = useT();
  const rows = state.disposal;

  return (
    <>
      <header class="cons__head">
        <h1 class="cons__title">{t('tower.disposal.title')}</h1>
        <p class="cons__lede">{t('tower.disposal.lede')}</p>
      </header>

      <p class="cons__caveat">
        <Icon name="box" size={18} />
        <span>
          <b>{t('tower.disposal.caveatLead')}</b> {t('tower.disposal.caveat')}
        </span>
      </p>

      <QueuePanel
        count={rows?.length ?? null}
        countLabel={t('tower.disposal.count', { n: rows?.length ?? 0 })}
        state={state}
        actions={actions}
        emptyTitle={t('tower.disposal.emptyTitle')}
        emptyBody={t('tower.disposal.emptyBody')}
      >
        {rows?.length ? (
          <table class="ctbl ctbl--stack">
            <thead>
              <tr>
                <th>{t('tower.disposal.col.parcel')}</th>
                <th>{t('tower.disposal.col.where')}</th>
                <th class="ctbl__num">{t('tower.disposal.col.worth')}</th>
                <th class="ctbl__num">{t('tower.disposal.col.owed')}</th>
                <th>{t('tower.disposal.col.held')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <DisposalRowView key={row.parcelId} row={row} state={state} actions={actions} />
              ))}
            </tbody>
          </table>
        ) : null}
      </QueuePanel>
    </>
  );
}

function DisposalRowView({ row, state, actions }: { row: DisposalRow; state: TowerState; actions: TowerActions }) {
  const t = useT();
  const open = state.openId === row.parcelId;
  const long = row.heldDays >= DISPOSAL_LONG_DAYS;

  return (
    <>
      <tr class={open ? 'is-open' : undefined}>
        <td class="ctbl__strong">{row.parcelId}</td>
        {/* A NAME, not the DID this column used to print — the operator reads it to know whose shelf this is
            and who is owed. Where the server cannot name one, it says so rather than showing the key. */}
        <td class="ctbl__strong"><span class="ctbl__lbl">{t('tower.disposal.col.where')}</span>{row.shopName ?? t('tower.disposal.unknownShop')}</td>
        <td class="ctbl__num"><span class="ctbl__lbl">{t('tower.disposal.col.worth')}</span>{row.declaredValue != null ? money(row.declaredValue) : '—'}</td>
        <td class="ctbl__num ctbl__strong"><span class="ctbl__lbl">{t('tower.disposal.col.owed')}</span>{money(row.owedToShop)}</td>
        <td><span class="ctbl__lbl">{t('tower.disposal.col.held')}</span>
          <div>{t('tower.wait.days', { n: row.heldDays })}</div>
          {long ? <span class="ctag ctag--warn">{t('tower.disposal.longHeld')}</span> : null}
        </td>
        <td>
          <button type="button" class="cbtn cbtn--ghost cbtn--sm" aria-expanded={open} onClick={() => actions.open(open ? null : row.parcelId)}>
            {open ? t('common.close') : t('tower.disposal.close')}
          </button>
        </td>
      </tr>
      {open ? (
        <tr class="is-open ctbl__editor">
          <td colSpan={6}>
            <DisposalForm row={row} state={state} actions={actions} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

function DisposalForm({ row, state, actions }: { row: DisposalRow; state: TowerState; actions: TowerActions }) {
  const t = useT();
  const [reason, setReason] = useState('');
  const busy = state.busyId === row.parcelId;

  return (
    <div class="twr-clear">
      <p class="twr-clear__t">{t('tower.disposal.closeTitle', { parcel: row.parcelId })}</p>
      <p class="twr-clear__b">{t('tower.disposal.closeBody', { amount: amount(row.owedToShop, row.currency) })}</p>

      <label class="cfield">
        <span class="cfield__label">{t('tower.disposal.reason')}</span>
        <textarea class="ctextarea" value={reason} maxLength={300} placeholder={t('tower.disposal.reasonPlaceholder')} onInput={(e) => setReason((e.target as HTMLTextAreaElement).value)} />
        <span class="chint">{t('tower.disposal.reasonHint')}</span>
      </label>

      {state.queueError ? <p class="cerr">{state.queueError}</p> : null}

      <div class="twr-clear__act">
        <button
          type="button"
          class="cbtn cbtn--danger"
          disabled={busy || !reason.trim()}
          onClick={() => void actions.closeDisposal(row.parcelId, reason)}
        >
          {t('tower.disposal.confirm')}
        </button>
        <button type="button" class="cbtn cbtn--ghost" disabled={busy} onClick={() => actions.open(null)}>
          {t('tower.disposal.keep')}
        </button>
        {!reason.trim() ? <span class="chint">{t('tower.disposal.needReason')}</span> : null}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- approvals -- */

/** Shops waiting to be let onto the network — the KYC queue, where the network decides who carries for it. */
export function ApprovalsScreen({ state, actions }: { state: TowerState; actions: TowerActions }) {
  const t = useT();
  const rows = state.approvals;

  return (
    <>
      <header class="cons__head">
        <h1 class="cons__title">{t('tower.approvals.title')}</h1>
        <p class="cons__lede">{t('tower.approvals.lede')}</p>
      </header>

      <QueuePanel
        count={rows?.length ?? null}
        countLabel={t('tower.approvals.count', { n: rows?.length ?? 0 })}
        state={state}
        actions={actions}
        emptyTitle={t('tower.approvals.emptyTitle')}
        emptyBody={t('tower.approvals.emptyBody')}
      >
        {rows?.length ? (
          <table class="ctbl ctbl--stack">
            <thead>
              <tr>
                <th>{t('tower.approvals.col.shop')}</th>
                <th class="ctbl__num">{t('tower.approvals.col.shelf')}</th>
                <th>{t('tower.approvals.col.kit')}</th>
                <th>{t('tower.approvals.col.docs')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <ApprovalRowView key={row.did} row={row} state={state} actions={actions} />
              ))}
            </tbody>
          </table>
        ) : null}
      </QueuePanel>

      <DriverApplicationsPanel state={state} actions={actions} />

      <FleetsPanel state={state} actions={actions} />

      <StalledPanel rows={state.stalled} />
    </>
  );
}

/**
 * HEAVY-REGISTRY DRIVERS WAITING TO BE VETTED — the queue that had no screen.
 *
 * `GET fleet/drivers/kyc-queue` has existed on the server the whole time and nothing in any console read
 * it, so a driver who uploaded an ID and a licence copy sat in KYC_PENDING with nobody able to look: the
 * documents were submitted, the decision route was live, and there was no surface between them. The
 * sandbox had one waiting since the 9th of August.
 *
 * It belongs on this screen because this is the screen about people joining, and it is a real queue —
 * somebody is waiting on US — so it sits above the chase list rather than below it.
 *
 * THE DOCUMENTS ARE THE POINT. A vetting decision taken without looking at the licence is a rubber stamp,
 * and the one thing it guards is whether this person may legally drive.
 */
function DriverApplicationsPanel({ state, actions }: { state: TowerState; actions: TowerActions }) {
  const t = useT();
  const rows = state.driverApplications;

  return (
    <section class="cons__panel">
      <div class="cons__panelhead">
        <span class="cons__panelt">{t('tower.drivers.title')}</span>
        {/* Null is "not read yet" and must never render as a zero. */}
        {rows === null ? null : <span class="ctbl__sub">{t('tower.drivers.count', { n: rows.length })}</span>}
      </div>
      <p class="cons__lede">{t('tower.drivers.lede')}</p>
      {rows === null ? (
        <p class="cons__empty">{t('tower.drivers.loading')}</p>
      ) : rows.length === 0 ? (
        <p class="cons__empty">{t('tower.drivers.none')}</p>
      ) : (
        <table class="ctbl ctbl--stack">
          <thead>
            <tr>
              <th>{t('tower.drivers.col.driver')}</th>
              <th>{t('tower.drivers.col.licence')}</th>
              <th>{t('tower.drivers.col.papers')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <DriverApplicationRow key={row.did} row={row} state={state} actions={actions} />
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function DriverApplicationRow({ row, state, actions }: { row: DriverApplication; state: TowerState; actions: TowerActions }) {
  const t = useT();
  const busy = state.busyId === row.did;
  const [why, setWhy] = useState<string | null>(null);
  /*
   * THE RECORD CHECK, TICKED BY THE PERSON WHO DID IT.
   *
   * A fleet asserts this when it registers its own driver, so a fleet applicant arrives with it already
   * true. NOBODY asserts it for a courier who registered themselves — and approval is blocked without it,
   * which left the independent path permanently closed with no control anywhere to open it. It is not
   * something the applicant may tick: a self-declared clear record is not a check.
   */
  const [cleared, setCleared] = useState(false);
  const needsRecord = !row.criminalRecordClear;
  const refs = [row.kyc?.licenceCopyRef, row.kyc?.idCopyRef].filter((x): x is string => Boolean(x));

  return (
    <>
      <tr>
        <td>
          <div class="ctbl__strong">{row.displayName}</div>
          <div class="ctbl__sub">
            {row.registry} · {row.jurisdiction ?? '—'}
            {row.criminalRecordClear ? '' : ` · ${t('tower.drivers.recordNotClear')}`}
          </div>
        </td>
        <td class="ctbl__sub"><span class="ctbl__lbl">{t('tower.drivers.col.licence')}</span>
          <div class="ctbl__mono">{row.licence?.number ?? '—'}</div>
          <div>{row.licence?.expiresAt ? row.licence.expiresAt.slice(0, 10) : t('tower.papers.noDate')}</div>
        </td>
        <td class="ctbl__sub"><span class="ctbl__lbl">{t('tower.drivers.col.papers')}</span>{row.kyc?.submittedAt ? t('tower.drivers.sent', { date: row.kyc.submittedAt.slice(0, 10) }) : t('tower.drivers.noPapers')}</td>
        <td>
          {needsRecord ? (
            <label class="cfield cfield--check">
              <input type="checkbox" checked={cleared} onChange={(e) => setCleared((e.target as HTMLInputElement).checked)} />
              <span>{t('tower.drivers.recordCleared')}</span>
            </label>
          ) : null}
          <span class="twr-clear__act">
            <button
              type="button"
              class="cbtn cbtn--primary cbtn--sm"
              disabled={busy || (needsRecord && !cleared)}
              onClick={() => void actions.decideDriver(row.did, true, undefined, cleared)}
            >
              {t('tower.approvals.approve')}
            </button>
            <button type="button" class="cbtn cbtn--ghost cbtn--sm" disabled={busy} aria-expanded={why != null} onClick={() => setWhy(why == null ? '' : null)}>
              {t('tower.approvals.refuse')}
            </button>
          </span>
        </td>
      </tr>
      <tr class="ctbl__editor">
        <td colSpan={4}>
          {/* The papers themselves, open on the row rather than behind a tap: this decision should not be
              possible to take without having looked, and a click to reveal is a click people skip. */}
          <DocumentStrip refs={refs} state={state} actions={actions} emptyKey="tower.drivers.nothingToSee" titleKey="tower.drivers.whatTheySent" />
          {why != null ? (
            <>
              <label class="cfield">
                <span class="cfield__label">{t('tower.drivers.whyLabel')}</span>
                <textarea class="ctextarea" rows={2} value={why} disabled={busy} onInput={(e) => setWhy((e.target as HTMLTextAreaElement).value)} />
              </label>
              <span class="twr-clear__act">
                <button
                  type="button"
                  class="cbtn cbtn--danger cbtn--sm"
                  disabled={busy || !why.trim()}
                  onClick={() => {
                    void actions.decideDriver(row.did, false, why.trim());
                    setWhy(null);
                  }}
                >
                  {t('tower.approvals.refuseConfirm')}
                </button>
                <button type="button" class="cbtn cbtn--ghost cbtn--sm" disabled={busy} onClick={() => setWhy(null)}>
                  {t('common.close')}
                </button>
              </span>
            </>
          ) : null}
        </td>
      </tr>
    </>
  );
}

/**
 * THE SHOPS NOBODY IS CHASING — the second half of this screen, and deliberately not a queue.
 *
 * The queue above is decisions we owe. This is people who are waiting on THEMSELVES: a shop that
 * registered and never sent its documents, or one we approved that never funded its float. They are on
 * this screen because it is the screen about shops joining, and they are below the queue, without a
 * count in the rail or a badge on the bar, because nothing here is waiting on network staff.
 *
 * Every row is a phone call, so every row carries what that call is about: how long they have been
 * stuck, why, and exactly which documents are missing.
 */
function StalledPanel({ rows }: { rows: StalledRow[] | null }) {
  const t = useT();
  const now = Date.now();

  return (
    <section class="cons__panel twr-stalled">
      <div class="cons__panelhead">
        <span class="cons__panelt">{t('tower.stalled.title')}</span>
        {/* Null is "not read", and it must not be rendered as a zero. */}
        {rows === null ? null : <span class="ctbl__sub">{t('tower.stalled.count', { n: rows.length })}</span>}
      </div>

      <p class="twr-stalled__note">{t('tower.stalled.lede')}</p>

      {rows === null ? (
        <p class="cons__empty">{t('tower.queues.loading')}</p>
      ) : rows.length === 0 ? (
        <div class="cons__empty">
          <p class="cons__emptyt">{t('tower.stalled.emptyTitle')}</p>
          <p>{t('tower.stalled.emptyBody')}</p>
        </div>
      ) : (
        <table class="ctbl ctbl--stack">
          <thead>
            <tr>
              <th>{t('tower.stalled.col.shop')}</th>
              <th class="ctbl__num">{t('tower.stalled.col.stuck')}</th>
              <th>{t('tower.stalled.col.why')}</th>
              <th>{t('tower.stalled.col.missing')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.did}>
                <td>
                  <div class="ctbl__strong">{row.shopName || row.did}</div>
                  <div class="ctbl__sub">{row.zone || '—'}</div>
                </td>
                <td class="ctbl__num"><span class="ctbl__lbl">{t('tower.stalled.col.stuck')}</span>{stuckLabel(stuckDays(row.since, now), t)}</td>
                <td class="ctbl__sub"><span class="ctbl__lbl">{t('tower.stalled.col.why')}</span>
                  {t(STALLED_REASON[row.reason] ?? 'tower.stalled.reason.documents')}
                  {/* What WE said, on a shop we turned down — so whoever rings them is not guessing. */}
                  {row.rejectedWhy ? <div>{t('tower.stalled.rejectedWhy', { why: row.rejectedWhy })}</div> : null}
                  {/* THE LOOSE END ITSELF. A row that says this is one where somebody is waiting on a
                      message we have not sent — which is the state this whole list used to be in. */}
                  {row.told === false ? <span class="ctag ctag--warn">{t('tower.stalled.notTold')}</span> : null}
                </td>
                <td class="ctbl__sub"><span class="ctbl__lbl">{t('tower.stalled.col.missing')}</span>
                  {/* An approved shop that never topped up is missing no documents at all, and an empty
                      cell there would read as "not loaded" rather than as "nothing outstanding". */}
                  {row.missing.length ? missingWords(row.missing, t) : t('tower.stalled.nothingMissing')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function ApprovalRowView({ row, state, actions }: { row: ApprovalRow; state: TowerState; actions: TowerActions }) {
  const t = useT();
  const busy = state.busyId === row.did;
  const docs = documentsOf(row);
  // Refusing asks WHY before it will go through — the applicant is shown this sentence, and it is the only
  // thing that tells them what to fix. Approving needs no form: nothing about a yes needs explaining to
  // somebody who just got in.
  const [why, setWhy] = useState<string | null>(null);

  return (
    <>
    <tr>
      <td>
        <div class="ctbl__strong">{row.shopName ?? t('tower.network.unnamedShop')}</div>
        <div class="ctbl__sub">{row.zone ?? '—'}</div>
      </td>
      <td class="ctbl__num"><span class="ctbl__lbl">{t('tower.approvals.col.shelf')}</span>{t('tower.approvals.slots', { n: shelfSlots(row) })}</td>
      <td class="ctbl__sub"><span class="ctbl__lbl">{t('tower.approvals.col.kit')}</span>
        {t('tower.approvals.android', { version: row.requirements?.androidVersion ?? '—' })} ·{' '}
        {t('tower.approvals.licence', { licence: row.requirements?.tradingLicence ?? '—' })}
      </td>
      <td class="ctbl__mono"><span class="ctbl__lbl">{t('tower.approvals.col.docs')}</span>
        {/* An application with NO documents is a different decision from one with three, and the screen
            says which it is rather than rendering an empty cell that reads as "not loaded". */}
        {docs.length ? t('tower.approvals.nDocs', { n: docs.length }) : t('tower.approvals.noDocs')}
      </td>
      <td>
        <span class="twr-clear__act">
          <button type="button" class="cbtn cbtn--primary cbtn--sm" disabled={busy} onClick={() => void actions.decideApproval(row.did, true)}>
            {t('tower.approvals.approve')}
          </button>
          <button type="button" class="cbtn cbtn--ghost cbtn--sm" disabled={busy} aria-expanded={why != null} onClick={() => setWhy(why == null ? '' : null)}>
            {t('tower.approvals.refuse')}
          </button>
        </span>
      </td>
    </tr>
    {why != null ? (
      <tr class="is-open ctbl__editor">
        <td colSpan={5}>
          <label class="cfield">
            <span class="cfield__label">{t('tower.approvals.whyLabel')}</span>
            <textarea class="ctextarea" rows={2} value={why} disabled={busy} onInput={(e) => setWhy((e.target as HTMLTextAreaElement).value)} />
          </label>
          <p class="chint">{t('tower.approvals.whyHint')}</p>
          <span class="twr-clear__act">
            <button
              type="button"
              class="cbtn cbtn--danger cbtn--sm"
              disabled={busy || !why.trim()}
              onClick={() => {
                void actions.decideApproval(row.did, false, why.trim());
                setWhy(null);
              }}
            >
              {t('tower.approvals.refuseConfirm')}
            </button>
            <button type="button" class="cbtn cbtn--ghost cbtn--sm" disabled={busy} onClick={() => setWhy(null)}>
              {t('common.close')}
            </button>
          </span>
        </td>
      </tr>
    ) : null}
    </>
  );
}

/* ------------------------------------------------------------------- shared -- */

/** The panel every queue sits in: a count, a refresh, what just happened, and an honest empty state. */
function QueuePanel({
  count,
  countLabel,
  state,
  actions,
  emptyTitle,
  emptyBody,
  children,
}: {
  count: number | null;
  countLabel: string;
  state: TowerState;
  actions: TowerActions;
  emptyTitle: string;
  emptyBody: string;
  children: preact.ComponentChildren;
}) {
  const t = useT();
  return (
    <section class="cons__panel">
      <div class="cons__panelhead">
        <span class="cons__panelt">{countLabel}</span>
        <span class="twr-panelend">
          {state.readAt ? <span class="ctbl__sub">{t('tower.hazards.updatedAt', { time: new Date(state.readAt).toLocaleTimeString() })}</span> : null}
          <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => void actions.refresh()} disabled={state.loading}>
            <Icon name="refresh" size={16} />
            {t('tower.hazards.refresh')}
          </button>
        </span>
      </div>

      {state.done ? (
        <p class="twr-done">
          <Icon name="check" size={16} />
          {state.done}
        </p>
      ) : null}

      {state.error ? (
        <p class="cerr" style="margin:12px 0">
          <b>{t('tower.queues.failedTitle')}</b> — {state.error.detail || state.error.title}
        </p>
      ) : null}

      {count === null ? (
        <p class="cons__empty">{t('tower.queues.loading')}</p>
      ) : count === 0 ? (
        <div class="cons__empty">
          <p class="cons__emptyt">{emptyTitle}</p>
          <p>{emptyBody}</p>
        </div>
      ) : (
        children
      )}
    </section>
  );
}
