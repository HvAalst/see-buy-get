import { useState } from 'preact/hooks';
import { Button, Card, ErrorNote, Explainer, ExplainerReset, Icon, Note, OpenInMaps, PlacePicker, Pill, ReadAloud, Sheet, type PlaceNote } from '../../../shared/ui';
import { formatDate, useT, type Translate } from '../../../shared/i18n';
import { narrow } from '../../../lib/sbg';
import { ConversationList, ConversationSheet } from '../../../shared/conversation/Conversations';
import type { ChatThread } from '../../../shared/conversation/logic';
import { blockerTone, boardDistanceLine, boardSummary, cash, originReady, unlocks } from '../logic';
import type { BoardRow } from '../types';
import { BOARD_REACHES, type BoardReach, type DriverActions, type DriverState } from '../useDriverApp';

export interface BoardScreenProps {
  state: DriverState;
  actions: DriverActions;
}

/**
 * FB2 — the open freight market.
 *
 * The other half of the driver's relationship with work. The offer deck is the network TELLING a driver
 * about a load; this is the operator going to look. Everything on screen follows from that: no card deck to
 * swipe through one at a time, no countdown, no single blue Claim — a list to read, sorted by what the money
 * is worth per kilometre turned, with the loads that cannot be taken still on it and marked.
 */
export function BoardScreen({ state, actions }: BoardScreenProps) {
  const t = useT();
  const [proposing, setProposing] = useState<BoardRow | null>(null);
  const [picking, setPicking] = useState(false);
  // CV1 — the thread open in the sheet, why asking failed (if it did), and a tick to re-read the list.
  const [thread, setThread] = useState<ChatThread | null>(null);
  const [askFailed, setAskFailed] = useState<string | null>(null);
  const [chatTick, setChatTick] = useState(0);
  const ask = async (row: BoardRow) => {
    if (!actions.chatApi) return;
    setAskFailed(null);
    const r = await actions.chatApi.open(row.freightId);
    if (r.error) return setAskFailed(r.error.detail || r.error.title);
    setThread(narrow<ChatThread>(r.data));
    setChatTick((n) => n + 1);
  };
  const rows = state.board;
  const can = rows.filter((r) => r.canTake).length;
  const opportunities = unlocks(rows);

  // A post-mount loader has not run yet on first paint; treating 'idle' as loading avoids a flash of
  // "nothing on the market" over a request that is about to answer.
  const loading = state.boardState === 'idle' || state.boardState === 'loading';

  return (
    <div class="scr">
      <h1 class="scr__title">{t('driver.board.title')}</h1>
      <Explainer who={state.driver?.did} id="driver.board.how" text={t('driver.board.lede')} />

      {/* FP8 — an hours refusal carries the numbers in its detail; they are the whole answer to "why not". */}
      {state.error ? <ErrorNote error={state.error} showDetail={state.error.code === 'HOURS_EXCEEDED'} /> : null}
      {askFailed ? <Note tone="warn" icon="warning" title={askFailed} detail="" /> : null}

      {/* CV1 — the questions this driver has asked, and the answers waiting. Above the market, because an
          answer is usually the next thing to act on.
          The card is the LIST'S to draw, so a driver who has never had a conversation does not carry a
          white block reading "No conversations yet" down every screen of the market. Its value is the
          answers in it; empty, it was a fifth of a phone spent on nothing. A conversation starts from a
          load further down this same screen, so nothing is lost by it not being announced here. */}
      <ConversationList api={actions.chatApi} refreshKey={chatTick} onOpen={setThread} cardTitle={t('common.chat.listTitle')} />

      <Origin state={state} actions={actions} onPick={() => setPicking(true)} />
      <Reach value={state.boardReach} onChange={actions.setBoardReach} who={state.driver?.did} />

      {/* No position, no honest board: every distance, price and the whole sort order are relative to it.
          FB3a — and now there is a way out of it that is not "go outside": name the place instead. */}
      {state.boardState === 'error' && !state.boardFrom ? (
        <Note tone="warn" icon="pin" title={t('driver.board.noLocation')} detail={t('driver.board.noLocationFix')} />
      ) : null}

      {loading ? (
        <p class="scr__lede" aria-live="polite">
          {t('common.loading')}
        </p>
      ) : rows.length === 0 ? (
        <Card title={t('driver.board.emptyTitle')} tone="soft">
          <p class="card__note">{t('driver.board.emptyLede')}</p>
        </Card>
      ) : (
        <>
          <p class="board__count">
            <b>{t('driver.board.countAll', { n: rows.length })}</b>
            <span>{t('driver.board.countSplit', { can, blocked: rows.length - can })}</span>
          </p>

          <Unlocks items={opportunities} currency={state.session.currency} />

          <div class="rows board__list" role="list">
            {rows.map((row) => (
              <BoardCard key={row.freightId} row={row} currency={state.session.currency} onPropose={() => setProposing(row)} onAsk={() => void ask(row)} />
            ))}
          </div>
        </>
      )}

      <div class="scr__cta">
        <Button onClick={actions.loadBoard} busy={loading}>
          {t('driver.board.refresh')}
        </Button>
      </div>

      <div class="scr__foot">
        <ReadAloud text={() => boardSummary(rows, t)} />
        <ExplainerReset who={state.driver?.did} />
      </div>

      <OriginSheet state={state} actions={actions} open={picking} onClose={() => setPicking(false)} />
      <ProposeSheet row={proposing} state={state} actions={actions} onClose={() => setProposing(null)} />
      <ConversationSheet
        api={actions.chatApi}
        thread={thread}
        onClose={() => setThread(null)}
        onChanged={() => setChatTick((n) => n + 1)}
        // CV2 — a price records the empty run from where the driver is; the market already knows that point.
        positionFor={async () => state.boardFrom}
      />
    </div>
  );
}

