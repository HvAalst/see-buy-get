import { useState } from 'preact/hooks';
import { Button, Card, Checklist, CodeCard, ErrorNote, Icon, Info, Note, PlaceMap, Pill, ReadAloud, ShopDetailSheet } from '../../../shared/ui';
import { useT, type Translate } from '../../../shared/i18n';
import { fromPlaceWords } from '../../../shared/placewords';
import { distanceLabel, haversineKm } from '../../../shared/geo';
import { PhotoField } from './PhotoField';
import { PapersCard } from './PapersCard';
import { papersGaps } from '../papers';
import { chargeOf, dimsComplete, feeLines, handoffLine, money, originRows, priceCards } from '../logic';
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
  const t = useT();
  return (
    <div class="dots" role="img" aria-label={t('vendor.mint.step', { at })}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} class={`dots__dot${n === at ? ' dots__dot--on' : n < at ? ' dots__dot--done' : ''}`} />
      ))}
    </div>
  );
}

/* ----------------------------------------------------------------- source -- */

function SourceStep({ state, actions }: MintScreenProps) {
  const t = useT();
  return (
    <div class="scr">
      <h1 class="scr__title">{t('vendor.mint.sourceTitle')}</h1>
      <p class="scr__lede">{t('vendor.mint.sourceLede')}</p>

      {state.error ? <ErrorNote error={state.error} /> : null}

      {state.checkouts.length ? (
        <Card title={t('vendor.waitingToShip')}>
          <div class="rows" role="list">
            {state.checkouts.map((c) => (
              <button key={c.id} type="button" class="row" onClick={() => actions.startMint(c)}>
                <span class="row__ic">
                  <Icon name="send" size={24} />
                </span>
                <span class="row__body">
                  <span class="row__t">{handoffLine(c, t)}</span>
                  <span class="row__s">{t('vendor.mint.buyerPicked')}</span>
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
          <p class="hint">{t('vendor.mint.noCheckouts')}</p>
        </Card>
      )}

      <div class="scr__cta">
        <Button onClick={() => actions.startMint()}>{t('vendor.mint.byHand')}</Button>
      </div>

      <div class="scr__foot">
        <ReadAloud
          text={() =>
            state.checkouts.length
              ? t('vendor.mint.sourceAloudSome', { count: state.checkouts.length })
              : t('vendor.mint.sourceAloudNone')
          }
          label={t('vendor.readAloud')}
        />
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- parcel -- */

function ParcelStep({ state, actions }: MintScreenProps) {
  const t = useT();
  const f = state.form;
  const ready = dimsComplete(f) && Boolean(f.photoRef);

  return (
    <div class="scr">
      <StepDots at={1} />
      <h1 class="scr__title">{t('vendor.mint.parcelTitle')}</h1>
      <p class="scr__lede">{t('vendor.mint.parcelLede')}</p>

      {state.error ? <ErrorNote error={state.error} /> : null}

      <Card label={t('vendor.mint.measurements')}>
        <div class="dims">
          {(
            [
              ['l', 'vendor.mint.dimL'],
              ['w', 'vendor.mint.dimW'],
              ['h', 'vendor.mint.dimH'],
              ['kg', 'vendor.mint.dimKg'],
            ] as const
          ).map(([k, labelKey]) => (
            <div key={k} class="field">
              <label class="field__label" for={`dim-${k}`}>
                {t(labelKey)}
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
        {f.derivedSize ? <Pill tone="info">{t('vendor.mint.sizeTier', { size: f.derivedSize })}</Pill> : <p class="card__note">{t('vendor.mint.fillAll')}</p>}
        {f.dedicatedCargo ? (
          <div style="margin-top:12px">
            <Note tone="warn" icon="truck" title={t('vendor.mint.tooBigTitle')} detail={t('vendor.mint.tooBigDetail')} />
          </div>
        ) : null}
        <label class="checkline" style="margin-top:12px">
          <input type="checkbox" checked={f.fragile} onChange={(e) => actions.setForm({ fragile: e.currentTarget.checked })} />
          <span>{t('vendor.mint.fragile')}</span>
        </label>
      </Card>

      <Card label={t('vendor.mint.contentsPhoto')}>
        <PhotoField id="mint-photo" value={f.photoRef} label={t('vendor.mint.photographContents')} onCapture={(ref) => actions.setForm({ photoRef: ref })} />
        <p class="card__note">{t('vendor.mint.photoNote')}</p>
      </Card>

      {!f.checkoutId ? (
        <Card label={t('vendor.mint.buyerByHand')}>
          <div class="field">
            <label class="field__label" for="buyer-mobile">
              {t('vendor.mint.buyerPhone')}
            </label>
            <input id="buyer-mobile" class="input" type="tel" inputMode="tel" value={f.buyerMobile} onInput={(e) => actions.setForm({ buyerMobile: e.currentTarget.value })} placeholder="07…" />
          </div>
          <div class="field" style="margin-top:12px">
            <label class="field__label" for="order-ref">
              {t('vendor.mint.orderRef')}
            </label>
            <input id="order-ref" class="input" value={f.externalOrderId} onInput={(e) => actions.setForm({ externalOrderId: e.currentTarget.value })} placeholder="SO-1024" />
          </div>
        </Card>
      ) : null}

      {/* FP8 — box 13 of the consignment note, for the order that turns out to be freight. Taken down here because
          the store knows the door and the parcel network never asks; the server ignores it for a parcel. */}
      <Card label={t('vendor.mint.freightTitle')}>
        <div class="field">
          <label class="field__label" for="freight-window">
            {t('vendor.mint.freightWindow')}
          </label>
          <input id="freight-window" class="input" maxLength={80} value={f.deliveryWindow} onInput={(e) => actions.setForm({ deliveryWindow: e.currentTarget.value })} placeholder={t('vendor.mint.freightWindowPlaceholder')} />
        </div>
        <div class="field" style="margin-top:12px">
          <label class="field__label" for="freight-note">
            {t('vendor.mint.freightNote')}
          </label>
          <textarea id="freight-note" class="input" rows={2} maxLength={500} value={f.instructions} onInput={(e) => actions.setForm({ instructions: e.currentTarget.value })} />
        </div>
        <p class="card__note">{t('vendor.mint.freightHint')}</p>
      </Card>

      <div class="scr__cta">
        {/* A handoff already carries the destination — Continue goes straight to pricing the drop-offs. */}
        <Button onClick={() => (f.checkoutId && f.destDid ? void actions.pickDest(f.destDid) : actions.toStep('dest'))} disabled={!ready}>
          {t('vendor.continue')}
        </Button>
        {!ready ? <p class="hint" style="margin-top:8px">{t('vendor.mint.measurementsFirst')}</p> : null}
      </div>

      {f.checkoutId && f.destDid ? <Note tone="info" icon="pin" title={t('vendor.mint.buyerChose')} /> : null}

      <div class="scr__foot">
        <Button variant="link" full={false} onClick={() => actions.toStep('source')}>
          {t('vendor.goBackStep')}
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------- dest -- */

function DestStep({ state, actions }: MintScreenProps) {
  const t = useT();
  /** The buyer's place, in three words — the no-address way to sort shops nearest-first. */
  const [wordsText, setWordsText] = useState('');
  const [openShop, setOpenShop] = useState<string | null>(null);
  const near = fromPlaceWords(wordsText);
  const points = state.points
    .filter((p) => p.openState === 'open' && p.takesNew !== false)
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
      <h1 class="scr__title">{t('vendor.mint.destTitle')}</h1>
      <p class="scr__lede">{t('vendor.mint.destLede')}</p>

      {state.pointsState === 'loading' ? <p class="hint">{t('vendor.mint.findingShops')}</p> : null}
      {state.pointsState === 'error' && state.error ? <ErrorNote error={state.error} onRetry={() => void actions.loadPoints()} /> : null}

      {points.length ? (
        <PlaceMap
          label={t('vendor.mint.mapCollection', { count: points.length })}
          pins={points.filter((p) => p.location).map((p) => ({ id: p.did, label: p.shopName, point: p.location! }))}
          selectedId={openShop}
          onPick={setOpenShop}
          reference={near}
        />
      ) : null}

      <Card label={t('vendor.mint.buyerPlaceWords')}>
        <input
          class="input"
          value={wordsText}
          onInput={(e) => setWordsText(e.currentTarget.value)}
          placeholder="goldfox calmriver blueowl"
          autocapitalize="none"
          autocomplete="off"
          spellcheck={false}
        />
        <p class="card__note">{near ? t('vendor.mint.wordsFound') : t('vendor.mint.wordsAsk')}</p>
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
          {t('vendor.goBackStep')}
        </Button>
      </div>

      {/* G4b — tap a shop on the map to preview it (price, distance, rating) before choosing. */}
      <ShopDetailSheet
        open={!!preview}
        title={preview?.shopName ?? t('vendor.mint.collectionShop')}
        subtitle={preview ? [preview.landmark, t('vendor.zone', { zone: preview.zone })].filter(Boolean).join(' · ') : undefined}
        lines={preview ? shopFacts(preview, near && preview.location ? distanceLabel(haversineKm(near, preview.location)) : null, t) : []}
        location={preview?.location ?? null}
        onChoose={preview ? () => { const did = preview.did; setOpenShop(null); void actions.pickDest(did); } : undefined}
        chooseLabel={t('vendor.mint.collectHere')}
        onClose={() => setOpenShop(null)}
      />
    </div>
  );
}

/** The detail lines a shop preview shows: price to handle, distance, open state, free slots, rating. */
function shopFacts(shop: NetworkPoint, away: string | null, t: Translate): string[] {
  return [
    t('vendor.shop.handleTheParcel', { price: money(shop.pricePerParcel, shop.currency) }),
    away ? t('vendor.shop.away', { dist: away }) : t('vendor.zone', { zone: shop.zone }),
    shop.openState === 'open' ? t('vendor.shop.openNow') : t('vendor.shop.closedNow'),
    ...(shop.freeSlots != null ? [shop.freeSlots === 1 ? t('vendor.shop.slotOne', { count: shop.freeSlots }) : t('vendor.shop.slotMany', { count: shop.freeSlots })] : []),
    ...(shop.rating?.count ? [t('vendor.shop.rated', { avg: shop.rating.average.toFixed(1), count: shop.rating.count })] : []),
  ];
}

function PointRow({ point, onPick, price, sub }: { point: NetworkPoint; onPick: () => void; price?: string | null; sub?: string }) {
  const t = useT();
  return (
    <button type="button" class="row" onClick={onPick}>
      <span class="row__ic">
        <Icon name="home" size={24} />
      </span>
      <span class="row__body">
        <span class="row__t">{point.shopName}</span>
        <span class="row__s">{`${sub ? `${sub} · ` : ''}${t('vendor.zone', { zone: point.zone })}${point.landmark ? ` · ${point.landmark}` : ''}`}</span>
      </span>
      <span class="row__end">
        {price !== undefined ? price === null ? <Pill tone="idle">{t('vendor.mint.noRoute')}</Pill> : <b class="mono-t">{price}</b> : null}
        <Icon name="chevronRight" size={22} />
      </span>
    </button>
  );
}

/* ----------------------------------------------------------------- origin -- */

function OriginStep({ state, actions }: MintScreenProps) {
  const t = useT();
  const rows = originRows(state.points, state.form.destDid, state.originOptions);
  const [openShop, setOpenShop] = useState<string | null>(null);
  const preview = openShop ? rows.find((r) => r.point.did === openShop) ?? null : null;

  return (
    <div class="scr">
      <StepDots at={3} />
      <h1 class="scr__title">{t('vendor.mint.originTitle')}</h1>
      <p class="scr__lede">{t('vendor.mint.originLede')}</p>

      {state.originState === 'loading' ? <p class="hint">{t('vendor.mint.pricingDropoffs')}</p> : null}
      {state.originState === 'error' && state.error ? <ErrorNote error={state.error} onRetry={() => void actions.pickDest(state.form.destDid)} /> : null}

      {rows.length ? (
        <PlaceMap
          label={t('vendor.mint.mapDropoff', { count: rows.length })}
          pins={rows.filter((r) => r.point.location).map((r) => ({ id: r.point.did, label: r.total === null ? r.point.shopName : `${r.point.shopName} · ${money(r.total, r.currency)}`, point: r.point.location! }))}
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
            price={r.total === null ? null : money(r.total, r.currency)}
            sub={state.vendor?.location && r.point.location ? distanceLabel(haversineKm(state.vendor.location, r.point.location)) : undefined}
            onPick={() => void actions.pickOrigin(r.point.did)}
          />
        ))}
      </div>

      <div class="scr__foot">
        <Button variant="link" full={false} onClick={() => actions.toStep(state.form.checkoutId ? 'parcel' : 'dest')}>
          {t('vendor.goBackStep')}
        </Button>
      </div>

      {/* G4b — tap a drop-off shop on the map to preview its all-in shipping price before choosing. */}
      <ShopDetailSheet
        open={!!preview}
        title={preview?.point.shopName ?? t('vendor.mint.dropoffShop')}
        subtitle={preview ? [preview.point.landmark, t('vendor.zone', { zone: preview.point.zone })].filter(Boolean).join(' · ') : undefined}
        lines={
          preview
            ? [
                preview.total === null ? t('vendor.mint.noRouteYet') : t('vendor.mint.toShipAllIn', { price: money(preview.total, preview.currency) }),
                ...shopFacts(
                  preview.point,
                  state.vendor?.location && preview.point.location ? distanceLabel(haversineKm(state.vendor.location, preview.point.location)) : null,
                  t,
                ),
              ]
            : []
        }
        location={preview?.point.location ?? null}
        onChoose={preview && preview.total !== null ? () => { const did = preview.point.did; setOpenShop(null); void actions.pickOrigin(did); } : undefined}
        chooseLabel={t('vendor.mint.dropHere')}
        onClose={() => setOpenShop(null)}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ price -- */

function PriceStep({ state, actions }: MintScreenProps) {
  const t = useT();
  const q = state.quote;
  const f = state.form;

  return (
    <div class="scr">
      <StepDots at={4} />
      <div class="info-row">
        <h1 class="scr__title">{t('vendor.mint.priceTitle')}</h1>
        {/* The two prices are a CEILING and a COMMITMENT, which "Fastest" and "Cheapest" cannot say in
            one word each. The explanation belongs a tap away rather than crammed under the buttons. */}
        <Info title={t('vendor.price.explainTitle')} aloud={t('vendor.price.explainAloud')}>
          {/* The bubble names the SAME two words the buttons show, so a reader can map one to the other
              without translating between two vocabularies. */}
          <p>
            <b>{t('vendor.price.fastest')}</b> {t('vendor.price.explainFastest')}
          </p>
          <p>
            <b>{t('vendor.price.cheapest')}</b> {t('vendor.price.explainCheapest')}
          </p>
          <p>{t('vendor.price.explainEither')}</p>
        </Info>
      </div>
      <p class="scr__lede">{t('vendor.mint.priceLede')}</p>
      {/* The size tier is shown three steps back as a Pill, so without this a store reads the price as
          the tier's price. It is not: the tier says what the network will HANDLE the box as, and the
          price follows the centimetres the store typed. Said only when it is true. */}
      {q?.factorBasis === 'measured' ? <p class="card__note">{t('vendor.mint.measuredPrice')}</p> : null}

      {state.quoteState === 'loading' ? <p class="hint">{t('vendor.mint.workingJourney')}</p> : null}
      {state.quoteState === 'error' && state.error ? <ErrorNote error={state.error} onRetry={() => void actions.pickOrigin(f.originDid)} /> : null}

      {q ? (
        <>
          <div class="prices" role="group" aria-label={t('vendor.mint.choosePrice')}>
            {priceCards(q, t).map((c) => {
              const on = f.routeMode === c.key;
              return (
                <button key={c.key} type="button" class={`price price--tap${on ? ' price--on' : ''}`} aria-pressed={on} onClick={() => actions.setForm({ routeMode: c.key })}>
                  <span class="price__title">{c.title}</span>
                  <span class="price__total">{money(c.total, q.currency)}</span>
                  <span class="price__sub">{c.sub}</span>
                </button>
              );
            })}
          </div>

          {/* The one fee line a merchant is owed, under the price it is inside — not on a separate screen
              and not only on the invoice. What it is MADE OF stays ours. */}
          {feeLines(f.routeMode === 'locked' ? q.locked : q.flexible, t).map((line: { label: string; amount: number }) => (
            <p key={line.label} class="kv kv--quiet">
              <span>{line.label}</span>
              <b>{money(line.amount, q.currency)}</b>
            </p>
          ))}

          {/* Round 13 — crossing a border, the shipment goes with its commercial invoice: asked for here, printed with the label. */}
          {q.crossesBorder ? <PapersCard quote={q} papers={f.papers} onChange={(papers) => actions.setForm({ papers })} /> : null}

          <Card title={t('vendor.mint.whatHappensTitle')} tone="soft">
            <Checklist
              items={[
                t('vendor.mint.happen1'),
                t('vendor.mint.happen2', { amount: money(chargeOf(f.routeMode === 'locked' ? q.locked : q.flexible), q.currency) }),
                t('vendor.mint.happen3'),
              ]}
            />
          </Card>

          <div class="scr__cta">
            <Button onClick={() => void actions.submitMint()} busy={state.busy === 'mint'} disabled={Boolean(q.crossesBorder) && papersGaps(f.papers).length > 0}>
              {t('vendor.mint.mintCta')}
            </Button>
          </div>
        </>
      ) : null}

      <div class="scr__foot">
        <Button variant="link" full={false} onClick={() => actions.toStep('origin')}>
          {t('vendor.mint.changeDropoff')}
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ label -- */

function LabelStep({ state, actions }: MintScreenProps) {
  const t = useT();
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
      <h1 class="scr__title">{m.paid ? t('vendor.mint.labelTitlePaid') : t('vendor.mint.labelTitleUnpaid')}</h1>

      {state.error ? <ErrorNote error={state.error} /> : null}

      {m.paid && svg ? (
        <>
          {/* Trusted markup: the SVG comes from OUR backend's label endpoint, nothing user-authored. */}
          <div class="labelbox" dangerouslySetInnerHTML={{ __html: svg }} />
          <div class="scr__cta">
            <Button onClick={openLabel}>{t('vendor.mint.openPrint')}</Button>
          </div>
        </>
      ) : null}

      {/* Round 13 — its papers abroad: three copies, printed with the label and put in the pouch. */}
      {m.parcel.customs ? (
        <Card label={t('vendor.papers.title')}>
          <p class="card__note">{t('vendor.papers.printNote')}</p>
          <Button variant="outline" busy={state.busy === `papers:${m.parcel.parcelId}`} onClick={() => void actions.printPapers(m.parcel.parcelId)}>
            {t('vendor.papers.print')}
          </Button>
        </Card>
      ) : null}

      {!m.paid ? (
        <>
          <Note tone="warn" icon="wallet" title={t('vendor.mint.noPrepayTitle')} detail={t('vendor.mint.noPrepayDetail')} />
          <div class="scr__cta">
            <Button busy={state.busy === `settle:${m.parcel.parcelId}`} onClick={() => void actions.settleOrder(m.parcel.parcelId)}>
              {t('vendor.payNow')}
            </Button>
          </div>
        </>
      ) : null}

      {m.parcel.collectionCode ? <CodeCard label={t('vendor.buyerCollectionCode')} code={m.parcel.collectionCode} scanAs="collect" /> : null}

      {/* DT — the parcel is born with a digital twin that already knows its route. */}
      {state.mintedJourney ? (
        <Card title={t('vendor.mint.plannedJourney')}>
          <p class="t-body">{state.mintedJourney.hops.join(' → ')}</p>
          <p class="card__note">
            {state.mintedJourney.mdpRouted ? t('vendor.mint.routedHub') : t('vendor.mint.directHop')}
            {state.mintedJourney.pickupReadyAt ? t('vendor.mint.readyAround', { time: new Date(state.mintedJourney.pickupReadyAt).toLocaleString() }) : ''}
          </p>
        </Card>
      ) : null}

      <Card label={t('vendor.mint.keepRecords')}>
        <div class="kv">
          <span>{t('vendor.parcel')}</span>
          <b class="mono-t">{m.parcel.parcelId}</b>
        </div>
        {m.parcel.did ? (
          <div class="kv">
            <span>{t('vendor.mint.shipmentIdTwin')}</span>
            <b class="mono-t">{m.parcel.did}</b>
          </div>
        ) : null}
        {m.parcel.trackingKey ? (
          <div class="kv">
            <span>{t('vendor.trackingKey')}</span>
            <b class="mono-t">{m.parcel.trackingKey}</b>
          </div>
        ) : null}
        {m.parcel.shipmentCost != null ? (
          <div class="kv">
            <span>{t('vendor.mint.billed')}</span>
            <b>{money(m.parcel.shipmentCost, m.parcel.currency)}</b>
          </div>
        ) : null}
      </Card>

      <Button variant="outline" onClick={() => actions.startMint()}>
        {t('vendor.mint.shipAnother')}
      </Button>

      <div class="scr__foot">
        <Button variant="link" full={false} onClick={() => actions.go('orders')}>
          {t('vendor.backToOrders')}
        </Button>
      </div>
    </div>
  );
}
