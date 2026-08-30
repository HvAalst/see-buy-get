import { useState } from 'preact/hooks';
import { Button, Card, ErrorNote, Icon, Note, OpenInMaps, Pill, ReadAloud, Sheet } from '../../../shared/ui';
import { formatDate, useT } from '../../../shared/i18n';
import { blockerTone, boardDistanceLine, boardSummary, money, unlocks } from '../logic';
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
  const rows = state.board;
  const can = rows.filter((r) => r.canTake).length;
  const opportunities = unlocks(rows);

  // A post-mount loader has not run yet on first paint; treating 'idle' as loading avoids a flash of
  // "nothing on the market" over a request that is about to answer.
  const loading = state.boardState === 'idle' || state.boardState === 'loading';

  return (
    <div class="scr">
      <h1 class="scr__title">{t('driver.board.title')}</h1>
      <p class="scr__lede">{t('driver.board.lede')}</p>

      {state.error ? <ErrorNote error={state.error} /> : null}

      <Reach value={state.boardReach} onChange={actions.setBoardReach} />

      {/* No position, no honest board: every distance, price and the whole sort order are relative to it. */}
      {state.boardState === 'error' && !state.boardFrom ? (
        <Note tone="warn" icon="pin" title={t('driver.board.noLocation')} />
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

          <Unlocks items={opportunities} />

          <div class="rows board__list" role="list">
            {rows.map((row) => (
              <BoardCard key={row.freightId} row={row} onPropose={() => setProposing(row)} />
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
      </div>

      <ProposeSheet row={proposing} state={state} actions={actions} onClose={() => setProposing(null)} />
    </div>
  );
}

/**
 * How far the operator will look — THEIR choice, presented as such.
 *
 * "Everywhere" is first and is the default. The whole point of the board is that the platform stops deciding
 * what is relevant; opening on a narrowed market would quietly re-impose exactly what was removed.
 */
function Reach({ value, onChange }: { value: BoardReach; onChange: (r: BoardReach) => void }) {
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
      <p class="board__reach-note">{t('driver.board.reachNote')}</p>
    </div>
  );
}

/**
 * What one change would open up — the reason a load you cannot take is on the screen at all.
 *
 * Counted only where the change is the ONE thing in the way, so the number is work the operator would really
 * win. Promising loads that a forklift alone would not unlock is the most expensive wrong number here.
 */
function Unlocks({ items }: { items: ReturnType<typeof unlocks> }) {
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
                  ? t('driver.board.unlockCount', { loads: u.loads, amount: money(u.earnings) })
                  : t('driver.board.unlockCountNoPay', { loads: u.loads })}
              </span>
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

function BoardCard({ row, onPropose }: { row: BoardRow; onPropose: () => void }) {
  const t = useT();
  const body = row.bodyDerived;
  return (
    <article class={`board__card${row.canTake ? '' : ' board__card--blocked'}`} role="listitem">
      <div class="board__top">
        <Pill tone={row.canTake ? 'ok' : 'idle'} dot>
          {row.code}
        </Pill>
        {row.commitMode === 'negotiate' ? <Pill tone="info">{t('driver.board.negotiate')}</Pill> : null}
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
              <b>{money(row.price?.total ?? 0)}</b> · {t('driver.board.perKm', { amount: money(row.earningsPerKm) })}
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

      {row.blockers.length > 0 ? (
        <ul class="board__blockers">
          {row.blockers.map((b) => (
            <li key={b.code}>
              <Pill tone={blockerTone(b.kind)}>{b.message}</Pill>
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
              {t('driver.board.proposePrice')}
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