/**
 * FB3a — WHERE the operator is looking from, said out loud above the list.
 *
 * It has to be stated rather than assumed, because every distance and every price on the board below is
 * measured from this point, and once it can be somewhere other than the device the two readings of "40 km
 * away" come apart. A board that silently answered about Mombasa while the operator read it as "from here"
 * would be worse than one that never let them ask.
 */
function Origin({ state, actions, onPick }: { state: DriverState; actions: DriverActions; onPick: () => void }) {
  const t = useT();
  const here = state.boardOrigin == null;
  return (
    <div class="board__origin">
      <Icon name="pin" size={18} class="board__origin-ic" />
      <p class="board__origin-txt">{here ? t('driver.board.originHere') : t('driver.board.originThere', { where: state.boardOrigin!.label })}</p>
      <div class="board__origin-acts">
        {/* Offered only when it would change something. "Use where I am" while already there is a button
            that does nothing, which teaches an operator that the controls on this screen are decorative. */}
        {here ? null : (
          <button type="button" class="board__origin-btn" onClick={actions.useMyPosition}>
            {t('driver.board.originHereBtn')}
          </button>
        )}
        <button type="button" class="board__origin-btn" onClick={onPick}>
          {here ? t('driver.board.originSet') : t('driver.board.originChange')}
        </button>
      </div>
    </div>
  );
}

/** The origin picker. A sheet rather than an inline field: it carries a map, and the board behind it is the
 *  thing being changed — pushing the list down by a map's height on every visit would bury it. */
function OriginSheet({ state, actions, open, onClose }: { state: DriverState; actions: DriverActions; open: boolean; onClose: () => void }) {
  const t = useT();
  const draft = state.boardPlace;
  const ready = originReady(draft);
  return (
    <Sheet open={open} title={t('driver.board.originTitle')} onClose={onClose}>
      <p class="card__note">{t('driver.board.originLede')}</p>
      <PlacePicker
        id="board-origin"
        fieldLabel={t('driver.board.originLabel')}
        placeholder={t('driver.board.originPh')}
        mapLabel={t('driver.board.originMapLabel')}
        findLabel={t('driver.route.findOnMap')}
        label={draft.label}
        pin={draft.pin}
        reference={state.boardFrom}
        onLabel={(label) => actions.setBoardPlace({ label })}
        onPin={(pin, from) => actions.setBoardPlace({ pin, from })}
        geocode={actions.geocodePlace}
        noteText={(n) => originNote(t, n)}
      />
      <Button
        disabled={!ready}
        onClick={() => {
          if (actions.applyBoardOrigin()) onClose();
        }}
      >
        {t('driver.board.originApply')}
      </Button>
    </Sheet>
  );
}

/** What a match MEANS here: not a road or a price, but which market you are about to be shown. */
function originNote(t: Translate, note: PlaceNote): string {
  if (note.kind === 'found') return note.confidence === 'exact' ? t('driver.board.originFound', { where: note.where }) : t('driver.board.originApprox', { where: note.where });
  if (note.kind === 'notFound') return t('driver.board.originNotFound');
  if (note.kind === 'pinned') return t('driver.board.originPinned');
  return t('driver.board.originIdle');
}

