import { useState } from 'preact/hooks';
import { Button, Card, Checklist, CodeCard, ErrorNote, Icon, Note, PlaceMap, Pill, ReadAloud, ShopDetailSheet } from '../../../shared/ui';
import { fromPlaceWords } from '../../../shared/placewords';
import { distanceLabel, haversineKm } from '../../../shared/geo';
import { PhotoField } from './PhotoField';
import { dimsComplete, handoffLine, money, originRows, priceCards } from '../logic';
import type { NetworkPoint } from '../types';
import type { VendorActions, VendorState } from '../useVendorApp';

export interface MintScreenProps {
  state: VendorState;
  actions: VendorActions;
}

/**
 * The mint — an order becomes a parcel. One decision per step: what is shipping
 * (measure + photo), where the buyer collects, which shop you drop it at (priced
 * cheapest-first against the destination), which price to lock, then the LABEL.
 */
export function MintScreen({ state, actions }: MintScreenProps) {
  switch (state.mintStep) {
    case 'parcel':
      return <ParcelStep state={state} actions={actions} />;
    case 'dest':
      return <DestStep state={state} actions={actions} />;
    case 'origin':
      return <OriginStep state={state} actions={actions} />;
    case 'price':
      return <PriceStep state={state} actions={actions} />;
    case 'label':
      return <LabelStep state={state} actions={actions} />;
    default:
      return <SourceStep state={state} actions={actions} />;
  }
}

