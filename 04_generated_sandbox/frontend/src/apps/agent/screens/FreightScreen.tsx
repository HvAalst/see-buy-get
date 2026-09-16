import { useState } from 'preact/hooks';
import { DocumentButton, Button, Card, Checklist, ErrorNote, Icon, PhotoField, Pill, QrBlock, Sheet } from '../../../shared/ui';
import { formatDate, useT } from '../../../shared/i18n';
import { InstructionsBlock } from '../../../shared/InstructionsBlock';
import { hasInstructions } from '../../../shared/instructions';
import { ConversationList, ConversationSheet } from '../../../shared/conversation/Conversations';
import type { ChatThread } from '../../../shared/conversation/logic';
import type { AgentActions, AgentState, FreightClaim, FreightPrice, PostedFreight } from '../useAgentApp';

export interface FreightScreenProps {
  state: AgentState;
  actions: AgentActions;
}

/**
 * FB2b — the other side of the negotiation: the shop that posted a load, answering the prices offered on it.
 *
 * Two views in one screen, because they are one task: the loads we sent out, and then the prices on the one
 * being decided. A shop clerk answering a driver's number does not need a second tab to get back.
 */
export function FreightScreen({ state, actions }: FreightScreenProps) {
  const t = useT();
  const load = state.posted.find((p) => p.freightId === state.pricesFor) ?? null;
  // CV1 — the thread open in the sheet, and a counter that makes every list re-read after something changed.
  const [thread, setThread] = useState<ChatThread | null>(null);
  const [chatTick, setChatTick] = useState(0);
  return (
    <div class="scr">
      {load ? <Prices load={load} state={state} actions={actions} /> : <PostedList state={state} actions={actions} />}

      {/* CV1 — the people asking about these loads. Before a match, on purpose: a question answered is how a
          load finds the right driver, and in a country we only match it is where the payment is agreed. */}
      <Card title={load ? t('common.chat.questions') : t('common.chat.listTitle')}>
        <ConversationList
          api={actions.chatApi}
          subject="freight"
          freightId={load?.freightId}
          refreshKey={chatTick}
          onOpen={setThread}
          emptyText={load ? t('common.chat.noQuestions') : undefined}
        />
      </Card>
      <ConversationSheet
        api={actions.chatApi}
        thread={thread}
        onClose={() => setThread(null)}
        onChanged={() => {
          setChatTick((n) => n + 1);
          // CV2 — accepting a price in the thread claims the load, so the posted list above must say so.
          void actions.loadPosted();
        }}
      />
    </div>
  );
}

function PostedList({ state, actions }: FreightScreenProps) {
  const t = useT();
  const loading = state.postedState === 'idle' || state.postedState === 'loading';
  return (
    <>
      <h1 class="scr__title">{t('agent.freight.title')}</h1>
      <p class="scr__lede">{t('agent.freight.lede')}</p>
      {state.error ? <ErrorNote error={state.error} /> : null}

      {loading ? (
        <p class="scr__lede" aria-live="polite">
          {t('common.loading')}
        </p>
      ) : state.posted.length === 0 ? (
        <Card title={t('agent.freight.emptyTitle')} tone="soft">
          <p class="card__note">{t('agent.freight.emptyLede')}</p>
        </Card>
      ) : (
        <div class="rows" role="list">
          {state.posted.map((f) => (
            <PostedRow key={f.freightId} f={f} onOpen={() => void actions.openPrices(f.freightId)} />
          ))}
        </div>
      )}
    </>
  );
}

/** FP3b — one failed attempt, in the shop's words. */
function attemptLine(a: NonNullable<PostedFreight['attempts']>[number], t: ReturnType<typeof useT>): string {
  const why = a.outcome === 'absent' ? t('agent.freight.attemptAbsent') : a.outcome === 'refused' ? t('agent.freight.attemptRefused') : t('agent.freight.attemptUnreachable');
  return t('agent.freight.attemptLine', { when: formatDate(a.at), why: a.note ? `${why} — “${a.note}”` : why });
}