/**
 * How far the operator will look — THEIR choice, presented as such.
 *
 * "Everywhere" is first and is the default. The whole point of the board is that the platform stops deciding
 * what is relevant; opening on a narrowed market would quietly re-impose exactly what was removed.
 */
function Reach({ value, onChange, who }: { value: BoardReach; onChange: (r: BoardReach) => void; who: string | null | undefined }) {
  const t = useT();
  return (
    <div class="board__reach">
      <span class="board__reach-lbl" id="board-reach">
        {t('driver.board.reach')}
      </span>
      {/* Click-only toggle group → role=group + aria-pressed, never a tablist (nothing here is a tab panel). */}
      <div class="board__reach-set" role="group" aria-labelledby="board-reach">
        {BOARD_REACHES.map((r) => (
          <button
            key={String(r)}
            type="button"
            class="board__reach-btn"
            aria-pressed={value === r}
            onClick={() => onChange(r)}
          >
            {r == null ? t('driver.board.reachAny') : t('driver.board.reachKm', { km: r })}
          </button>
        ))}
      </div>
      <Explainer who={who} id="driver.board.reach" text={t('driver.board.reachNote')} />
    </div>
  );
}

/**
 * What one change would open up — the reason a load you cannot take is on the screen at all.
 *
 * Counted only where the change is the ONE thing in the way, so the number is work the operator would really
 * win. Promising loads that a forklift alone would not unlock is the most expensive wrong number here.
 */
