import { useCallback, useEffect, useState } from 'preact/hooks';
import { useT } from '../../../shared/i18n';
import { ConsoleDetail } from '../ConsoleDetail';
import {
  DISPUTE_LABEL,
  DISPUTE_TONE,
  cardWords,
  decidedWords,
  disputeNotes,
  disputeStep,
  disputeSub,
  finalWords,
  mayPropose,
  photoRefs,
  waitsOnThem,
  waitsOnUs,
  type DisputeParty,
  type DisputeRow,
  type DisputeSide,
} from '../idDisputes';
import type { TowerActions, TowerState } from '../useTowerApp';
import { DocumentStrip } from './DocumentStrip';

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const dayOf = (iso: string) => new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString(undefined, { dateStyle: 'medium' });

/**
 * ID DISPUTES — two people say one national ID is theirs, and it takes two of us to say whose.
 *
 * The user, 2026-10-08: staff see "a selfie with the holder showing it's ID back and front"; "staff decide from the
 * photos, if that is still disputed they can make an appointment in person."
 *
 * The photographs of both are side by side, with the reference each should be holding in theirs. A member of staff
 * types the number they read on a card and is told only whether it is the disputed one. One says whose it is and
 * why; a second, different one approves — and only then does anything change for anybody.
 */
export function IdDisputesScreen({ state, actions }: { state: TowerState; actions: TowerActions }) {
  const t = useT();
  const rows = state.idDisputes;
  const [open, setOpen] = useState<string | null>(null);
  const ours = rows?.filter((r) => waitsOnUs(r)) ?? [];
  const theirs = rows?.filter((r) => waitsOnThem(r)) ?? [];
  const rest = rows?.filter((r) => !waitsOnUs(r) && !waitsOnThem(r)) ?? [];

  return (
    <>
      <header class="cons__head">
        <h1 class="cons__title">{t('tower.ids.title')}</h1>
        <p class="cons__lede">{t('tower.ids.lede')}</p>
      </header>

      <section class="cons__panel">
        <div class="cons__panelhead">
          <span class="cons__panelt">{t('tower.moves.waitingTitle')}</span>
          {rows ? <span class="chint">{t('tower.moves.waitingCount', { n: ours.length })}</span> : null}
        </div>
        {rows === null ? <p class="cons__empty">{t('tower.imports.loading')}</p> : ours.length === 0 ? <p class="cons__empty">{t('tower.ids.waitingNone')}</p> : <Rows rows={ours} onOpen={setOpen} />}
      </section>

      {theirs.length ? (
        <section class="cons__panel">
          <div class="cons__panelhead">
            <span class="cons__panelt">{t('tower.ids.theirsTitle')}</span>
            <span class="chint">{t('tower.moves.doneCount', { n: theirs.length })}</span>
          </div>
          <Rows rows={theirs} onOpen={setOpen} />
        </section>
      ) : null}

      {rest.length ? (
        <section class="cons__panel">
          <div class="cons__panelhead">
            <span class="cons__panelt">{t('tower.ids.doneTitle')}</span>
            <span class="chint">{t('tower.moves.doneCount', { n: rest.length })}</span>
          </div>
          <Rows rows={rest} onOpen={setOpen} />
        </section>
      ) : null}

      {open ? <Detail disputeId={open} state={state} actions={actions} onClose={() => setOpen(null)} /> : null}
    </>
  );
}