/** FP3b — where the claim stands, in one line. */
function claimLine(c: FreightClaim, t: ReturnType<typeof useT>): string {
  const kind = c.kind === 'damaged' ? t('agent.freight.claimDamaged') : c.kind === 'short' ? t('agent.freight.claimShort') : t('agent.freight.claimNotReceived');
  if (c.state === 'open') return t('agent.freight.claimOpenLine', { kind, when: formatDate(c.raisedAt) });
  const decision = c.decision === 'upheld' ? t('agent.freight.claimUpheld') : c.decision === 'partly_upheld' ? t('agent.freight.claimPartly') : t('agent.freight.claimRejected');
  const money = c.award ? t('agent.freight.claimAward', { amount: c.award.toFixed(2) }) : c.paidTo?.kind === 'between_parties' ? t('agent.freight.claimBetween') : '';
  return t('agent.freight.claimDecidedLine', { kind, decision, money: money ? ` — ${money}` : '', note: c.note ?? '' });
}

function PostedRow({ f, onOpen }: { f: PostedFreight; onOpen: () => void }) {
  const t = useT();
  return (
    <div class="row row--static" role="listitem">
      <span class="row__ic">
        <Icon name="truck" size={24} />
      </span>
      <span class="row__body">
        <span class="row__t">
          {f.code} — {f.description}
        </span>
        <span class="row__s">{t('agent.freight.statusLine', { status: f.status.replace('_', ' '), kg: f.weightKg, dest: f.destLabel })}</span>
        {f.maxSpend != null ? <span class="row__s">{t('agent.freight.budget', { amount: f.maxSpend.toFixed(2) })}</span> : null}
        {f.agreedPrice != null ? <span class="row__s">{t('agent.freight.agreed', { amount: f.agreedPrice.toFixed(2) })}</span> : null}
        {f.scheduledPickupAt ? <span class="row__s">{formatDate(f.scheduledPickupAt)}</span> : null}
        {/* FP3 — what became of it: who signed for the goods, or that the shop withdrew it. */}
        {f.receiverName && f.deliveredAt ? <span class="row__s">{t('agent.freight.receivedBy', { name: f.receiverName, when: formatDate(f.deliveredAt) })}</span> : null}
        {f.cancelledAt ? <span class="row__s">{t('agent.freight.cancelledLine', { when: formatDate(f.cancelledAt) })}</span> : null}
        {/* FP8 — a driver gave it back: the latest, with their reason, while the load is still looking for a carrier. */}
        {f.handBacks?.length && !f.pickedUpAt ? <span class="row__s">{t('agent.freight.handBackLine', { when: formatDate(f.handBacks[f.handBacks.length - 1].at), reason: f.handBacks[f.handBacks.length - 1].reason })}</span> : null}
        {f.attempts?.length && f.status === 'in_transit' ? <span class="row__s">{attemptLine(f.attempts[f.attempts.length - 1], t)}</span> : null}
        {f.claim ? <span class="row__s">{claimLine(f.claim, t)}</span> : null}
        {/* FP6 — who has it, and what the shop said of them. */}
        {f.carrier ? <span class="row__s">{t('agent.freight.carrierLine', { driver: f.carrier.driverName ?? t('agent.freight.carrierUnknown'), plate: f.carrier.plate ?? '' })}</span> : null}
        {f.rating ? <span class="row__s">{t('agent.freight.ratedLine', { stars: f.rating.stars })}</span> : null}
        <span class="freight__tags">
          <Pill tone="idle">{f.commitMode === 'negotiate' ? t('agent.freight.negotiate') : t('agent.freight.instant')}</Pill>
          {/* The count is the reason this row is on a screen at all, so it leads in the loud tone. */}
          {f.openProposals > 0 ? <Pill tone="warn" dot>{t('agent.freight.waiting', { n: f.openProposals })}</Pill> : null}
        </span>
        {/* Offered even with nothing waiting: a shop looking at a load wants to see who declined and why it
            is still sitting there, not just be told there is nothing to do. */}
        <Button variant="link" full={false} onClick={onOpen}>
          {f.openProposals > 0 ? t('agent.freight.open') : t('agent.freight.noneWaiting')}
        </Button>
      </span>
    </div>
  );
}

