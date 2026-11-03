import { Abbreviated } from '../../../shared/ui/Abbr';
import { pageGot, PaperSheet, Sections, usePaper } from '../../../shared/ui';
import { useNoteLinks } from '../../../shared/archive/useNoteLinks';
import { useCallback, useEffect, useState } from 'preact/hooks';
import { useT, type MessageKey } from '../../../shared/i18n';
import { foundWords } from '../../../shared/found';
import { quoteFigure, quoteTone, type QuoteView } from '../../../shared/quote';
import { ConsoleDetail } from '../../tower/ConsoleDetail';
import { QuotePanel } from '../../tower/screens/QuotePanel';
import { LoadReservations } from './LoadReservations';
import type { BusinessClient, BusinessView, LoadProposal, PostedLoad } from '../api';
import { deliverySays, loadSectionFor, loadStage, mayAct, noteKept, planDo, planSays, roadSays, type LoadStage } from '../logic';
import { draftOwner, dropLoadDraft, keptLoadDraft, type LoadDraft } from '../postLoad';
import { PostLoad } from './PostLoad';
import type { LoadAsked } from '../../../shared/launch';
import { openLinkedLoad } from '../../../shared/linkedLoad';
import { passageWords } from '../../../shared/passages';
import { heldLine } from '../../../shared/tamper';
import { heldByLine } from '../../../shared/heldByAuthority';

/** A time on the road, as the shipper reads it: its day and hour. */
const onRoad = (iso: string) => new Date(iso).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
import { NoteFile, NoteLinksPanel } from './LoadNote';
import { LoadClaimPanel } from './LoadClaim';
import { LoadPapers } from './LoadPapers';
import { LoadSeals } from './LoadSeals';
import { LoadRefusal } from './LoadRefusal';
import { LoadPaidAnswer } from './LoadPaidAnswer';
import { LoadDoor } from './LoadDoor';

/** A price on a load, in the money the load was posted in — the figure alone only where no company of ours names one. */
const priced = (amount: number, currency?: string): string => (currency ? quoteFigure({ amount, currency }) : amount.toLocaleString());
import type { BusinessActions } from '../useBusinessApp';
import { shipperPaidLine } from '../../../shared/paidDirect';

const STAGE: Record<LoadStage, { label: MessageKey; tone: string }> = {
  ordered: { label: 'business.loads.stage.ordered', tone: 'info' },
  posted: { label: 'business.loads.stage.posted', tone: 'quiet' },
  offers: { label: 'business.loads.stage.offers', tone: 'info' },
  taken: { label: 'business.loads.stage.taken', tone: 'info' },
  moving: { label: 'business.loads.stage.moving', tone: 'info' },
  delivered: { label: 'business.loads.stage.delivered', tone: 'ok' },
  refused: { label: 'refusal.status', tone: 'warn' },
  cancelled: { label: 'business.loads.stage.cancelled', tone: 'quiet' },
};

/**
 * B2 — A BUSINESS'S OWN LOADS: post one, and follow it to the door.
 *
 * Posted as the business, by a named person, onto the same open board every carrier reads — and SETTLED BETWEEN THE
 * PARTIES: the business pays the carrier itself, or through its own payment network, and nothing about it lands on
 * our books (the user, 2026-10-04). What we keep is the record: the price the two agreed, the carrier's quotation and
 * proforma, and whether it is paid as the business says so.
 */
/** A load a notice names (shared/launch.ts), and which asking it is — the same load asked for twice opens twice. */
export interface LoadAskedFor extends LoadAsked {
  seq: number;
}