function StepDots({ at }: { at: number }) {
  return (
    <div class="dots" role="img" aria-label={`Step ${at} of 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} class={`dots__dot${n === at ? ' dots__dot--on' : n < at ? ' dots__dot--done' : ''}`} />
      ))}
    </div>
  );
}

/* ----------------------------------------------------------------- source -- */

function SourceStep({ state, actions }: MintScreenProps) {
  return (
    <div class="scr">
      <h1 class="scr__title">Ship an order</h1>
      <p class="scr__lede">Start from a buyer's checkout, or make a label by hand.</p>

      {state.error ? <ErrorNote error={state.error} /> : null}

      {state.checkouts.length ? (
        <Card title="Waiting to ship">
          <div class="rows" role="list">
            {state.checkouts.map((c) => (
              <button key={c.id} type="button" class="row" onClick={() => actions.startMint(c)}>
                <span class="row__ic">
                  <Icon name="send" size={24} />
                </span>
                <span class="row__body">
                  <span class="row__t">{handoffLine(c)}</span>
                  <span class="row__s">The buyer already picked their collection shop</span>
                </span>
                <span class="row__end">
                  <Icon name="chevronRight" size={22} />
                </span>
              </button>
            ))}
          </div>
        </Card>
      ) : (
        <Card>
          <p class="hint">No checkouts are waiting. Orders from your store's checkout appear here by themselves.</p>
        </Card>
      )}

      <div class="scr__cta">
        <Button onClick={() => actions.startMint()}>Make a label by hand</Button>
      </div>

      <div class="scr__foot">
        <ReadAloud
          text={() =>
            state.checkouts.length
              ? `${state.checkouts.length} orders are waiting to ship. Tap one, or make a label by hand.`
              : 'No orders are waiting. Tap make a label by hand.'
          }
          label="Read this aloud"
        />
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- parcel -- */

function ParcelStep({ state, actions }: MintScreenProps) {
  const f = state.form;
  const ready = dimsComplete(f) && Boolean(f.photoRef);

  return (
    <div class="scr">
      <StepDots at={1} />
      <h1 class="scr__title">What is shipping?</h1>
      <p class="scr__lede">Measure the parcel — the size tier comes from the numbers, so there is nothing to argue about later.</p>

      {state.error ? <ErrorNote error={state.error} /> : null}

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
              <label class="field__label" for={`dim-${k}`}>
                {label}
              </label>
              <input
                id={`dim-${k}`}
                class="input"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.1"
                value={f[k]}
                onInput={(e) => actions.setForm({ [k]: e.currentTarget.value } as never)}
                onBlur={() => void actions.classify()}
              />
            </div>
          ))}
        </div>
        {f.derivedSize ? <Pill tone="info">{`Size tier ${f.derivedSize}`}</Pill> : <p class="card__note">Fill all four and the tier appears.</p>}
        {f.dedicatedCargo ? (
          <div style="margin-top:12px">
            <Note tone="warn" icon="truck" title="Too big for the parcel network" detail="This is dedicated freight — minting sends it to the freight lane (a truck with the right lifting gear), not the PUDO shelves." />
          </div>
        ) : null}
        <label class="checkline" style="margin-top:12px">
          <input type="checkbox" checked={f.fragile} onChange={(e) => actions.setForm({ fragile: e.currentTarget.checked })} />
          <span>Fragile — keep it off two-wheelers</span>
        </label>
      </Card>

      <Card label="Contents photo">
        <PhotoField id="mint-photo" value={f.photoRef} label="Photograph the contents" onCapture={(ref) => actions.setForm({ photoRef: ref })} />
        <p class="card__note">The photo is the baseline if anything is disputed at collection.</p>
      </Card>

      {!f.checkoutId ? (
        <Card label="Buyer (by hand)">
          <div class="field">
            <label class="field__label" for="buyer-mobile">
              Buyer phone
            </label>
            <input id="buyer-mobile" class="input" type="tel" inputMode="tel" value={f.buyerMobile} onInput={(e) => actions.setForm({ buyerMobile: e.currentTarget.value })} placeholder="07…" />
          </div>
          <div class="field" style="margin-top:12px">
            <label class="field__label" for="order-ref">
              Your order reference (optional)
            </label>
            <input id="order-ref" class="input" value={f.externalOrderId} onInput={(e) => actions.setForm({ externalOrderId: e.currentTarget.value })} placeholder="SO-1024" />
          </div>
        </Card>
      ) : null}

      <div class="scr__cta">
        {/* A handoff already carries the destination — Continue goes straight to pricing the drop-offs. */}
        <Button onClick={() => (f.checkoutId && f.destDid ? void actions.pickDest(f.destDid) : actions.toStep('dest'))} disabled={!ready}>
          Continue
        </Button>
        {!ready ? <p class="hint" style="margin-top:8px">Measurements and the photo first.</p> : null}
      </div>

      {f.checkoutId && f.destDid ? <Note tone="info" icon="pin" title="The buyer already chose their collection shop" /> : null}

      <div class="scr__foot">
        <Button variant="link" full={false} onClick={() => actions.toStep('source')}>
          Go back a step
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------- dest -- */

function DestStep({ state, actions }: MintScreenProps) {
  /** The buyer's place, in three words — the no-address way to sort shops nearest-first. */
  const [wordsText, setWordsText] = useState('');
  const [openShop, setOpenShop] = useState<string | null>(null);
  const near = fromPlaceWords(wordsText);
  const points = state.points
    .filter((p) => p.openState === 'open')
    .sort((a, b) => {
      if (near) {
        const da = a.location ? haversineKm(near, a.location) : Number.POSITIVE_INFINITY;
        const db = b.location ? haversineKm(near, b.location) : Number.POSITIVE_INFINITY;
        if (da !== db) return da - db;
      }
      return a.shopName.localeCompare(b.shopName);
    });
  const preview = openShop ? points.find((p) => p.did === openShop) ?? null : null;

  return (
    <div class="scr">
      <StepDots at={2} />
      <h1 class="scr__title">Where does the buyer collect?</h1>
      <p class="scr__lede">Tap the shop nearest to your buyer — on the map or in the list.</p>

      {state.pointsState === 'loading' ? <p class="hint">Finding shops…</p> : null}
      {state.pointsState === 'error' && state.error ? <ErrorNote error={state.error} onRetry={() => void actions.loadPoints()} /> : null}

      {points.length ? (
        <PlaceMap
          label={`Map of ${points.length} collection shops`}
          pins={points.filter((p) => p.location).map((p) => ({ id: p.did, label: p.shopName, point: p.location! }))}
          selectedId={openShop}
          onPick={setOpenShop}
          reference={near}
        />
      ) : null}

      <Card label="The buyer's place, in three words">
        <input
          class="input"
          value={wordsText}
          onInput={(e) => setWordsText(e.currentTarget.value)}
          placeholder="goldfox calmriver blueowl"
          autocapitalize="none"
          autocomplete="off"
          spellcheck={false}
        />
        <p class="card__note">{near ? 'Found it — the nearest shops are now first.' : 'Ask the buyer for their three words; no street address needed.'}</p>
      </Card>

      <div class="rows" role="list">
        {points.map((p) => (
          <PointRow
            key={p.did}
            point={p}
            sub={near && p.location ? distanceLabel(haversineKm(near, p.location)) : undefined}
            onPick={() => void actions.pickDest(p.did)}
          />
        ))}
      </div>

      <div class="scr__foot">
        <Button variant="link" full={false} onClick={() => actions.toStep('parcel')}>
          Go back a step
        </Button>
      </div>

      {/* G4b — tap a shop on the map to preview it (price, distance, rating) before choosing. */}
      <ShopDetailSheet
        open={!!preview}
        title={preview?.shopName ?? 'Collection shop'}
        subtitle={preview ? [preview.landmark, `Zone ${preview.zone}`].filter(Boolean).join(' · ') : undefined}
        lines={preview ? shopFacts(preview, near && preview.location ? distanceLabel(haversineKm(near, preview.location)) : null) : []}
        location={preview?.location ?? null}
        onChoose={preview ? () => { const did = preview.did; setOpenShop(null); void actions.pickDest(did); } : undefined}
        chooseLabel="Collect here"
        onClose={() => setOpenShop(null)}
      />
    </div>
  );
}

/** The detail lines a shop preview shows: price to handle, distance, open state, free slots, rating. */
function shopFacts(shop: NetworkPoint, away: string | null): string[] {
  return [
    `${money(shop.pricePerParcel)} to handle the parcel`,
    away ? `${away} away` : `Zone ${shop.zone}`,
    shop.openState === 'open' ? 'Open now' : 'Closed right now',
    ...(shop.freeSlots != null ? [`${shop.freeSlots} ${shop.freeSlots === 1 ? 'space' : 'spaces'} free`] : []),
    ...(shop.rating?.count ? [`Rated ${shop.rating.average.toFixed(1)} by ${shop.rating.count}`] : []),
  ];
}

function PointRow({ point, onPick, price, sub }: { point: NetworkPoint; onPick: () => void; price?: string | null; sub?: string }) {
  return (
    <button type="button" class="row" onClick={onPick}>
      <span class="row__ic">
        <Icon name="home" size={24} />
      </span>
      <span class="row__body">
        <span class="row__t">{point.shopName}</span>
        <span class="row__s">{`${sub ? `${sub} · ` : ''}Zone ${point.zone}${point.landmark ? ` · ${point.landmark}` : ''}`}</span>
      </span>
      <span class="row__end">
        {price !== undefined ? price === null ? <Pill tone="idle">No route</Pill> : <b class="mono-t">{price}</b> : null}
        <Icon name="chevronRight" size={22} />
      </span>
    </button>
  );
}

/* ----------------------------------------------------------------- origin -- */

function OriginStep({ state, actions }: MintScreenProps) {
  const rows = originRows(state.points, state.form.destDid, state.originOptions);
  const [openShop, setOpenShop] = useState<string | null>(null);
  const preview = openShop ? rows.find((r) => r.point.did === openShop) ?? null : null;

  return (
    <div class="scr">
      <StepDots at={3} />
      <h1 class="scr__title">Where will you drop it off?</h1>
      <p class="scr__lede">Every shop is priced against the buyer's collection shop — cheapest first. Your store pin is the orange dot.</p>

      {state.originState === 'loading' ? <p class="hint">Pricing every drop-off…</p> : null}
      {state.originState === 'error' && state.error ? <ErrorNote error={state.error} onRetry={() => void actions.pickDest(state.form.destDid)} /> : null}

      {rows.length ? (
        <PlaceMap
          label={`Map of ${rows.length} drop-off shops relative to your store`}
          pins={rows.filter((r) => r.point.location).map((r) => ({ id: r.point.did, label: r.total === null ? r.point.shopName : `${r.point.shopName} · ${money(r.total)}`, point: r.point.location! }))}
          selectedId={openShop}
          onPick={setOpenShop}
          reference={state.vendor?.location ?? null}
        />
      ) : null}

      <div class="rows" role="list">
        {rows.map((r) => (
          <PointRow
            key={r.point.did}
            point={r.point}
            price={r.total === null ? null : money(r.total)}
            sub={state.vendor?.location && r.point.location ? distanceLabel(haversineKm(state.vendor.location, r.point.location)) : undefined}
            onPick={() => void actions.pickOrigin(r.point.did)}
          />
        ))}
      </div>

      <div class="scr__foot">
        <Button variant="link" full={false} onClick={() => actions.toStep(state.form.checkoutId ? 'parcel' : 'dest')}>
          Go back a step
        </Button>
      </div>

      {/* G4b — tap a drop-off shop on the map to preview its all-in shipping price before choosing. */}
      <ShopDetailSheet
        open={!!preview}
        title={preview?.point.shopName ?? 'Drop-off shop'}
        subtitle={preview ? [preview.point.landmark, `Zone ${preview.point.zone}`].filter(Boolean).join(' · ') : undefined}
        lines={
          preview
            ? [
                preview.total === null ? 'No route from here yet' : `${money(preview.total)} to ship, all in`,
                ...shopFacts(
                  preview.point,
                  state.vendor?.location && preview.point.location ? distanceLabel(haversineKm(state.vendor.location, preview.point.location)) : null,
                ),
              ]
            : []
        }
        location={preview?.point.location ?? null}
        onChoose={preview && preview.total !== null ? () => { const did = preview.point.did; setOpenShop(null); void actions.pickOrigin(did); } : undefined}
        chooseLabel="Drop off here"
        onClose={() => setOpenShop(null)}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ price -- */

function PriceStep({ state, actions }: MintScreenProps) {
  const q = state.quote;
  const f = state.form;

  return (
    <div class="scr">
      <StepDots at={4} />
      <h1 class="scr__title">Lock the price</h1>
      <p class="scr__lede">Both get it there — you choose what your store pays.</p>

      {state.quoteState === 'loading' ? <p class="hint">Working out the journey…</p> : null}
      {state.quoteState === 'error' && state.error ? <ErrorNote error={state.error} onRetry={() => void actions.pickOrigin(f.originDid)} /> : null}

      {q ? (
        <>
          <div class="prices" role="group" aria-label="Choose a price">
            {priceCards(q).map((c) => {
              const on = f.routeMode === c.key;
              return (
                <button key={c.key} type="button" class={`price price--tap${on ? ' price--on' : ''}`} aria-pressed={on} onClick={() => actions.setForm({ routeMode: c.key })}>
                  <span class="price__title">{c.title}</span>
                  <span class="price__total">{money(c.total)}</span>
                  <span class="price__sub">{c.sub}</span>
                </button>
              );
            })}
          </div>

          <Card title="What happens at mint" tone="soft">
            <Checklist
              items={[
                'The label, collection code and tracking key are made now',
                `${money(f.routeMode === 'locked' ? q.locked.total : q.flexible.total)} is billed to your balance`,
                'The buyer gets the collection code when it is ready',
              ]}
            />
          </Card>

          <div class="scr__cta">
            <Button onClick={() => void actions.submitMint()} busy={state.busy === 'mint'}>
              Mint the label
            </Button>
          </div>
        </>
      ) : null}

      <div class="scr__foot">
        <Button variant="link" full={false} onClick={() => actions.toStep('origin')}>
          Change the drop-off
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ label -- */

function LabelStep({ state, actions }: MintScreenProps) {
  const m = state.minted;
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
      <StepDots at={5} />
      <h1 class="scr__title">{m.paid ? 'Here is the label' : 'Order made — unpaid'}</h1>

      {state.error ? <ErrorNote error={state.error} /> : null}

      {m.paid && svg ? (
        <>
          {/* Trusted markup: the SVG comes from OUR backend's label endpoint, nothing user-authored. */}
          <div class="labelbox" dangerouslySetInnerHTML={{ __html: svg }} />
          <div class="scr__cta">
            <Button onClick={openLabel}>Open and print the label</Button>
          </div>
        </>
      ) : null}

      {!m.paid ? (
        <>
          <Note tone="warn" icon="wallet" title="No prepay, no label" detail="Top up on the Orders tab, then release it here." />
          <div class="scr__cta">
            <Button busy={state.busy === `settle:${m.parcel.parcelId}`} onClick={() => void actions.settleOrder(m.parcel.parcelId)}>
              Pay now from the balance
            </Button>
          </div>
        </>
      ) : null}

      {m.parcel.collectionCode ? <CodeCard label="Buyer's collection code" code={m.parcel.collectionCode} scanAs="collect" /> : null}

      {/* DT — the parcel is born with a digital twin that already knows its route. */}
      {state.mintedJourney ? (
        <Card title="Planned journey">
          <p class="t-body">{state.mintedJourney.hops.join(' → ')}</p>
          <p class="card__note">
            {state.mintedJourney.mdpRouted ? 'Routed through a sorting hub. ' : 'Direct local hop. '}
            {state.mintedJourney.pickupReadyAt ? `Ready for pickup around ${new Date(state.mintedJourney.pickupReadyAt).toLocaleString()}.` : ''}
          </p>
        </Card>
      ) : null}

      <Card label="Keep for your records">
        <div class="kv">
          <span>Parcel</span>
          <b class="mono-t">{m.parcel.parcelId}</b>
        </div>
        {m.parcel.did ? (
          <div class="kv">
            <span>Shipment ID (twin)</span>
            <b class="mono-t">{m.parcel.did}</b>
          </div>
        ) : null}
        {m.parcel.trackingKey ? (
          <div class="kv">
            <span>Tracking key</span>
            <b class="mono-t">{m.parcel.trackingKey}</b>
          </div>
        ) : null}
        {m.parcel.shipmentCost != null ? (
          <div class="kv">
            <span>Billed</span>
            <b>{money(m.parcel.shipmentCost)}</b>
          </div>
        ) : null}
      </Card>

      <Button variant="outline" onClick={() => actions.startMint()}>
        Ship another order
      </Button>

      <div class="scr__foot">
        <Button variant="link" full={false} onClick={() => actions.go('orders')}>
          Back to my orders
        </Button>
      </div>
    </div>
  );
}