function Prices({ load, state, actions }: { load: PostedFreight } & FreightScreenProps) {
  const t = useT();
  const [confirm, setConfirm] = useState<FreightPrice | null>(null);
  const [withdraw, setWithdraw] = useState(false);
  const [reason, setReason] = useState('');
  const [claiming, setClaiming] = useState(false);
  // FP6 — the link to hand on, and the verdict.
  const [sharing, setSharing] = useState(false);
  const [rating, setRating] = useState(false);
  // FP7 — box 13.
  const [instructing, setInstructing] = useState(false);
  const [claimKind, setClaimKind] = useState<'damaged' | 'short' | 'not_received'>('damaged');
  const [claimText, setClaimText] = useState('');
  const [claimPhoto, setClaimPhoto] = useState('');
  const loading = state.pricesState === 'loading';
  const open = state.prices.filter((p) => p.status === 'open');
  const decided = state.prices.filter((p) => p.status !== 'open');
  return (
    <>
      <h1 class="scr__title">{t('agent.freight.pricesTitle', { code: load.code })}</h1>
      <p class="scr__lede">{load.description}</p>
      {load.maxSpend != null ? <p class="scr__lede">{t('agent.freight.budget', { amount: load.maxSpend.toFixed(2) })}</p> : null}
      {/* FP2 — the load's own document, from posting to delivery. */}
      {load.receiverName && load.deliveredAt ? <p class="scr__lede">{t('agent.freight.receivedBy', { name: load.receiverName, when: formatDate(load.deliveredAt) })}</p> : null}
      {load.cancelledAt ? <p class="scr__lede">{t('agent.freight.cancelledLine', { when: formatDate(load.cancelledAt) })}</p> : null}
      {/* CL1 — the agreed term, and the one consequence of it a shop actually needs: who claims if the goods
          are damaged on the road. Said in words, because "CIF Mombasa" tells a clerk nothing on its own. */}
      {load.incoterm ? (
        <p class="scr__lede">
          {t('agent.freight.termLine', { term: load.incoterm, place: load.namedPlace ?? '' })}
          {load.claimant ? ' ' + t(load.claimant === 'receiver' ? 'agent.freight.termReceiverClaims' : 'agent.freight.termSenderClaims') : ''}
        </p>
      ) : null}
      {/* FP8 — every hand-back, with the driver's reason: the load is on the market again and nothing has moved. */}
      {load.handBacks?.length ? (
        <Card tone="soft">
          {load.handBacks.map((h) => (
            <p key={h.at} class="card__note">
              {t('agent.freight.handBackLine', { when: formatDate(h.at), reason: h.reason })}
            </p>
          ))}
          {!load.pickedUpAt && !load.cancelledAt ? <p class="card__note">{t('agent.freight.handBackAdvice')}</p> : null}
        </Card>
      ) : null}
      {/* FP3b — every failed attempt, and the claim: the two things a shop rings about. */}
      {load.attempts?.length ? (
        <Card tone="soft">
          {load.attempts.map((a) => (
            <p key={a.at} class="card__note">
              {attemptLine(a, t)}
            </p>
          ))}
          {load.status === 'in_transit' ? <p class="card__note">{t('agent.freight.attemptAdvice')}</p> : null}
        </Card>
      ) : null}
      {load.claim ? (
        <Card tone="soft">
          <p class="card__note">{claimLine(load.claim, t)}</p>
        </Card>
      ) : null}
      {/* FP7 — box 13: what the driver is told at the door, and the door to change it while it still can be. */}
      {hasInstructions(load.instructions) || load.instructionsMode !== 'none' ? (
        <Card title={t('common.instructions.title')} aside={load.instructionsMode !== 'none' ? <Button variant="link" full={false} onClick={() => setInstructing(true)}>{t(load.instructionsMode === 'amend' ? 'agent.freight.instructAdd' : hasInstructions(load.instructions) ? 'agent.freight.instructEdit' : 'agent.freight.instructOpen')}</Button> : undefined}>
          {hasInstructions(load.instructions) ? <InstructionsBlock view={load.instructions} /> : <p class="card__note">{t('common.instructions.none')}</p>}
        </Card>
      ) : null}
      <InstructionsSheet load={load} open={instructing} onClose={() => setInstructing(false)} state={state} actions={actions} />

      <div class="btnrow">
        <DocumentButton label={t('common.cmr.open')} title={t('common.cmr.title')} fetch={() => actions.freightNote(load.freightId)} />
        {/* FP3 — withdrawing is possible only until the goods are on a truck; the server says the same. A quiet
            link, not a button: it is the exception, and it is confirmed with a reason in a sheet. */}
        {load.canCancel ? (
          <Button variant="link" danger full={false} onClick={() => setWithdraw(true)}>
            {t('agent.freight.cancelOpen')}
          </Button>
        ) : null}
        {load.canClaim ? (
          <Button variant="link" full={false} onClick={() => setClaiming(true)}>
            {t('agent.freight.claimOpen')}
          </Button>
        ) : null}
        {/* FP6 — the same link the consignment note carries as a QR, here so a shop can send it on WhatsApp. */}
        {load.trackingUrl ? (
          <Button variant="link" full={false} onClick={() => setSharing(true)}>
            {t('agent.freight.trackOpen')}
          </Button>
        ) : null}
        {load.canRate ? (
          <Button variant="link" full={false} onClick={() => setRating(true)}>
            {load.rating ? t('agent.freight.rateChange') : t('agent.freight.rateOpen')}
          </Button>
        ) : null}
      </div>
      {load.carrier ? <p class="scr__lede">{t('agent.freight.carrierLine', { driver: load.carrier.driverName ?? t('agent.freight.carrierUnknown'), plate: load.carrier.plate ?? '' })}</p> : null}
      {load.rating ? <p class="scr__lede">{t('agent.freight.ratedLine', { stars: load.rating.stars })}</p> : null}

      <TrackingSheet load={load} open={sharing} onClose={() => setSharing(false)} />
      <RatingSheet load={load} open={rating} onClose={() => setRating(false)} state={state} actions={actions} />
      {state.error ? <ErrorNote error={state.error} /> : null}

      {loading ? (
        <p class="scr__lede" aria-live="polite">
          {t('common.loading')}
        </p>
      ) : state.prices.length === 0 ? (
        <Card tone="soft">
          <p class="card__note">{t('agent.freight.pricesEmpty')}</p>
        </Card>
      ) : (
        <>
          <div class="rows" role="list">
            {open.map((p) => (
              <PriceRow key={p.proposalId} p={p} load={load} state={state} actions={actions} onTake={() => setConfirm(p)} />
            ))}
          </div>
          {/* Decided prices stay visible. A shop deciding whether to hold out for a better number needs to
              see what it has already turned down, and what was withdrawn from under it. */}
          {decided.length > 0 ? (
            <div class="rows" role="list" style="margin-top:16px">
              {decided.map((p) => (
                <PriceRow key={p.proposalId} p={p} load={load} state={state} actions={actions} onTake={() => undefined} />
              ))}
            </div>
          ) : null}
        </>
      )}

      <Button variant="outline" onClick={() => void actions.openPrices(null)}>
        {t('agent.freight.back')}
      </Button>

      <Sheet open={withdraw} onClose={() => setWithdraw(false)} title={t('agent.freight.cancelTitle')}>
        <p class="t-body">{t('agent.freight.cancelBody', { code: load.code })}</p>
        <div class="field">
          <label class="field__label" for={`why-${load.freightId}`}>
            {t('agent.freight.cancelReasonLabel')}
          </label>
          <textarea id={`why-${load.freightId}`} class="input" rows={2} maxLength={500} value={reason} onInput={(e) => setReason(e.currentTarget.value)} />
        </div>
        <div style="margin-top:14px">
          <Button
            chevron={false}
            busy={state.busy === `cancel-freight:${load.freightId}`}
            disabled={reason.trim().length < 3}
            onClick={() => {
              const why = reason.trim();
              setWithdraw(false);
              setReason('');
              void actions.cancelFreight(load.freightId, why);
            }}
          >
            {t('agent.freight.cancelConfirm')}
          </Button>
          <Button variant="link" onClick={() => setWithdraw(false)}>
            {t('agent.cancel')}
          </Button>
        </div>
      </Sheet>

      {/* FP3b — the claim. What was found, in the shop's words, with a photo if there is one; an operator
          decides it and the shop is shown the reason. Nothing is promised here about money: whether there is
          any to award depends on whether the network billed this load at all. */}
      <Sheet open={claiming} onClose={() => setClaiming(false)} title={t('agent.freight.claimTitle')}>
        <p class="t-body">{t('agent.freight.claimBody', { code: load.code })}</p>
        <div class="field">
          <label class="field__label" for={`ckind-${load.freightId}`}>
            {t('agent.freight.claimKindLabel')}
          </label>
          <select id={`ckind-${load.freightId}`} class="input" value={claimKind} onChange={(e) => setClaimKind(e.currentTarget.value as 'damaged' | 'short' | 'not_received')}>
            <option value="damaged">{t('agent.freight.claimDamaged')}</option>
            <option value="short">{t('agent.freight.claimShort')}</option>
            <option value="not_received">{t('agent.freight.claimNotReceived')}</option>
          </select>
        </div>
        <div class="field" style="margin-top:10px">
          <label class="field__label" for={`ctext-${load.freightId}`}>
            {t('agent.freight.claimTextLabel')}
          </label>
          <textarea id={`ctext-${load.freightId}`} class="input" rows={3} maxLength={1000} value={claimText} onInput={(e) => setClaimText(e.currentTarget.value)} />
        </div>
        <div class="field" style="margin-top:10px">
          <span class="field__label">{t('agent.freight.claimPhotoLabel')}</span>
          <PhotoField id={`cphoto-${load.freightId}`} value={claimPhoto} upload={(f) => actions.uploadPhoto('dispute', f)} onCapture={setClaimPhoto} label={t('agent.freight.claimPhotoAria')} />
        </div>
        <div style="margin-top:14px">
          <Button
            chevron={false}
            busy={state.busy === `claim-freight:${load.freightId}`}
            disabled={claimText.trim().length < 3}
            onClick={() => {
              const body = { kind: claimKind, description: claimText.trim(), ...(claimPhoto ? { photoRef: claimPhoto } : {}) };
              setClaiming(false);
              setClaimText('');
              setClaimPhoto('');
              void actions.openFreightClaim(load.freightId, body);
            }}
          >
            {t('agent.freight.claimConfirm')}
          </Button>
          <Button variant="link" onClick={() => setClaiming(false)}>
            {t('agent.cancel')}
          </Button>
        </div>
      </Sheet>

      {/* Taking a price CLAIMS the load and settles the money, so it is confirmed in a sheet — the same
          shape the counter already uses for a claim or a bag load, and the screen's one blue CTA lives here
          rather than repeating down a list of rows. */}
      <Sheet open={!!confirm} onClose={() => setConfirm(null)} title={t('agent.freight.confirmTitle')}>
        {confirm ? (
          <>
            <p class="t-body">{t('agent.freight.confirmBody', { amount: confirm.price.toFixed(2), code: load.code })}</p>
            <Checklist
              items={[
                t('agent.freight.confirmRun', { empty: confirm.deadheadKm, loaded: confirm.loadedKm }),
                ...(load.maxSpend != null ? [t('agent.freight.budget', { amount: load.maxSpend.toFixed(2) })] : []),
              ]}
            />
            <Button
              chevron={false}
              busy={state.busy === `accept-price:${confirm.proposalId}`}
              onClick={() => {
                const p = confirm;
                setConfirm(null);
                void actions.acceptPrice(p);
              }}
            >
              {t('agent.freight.accept')}
            </Button>
            <Button variant="link" onClick={() => setConfirm(null)}>
              {t('agent.cancel')}
            </Button>
          </>
        ) : null}
      </Sheet>
    </>
  );
}

