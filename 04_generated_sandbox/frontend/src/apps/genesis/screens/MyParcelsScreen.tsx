import { useEffect } from 'preact/hooks';
import { Button, Card, Checklist, CodeCard, ErrorNote, Icon, Pill, ReadAloud } from '../../../shared/ui';
import { LADDER, isOffLadder, ladderIndex, parcelRowLine, relationWord, sortForPerson, statusPresentation, stepTime } from '../logic';
import type { ConsumerParcelView, ParcelStatus } from '../types';
import type { SendActions, SendState } from '../useSendApp';

export interface MyParcelsScreenProps {
  state: SendState;
  actions: SendActions;
}

const PILL_TONE = { ok: 'ok', info: 'info', danger: 'danger' } as const;

/**
 * The receiver/sender home (S21). Every parcel this person is a party to, matched by their verified
 * phone — the parcels coming TO them first (the ones they act on), then the ones they are sending.
 * Tapping a parcel opens its authenticated twin: the same status ladder the public track shows, but
 * reached by identity, not by pasting a code.
 */
export function MyParcelsScreen({ state, actions }: MyParcelsScreenProps) {
  useEffect(() => {
    if (state.parcelsState === 'idle') void actions.loadParcels();
  }, [state.parcelsState, actions]);

  const open = openParcelView(state);
  if (open) return <ParcelDetail parcel={open} state={state} actions={actions} />;

  const received = sortForPerson(state.parcels?.received ?? []);
  const sent = sortForPerson(state.parcels?.sent ?? []);
  const empty = state.parcelsState === 'ready' && received.length === 0 && sent.length === 0;

  return (
    <div class="scr">
      <h1 class="scr__title">My parcels</h1>
      <p class="scr__lede">Everything you send and receive, in one place.</p>

      {state.parcelsState === 'error' && state.parcelsError ? (
        <ErrorNote error={state.parcelsError} onRetry={() => void actions.loadParcels()} />
      ) : null}

      {received.length ? (
        <ParcelGroup title="Coming to you" items={received} actions={actions} />
      ) : null}
      {sent.length ? (
        <ParcelGroup title="You are sending" items={sent} actions={actions} />
      ) : null}

      {empty ? (
        <Card tone="soft">
          <Checklist items={['Parcels sent to your number show up here', 'So do the ones you send', 'No code to type — it is your account']} />
        </Card>
      ) : null}

      {state.parcelsState === 'loading' && !state.parcels ? <p class="hint">Loading your parcels…</p> : null}

      <div class="scr__foot">
        <Button variant="link" onClick={() => void actions.loadParcels()} busy={state.parcelsState === 'loading'}>
          Refresh
        </Button>
        <ReadAloud text={() => (empty ? 'You have no parcels yet.' : 'Your parcels are listed here, the ones coming to you first.')} label="Read this aloud" />
      </div>
    </div>
  );
}

function ParcelGroup({ title, items, actions }: { title: string; items: ConsumerParcelView[]; actions: SendActions }) {
  return (
    <Card title={title}>
      <div class="rows">
        {items.map((p) => {
          const pres = statusPresentation(p.status);
          return (
            <button key={p.parcelId} type="button" class="row" onClick={() => void actions.openParcel(p.parcelId)}>
              <span class="row__ic">
                <Icon name={pres.icon} size={24} />
              </span>
              <span class="row__body">
                <span class="row__t">{p.parcelId}</span>
                <span class="row__s">{parcelRowLine(p)}</span>
              </span>
              <span class="row__end">
                <Pill tone={PILL_TONE[pres.tone]} dot>{pres.word}</Pill>
                <Icon name="chevronRight" size={22} />
              </span>
            </button>
          );
        })}
      </div>
    </Card>
  );
}

