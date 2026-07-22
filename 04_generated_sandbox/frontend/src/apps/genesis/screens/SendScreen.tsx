import { useState } from 'preact/hooks';
import { Button, Card, Checklist, ErrorNote, Icon, PlaceMap, Pill, ReadAloud } from '../../../shared/ui';
import { fromPlaceWords } from '../../../shared/placewords';
import { SIZES, journeyLine, money, pointDistance, pointLine, priceCards, quoteSummary, selectablePoints } from '../logic';
import type { NetworkPoint } from '../types';
import type { SendActions, SendState } from '../useSendApp';

export interface SendScreenProps {
  state: SendState;
  actions: SendActions;
}

/**
 * The SEE of See-Buy-Get: size → drop-off shop → delivery shop → the price, one decision
 * per step. No typing anywhere — every choice is a tap on a card, and the quote ends in
 * plain instructions (take it to the shop, pay there, get the tracking key by message).
 */
export function SendScreen({ state, actions }: SendScreenProps) {
  switch (state.step) {
    case 'size':
      return <SizeStep state={state} actions={actions} />;
    case 'from':
      return <PointStep state={state} actions={actions} kind="from" />;
    case 'to':
      return <PointStep state={state} actions={actions} kind="to" />;
    default:
      return <QuoteStep state={state} actions={actions} />;
  }
}