function PriceRow({ p, load, state, actions, onTake }: { p: FreightPrice; load: PostedFreight; onTake: () => void } & FreightScreenProps) {
  const t = useT();
  const decided = p.status !== 'open';
  // Named locally rather than trusted from the server's refusal: the shop should see that a price is over
  // budget BEFORE tapping accept and being told, so the conversation with the customer happens first.
  const overBudget = load.maxSpend != null && p.price > load.maxSpend;
  return (
    <div class={`row row--static${decided ? ' row--muted' : ''}`} role="listitem">
      <span class="row__ic">
        <Icon name="wallet" size={24} />
      </span>
      <span class="row__body">
        <span class="row__t">{t('agent.freight.priceLine', { amount: p.price.toFixed(2) })}</span>
        <span class="row__s">{t('agent.freight.priceRun', { empty: p.deadheadKm, loaded: p.loadedKm })}</span>
        {/* The driver's own words for the number. Often the whole reason it is low. */}
        {p.note ? <span class="row__s">“{p.note}”</span> : null}
        {decided ? (
          <span class="freight__tags">
            <Pill tone="idle">{t(`agent.freight.priceStatus.${p.status}` as 'agent.freight.priceStatus.accepted')}</Pill>
          </span>
        ) : (
          <>
            {overBudget ? (
              <span class="freight__tags">
                <Pill tone="warn">{t('agent.freight.overBudget')}</Pill>
              </span>
            ) : null}
            <span class="freight__acts">
              {/* Link-weight, because the screen's one solid CTA belongs in the confirming sheet — a list of
                  blue buttons would make eight equivalent prices look like eight recommendations. */}
              <Button variant="link" full={false} disabled={overBudget} onClick={onTake}>
                {t('agent.freight.accept')}
              </Button>
              <Button variant="link" full={false} busy={state.busy === `decline-price:${p.proposalId}`} onClick={() => void actions.declinePrice(p)}>
                {t('agent.freight.decline')}
              </Button>
            </span>
          </>
        )}
      </span>
    </div>
  );
}