function Unlocks({ items, currency }: { items: ReturnType<typeof unlocks>; currency?: string }) {
  const t = useT();
  if (items.length === 0) return null;
  return (
    <Card title={t('driver.board.unlockTitle')} tone="soft">
      <p class="card__note">{t('driver.board.unlockLede')}</p>
      <div class="rows" role="list">
        {items.map((u) => (
          <div key={u.code} class="row row--static" role="listitem">
            <span class="row__ic">
              <Icon name="arrowUp" size={24} />
            </span>
            <span class="row__body">
              <span class="row__t">{u.message}</span>
              <span class="row__s">
                {u.earnings > 0
                  ? t('driver.board.unlockCount', { loads: u.loads, amount: cash(u.earnings, currency) })
                  : t('driver.board.unlockCountNoPay', { loads: u.loads })}
              </span>
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function BoardCard({ row, currency, onPropose, onAsk }: { row: BoardRow; currency?: string; onPropose: () => void; onAsk: () => void }) {
  const t = useT();
  const body = row.bodyDerived;
  return (
    <article class={`board__card${row.canTake ? '' : ' board__card--blocked'}`} role="listitem">
      <div class="board__top">
        <Pill tone={row.canTake ? 'ok' : 'idle'} dot>
          {row.code}
        </Pill>
        {row.commitMode === 'negotiate' ? <Pill tone="info">{t('driver.board.negotiate')}</Pill> : null}
        {/* AN EMPTY BOX GOING HOME IS REAL WORK WITH NO CARGO, and the driver learns it here rather than
            at the quay. The weight is the container's own tare, which is why it still needs a real truck. */}
        {row.emptyRun ? <Pill tone="idle">{t('driver.board.emptyRun')}</Pill> : null}
        {row.scheduledPickupAt ? <Pill tone="idle">{t('driver.board.scheduled', { when: formatDate(row.scheduledPickupAt) })}</Pill> : null}
      </div>

      <p class="board__desc">{row.description}</p>

      {/* The rate leads, because it is the sort key and the decision: what this is worth per kilometre
          TURNED, empty run included. Without a vehicle there is no rate, and we say that rather than show 0. */}
      <p class="board__rate">
        <Icon name="wallet" size={24} class="board__rate-ic" />
        <span>
          {row.earningsPerKm != null ? (
            <>
              <b>{cash(row.price?.total ?? 0, currency)}</b> · {t('driver.board.perKm', { amount: cash(row.earningsPerKm, currency) })}
            </>
          ) : (
            t('driver.board.perKmNone')
          )}
        </span>
      </p>

      <div class="board__meta">
        <p class="meta">
          <Icon name="route" size={21} class="meta__ic" />
          <span>{boardDistanceLine(row, t)}</span>
        </p>
        <p class="meta">
          <Icon name="weight" size={21} class="meta__ic" />
          <span>{t('driver.board.weight', { kg: row.weightKg, dest: row.destLabel })}</span>
        </p>
        <p class="meta">
          <Icon name="pin" size={21} class="meta__ic" />
          <span>{t('driver.board.from', { where: row.pickupLabel })}</span>
        </p>
        {body ? (
          <p class="meta">
            <Icon name="truck" size={21} class="meta__ic" />
            {/* A body derived from weight alone is labelled as such. "We measured this" and "we guessed" are
                not the same claim, and an operator sizing a purchase needs to know which one they have. */}
            <span>{body.basis === 'measured' ? t('driver.board.body', { body: body.body }) : t('driver.board.bodyGuessed', { body: body.body })}</span>
          </p>
        ) : null}
      </div>

      {/*
        * A BLOCKER IS A SENTENCE, AND A PILL IS A BADGE.
        *
        * These were rendered as pills, and `.pill` is `white-space: nowrap` — correctly, because a pill
        * holds a status WORD. The server's blockers are reasons written for a driver to act on ("Couple
        * to a vehicle to see whether you can take this load"), so on a phone they ran straight off the
        * right edge of the card, clipped mid-word. Reported from a screenshot.
        *
        * Made to read as what it is: a line, wrapping, with the tone carried by a dot rather than by a
        * lozenge around the text. It mirrors the "you can take this" line in the other branch, which is
        * the same kind of statement with the opposite answer.
        */}
      {row.blockers.length > 0 ? (
        <ul class="board__blockers">
          {row.blockers.map((b) => (
            <li key={b.code} class={`board__blocker board__blocker--${blockerTone(b.kind)}`}>
              <span class="board__blocker-dot" aria-hidden="true" />
              <span>{b.message}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p class="board__can">
          <Icon name="check" size={21} class="meta__ic" />
          <span>{t('driver.board.canTake')}</span>
        </p>
      )}

      <div class="board__foot">
        {row.pickupLocation ? <OpenInMaps point={row.pickupLocation} label={t('driver.navigateTo', { label: row.pickupLabel })} /> : null}
        {/* A negotiate load offers a price, never a claim — its price is not settled, so there is nothing to
            accept. Offered even on a blocked row: naming a price is how an operator opens the conversation
            about the thing that is in the way. */}
        {row.commitMode === 'negotiate' ? (
          <Button variant="outline" full={false} chevron={false} onClick={onPropose}>
            {t('driver.board.negotiate')}
          </Button>
        ) : null}
        {/* CV1 — ask before you commit. Offered on every load, blocked or not: the question is often exactly
            about the thing in the way ("can you load it by hand?"). */}
        <Button variant="link" full={false} onClick={onAsk}>
          {t('common.chat.ask')}
        </Button>
      </div>
    </article>
  );
}

function ProposeSheet({ row, state, actions, onClose }: { row: BoardRow | null; state: DriverState; actions: DriverActions; onClose: () => void }) {
  const t = useT();
  const [price, setPrice] = useState('');
  const [note, setNote] = useState('');
  const amount = Number(price);
  const valid = Number.isFinite(amount) && amount > 0;

  return (
    <Sheet open={!!row} onClose={onClose} title={t('driver.board.proposeTitle')}>
      {row ? (
        <>
          <p class="t-body">{t('driver.board.proposeLede')}</p>
          <p class="t-body">
            <b>{row.code}</b> — {row.description}
          </p>
          <div class="field">
            <label class="field__label" for="propose-price">
              {state.session.currency ? t('driver.board.proposePriceIn', { currency: state.session.currency }) : t('driver.board.proposePrice')}
            </label>
            <input
              id="propose-price"
              class="input"
              type="number"
              inputMode="decimal"
              min="0.01"
              step="0.01"
              value={price}
              onInput={(e) => setPrice(e.currentTarget.value)}
            />
          </div>
          <div class="field">
            <label class="field__label" for="propose-note">
              {t('driver.board.proposeNote')}
            </label>
            <input
              id="propose-note"
              class="input"
              type="text"
              placeholder={t('driver.board.proposeNotePlaceholder')}
              value={note}
              onInput={(e) => setNote(e.currentTarget.value)}
            />
          </div>
          <Button
            chevron={false}
            disabled={!valid}
            busy={state.busy === `propose:${row.freightId}`}
            onClick={() => {
              void actions.proposePrice(row, amount, note).then((ok) => {
                if (ok) {
                  setPrice('');
                  setNote('');
                  onClose();
                }
              });
            }}
          >
            {t('driver.board.proposeSend')}
          </Button>
          {!valid && price !== '' ? <p class="card__note">{t('driver.board.proposeNeedsPrice')}</p> : null}
          <Button variant="link" onClick={onClose}>
            {t('driver.notYet')}
          </Button>
        </>
      ) : null}
    </Sheet>
  );
}
