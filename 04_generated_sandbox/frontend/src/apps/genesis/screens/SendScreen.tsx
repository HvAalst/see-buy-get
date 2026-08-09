import { useState } from 'preact/hooks';
import { Button, Card, Checklist, ErrorNote, Icon, Note, PlaceMap, Pill, ReadAloud, ShopDetailSheet } from '../../../shared/ui';
import { fromPlaceWords } from '../../../shared/placewords';
import { cleanPhone, dimsBlocker, journeyLine, lockedPrice, mintChecklist, money, phoneReady, pointDistance, pointLine, quoteSummary, selectablePoints, sizeMeta } from '../logic';
import type { NetworkPoint } from '../types';
import type { SendActions, SendState } from '../useSendApp';

export interface SendScreenProps {
  state: SendState;
  actions: SendActions;
}

/**
 * The SEE of See-Buy-Get, now a real booking (PG3): measure the parcel → drop-off shop →
 * delivery shop → the price — and a signed-in sender carries on: receiver → MINT. The mint
 * is the identical genesis the vendor console gets, so the flow ends with the label on
 * their own phone, not a "pay there and hope" checklist. Guests still price + walk up.
 */
export function SendScreen({ state, actions }: SendScreenProps) {
  switch (state.step) {
    case 'parcel':
      return <ParcelStep state={state} actions={actions} />;
    case 'from':
      return <PointStep state={state} actions={actions} kind="from" />;
    case 'to':
      return <PointStep state={state} actions={actions} kind="to" />;
    case 'quote':
      return <QuoteStep state={state} actions={actions} />;
    case 'book':
      return <BookStep state={state} actions={actions} />;
    default:
      return <DoneStep state={state} actions={actions} />;
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

/* ----------------------------------------------------------------- parcel -- */

function ParcelStep({ state, actions }: SendScreenProps) {
  const blocked = dimsBlocker(state.dims);
  const derived = state.derived;

  return (
    <div class="scr">
      <StepDots at={1} />
      <h1 class="scr__title">What are you sending?</h1>
      <p class="scr__lede">Measure it — the size comes from the numbers, same as in any shop.</p>

      <Card label="Measurements">
        <div class="dims">
          {(
            [
              ['l', 'Length cm'],
              ['w', 'Width cm'],
              ['h', 'Height cm'],
              ['kg', 'Weight kg'],
            ] as const
          ).map(([k, label]) => (
            <div key={k} class="field">
              <label class="field__label" for={`send-dim-${k}`}>
                {label}
              </label>
              <input
                id={`send-dim-${k}`}
                class="input"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.1"
                value={state.dims[k]}
                onInput={(e) => actions.setDims({ [k]: e.currentTarget.value } as never)}
              />
            </div>
          ))}
        </div>
        {derived ? <Pill tone={derived.dedicated ? 'warn' : 'info'}>{`${sizeMeta(derived.size).label} — ${sizeMeta(derived.size).hint}`}</Pill> : <p class="card__note">Fill all four, then continue — the size tier is worked out for you.</p>}
        <label class="checkline" style="margin-top:12px">
          <input type="checkbox" checked={state.fragile} onChange={(e) => actions.setFragile(e.currentTarget.checked)} />
          <span>Fragile — keep it off two-wheelers</span>
        </label>
      </Card>

      {derived?.dedicated ? (
        <Note
          tone="warn"
          icon="truck"
          title="Too big for the parcel network"
          detail="This needs dedicated freight — a truck with the right lifting gear. Ask at a PUDO shop; booking heavy freight from here is coming."
        />
      ) : null}

      {state.deriveError ? <ErrorNote error={state.deriveError} onRetry={() => void actions.submitParcel()} /> : null}

      <Card title="How it works" tone="soft">
        <Checklist items={['See the price before you decide', state.identity ? 'Book it here — your label is ready before you leave home' : 'Sign in to book it — or just walk up and pay at the shop', 'The receiver collects it from a shop near them']} />
      </Card>

      <div class="scr__cta">
        <Button busy={state.deriveBusy} disabled={Boolean(blocked) || Boolean(derived?.dedicated)} onClick={() => void actions.submitParcel()}>
          Continue
        </Button>
        {blocked ? <p class="hint" style="margin-top:8px">{blocked}</p> : null}
      </div>

      <div class="scr__foot">
        <ReadAloud text={() => 'What are you sending? Measure the parcel: length, width and height in centimetres, and the weight in kilograms.'} label="Read this aloud" />
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
  // G4 — the shop whose detail sheet is open (tapping a map pin previews it before committing). The list
  // rows still commit directly; the map is the "look before you leap" surface.
  const [openShop, setOpenShop] = useState<string | null>(null);
  const near = fromPlaceWords(wordsText);
  const points = selectablePoints(state.points, from ? undefined : (state.fromDid ?? undefined), near);
  const picked = from ? state.fromDid : state.toDid;
  const pick = (did: string) => (from ? actions.pickFrom(did) : actions.pickTo(did));
  const preview = openShop ? points.find((p) => p.did === openShop) ?? null : null;

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
          selectedId={openShop ?? picked}
          onPick={setOpenShop}
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
        <Button variant="link" full={false} onClick={() => actions.backTo(from ? 'parcel' : 'from')}>
          Go back a step
        </Button>
        <ReadAloud
          text={() =>
            `${points.length} shops to choose from. ${near ? 'The nearest is first.' : ''} ${from ? 'Pick where you will drop the parcel off.' : 'Pick where it is going.'}`
          }
          label="Read this aloud"
        />
      </div>

      {/* G4 — tap a pin on the map to preview the shop (price, distance, rating) before committing. The
          list rows still commit directly; the shared sheet is the same on every shop picker (G4b). */}
      <ShopDetailSheet
        open={!!preview}
        title={preview?.shopName ?? 'Pickup point'}
        subtitle={preview ? [preview.landmark, `Zone ${preview.zone}`].filter(Boolean).join(' · ') : undefined}
        lines={preview ? shopFacts(preview, pointDistance(preview, near)) : []}
        location={preview?.location ?? null}
        onChoose={preview ? () => { const did = preview.did; setOpenShop(null); pick(did); } : undefined}
        chooseLabel="Choose this pickup"
        chooseDisabled={preview?.openState === 'closed'}
        onClose={() => setOpenShop(null)}
      />
    </div>
  );
}

/** The detail lines a shop preview shows (what the row can't): price, distance, open state, slots, rating. */
function shopFacts(shop: NetworkPoint, away: string | null): string[] {
  return [
    `${money(shop.pricePerParcel)} to handle your parcel`,
    away ? `${away} from your place` : `In zone ${shop.zone}`,
    shop.openState === 'open' ? 'Open now' : 'Closed right now',
    ...(shop.freeSlots != null ? [`${shop.freeSlots} ${shop.freeSlots === 1 ? 'space' : 'spaces'} free`] : []),
    ...(shop.rating?.count ? [`Rated ${shop.rating.average.toFixed(1)} by ${shop.rating.count}`] : []),
  ];
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
  const signedIn = Boolean(state.identity);

  return (
    <div class="scr">
      <StepDots at={4} />
      <h1 class="scr__title">Here is the price</h1>

      {state.quoteState === 'loading' ? <p class="hint">Working out the journey…</p> : null}
      {state.quoteState === 'error' && state.quoteError ? <ErrorNote error={state.quoteError} onRetry={actions.retryQuote} /> : null}

      {/* The market moved between the price and the mint — we bounced back here with the fresh price to re-confirm. */}
      {state.mintError?.code === 'PRICE_CHANGED' ? (
        <Note tone="warn" icon="wallet" title="The price just changed" detail="The route's price moved while you were booking. Here's the new price — tap Book this send to go ahead." />
      ) : null}

      {q ? (
        <>
          <div class="prices">
            <div class="price price--lead">
              <span class="price__title">The price</span>
              <span class="price__total">{money(lockedPrice(q).total)}</span>
              <span class="price__sub">{lockedPrice(q).sub}</span>
            </div>
          </div>

          <Card label="The journey">
            <p class="t-body">{journeyLine(q)}</p>
            <p class="card__note">{`About ${Math.round(q.totalKm)} km · shop and hub fees ${money(q.nodeFees)} inside the price`}</p>
          </Card>

          {signedIn ? null : (
            <Card title="What you do next">
              <Checklist
                items={[
                  `Take the parcel to ${from?.shopName ?? 'your drop-off shop'}`,
                  'Pay there — cash is fine',
                  'You get a tracking code by message',
                ]}
              />
            </Card>
          )}
        </>
      ) : null}

      {q ? (
        <div class="scr__cta">
          {signedIn ? (
            <Button onClick={actions.toBook}>Book this send</Button>
          ) : (
            <Button onClick={() => actions.go('account')}>Sign in to book it</Button>
          )}
        </div>
      ) : null}

      <div class="scr__foot">
        <Button variant="link" full={false} onClick={() => actions.backTo('to')}>
          Change the delivery shop
        </Button>
        <Button variant="link" full={false} onClick={actions.startAgain}>
          Price another parcel
        </Button>
        <ReadAloud text={() => (q ? quoteSummary(q) : 'The price is still loading.')} label="Read this aloud" />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------- book -- */

function BookStep({ state, actions }: SendScreenProps) {
  const q = state.quote;
  const from = state.points.find((p) => p.did === state.fromDid);
  const to = state.points.find((p) => p.did === state.toDid);
  const ready = phoneReady(cleanPhone(state.receiverMobile));

  return (
    <div class="scr">
      <h1 class="scr__title">Who is it going to?</h1>
      <p class="scr__lede">Their number is how the parcel finds them — they see it in their app and collect with it.</p>

      <Card label="The receiver">
        <div class="field">
          <label class="field__label" for="rcv-phone">
            Receiver&rsquo;s phone number
          </label>
          <input
            id="rcv-phone"
            class="input"
            type="tel"
            inputMode="tel"
            value={state.receiverMobile}
            onInput={(e) => actions.setReceiver(e.currentTarget.value)}
            placeholder="07…"
          />
        </div>
        <Button variant="link" full={false} onClick={() => void actions.pickReceiverContact()}>
          Pick from my contacts
        </Button>
      </Card>

      <Card label="Your send">
        <div class="kv">
          <span>From</span>
          <b>{from?.shopName ?? '—'}</b>
        </div>
        <div class="kv">
          <span>To</span>
          <b>{to?.shopName ?? '—'}</b>
        </div>
        {state.derived ? (
          <div class="kv">
            <span>Size</span>
            <b>{sizeMeta(state.derived.size).label}</b>
          </div>
        ) : null}
        {q ? (
          <div class="kv">
            <span>You pay at the shop</span>
            <b>{money(lockedPrice(q).total)}</b>
          </div>
        ) : null}
      </Card>

      {state.mintError ? <ErrorNote error={state.mintError} /> : null}

      <div class="scr__cta">
        <Button busy={state.mintBusy} disabled={!ready} onClick={() => void actions.submitMint()}>
          Make my label
        </Button>
        {!ready ? <p class="hint" style="margin-top:8px">Enter the receiver&rsquo;s number first.</p> : null}
      </div>

      <div class="scr__foot">
        <Button variant="link" full={false} onClick={() => actions.backTo('quote')}>
          Go back to the price
        </Button>
        <ReadAloud text={() => `Type the receiver's phone number, then make the label. You pay ${q ? money(lockedPrice(q).total) : 'the price'} in cash when you drop the parcel at ${from?.shopName ?? 'the shop'}.`} label="Read this aloud" />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------- done -- */

function DoneStep({ state, actions }: SendScreenProps) {
  const m = state.minted;
  // The shop the parcel was actually minted at — snapshotted at mint, immune to any later back-navigation.
  const fromName = state.mintedFromName ?? 'your drop-off shop';
  if (!m) return null;
  const svg = m.label?.svg ?? null;

  const openLabel = () => {
    if (!svg) return;
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  return (
    <div class="scr">
      <h1 class="scr__title">Your label is ready</h1>
      <p class="scr__lede">The parcel already exists on the network — show this at the shop and it is on its way.</p>

      {/* Trusted markup: the SVG comes from OUR backend's mint response, nothing user-authored. */}
      {svg ? <div class="labelbox" dangerouslySetInnerHTML={{ __html: svg }} /> : null}

      <Card title="What happens next">
        <Checklist items={mintChecklist(fromName, m.price.total)} />
      </Card>

      {m.journey ? (
        <Card title="Planned journey">
          <p class="t-body">{m.journey.hops.join(' → ')}</p>
          <p class="card__note">
            {m.journey.mdpRouted ? 'Routed through a sorting hub. ' : 'Direct local hop. '}
            {m.journey.pickupReadyAt ? `Ready for collection around ${new Date(m.journey.pickupReadyAt).toLocaleString()}.` : ''}
          </p>
        </Card>
      ) : null}

      <Card label="Keep for your records">
        <div class="kv">
          <span>Parcel</span>
          <b class="mono-t">{m.parcel.parcelId}</b>
        </div>
        {m.parcel.trackingKey ? (
          <div class="kv">
            <span>Tracking key</span>
            <b class="mono-t">{m.parcel.trackingKey}</b>
          </div>
        ) : null}
        <div class="kv">
          <span>You pay at the shop</span>
          <b>{money(m.price.total)}</b>
        </div>
      </Card>

      <div class="scr__cta">
        <Button onClick={openLabel} disabled={!svg}>
          Open and print the label
        </Button>
      </div>

      <Button variant="outline" onClick={() => actions.go('parcels')}>
        See it in My parcels
      </Button>

      <div class="scr__foot">
        <Button variant="link" full={false} onClick={actions.startAgain}>
          Send another parcel
        </Button>
        <ReadAloud text={() => `Your label is ready. Take the parcel to ${fromName}, show the label, and pay ${money(m.price.total)} in cash. The receiver already sees it in their app.`} label="Read this aloud" />
      </div>
    </div>
  );
}