/**
 * FP6 — the tracking link, to hand on. The receiver is usually not on the network at all; what they get is a
 * link and a QR that answer where the load is and who will be at the door, and nothing more. Share where the
 * phone can, copy where it cannot.
 */
function TrackingSheet({ load, open, onClose }: { load: PostedFreight; open: boolean; onClose: () => void }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const url = load.trackingUrl ?? '';
  const send = async () => {
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
        await navigator.share({ title: t('agent.freight.trackShareTitle', { code: load.code }), text: t('agent.freight.trackShareText', { code: load.code, dest: load.destLabel }), url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      /* dismissed, or no clipboard — the link is on screen to copy by hand */
    }
  };
  return (
    <Sheet open={open} onClose={onClose} title={t('agent.freight.trackTitle', { code: load.code })}>
      <p class="t-body">{t('agent.freight.trackBody')}</p>
      <QrBlock value={url} size={180} caption={load.trackingKey ?? ''} label={t('agent.freight.trackQrLabel', { code: load.code })} />
      <p class="mono-t" style="word-break:break-all;font-size:0.9rem">{url}</p>
      {copied ? <p class="card__note">{t('agent.freight.trackCopied')}</p> : null}
      <Button chevron={false} onClick={() => void send()}>
        {t('agent.freight.trackShare')}
      </Button>
      <Button variant="link" onClick={onClose}>
        {t('agent.freight.close')}
      </Button>
    </Sheet>
  );
}

const ISSUE_KEYS = [
  ['LATE_PICKUP', 'agent.freight.issueLatePickup'],
  ['LATE_ARRIVAL', 'agent.freight.issueLateArrival'],
  ['KEPT_OVERNIGHT', 'agent.freight.issueOvernight'],
  ['AFTER_HOURS', 'agent.freight.issueAfterHours'],
  ['EQUIPMENT_FAILURE', 'agent.freight.issueEquipment'],
  ['ROUGH_HANDLING', 'agent.freight.issueRough'],
] as const;

/**
 * FP6 — the verdict. Stars, and tags for what went wrong: tags rather than prose, so what a shop says of a
 * driver is the same kind of thing every other shop says, and can be counted. Last wins on the same load.
 */
function RatingSheet({ load, open, onClose, state, actions }: { load: PostedFreight; open: boolean; onClose: () => void } & FreightScreenProps) {
  const t = useT();
  const [stars, setStars] = useState(load.rating?.stars ?? 0);
  const [issues, setIssues] = useState<string[]>(load.rating?.issues ?? []);
  const busy = state.busy === `rate-freight:${load.freightId}`;
  return (
    <Sheet open={open} onClose={onClose} title={t('agent.freight.rateTitle', { code: load.code })}>
      <p class="t-body">{t('agent.freight.rateBody', { driver: load.carrier?.driverName ?? t('agent.freight.carrierUnknown') })}</p>
      <div class="field">
        <span class="field__label">{t('agent.freight.rateStars')}</span>
        <div class="chips" role="radiogroup" aria-label={t('agent.freight.rateStars')} style="display:flex;flex-wrap:wrap;gap:8px">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} type="button" role="radio" aria-checked={stars === n} class={'chip chip--tap' + (stars === n ? ' chip--on' : '')} style="min-width:44px;justify-content:center" onClick={() => setStars(n)}>
              {t('agent.freight.starN', { n })}
            </button>
          ))}
        </div>
      </div>
      <div class="field" style="margin-top:12px">
        <span class="field__label">{t('agent.freight.rateIssues')}</span>
        <div class="chips" style="display:flex;flex-wrap:wrap;gap:8px">
          {ISSUE_KEYS.map(([key, labelKey]) => {
            const on = issues.includes(key);
            return (
              <button key={key} type="button" class={'chip chip--tap' + (on ? ' chip--on' : '')} aria-pressed={on} onClick={() => setIssues(on ? issues.filter((i) => i !== key) : [...issues, key])}>
                {t(labelKey)}
              </button>
            );
          })}
        </div>
        <p class="hint" style="margin-top:6px">{t('agent.freight.rateIssuesHint')}</p>
      </div>
      <div style="margin-top:14px">
        <Button
          chevron={false}
          busy={busy}
          disabled={stars < 1}
          onClick={() => {
            onClose();
            void actions.rateFreight(load.freightId, { stars, issues });
          }}
        >
          {t('agent.freight.rateConfirm')}
        </Button>
        <Button variant="link" onClick={onClose}>
          {t('agent.cancel')}
        </Button>
      </div>
    </Sheet>
  );
}