function Rows({ rows, onOpen }: { rows: DisputeRow[]; onOpen: (disputeId: string) => void }) {
  const t = useT();
  return (
    <div class="crows">
      {rows.map((r) => (
        <button type="button" class="crow" key={r.disputeId} onClick={() => onOpen(r.disputeId)}>
          <span class="crow__body">
            <span class="crow__top">
              <span class="crow__name">{r.reference}</span>
              <span class={`ctag ctag--${DISPUTE_TONE[r.state]}`}>{t(DISPUTE_LABEL[r.state])}</span>
            </span>
            <span class="crow__sub">{disputeSub(r, t)}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

function Detail({ disputeId, state, actions, onClose }: { disputeId: string; state: TowerState; actions: TowerActions; onClose: () => void }) {
  const t = useT();
  const client = actions.client();
  const me = state.who?.name;
  const [row, setRow] = useState<DisputeRow | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [to, setTo] = useState<DisputeSide | null>(null);
  const [what, setWhat] = useState('');
  const [reason, setReason] = useState('');
  const [why, setWhy] = useState('');
  const [came, setCame] = useState({ claimant: false, holder: false });

  // The photographs are read one dispute at a time: they are somebody's face and card, and the list does not carry them.
  const load = useCallback(async () => {
    if (!client) return;
    const r = await client.api.idDispute(disputeId);
    if (r.error || !r.data) return setError(r.error?.detail || r.error?.title || t('tower.ids.unread'));
    setRow(r.data as unknown as DisputeRow);
  }, [client, disputeId]);

  useEffect(() => {
    setRow(null);
    setError(null);
    setTo(null);
    setWhat('');
    setReason('');
    setWhy('');
    void load();
  }, [load]);

  const act = async (key: string, fn: () => Promise<{ data?: unknown; error?: { detail?: string; title?: string } | null }>) => {
    setBusy(key);
    setError(null);
    const r = await fn();
    setBusy(null);
    if (r.error) setError(r.error.detail || r.error.title || null);
    await load();
    await actions.refresh();
    return !r.error;
  };

  if (!row || !client) {
    return (
      <ConsoleDetail openKey={disputeId} title={t('tower.ids.title')} onClose={onClose}>
        {error ? <p class="cerr">{error}</p> : <p class="cons__empty">{t('tower.imports.loading')}</p>}
      </ConsoleDetail>
    );
  }
  const step = disputeStep(row, me);
  const notes = disputeNotes(row, t);
  const reading = row.state === 'ready' || step === 'record';
  const allowed = to ? mayPropose(row, to, step === 'record' ? came : undefined) : null;

  return (
    <ConsoleDetail openKey={disputeId} title={row.reference} onClose={onClose}>
      <section class="cons__panel">
        <div class="cons__panelhead">
          <span class="cons__panelt">{row.reference}</span>
          <span class={`ctag ctag--${DISPUTE_TONE[row.state]}`}>{t(DISPUTE_LABEL[row.state])}</span>
        </div>
        <dl class="cons__facts">
          <Fact k={t('tower.ids.fact.what')} v={t(row.register === 'driver' ? 'tower.ids.reg.driver' : 'tower.ids.reg.shop')} />
          <Fact k={t('tower.ids.fact.opened')} v={when(row.openedAt)} />
          {row.photosBy ? <Fact k={t('tower.ids.fact.photosBy')} v={dayOf(row.photosBy)} /> : null}
          {row.answerBy ? <Fact k={t('tower.ids.fact.answerBy')} v={dayOf(row.answerBy)} /> : null}
          {row.decidedTo ? <Fact k={t('tower.ids.fact.decided')} v={decidedWords(row, t, when)} hint={row.finalTo ? undefined : row.reason} /> : null}
          {row.state === 'decided' && row.contestBy ? <Fact k={t('tower.ids.fact.contestBy')} v={dayOf(row.contestBy)} /> : null}
          {row.appointmentDate ? <Fact k={t('tower.ids.fact.appointment')} v={t('tower.ids.fact.appointmentBy', { date: dayOf(row.appointmentDate), who: t(row.appointmentBy === 'claimant' ? 'tower.ids.side.claimant' : 'tower.ids.side.holder') })} hint={row.appointmentPlace ? t('tower.ids.fact.appointmentAt', { where: row.appointmentPlace }) : t('tower.ids.fact.appointmentNoPlace')} /> : null}
          {row.finalTo ? <Fact k={t('tower.ids.fact.final')} v={finalWords(row, t, when)} hint={row.reason} /> : null}
        </dl>
        <p class="chint">{t('tower.ids.numbersHint')}</p>
      </section>

      <div class="twr-ids">
        {(['claimant', 'holder'] as const).map((side) => (
          <Party
            key={side}
            side={side}
            row={row}
            state={state}
            actions={actions}
            reading={reading}
            mayRetake={row.state === 'ready'}
            busy={busy}
            onRead={(number) => act(`card-${side}`, () => client.api.readIdCard(row.disputeId, side, number, me) as never)}
            onRetake={(reasonWhy) => act(`retake-${side}`, () => client.api.retakeIdPhotos(row.disputeId, side, reasonWhy, me) as never)}
          />
        ))}
      </div>

      {notes.length ? (
        <section class="cons__panel">
          <div class="cons__panelhead">
            <span class="cons__panelt">{t('tower.ids.weighTitle')}</span>
          </div>
          {notes.map((n) => (
            <p class={n.tone === 'danger' ? 'cerr' : n.tone === 'warn' ? 'cons__caveat' : 'chint'} key={n.text}>
              {n.text}
            </p>
          ))}
        </section>
      ) : null}

      <section class="cons__panel">
        <div class="cons__panelhead">
          <span class="cons__panelt">{t('tower.moves.decideTitle')}</span>
        </div>
        {row.sentBackWhy ? <p class="cons__caveat">{t('tower.ids.sentBack', { why: row.sentBackWhy })}</p> : null}

        {step === 'wait' ? <p class="cons__empty">{t(row.state === 'opened' ? 'tower.ids.wait.opened' : row.state === 'answering' ? 'tower.ids.wait.answering' : 'tower.ids.wait.appointment')}</p> : null}
        {step === 'over' ? <p class="cons__empty">{t('tower.ids.over')}</p> : null}

        {step === 'propose' || step === 'record' ? (
          <>
            <p class="cons__lede">{t(step === 'record' ? 'tower.ids.recordLede' : 'tower.ids.proposeLede')}</p>
            {step === 'record' ? (
              <div class="cfield">
                <span class="cfield__label">{t('tower.ids.whoCame')}</span>
                {(['claimant', 'holder'] as const).map((side) => (
                  <label class="cfield cfield--check" key={side}>
                    <input type="checkbox" checked={came[side]} onChange={(e) => setCame((c) => ({ ...c, [side]: (e.target as HTMLInputElement).checked }))} />
                    <span>{t(side === 'claimant' ? 'tower.ids.came.claimant' : 'tower.ids.came.holder')}</span>
                  </label>
                ))}
              </div>
            ) : null}
            <div class="cfield">
              <span class="cfield__label">{t('tower.ids.whose')}</span>
              <div class="twr-ids__choice" role="group">
                {(['claimant', 'holder'] as const).map((side) => (
                  <button type="button" key={side} class={`cbtn cbtn--ghost${to === side ? ' cbtn--on' : ''}`} aria-pressed={to === side} onClick={() => setTo(side)}>
                    {t(side === 'claimant' ? 'tower.ids.to.claimant' : 'tower.ids.to.holder')}
                  </button>
                ))}
              </div>
              {/* Said before the button, in the server's own terms: what is missing for this to be proposed. */}
              {allowed && !allowed.ok && allowed.why ? <span class="cerr">{t(allowed.why)}</span> : null}
              {to && allowed?.ok ? <span class="chint">{t(to === 'claimant' ? (row.holder.card === 'differs' ? 'tower.ids.means.claimantCorrected' : 'tower.ids.means.claimant') : 'tower.ids.means.holder')}</span> : null}
            </div>
            <label class="cfield">
              <span class="cfield__label">{t('tower.ids.what')}</span>
              <textarea class="cinput" rows={3} maxLength={500} value={what} onInput={(e) => setWhat((e.target as HTMLTextAreaElement).value)} />
              <span class="chint">{t('tower.ids.whatHint')}</span>
            </label>
            <label class="cfield">
              <span class="cfield__label">{t('tower.ids.reason')}</span>
              <input class="cinput" maxLength={500} value={reason} onInput={(e) => setReason((e.target as HTMLInputElement).value)} />
              <span class="chint">{t('tower.ids.reasonHint')}</span>
            </label>
            <div class="twr-panelend">
              <button
                type="button"
                class="cbtn cbtn--primary"
                disabled={busy !== null || !to || !allowed?.ok || !what.trim() || !reason.trim()}
                onClick={async () => {
                  const ok = await act('check', () => client.api.checkIdDispute(row.disputeId, { to: to!, what: what.trim(), reason: reason.trim(), ...(step === 'record' ? { claimantCame: came.claimant, holderCame: came.holder } : {}) }, me) as never);
                  if (ok) {
                    setWhat('');
                    setReason('');
                    setTo(null);
                  }
                }}
              >
                {t('tower.ids.proposeCta')}
              </button>
            </div>
          </>
        ) : null}

        {step === 'approve' || step === 'other' ? (
          <>
            <dl class="cons__facts">
              <Fact k={t('tower.ids.fact.proposed')} v={t('tower.ids.proposedBy', { who: row.proposedBy ?? '', to: t(row.proposedTo === 'claimant' ? 'tower.ids.side.claimant' : 'tower.ids.side.holder'), when: row.proposedAt ? when(row.proposedAt) : '' })} hint={row.proposedWhat} />
              <Fact k={t('tower.ids.fact.reason')} v={row.proposedReason ?? ''} />
            </dl>
            {/* The one who proposed it is told the approval is somebody else's — not invited to give it. */}
            {step === 'other' ? (
              <p class="cons__caveat">{t('tower.ids.otherApproves')}</p>
            ) : (
              <>
                <p class="cons__lede">{t(row.state === 'rechecked' ? 'tower.ids.approveFinalLede' : 'tower.ids.approveLede')}</p>
                <div class="twr-panelend">
                  <button type="button" class="cbtn cbtn--primary" disabled={busy !== null} onClick={() => void act('approve', () => client.api.approveIdDispute(row.disputeId, me) as never)}>
                    {t('tower.ids.approveCta')}
                  </button>
                </div>
              </>
            )}
            <label class="cfield" style="margin-top:12px">
              <span class="cfield__label">{t('tower.ids.sendBackWhy')}</span>
              <input class="cinput" maxLength={300} value={why} onInput={(e) => setWhy((e.target as HTMLInputElement).value)} />
              <span class="chint">{t('tower.ids.sendBackHint')}</span>
            </label>
            <div class="twr-panelend">
              <button
                type="button"
                class="cbtn cbtn--ghost"
                disabled={busy !== null || !why.trim()}
                onClick={async () => {
                  if (await act('back', () => client.api.sendBackIdDispute(row.disputeId, why.trim(), me) as never)) setWhy('');
                }}
              >
                {t('tower.ids.sendBackCta')}
              </button>
            </div>
          </>
        ) : null}
        {error ? <p class="cerr">{error}</p> : null}
      </section>
    </ConsoleDetail>
  );
}

/** One of the two: who they are, what they sent, what is on record, and — while it is being decided — the card to read. */
function Party({
  side,
  row,
  state,
  actions,
  reading,
  mayRetake,
  busy,
  onRead,
  onRetake,
}: {
  side: DisputeSide;
  row: DisputeRow;
  state: TowerState;
  actions: TowerActions;
  reading: boolean;
  mayRetake: boolean;
  busy: string | null;
  onRead: (number: string) => Promise<boolean>;
  onRetake: (reason: string) => Promise<boolean>;
}) {
  const t = useT();
  const party: DisputeParty = row[side];
  const [number, setNumber] = useState('');
  const [retake, setRetake] = useState('');
  const sent = Boolean(party.sentAt);
  // In the hand at an appointment there is a card to read whether or not photographs were ever sent.
  const canRead = reading && (sent || row.state === 'appointment');

  return (
    <section class="cons__panel">
      <div class="cons__panelhead">
        <span class="cons__panelt">{t(side === 'claimant' ? 'tower.ids.party.claimant' : 'tower.ids.party.holder')}</span>
        {typeof party.came === 'boolean' ? <span class="chint">{t(party.came ? 'tower.ids.cameYes' : 'tower.ids.cameNo')}</span> : null}
      </div>
      <dl class="cons__facts">
        <Fact k={t('tower.ids.fact.who')} v={party.who ?? t(side === 'claimant' ? 'tower.ids.who.none' : 'tower.ids.who.unknown')} />
        {party.since ? <Fact k={t('tower.ids.fact.since')} v={party.since.slice(0, 10)} /> : null}
        {party.phoneEnds ? <Fact k={t('tower.ids.fact.phone')} v={t('tower.moves.fact.ends', { ends: party.phoneEnds })} /> : null}
        {/* What should be written on the paper in THEIR first picture: it is the one check only a person can make. */}
        <Fact k={t('tower.ids.fact.reference')} v={side === 'claimant' ? row.reference : row.holderReference} hint={t('tower.ids.fact.referenceHint')} />
        <Fact k={t('tower.ids.fact.sent')} v={party.sentAt ? when(party.sentAt) : t('tower.ids.sentNothing')} hint={party.retakeWhy ? t('tower.ids.retakeAsked', { why: party.retakeWhy }) : undefined} />
        <Fact k={t('tower.ids.fact.card')} v={cardWords(party, t)} />
      </dl>
      <DocumentStrip refs={photoRefs(party)} state={state} actions={actions} titleKey="tower.ids.photos" emptyKey={side === 'claimant' ? 'tower.ids.noPhotos' : 'tower.ids.noPhotosHolder'} />
      {side === 'holder' && party.onRecord?.length ? <DocumentStrip refs={party.onRecord} state={state} actions={actions} titleKey="tower.ids.onRecord" emptyKey="tower.ids.noPhotos" /> : null}

      {canRead ? (
        <>
          <label class="cfield">
            <span class="cfield__label">{t('tower.ids.readLabel')}</span>
            <input class="cinput" value={number} onInput={(e) => setNumber((e.target as HTMLInputElement).value)} spellcheck={false} autocomplete="off" />
            <span class="chint">{t('tower.ids.readHint')}</span>
          </label>
          <div class="twr-panelend">
            <button
              type="button"
              class="cbtn cbtn--ghost"
              disabled={busy !== null || number.trim().length < 3}
              onClick={async () => {
                if (await onRead(number.trim())) setNumber('');
              }}
            >
              {t('tower.ids.readCta')}
            </button>
          </div>
        </>
      ) : null}

      {mayRetake && sent ? (
        <>
          <label class="cfield">
            <span class="cfield__label">{t('tower.ids.retakeLabel')}</span>
            <input class="cinput" maxLength={300} value={retake} onInput={(e) => setRetake((e.target as HTMLInputElement).value)} />
            <span class="chint">{t('tower.ids.retakeHint')}</span>
          </label>
          <div class="twr-panelend">
            <button
              type="button"
              class="cbtn cbtn--ghost"
              disabled={busy !== null || !retake.trim()}
              onClick={async () => {
                if (await onRetake(retake.trim())) setRetake('');
              }}
            >
              {t('tower.ids.retakeCta')}
            </button>
          </div>
        </>
      ) : null}
    </section>
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