function ParcelDetail({ parcel, state, actions }: { parcel: ConsumerParcelView; state: SendState; actions: SendActions }) {
  const pres = statusPresentation(parcel.status);
  const at = ladderIndex(parcel.status);
  const off = isOffLadder(parcel.status);
  const stepFor = (s: ParcelStatus) => parcel.timeline.find((x) => x.status === s || (s === 'Created' && x.status === 'CREATED'));

  return (
    <div class="scr">
      <div class="scr__back">
        <Button variant="link" chevron={false} onClick={() => actions.closeParcel()}>
          <Icon name="chevronLeft" size={20} /> All parcels
        </Button>
      </div>

      <h1 class="scr__title">{parcel.parcelId}</h1>
      <p class="scr__lede">{relationWord(parcel.relation)} · {parcel.relation === 'received' ? `from ${parcel.originZone}` : `to ${parcel.destZone}`}</p>

      <section class={`now now--${pres.tone}`} aria-live="polite">
        <Icon name={pres.icon} size={34} class="now__ic" />
        <span class="now__body">
          <span class="now__word">{pres.word}</span>
          <span class="now__sub">
            {parcel.status === 'Ready_For_Pickup'
              ? `Ready to collect in ${parcel.destZone}`
              : parcel.status === 'Delivered'
                ? `Handed over in ${parcel.destZone}`
                : parcel.relation === 'received'
                  ? `On its way to ${parcel.destZone}`
                  : `On its way from ${parcel.originZone}`}
          </span>
        </span>
      </section>

      {/* The single-parcel twin (which carries the collect token) failed to load — surface it + let them
          retry, instead of silently showing the token-less list row for a parcel that is ready to collect. */}
      {state.openParcelState === 'error' && state.openParcelError ? (
        <ErrorNote error={state.openParcelError} onRetry={() => void actions.openParcel(parcel.parcelId)} />
      ) : null}

      {/* S22: the in-app collection token — the receiver shows this QR (or reads the code) at the shop;
          the PUDO scans it. Delivered in the app, never by SMS. Present only when it is theirs to collect. */}
      {parcel.collectToken ? (
        <>
          <CodeCard label="Show this to collect" code={parcel.collectToken.code} scanAs="collect" sayLabel="Hear your code" />
          <p class="hint">Show the code to the shop, or let them scan it.</p>
        </>
      ) : null}

      {parcel.items?.length ? (
        <Card label="What is inside">
          <Checklist items={parcel.items.map((it) => `${it.qty} × ${it.name}`)} />
        </Card>
      ) : null}

      {off ? null : (
        <Card label="The journey so far">
          <ol class="ladder">
            {LADDER.map((s, i) => {
              const p = statusPresentation(s);
              const done = i < at;
              const now = i === at;
              const step = stepFor(s);
              return (
                <li key={s} class={`ladder__rung${done ? ' ladder__rung--done' : ''}${now ? ' ladder__rung--now' : ''}`}>
                  <span class="ladder__ic" aria-hidden="true">
                    <Icon name={done ? 'check' : p.icon} size={20} />
                  </span>
                  <span class="ladder__body">
                    <span class="ladder__word">{p.word}</span>
                    {step ? <span class="ladder__time">{stepTime(step.at)}</span> : null}
                  </span>
                </li>
              );
            })}
          </ol>
        </Card>
      )}

      {parcel.trackingKey ? <p class="hint">Share code: {parcel.trackingKey}</p> : null}

      <div class="scr__foot">
        <ReadAloud text={() => `Parcel ${parcel.parcelId}: ${pres.word.toLowerCase()}.`} label="Read this aloud" />
      </div>
    </div>
  );
}

/**
 * Resolve the open parcel: prefer the freshly-fetched single-parcel twin (it carries the S22 collect
 * token); fall back to the list row so the detail paints instantly while that fetch is in flight.
 */
function openParcelView(state: SendState): ConsumerParcelView | null {
  if (!state.openParcelId) return null;
  if (state.openParcelDetail?.parcelId === state.openParcelId) return state.openParcelDetail;
  const all = [...(state.parcels?.received ?? []), ...(state.parcels?.sent ?? [])];
  return all.find((p) => p.parcelId === state.openParcelId) ?? null;
}