/**
 * FP7 — the sender's instructions after posting. Until the goods are taken over the whole box is the shop's to
 * rewrite; once on the road only a subsequent instruction can be added, dated, never overwriting what the driver
 * was already told — which is how the CMR does it, and why the sheet changes shape with the load's status.
 */
function InstructionsSheet({ load, open, onClose, state, actions }: { load: PostedFreight; open: boolean; onClose: () => void } & FreightScreenProps) {
  const t = useT();
  const amend = load.instructionsMode === 'amend';
  const [text, setText] = useState(amend ? '' : (load.instructions?.text ?? ''));
  const [contactName, setContactName] = useState(load.instructions?.contactName ?? '');
  const [contactPhone, setContactPhone] = useState(load.instructions?.contactPhone ?? '');
  const [deliveryWindow, setDeliveryWindow] = useState(load.instructions?.deliveryWindow ?? '');
  const busy = state.busy === `instruct-freight:${load.freightId}`;
  const ready = amend ? text.trim().length >= 2 : true;
  return (
    <Sheet open={open} onClose={onClose} title={t(amend ? 'agent.freight.instructAddTitle' : 'agent.freight.instructTitle', { code: load.code })}>
      <p class="t-body">{t(amend ? 'agent.freight.instructAddBody' : 'agent.freight.instructBody')}</p>
      {amend ? null : (
        <>
          <div class="grid2">
            <div class="field">
              <label class="field__label" for={`ic-name-${load.freightId}`}>
                {t('agent.accept.contactName')}
              </label>
              <input id={`ic-name-${load.freightId}`} class="input" value={contactName} onInput={(e) => setContactName(e.currentTarget.value)} />
            </div>
            <div class="field">
              <label class="field__label" for={`ic-phone-${load.freightId}`}>
                {t('agent.accept.contactPhone')}
              </label>
              <input id={`ic-phone-${load.freightId}`} class="input" type="tel" inputMode="tel" value={contactPhone} onInput={(e) => setContactPhone(e.currentTarget.value)} />
            </div>
          </div>
          <div class="field" style="margin-top:12px">
            <label class="field__label" for={`ic-window-${load.freightId}`}>
              {t('agent.accept.deliveryWindow')}
            </label>
            <input id={`ic-window-${load.freightId}`} class="input" value={deliveryWindow} onInput={(e) => setDeliveryWindow(e.currentTarget.value)} placeholder={t('agent.accept.deliveryWindowPh')} />
          </div>
        </>
      )}
      <div class="field" style="margin-top:12px">
        <label class="field__label" for={`ic-text-${load.freightId}`}>
          {t(amend ? 'agent.freight.instructAddLabel' : 'agent.accept.instructions')}
        </label>
        <textarea id={`ic-text-${load.freightId}`} class="input" rows={3} maxLength={500} value={text} onInput={(e) => setText(e.currentTarget.value)} placeholder={t('agent.accept.instructionsPh')} />
      </div>
      <p class="card__note">{t('agent.accept.instructionsNote')}</p>
      <div style="margin-top:14px">
        <Button
          chevron={false}
          busy={busy}
          disabled={!ready}
          onClick={() => {
            onClose();
            void actions.setFreightInstructions(load.freightId, amend ? { text: text.trim() } : { text: text.trim() || undefined, contactName: contactName.trim() || undefined, contactPhone: contactPhone.trim() || undefined, deliveryWindow: deliveryWindow.trim() || undefined });
          }}
        >
          {t(amend ? 'agent.freight.instructAddConfirm' : 'agent.freight.instructConfirm')}
        </Button>
        <Button variant="link" onClick={onClose}>
          {t('agent.cancel')}
        </Button>
      </div>
    </Sheet>
  );
}