function StepDots({ at }: { at: number }) {
  return (
    <div class="dots" role="img" aria-label={`Step ${at} of 4`}>
      {[1, 2, 3, 4].map((n) => (
        <span key={n} class={`dots__dot${n === at ? ' dots__dot--on' : n < at ? ' dots__dot--done' : ''}`} />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------- size -- */

function SizeStep({ state, actions }: SendScreenProps) {
  return (
    <div class="scr">
      <StepDots at={1} />
      <h1 class="scr__title">What are you sending?</h1>
      <p class="scr__lede">Tap the size that fits it.</p>

      <div class="sizes" role="group" aria-label="Parcel size">
        {SIZES.map((s) => (
          <button
            key={s.key}
            type="button"
            class={`size${state.size === s.key ? ' size--on' : ''}`}
            aria-pressed={state.size === s.key}
            onClick={() => actions.pickSize(s.key)}
          >
            <span class="size__k">{s.label}</span>
            <span class="size__h">{s.hint}</span>
          </button>
        ))}
      </div>

      <Card title="No account needed" tone="soft">
        <Checklist items={['See the price before you decide', 'Pay at the shop when you drop it off', 'Track it with the code you get by message']} />
      </Card>

      <div class="scr__foot">
        <ReadAloud text={() => 'What are you sending? Tap small, medium, large, or heavy.'} label="Read this aloud" />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ from / to -- */

function PointStep({ state, actions, kind }: SendScreenProps & { kind: 'from' | 'to' }) {
  const from = kind === 'from';
  /**
   * The three words are the address substitute: type (or repeat aloud) where you are —
   * or where the receiver is — and the shops re-order nearest-first with distances.
   * No street address anywhere in the flow.
   */
  const [wordsText, setWordsText] = useState('');
  const near = fromPlaceWords(wordsText);
  const points = selectablePoints(state.points, from ? undefined : (state.fromDid ?? undefined), near);
  const picked = from ? state.fromDid : state.toDid;
  const pick = (did: string) => (from ? actions.pickFrom(did) : actions.pickTo(did));

  return (
    <div class="scr">
      <StepDots at={from ? 2 : 3} />
      <h1 class="scr__title">{from ? 'Where will you drop it off?' : 'Where is it going?'}</h1>
      <p class="scr__lede">{from ? 'Tap the shop nearest to you — on the map or in the list.' : 'Tap the shop nearest to the person receiving it.'}</p>

      {state.pointsState === 'loading' ? <p class="hint">Finding shops…</p> : null}
      {state.pointsState === 'error' && state.pointsError ? <ErrorNote error={state.pointsError} onRetry={() => void actions.loadPoints()} /> : null}
      {state.pointsState === 'ready' && points.length === 0 ? (
        <Card>
          <p class="t-body">No shops are on the network here yet.</p>
        </Card>
      ) : null}

      {points.length ? (
        <PlaceMap
          label={`Map of ${points.length} shops${near ? ' with your three-words place marked' : ''}`}
          pins={points.filter((p) => p.location && p.openState === 'open').map((p) => ({ id: p.did, label: p.shopName, point: p.location! }))}
          selectedId={picked}
          onPick={pick}
          reference={near}
        />
      ) : null}

      <Card label={from ? 'Where are you? Say it in three words' : 'Where is the receiver? Say it in three words'}>
        <input
          class="input"
          value={wordsText}
          onInput={(e) => setWordsText(e.currentTarget.value)}
          placeholder="goldfox calmriver blueowl"
          autocapitalize="none"
          autocomplete="off"
          spellcheck={false}
        />
        <p class="card__note">
          {near
            ? 'Found it — the nearest shops are now first.'
            : wordsText.trim()
              ? 'Not a place yet — three words, like on a shop sign.'
              : 'Every place has three words — shops show theirs on a sign. No street name needed.'}
        </p>
      </Card>

      <div class="rows" role="list">
        {points.map((p) => (
          <PointRow key={p.did} point={p} picked={picked === p.did} away={pointDistance(p, near)} onPick={() => pick(p.did)} />
        ))}
      </div>

      <div class="scr__foot">
        <Button variant="link" full={false} onClick={() => actions.backTo(from ? 'size' : 'from')}>
          Go back a step
        </Button>
        <ReadAloud
          text={() =>
            `${points.length} shops to choose from. ${near ? 'The nearest is first.' : ''} ${from ? 'Pick where you will drop the parcel off.' : 'Pick where it is going.'}`
          }
          label="Read this aloud"
        />
      </div>
    </div>
  );
}

function PointRow({ point, picked, away, onPick }: { point: NetworkPoint; picked: boolean; away: string | null; onPick: () => void }) {
  const closed = point.openState === 'closed';
  return (
    <button type="button" class="row" disabled={closed} aria-pressed={picked} onClick={onPick}>
      <span class="row__ic">
        <Icon name={picked ? 'check' : 'home'} size={24} />
      </span>
      <span class="row__body">
        <span class="row__t">{point.shopName}</span>
        <span class="row__s">{closed ? 'Closed right now' : `${away ? `${away} · ` : ''}${pointLine(point)}`}</span>
      </span>
      <span class="row__end">
        {closed ? (
          <Pill tone="idle" dot>
            Closed
          </Pill>
        ) : (
          <Icon name="chevronRight" size={22} />
        )}
      </span>
    </button>
  );
}

/* ------------------------------------------------------------------ quote -- */

function QuoteStep({ state, actions }: SendScreenProps) {
  const q = state.quote;
  const from = state.points.find((p) => p.did === state.fromDid);

  return (
    <div class="scr">
      <StepDots at={4} />
      <h1 class="scr__title">Here is the price</h1>

      {state.quoteState === 'loading' ? <p class="hint">Working out the journey…</p> : null}
      {state.quoteState === 'error' && state.quoteError ? <ErrorNote error={state.quoteError} onRetry={actions.retryQuote} /> : null}

      {q ? (
        <>
          <div class="prices">
            {priceCards(q).map((c) => (
              <div key={c.key} class={`price${c.key === 'locked' ? ' price--lead' : ''}`}>
                <span class="price__title">{c.title}</span>
                <span class="price__total">{money(c.total)}</span>
                <span class="price__sub">{c.sub}</span>
              </div>
            ))}
          </div>

          <Card label="The journey">
            <p class="t-body">{journeyLine(q)}</p>
            <p class="card__note">{`About ${Math.round(q.totalKm)} km · shop and hub fees ${money(q.nodeFees)} inside the price`}</p>
          </Card>

          <Card title="What you do next">
            <Checklist
              items={[
                `Take the parcel to ${from?.shopName ?? 'your drop-off shop'}`,
                'Pay there — cash is fine',
                'You get a tracking code by message',
              ]}
            />
          </Card>
        </>
      ) : null}

      <div class="scr__cta">
        <Button onClick={actions.startAgain}>Price another parcel</Button>
      </div>

      <div class="scr__foot">
        <Button variant="link" full={false} onClick={() => actions.backTo('to')}>
          Change the delivery shop
        </Button>
        <ReadAloud text={() => (q ? quoteSummary(q) : 'The price is still loading.')} label="Read this aloud" />
      </div>
    </div>
  );
}