export function LoadsScreen({ business, client, asked, onAsked }: { business: BusinessView; actions: BusinessActions; client: BusinessClient | null; asked?: LoadAskedFor | null; onAsked?: () => void }) {
  const t = useT();
  const act = mayAct(business.you.role);
  const [rows, setRows] = useState<PostedLoad[] | null>(null);
  const [open, setOpen] = useState<PostedLoad | null>(null);
  // The section a notice opened the load on, and which asking it was: a later tap on a row opens it as ever.
  const [openOn, setOpenOn] = useState<{ section: string; seq: number } | null>(null);
  // 2026-11-03 — posting a load is a wizard of its own screens (PostLoad.tsx): open afresh, or carrying on the load kept
  // on this phone. `n` draws a new one for "Post another".
  const owner = draftOwner(business.entityId, business.you.memberId);
  const [posting, setPosting] = useState<{ resume: LoadDraft | null; n: number } | null>(null);
  const [kept, setKept] = useState<LoadDraft | null>(() => (act ? keptLoadDraft(owner) : null));
  const startPosting = (resume: LoadDraft | null) => setPosting((p) => ({ resume, n: (p?.n ?? 0) + 1 }));
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const readLoads = useCallback(async (): Promise<PostedLoad[] | null> => {
    if (!client) return null;
    const r = await client.shipping.postedFreight();
    if (r.error) {
      setError(r.error.detail || r.error.title);
      return null;
    }
    const items = ((r.data as unknown as { items?: PostedLoad[] })?.items ?? []) as PostedLoad[];
    return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [client]);
  const load = useCallback(async () => {
    const items = await readLoads();
    if (items) setRows(items);
  }, [readLoads]);

  // Read on arriving — unless a notice brought them here, which reads the list itself (once, not twice).
  useEffect(() => {
    if (!asked) void load();
  }, [load]);

  // 2026-11-02 — A LOAD A NOTICE NAMES (the owner: "wire it in"; shared/linkedLoad.ts): the list read afresh, so a load
  // posted a minute ago is in it, then that load opened on the part the notice is about (loadSectionFor) — or, not
  // among this business's loads, said so in words rather than a list with nothing open.
  useEffect(() => {
    if (!asked || !client) return;
    const want = asked;
    onAsked?.();
    void openLinkedLoad<PostedLoad>(want.id, {
      mayRead: true,
      fetch: readLoads,
      keep: (items) => {
        setRows(items);
        setOpen(null);
        setError(null);
      },
      open: (row) => {
        // A load being posted stays kept on the phone; the load the notice is about is what is wanted now.
        setPosting(null);
        setOpenOn({ section: loadSectionFor(want.about), seq: want.seq });
        setOpen(row);
      },
      say: () => setError(t('business.loads.notYours')),
    });
  }, [asked?.seq, client]);

  useEffect(() => {
    if (open) setOpen(rows?.find((r) => r.freightId === open.freightId) ?? null);
  }, [rows]);

  // Posting is the whole screen, one step at a time, until it is posted or left for now.
  if (act && posting) {
    return (
      <PostLoad
        key={posting.n}
        business={business}
        client={client}
        resume={posting.resume}
        onLeave={() => {
          setPosting(null);
          setKept(keptLoadDraft(owner));
        }}
        onPosted={load}
        onOpen={async (freightId) => {
          setPosting(null);
          setKept(null);
          const items = await readLoads();
          if (!items) return;
          setRows(items);
          setOpenOn(null);
          setOpen(items.find((r) => r.freightId === freightId) ?? null);
        }}
        onAnother={() => {
          setKept(null);
          startPosting(null);
        }}
      />
    );
  }

  return (
    <>
      <header class="cons__head">
        <h1 class="cons__title">{t('business.loads.title')}</h1>
        <p class="cons__lede">{t('business.loads.lede')}</p>
      </header>
      {done ? <p class="cnote">{done}</p> : null}
      {error ? <p class="cerr"><Abbreviated text={error} /></p> : null}

      {act ? (
        kept ? (
          // A load started on this phone and not posted — a phone call, or "Leave it for now": carried on, or begun afresh.
          <section class="cons__panel biz-loads__kept" aria-labelledby="biz-loads-kept">
            <div class="cons__panelhead">
              <span class="cons__panelt" id="biz-loads-kept">
                {t('business.post.keptTitle')}
              </span>
            </div>
            <p class="cons__lede">{t('business.post.keptLine', { when: onRoad(new Date(kept.savedAt).toISOString()), what: kept.form.description.trim() || t('business.post.keptNothing') })}</p>
            <div class="twr-panelend">
              <button type="button" class="cbtn cbtn--primary" onClick={() => startPosting(kept)}>
                {t('business.post.carryOn')}
              </button>
              <button
                type="button"
                class="cbtn cbtn--ghost"
                onClick={() => {
                  dropLoadDraft(owner);
                  setKept(null);
                  startPosting(null);
                }}
              >
                {t('business.post.startAgain')}
              </button>
            </div>
          </section>
        ) : (
          <div class="twr-panelend biz-loads__new">
            <button type="button" class="cbtn cbtn--primary" onClick={() => startPosting(null)}>
              {t('business.loads.newCta')}
            </button>
          </div>
        )
      ) : null}

      <section class="cons__panel">
        <div class="cons__panelhead">
          <span class="cons__panelt">{t('business.loads.listTitle')}</span>
          {rows ? <span class="chint">{t('business.loads.count', { n: rows.length })}</span> : null}
        </div>
        {rows === null ? (
          <p class="cons__empty">{t('business.loading')}</p>
        ) : rows.length === 0 ? (
          <p class="cons__empty">{t('business.loads.none')}</p>
        ) : (
          <div class="crows">
            {rows.map((r) => {
              const stage = loadStage(r);
              const says = planSays(r, t);
              const handed = deliverySays(r, t);
              const road = roadSays(r, t, onRoad);
              return (
                <button
                  type="button"
                  class="crow"
                  key={r.freightId}
                  onClick={() => {
                    setOpenOn(null);
                    setOpen(r);
                  }}
                >
                  <span class="crow__body">
                    <span class="crow__top">
                      <span class="crow__name">
                        {r.code} · {r.description}
                      </span>
                      <span class={`ctag ctag--${STAGE[stage].tone}`}>{stage === 'offers' ? t('business.loads.stage.offersN', { n: r.openProposals }) : t(STAGE[stage].label)}</span>
                    </span>
                    <span class="crow__sub">
                      {t('business.loads.rowSub', { dest: r.destLabel, kg: r.weightKg.toLocaleString(), when: r.createdAt.slice(0, 10) })}
                      {r.carrier?.driverName ? ` · ${t('business.loads.carriedBy', { who: r.carrier.driverName })}` : ''}
                      {r.onBehalfOf ? ` · ${t('business.sentFor.forClient', { name: r.onBehalfOf.name })}` : ''}
                      {r.contract ? ` · ${t('business.loads.withCarrier', { fleet: r.contract.fleetName, day: r.deliverOn ?? '' })}` : ''}
                    </span>
                    {/* What a row must not lose to an ellipsis: which load of an order this is, and what its carrier's
                        plan says of it — on no vehicle, outside its window, or (with no tag: it needs nobody) about
                        when. The line above gives way to the width; this one wraps. */}
                    {r.partOf || says || handed || road || r.held || r.heldByAuthority || r.seals?.some((s) => s.state === 'broken') ? (
                      <span class="biz-loads__flags">
                        {r.partOf ? <span class="ctag ctag--quiet">{t('business.loads.loadOf', { no: r.partOf.no, of: r.partOf.of, order: r.partOf.rootCode })}</span> : null}
                        {says?.state === 'late' ? <span class="ctag ctag--danger">{t('business.loads.late.tag')}</span> : null}
                        {says?.state === 'left' ? <span class="ctag ctag--danger">{t('business.loads.left.tag')}</span> : null}
                        {says?.state === 'outside' ? <span class="ctag ctag--warn">{t('business.loads.win.tag')}</span> : null}
                        {says ? <span>{says.row}</span> : null}
                        {/* Delivered: when, and where that fell against what was asked — in colour only where it missed. */}
                        {handed?.tag ? <span class="ctag ctag--warn">{handed.tag}</span> : null}
                        {handed ? <span>{handed.row}</span> : null}
                        {/* Round 15 — a seal found broken on the road: in colour, on the row, until delivery and after. */}
                        {r.seals?.some((s) => s.state === 'broken') ? <span class="ctag ctag--danger">{t('business.loads.sealBroken')}</span> : null}
                        {/* Round 35 — held under the tamper protocol: in colour, with what was found, until operations releases it. */}
                        {r.held ? <span class="ctag ctag--danger">{t('common.tamper.heldShort')}</span> : null}
                        {r.held ? <span>{heldLine(r.held, t)}</span> : null}
                        {/* Held by the police or customs on the road, as its driver said: who and where, until let go. */}
                        {r.heldByAuthority ? <span class="ctag ctag--danger">{t('common.held.short')}</span> : null}
                        {r.heldByAuthority ? <span>{heldByLine(r.heldByAuthority, t)}</span> : null}
                        {/* Round 14 — on the road: where its driver said it is, and when it is expected. */}
                        {road ? <span>{[road.row, road.expected].filter(Boolean).join(' · ')}</span> : null}
                      </span>
                    ) : null}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {open ? (
        <LoadDetail
          // Opened afresh for each notice that names it, on the section that notice is about.
          key={openOn ? `${open.freightId}:${openOn.seq}` : open.freightId}
          row={open}
          start={openOn?.section}
          business={business}
          client={client}
          act={act}
          onClose={() => setOpen(null)}
          onChanged={async (message) => {
            if (message) setDone(message);
            await load();
          }}
        />
      ) : null}
    </>
  );
}

export function LoadDetail({ row, start, business, client, act, onClose, onChanged }: { row: PostedLoad; start?: string; business: BusinessView; client: BusinessClient | null; act: boolean; onClose: () => void; onChanged: (message?: string) => void | Promise<void> }) {
  const t = useT();
  const stage = loadStage(row);
  const says = planSays(row, t);
  const handed = deliverySays(row, t);
  const road = roadSays(row, t, onRoad);
  const kept = noteKept(row, stage);
  // 2026-11-02 — the note opens in the slide-up, as it will print (the owner: "the print function in slide up"); once
  // kept, Share there passes on a link to it — the same links its Papers panel lists, so one made in either shows in both.
  const paper = usePaper();
  const noteLinks = useNoteLinks(client ? client.client.sbg : null, kept === 'kept' ? row.noteId : undefined);
  const [proposals, setProposals] = useState<LoadProposal[] | null>(null);
  const [quote, setQuote] = useState<QuoteView | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [quoteForm, setQuoteForm] = useState({ amount: '', currency: '', reference: '' });

  const read = useCallback(async () => {
    if (!client) return;
    if (row.commitMode === 'negotiate' && (stage === 'posted' || stage === 'offers')) {
      const p = await client.shipping.freightProposals(row.freightId);
      setProposals(p.error ? [] : (((p.data as unknown as { items?: LoadProposal[] })?.items ?? []) as LoadProposal[]));
    } else setProposals([]);
    const q = await client.freightQuote(row.freightId);
    setQuote(q.error ? null : (q.data?.quote ?? null));
  }, [client, row.freightId, stage]);

  useEffect(() => {
    void read();
  }, [read]);

  const run = async (fn: () => Promise<{ error?: { detail?: string; title?: string } | null }>, message: string) => {
    setBusy(true);
    setError(null);
    const r = await fn();
    setBusy(false);
    if (r.error) return setError(r.error.detail || r.error.title || '');
    await onChanged(message);
    await read();
  };

  const note = () => {
    if (!client) return;
    paper.show(t('business.loads.note'), async () => pageGot(await client.shipping.freightNote(row.freightId), t('business.loads.noteGone')));
  };

  return (
    <ConsoleDetail openKey={row.freightId} title={`${row.code} · ${row.description}`} onClose={onClose}>
      {/* 2026-11-02 — a load's whole record, in sections the reader swipes through (the owner: "we don't want to mush
          scrolling … a sticky but swipable subheader"). Whatever waits for this business's answer is in the first. */}
      <Sections
        label={t('business.loads.sections')}
        opensOn={start}
        sections={[
          {
            key: 'overview',
            label: t('business.loads.sec.overview'),
            attention: Boolean(proposals?.some((p) => p.status === 'open')),
            content: (
              <>
                <section class="cons__panel">
                  <div class="cons__panelhead">
                    <span class="cons__panelt">
                      {row.code} · {row.description}
                    </span>
                    <span class={`ctag ctag--${STAGE[stage].tone}`}>{t(STAGE[stage].label)}</span>
                  </div>
                  <dl class="cons__facts">
                    <div class="cons__fact">
                      <dt class="cons__factk">{t('business.loads.fact.to')}</dt>
                      <dd class="cons__factv">{row.destLabel}</dd>
                    </div>
                    <div class="cons__fact">
                      <dt class="cons__factk">{t('business.loads.fact.weight')}</dt>
                      <dd class="cons__factv">{row.weightKg.toLocaleString()} kg</dd>
                    </div>
                    {/* 2026-11-03 — kept cold: the range it is kept in, and whether it is the one the business gave. */}
                    {row.keptBetween ? (
                      <div class="cons__fact">
                        <dt class="cons__factk">{t('business.post.k.temp')}</dt>
                        <dd class="cons__factv">
                          {t('business.post.v.temp', { min: String(row.keptBetween.minC), max: String(row.keptBetween.maxC) })}
                          <span class="chint"> {t(row.keptBetween.own ? 'business.loads.fact.keptOwn' : 'business.loads.fact.keptUsual')}</span>
                        </dd>
                      </div>
                    ) : null}
                    {row.contract ? (
                      <div class="cons__fact">
                        <dt class="cons__factk">{t('business.loads.fact.contract')}</dt>
                        <dd class="cons__factv">
                          {row.contract.fleetName}
                          {row.contract.reference ? ` · ${row.contract.reference}` : ''}
                          {row.deliverOn ? ` · ${t('business.loads.fact.arrivesOn', { day: row.deliverOn })}` : ''}
                          {row.orderRef ? ` · ${row.orderRef}` : ''}
                        </dd>
                      </div>
                    ) : null}
                    {row.returnOf ? (
                      <div class="cons__fact">
                        <dt class="cons__factk">{t('business.loads.fact.return')}</dt>
                        <dd class="cons__factv">{t('refusal.returnOf', { code: row.returnOf.code })}</dd>
                      </div>
                    ) : null}
                    {row.partOf ? (
                      <div class="cons__fact">
                        <dt class="cons__factk">{t('business.loads.fact.order')}</dt>
                        <dd class="cons__factv">{t('business.loads.loadOfFull', { no: row.partOf.no, of: row.partOf.of, order: row.partOf.rootCode, kg: row.partOf.orderKg.toLocaleString() })}</dd>
                      </div>
                    ) : null}
                    {says ? (
                      <div class="cons__fact">
                        <dt class="cons__factk">{t('business.loads.fact.plan')}</dt>
                        <dd class="cons__factv">
                          {says.full}
                          <span class="chint"> {planDo(says, row.contract?.fleetName ?? '', t)}</span>
                        </dd>
                      </div>
                    ) : null}
                    {row.carrier?.driverName ? (
                      <div class="cons__fact">
                        <dt class="cons__factk">{t('business.loads.fact.carrier')}</dt>
                        <dd class="cons__factv">
                          {row.carrier.driverName}
                          {row.carrier.plate ? ` · ${row.carrier.plate}` : ''}
                        </dd>
                      </div>
                    ) : null}
                    {row.agreedPrice != null ? (
                      <div class="cons__fact">
                        <dt class="cons__factk">{t('business.loads.fact.agreed')}</dt>
                        <dd class="cons__factv">
                          {priced(row.agreedPrice, row.currency)}
                          {/* A match (2026-10-27): the business pays the driver directly — and, once the carrier says so, that it did. */}
                          {shipperPaidLine(row, t) ? <span class="biz-road__line chint">{shipperPaidLine(row, t)}</span> : null}
                        </dd>
                      </div>
                    ) : null}
                    {row.deliveredAt ? (
                      <div class="cons__fact">
                        <dt class="cons__factk">{t('business.loads.fact.delivered')}</dt>
                        <dd class="cons__factv">
                          {t('business.loads.fact.deliveredTo', { when: row.deliveredAt.slice(0, 10), who: row.receiverName ?? '—' })}
                          {handed ? ` ${handed.full}` : ''}
                          {handed ? <span class="chint"> {t('business.loads.done.clock')}</span> : null}
                        </dd>
                      </div>
                    ) : null}
                    {/* D9 — what the receiver found at the handover, as the note has it beside their name. */}
                    {row.exceptions?.length ? (
                      <div class="cons__fact">
                        <dt class="cons__factk">{t('business.loads.fact.found')}</dt>
                        <dd class="cons__factv">{foundWords(row.exceptions, t)}</dd>
                      </div>
                    ) : null}
                    {row.trackingUrl ? (
                      <div class="cons__fact">
                        <dt class="cons__factk">{t('business.loads.fact.tracking')}</dt>
                        <dd class="cons__factv">
                          <a href={row.trackingUrl} target="_blank" rel="noopener noreferrer">
                            {row.trackingKey}
                          </a>
                          <span class="chint"> {t('business.loads.fact.trackingHint')}</span>
                        </dd>
                      </div>
                    ) : null}
                  </dl>
                  <div class="twr-panelend">
                    <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => void note()}>
                      {t('business.loads.note')}
                    </button>
                    {/* Once a copy is kept: the whole file — the note, every copy as it was signed, its photographs. */}
                    {kept === 'kept' ? <NoteFile client={client} noteId={row.noteId!} code={row.code} /> : null}
                  </div>
                  {kept === 'not_yet' ? <p class="chint">{t('business.note.notYet')}</p> : null}
                </section>

                {/* Refused at the door: where the goods go, the business's to say — or what became of them (the user, 2026-10-27). */}
                <LoadRefusal row={row} client={client} business={business} act={act} onChanged={onChanged} />
                {/* A driver said it was not paid: the business answers that it paid, with a reference — both sides heard (2026-10-27). */}
                <LoadPaidAnswer row={row} client={client} act={act} onChanged={onChanged} />
                {proposals && proposals.some((p) => p.status === 'open') ? (
                  <section class="cons__panel">
                    <div class="cons__panelhead">
                      <span class="cons__panelt">{t('business.loads.offersTitle')}</span>
                    </div>
                    <p class="cons__lede">{t('business.loads.offersLede')}</p>
                    <div class="crows">
                      {proposals
                        .filter((p) => p.status === 'open')
                        .map((p) => (
                          <div class="crow" key={p.proposalId}>
                            <span class="crow__body">
                              <span class="crow__top">
                                <span class="crow__name">{priced(p.price, row.currency)}</span>
                              </span>
                              {p.note ? <span class="crow__sub">{p.note}</span> : null}
                            </span>
                            {act ? (
                              <span class="crow__tail biz-choose__acts">
                                <button type="button" class="cbtn cbtn--primary cbtn--sm" disabled={busy} onClick={() => void run(() => client!.shipping.acceptProposal(p.proposalId) as never, t('business.loads.accepted'))}>
                                  {t('business.loads.accept')}
                                </button>
                                <button type="button" class="cbtn cbtn--ghost cbtn--sm" disabled={busy} onClick={() => void run(() => client!.shipping.declineProposal(p.proposalId) as never, t('business.loads.declined'))}>
                                  {t('business.loads.decline')}
                                </button>
                              </span>
                            ) : null}
                          </div>
                        ))}
                    </div>
                  </section>
                ) : null}

                {act && row.canCancel ? (
                  <section class="cons__panel">
                    <div class="cons__panelhead">
                      <span class="cons__panelt">{t('business.loads.cancelTitle')}</span>
                    </div>
                    <label class="cfield">
                      <span class="cfield__label">{t('business.loads.cancelWhy')}</span>
                      <input class="cinput" value={reason} onInput={(e) => setReason((e.target as HTMLInputElement).value)} />
                    </label>
                    <div class="twr-panelend">
                      <button type="button" class="cbtn cbtn--danger" disabled={busy || !reason.trim()} onClick={() => void run(() => client!.shipping.cancelFreight(row.freightId, reason.trim()) as never, t('business.loads.cancelled'))}>
                        {t('business.loads.cancelCta')}
                      </button>
                    </div>
                  </section>
                ) : null}

                {act && row.canRate ? (
                  <section class="cons__panel">
                    <div class="cons__panelhead">
                      <span class="cons__panelt">{t('business.loads.rateTitle')}</span>
                      {row.rating ? <span class="chint">{t('business.loads.rated', { n: row.rating.stars })}</span> : null}
                    </div>
                    <div class="biz-stars">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <button type="button" key={n} class={`cbtn cbtn--sm ${row.rating?.stars === n ? 'cbtn--primary' : 'cbtn--ghost'}`} disabled={busy} onClick={() => void run(() => client!.shipping.rateFreight(row.freightId, { stars: n }) as never, t('business.loads.thanks'))}>
                          {n}
                        </button>
                      ))}
                    </div>
                  </section>
                ) : null}
              </>
            ),
          },
          {
            key: 'road',
            label: t('business.loads.sec.road'),
            attention: Boolean(row.coldChainBroken || row.held || row.heldByAuthority),
            content: (
              <>
                {row.passages?.length || road || row.coldChainBroken || row.held || row.heldByAuthority ? (
                  <section class="cons__panel">
                    <div class="cons__panelhead">
                      <span class="cons__panelt">{t('business.loads.fact.road')}</span>
                    </div>
                    <dl class="cons__facts">
                        {/* 2026-11-02 — held on the road, said here as on its row: a notice that it is held opens this section. */}
                        {row.heldByAuthority ? (
                          <div class="cons__fact">
                            <dt class="cons__factk">{t('common.held.short')}</dt>
                            <dd class="cons__factv">{heldByLine(row.heldByAuthority, t)}</dd>
                          </div>
                        ) : null}
                        {row.held ? (
                          <div class="cons__fact">
                            <dt class="cons__factk">{t('common.tamper.heldShort')}</dt>
                            <dd class="cons__factv">{heldLine(row.held, t)}</dd>
                          </div>
                        ) : null}
                        {/* Round 14 — what its driver said on the road, in order; across a border, the allowance and when it is expected. */}
                        {row.passages?.length || road ? (
                          <div class="cons__fact">
                            <dt class="cons__factk">{t('business.loads.fact.road')}</dt>
                            <dd class="cons__factv">
                              {(row.passages ?? []).map((p) => (
                                <span key={`${p.kind}-${p.at}`} class="biz-road__line">
                                  {passageWords(p, t, onRoad)}
                                </span>
                              ))}
                              {road?.row && !row.passages?.length ? <span class="biz-road__line">{road.row}</span> : null}
                              {road?.wait ? <span class="biz-road__line chint">{road.wait}</span> : null}
                              {road?.expected ? (
                                <span class="biz-road__line">
                                  <b>{road.expected}</b>
                                </span>
                              ) : null}
                              {road?.drive ? <span class="biz-road__line chint">{road.drive}</span> : null}
                            </dd>
                          </div>
                        ) : null}
                        {/* Round 25 — its cold chain broken on the road: the reading that broke it, when, and whether it reached us late. */}
                        {row.coldChainBroken ? (
                          <div class="cons__fact">
                            <dt class="cons__factk">{t('business.loads.fact.coldChain')}</dt>
                            <dd class="cons__factv">
                              <b>{t('business.loads.coldChainBroken', { temp: row.coldChainBroken.celsius, when: onRoad(row.coldChainBroken.at), min: row.coldChainBroken.minC, max: row.coldChainBroken.maxC })}</b>
                              {row.coldChainBroken.receivedAt ? <span class="biz-road__line chint">{t('business.loads.coldChainLate', { when: onRoad(row.coldChainBroken.receivedAt) })}</span> : null}
                            </dd>
                          </div>
                        ) : null}
                    </dl>
                  </section>
                ) : null}
                {/* At the door: every attempt the driver made, and what the driver is told — the business's to add to (2026-10-27). */}
                <LoadDoor row={row} client={client} act={act} onChanged={onChanged} />
              </>
            ),
          },
          {
            key: 'papers',
            label: t('business.loads.sec.papers'),
            content: (
              <>
                {/* The labels for its packages and, across a border, its commercial invoice — the business's own papers. */}
                {/* Box 18 at taking over, and this business's answer (CMR Art. 8(2)). */}
                <LoadReservations row={row} client={client} act={act} onChanged={onChanged} />
                {stage !== 'cancelled' ? <LoadPapers row={row} client={client} business={business} act={act} /> : null}
                {/* Round 15 — the seals on the load: written before pickup, and what became of each after. */}
                {stage !== 'cancelled' ? <LoadSeals row={row} client={client} act={act} /> : null}

                {/* The links to its note — the one a receipt was emailed with, and the ones the business made to pass on. Shown to
                    a viewer too: what is a way into the business's papers is everybody's in it to see. */}
                {kept === 'kept' ? <NoteLinksPanel client={client} noteId={row.noteId!} title={`${row.code} · ${row.description}`} act={act} links={noteLinks} /> : null}
              </>
            ),
          },
          {
            key: 'money',
            label: t('business.loads.sec.money'),
            content: (
              <>
                {/* What the carrier asked to be paid, once a carrier has it — kept here, settled between the two of them. */}
                {stage === 'taken' || stage === 'moving' || stage === 'delivered' ? (
                  <section class="cons__panel">
                    <div class="cons__panelhead">
                      <span class="cons__panelt">{t('business.pay.title')}</span>
                      {quote ? <span class={`ctag ctag--${quoteTone(quote)}`}>{quote.status === 'paid' ? t('business.pay.paid') : t('business.pay.open', { figure: quoteFigure(quote) })}</span> : null}
                    </div>
                    {quote ? (
                      <QuotePanel quote={quote} api={client ? (client.api as never) : null} canChange={act} onChanged={() => read()} />
                    ) : quote === null ? (
                      <>
                        <p class="cons__lede">{t('business.pay.lede')}</p>
                        {act ? (
                          <>
                            <div class="biz-two">
                              <label class="cfield">
                                <span class="cfield__label">{t('business.pay.amount')}</span>
                                <input class="cinput" type="number" min={0} value={quoteForm.amount} placeholder={row.agreedPrice != null ? String(row.agreedPrice) : ''} onInput={(e) => setQuoteForm((prev) => ({ ...prev, amount: (e.target as HTMLInputElement).value }))} />
                              </label>
                              <label class="cfield">
                                <span class="cfield__label">{t('business.pay.reference')}</span>
                                <input class="cinput" value={quoteForm.reference} onInput={(e) => setQuoteForm((prev) => ({ ...prev, reference: (e.target as HTMLInputElement).value }))} />
                              </label>
                            </div>
                            <div class="twr-panelend">
                              <button
                                type="button"
                                class="cbtn cbtn--primary"
                                disabled={busy}
                                onClick={() =>
                                  void run(
                                    () =>
                                      client!.recordFreightQuote(row.freightId, {
                                        ...(Number(quoteForm.amount) > 0 ? { amount: Number(quoteForm.amount) } : {}),
                                        ...(quoteForm.currency.trim() ? { currency: quoteForm.currency.trim() } : {}),
                                        ...(quoteForm.reference.trim() ? { reference: quoteForm.reference.trim() } : {}),
                                      }),
                                    t('business.pay.recorded'),
                                  )
                                }
                              >
                                {t('business.pay.record')}
                              </button>
                            </div>
                          </>
                        ) : null}
                      </>
                    ) : null}
                  </section>
                ) : null}
              </>
            ),
          },
          {
            key: 'claim',
            label: t('business.loads.sec.claim'),
            content: (
              <>
                {/* A problem with the goods delivered: the business's claim, where it is the one to make it (claim.ts). */}
                {stage === 'delivered' ? <LoadClaimPanel row={row} client={client} act={act} onChanged={onChanged} /> : null}
              </>
            ),
          },
        ]}
      />
      {error ? <p class="cerr"><Abbreviated text={error} /></p> : null}
      {/* Share is offered where a link may be made: a kept note, and somebody of the business who may act. */}
      <PaperSheet state={paper} look="console" share={kept === 'kept' && act ? { links: noteLinks, title: `${row.code} · ${row.description}` } : undefined} />
    </ConsoleDetail>
  );
}
