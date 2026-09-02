import { useState } from 'preact/hooks';
import { Button, Card, Checklist, ErrorNote, Icon, Note, PlaceMap, Pill, ReadAloud, ShopDetailSheet } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import { fromPlaceWords } from '../../../shared/placewords';
import { cleanPhone, dimsBlocker, journeyLine, lockedPrice, mintChecklist, mintTaxLine, money, phoneReady, pointDistance, pointLine, quoteSummary, reputationLine, selectablePoints, servingSince, sizeMeta, taxLine, type Translate } from '../logic';
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
  const t = useT();
  return (
    <div class="dots" role="img" aria-label={t('send.stepDots', { at })}>
      {[1, 2, 3, 4].map((n) => (
        <span key={n} class={`dots__dot${n === at ? ' dots__dot--on' : n < at ? ' dots__dot--done' : ''}`} />
      ))}
    </div>
  );
}

/* ----------------------------------------------------------------- parcel -- */

function ParcelStep({ state, actions }: SendScreenProps) {
  const t = useT();
  const blocked = dimsBlocker(state.dims, t);
  const derived = state.derived;

  return (
    <div class="scr">
      <StepDots at={1} />
      <h1 class="scr__title">{t('send.parcel.title')}</h1>
      <p class="scr__lede">{t('send.parcel.lede')}</p>

      <Card label={t('send.parcel.measurements')}>
        <div class="dims">
          {(
            [
              ['l', 'send.parcel.dimL'],
              ['w', 'send.parcel.dimW'],
              ['h', 'send.parcel.dimH'],
              ['kg', 'send.parcel.dimKg'],
            ] as const
          ).map(([k, labelKey]) => (
            <div key={k} class="field">
              <label class="field__label" for={`send-dim-${k}`}>
                {t(labelKey)}
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
        {derived ? <Pill tone={derived.dedicated ? 'warn' : 'info'}>{`${sizeMeta(derived.size, t).label} — ${sizeMeta(derived.size, t).hint}`}</Pill> : <p class="card__note">{t('send.parcel.fillHint')}</p>}
        <label class="checkline" style="margin-top:12px">
          <input type="checkbox" checked={state.fragile} onChange={(e) => actions.setFragile(e.currentTarget.checked)} />
          <span>{t('send.parcel.fragile')}</span>
        </label>
      </Card>

      {derived?.dedicated ? (
        <Note
          tone="warn"
          icon="truck"
          title={t('send.parcel.dedicatedTitle')}
          detail={t('send.parcel.dedicatedDetail')}
        />
      ) : null}

      {state.deriveError ? <ErrorNote error={state.deriveError} onRetry={() => void actions.submitParcel()} /> : null}

      <Card title={t('send.parcel.howTitle')} tone="soft">
        <Checklist items={[t('send.parcel.howPrice'), state.identity ? t('send.parcel.howBook') : t('send.parcel.howWalkUp'), t('send.parcel.howCollect')]} />
      </Card>

      <div class="scr__cta">
        <Button busy={state.deriveBusy} disabled={Boolean(blocked) || Boolean(derived?.dedicated)} onClick={() => void actions.submitParcel()}>
          {t('send.parcel.continue')}
        </Button>
        {blocked ? <p class="hint" style="margin-top:8px">{blocked}</p> : null}
      </div>

      <div class="scr__foot">
        <ReadAloud text={() => t('send.parcel.aloud')} label={t('send.readAloud')} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ from / to -- */

function PointStep({ state, actions, kind }: SendScreenProps & { kind: 'from' | 'to' }) {
  const t = useT();
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
      <h1 class="scr__title">{from ? t('send.point.titleFrom') : t('send.point.titleTo')}</h1>
      <p class="scr__lede">{from ? t('send.point.ledeFrom') : t('send.point.ledeTo')}</p>

      {state.pointsState === 'loading' ? <p class="hint">{t('send.point.finding')}</p> : null}
      {state.pointsState === 'error' && state.pointsError ? <ErrorNote error={state.pointsError} onRetry={() => void actions.loadPoints()} /> : null}
      {state.pointsState === 'ready' && points.length === 0 ? (
        <Card>
          <p class="t-body">{t('send.point.none')}</p>
        </Card>
      ) : null}

      {points.length ? (
        <PlaceMap
          label={near ? t('send.point.mapLabelWords', { count: points.length }) : t('send.point.mapLabel', { count: points.length })}
          pins={points.filter((p) => p.location && p.openState === 'open').map((p) => ({ id: p.did, label: p.shopName, point: p.location! }))}
          selectedId={openShop ?? picked}
          onPick={setOpenShop}
          reference={near}
        />
      ) : null}

      <Card label={from ? t('send.point.wordsFrom') : t('send.point.wordsTo')}>
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
            ? t('send.point.wordsFound')
            : wordsText.trim()
              ? t('send.point.wordsNot')
              : t('send.point.wordsEmpty')}
        </p>
      </Card>

      <div class="rows" role="list">
        {points.map((p) => (
          <PointRow key={p.did} point={p} picked={picked === p.did} away={pointDistance(p, near)} onPick={() => pick(p.did)} />
        ))}
      </div>

      <div class="scr__foot">
        <Button variant="link" full={false} onClick={() => actions.backTo(from ? 'parcel' : 'from')}>
          {t('send.point.back')}
        </Button>
        <ReadAloud
          text={() =>
            `${t('send.point.aloudCount', { count: points.length })} ${near ? t('send.point.aloudNearest') : ''} ${from ? t('send.point.aloudPickFrom') : t('send.point.aloudPickTo')}`
          }
          label={t('send.readAloud')}
        />
      </div>

      {/* G4 — tap a pin on the map to preview the shop (price, distance, rating) before committing. The
          list rows still commit directly; the shared sheet is the same on every shop picker (G4b). */}
      <ShopDetailSheet
        open={!!preview}
        title={preview?.shopName ?? t('send.point.sheetTitle')}
        subtitle={preview ? [preview.landmark, t('send.zone', { zone: preview.zone })].filter(Boolean).join(' · ') : undefined}
        lines={preview ? shopFacts(preview, pointDistance(preview, near), t) : []}
        location={preview?.location ?? null}
        onChoose={preview ? () => { const did = preview.did; setOpenShop(null); pick(did); } : undefined}
        chooseLabel={t('send.point.choose')}
        chooseDisabled={preview?.openState === 'closed'}
        onClose={() => setOpenShop(null)}
      />
    </div>
  );
}

/** The detail lines a shop's public profile shows (what the row can't): price, distance, open state, slots,
 *  reputation (honest "New" when unrated) and how long it has served. REP1 turns this preview into a real
 *  public profile the sender can weigh before committing. */
function shopFacts(shop: NetworkPoint, away: string | null, t: Translate): string[] {
  return [
    t('send.point.factHandle', { price: money(shop.pricePerParcel) }),
    away ? t('send.point.factAway', { dist: away }) : t('send.point.factZone', { zone: shop.zone }),
    shop.openState === 'open' ? t('send.point.openNow') : t('send.point.closedNow'),
    ...(shop.freeSlots != null ? [shop.freeSlots === 1 ? t('send.point.slotOne', { count: shop.freeSlots }) : t('send.point.slotMany', { count: shop.freeSlots })] : []),
    reputationLine(shop.rating, t), // REP1 — always shown, honest about the cold start
    ...(servingSince(shop.since, t) ? [servingSince(shop.since, t)!] : []),
  ];
}

function PointRow({ point, picked, away, onPick }: { point: NetworkPoint; picked: boolean; away: string | null; onPick: () => void }) {
  const t = useT();
  const closed = point.openState === 'closed';
  return (
    <button type="button" class="row" disabled={closed} aria-pressed={picked} onClick={onPick}>
      <span class="row__ic">
        <Icon name={picked ? 'check' : 'home'} size={24} />
      </span>
      <span class="row__body">
        <span class="row__t">{point.shopName}</span>
        <span class="row__s">{closed ? t('send.point.closedNow') : `${away ? `${away} · ` : ''}${pointLine(point, t)}`}</span>
      </span>
      <span class="row__end">
        {closed ? (
          <Pill tone="idle" dot>
            {t('send.point.closed')}
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
  const t = useT();
  const q = state.quote;
  const from = state.points.find((p) => p.did === state.fromDid);
  const signedIn = Boolean(state.identity);

  return (
    <div class="scr">
      <StepDots at={4} />
      <h1 class="scr__title">{t('send.quote.title')}</h1>

      {state.quoteState === 'loading' ? <p class="hint">{t('send.quote.working')}</p> : null}
      {state.quoteState === 'error' && state.quoteError ? <ErrorNote error={state.quoteError} onRetry={actions.retryQuote} /> : null}

      {/* The market moved between the price and the mint — we bounced back here with the fresh price to re-confirm. */}
      {state.mintError?.code === 'PRICE_CHANGED' ? (
        <Note tone="warn" icon="wallet" title={t('send.quote.changedTitle')} detail={t('send.quote.changedDetail')} />
      ) : null}

      {q ? (
        <>
          <div class="prices">
            <div class="price price--lead">
              <span class="price__title">{t('send.quote.priceTitle')}</span>
              <span class="price__total">{money(lockedPrice(q, t).total)}</span>
              <span class="price__sub">{lockedPrice(q, t).sub}</span>
              {/* The tax the price already contains — named, never added on at the end. Rendered only when
                  there is one, which today is nowhere: a line reading zero is noise on a receipt. */}
              {taxLine(q, t) ? <span class="price__sub">{taxLine(q, t)}</span> : null}
            </div>
          </div>

          <Card label={t('send.quote.journey')}>
            <p class="t-body">{journeyLine(q)}</p>
            <p class="card__note">{t('send.quote.about', { km: Math.round(q.totalKm), fees: money(q.nodeFees) })}</p>
          </Card>

          {signedIn ? null : (
            <Card title={t('send.quote.nextTitle')}>
              <Checklist
                items={[
                  t('send.quote.nextTake', { shop: from?.shopName ?? t('send.dropShop') }),
                  t('send.quote.nextPay'),
                  t('send.quote.nextCode'),
                ]}
              />
            </Card>
          )}
        </>
      ) : null}

      {q ? (
        <div class="scr__cta">
          {signedIn ? (
            <Button onClick={actions.toBook}>{t('send.quote.book')}</Button>
          ) : (
            <Button onClick={() => actions.go('account')}>{t('send.quote.signIn')}</Button>
          )}
        </div>
      ) : null}

      <div class="scr__foot">
        <Button variant="link" full={false} onClick={() => actions.backTo('to')}>
          {t('send.quote.changeShop')}
        </Button>
        <Button variant="link" full={false} onClick={actions.startAgain}>
          {t('send.quote.another')}
        </Button>
        <ReadAloud text={() => (q ? quoteSummary(q, t) : t('send.quote.aloudLoading'))} label={t('send.readAloud')} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------- book -- */

function BookStep({ state, actions }: SendScreenProps) {
  const t = useT();
  const q = state.quote;
  const from = state.points.find((p) => p.did === state.fromDid);
  const to = state.points.find((p) => p.did === state.toDid);
  const ready = phoneReady(cleanPhone(state.receiverMobile));

  return (
    <div class="scr">
      <h1 class="scr__title">{t('send.book.title')}</h1>
      <p class="scr__lede">{t('send.book.lede')}</p>

      <Card label={t('send.book.receiver')}>
        <div class="field">
          <label class="field__label" for="rcv-phone">
            {t('send.book.phoneLabel')}
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
          {t('send.pickContacts')}
        </Button>
      </Card>

      <Card label={t('send.book.yourSend')}>
        <div class="kv">
          <span>{t('send.book.from')}</span>
          <b>{from?.shopName ?? '—'}</b>
        </div>
        <div class="kv">
          <span>{t('send.book.to')}</span>
          <b>{to?.shopName ?? '—'}</b>
        </div>
        {state.derived ? (
          <div class="kv">
            <span>{t('send.book.size')}</span>
            <b>{sizeMeta(state.derived.size, t).label}</b>
          </div>
        ) : null}
        {q ? (
          <div class="kv">
            <span>{t('send.youPay')}</span>
            <b>{money(lockedPrice(q, t).total)}</b>
          </div>
        ) : null}
        {q && taxLine(q, t) ? <p class="card__note">{taxLine(q, t)}</p> : null}
      </Card>

      {state.mintError ? <ErrorNote error={state.mintError} /> : null}

      <div class="scr__cta">
        <Button busy={state.mintBusy} disabled={!ready} onClick={() => void actions.submitMint()}>
          {t('send.book.makeLabel')}
        </Button>
        {!ready ? <p class="hint" style="margin-top:8px">{t('send.book.enterNumber')}</p> : null}
      </div>

      <div class="scr__foot">
        <Button variant="link" full={false} onClick={() => actions.backTo('quote')}>
          {t('send.book.backToPrice')}
        </Button>
        <ReadAloud text={() => t('send.book.aloud', { price: q ? money(lockedPrice(q, t).total) : t('send.book.thePrice'), shop: from?.shopName ?? t('send.book.theShop') })} label={t('send.readAloud')} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------- done -- */

function DoneStep({ state, actions }: SendScreenProps) {
  const t = useT();
  const m = state.minted;
  // The shop the parcel was actually minted at — snapshotted at mint, immune to any later back-navigation.
  const fromName = state.mintedFromName ?? t('send.dropShop');
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
      <h1 class="scr__title">{t('send.done.title')}</h1>
      <p class="scr__lede">{t('send.done.lede')}</p>

      {/* Trusted markup: the SVG comes from OUR backend's mint response, nothing user-authored. */}
      {svg ? <div class="labelbox" dangerouslySetInnerHTML={{ __html: svg }} /> : null}

      <Card title={t('send.done.nextTitle')}>
        <Checklist items={mintChecklist(fromName, m.price.total, t)} />
      </Card>

      {m.journey ? (
        <Card title={t('send.done.journeyTitle')}>
          <p class="t-body">{m.journey.hops.join(' → ')}</p>
          <p class="card__note">
            {m.journey.mdpRouted ? t('send.done.routedHub') : t('send.done.directHop')}
            {m.journey.pickupReadyAt ? t('send.done.readyAround', { time: new Date(m.journey.pickupReadyAt).toLocaleString() }) : ''}
          </p>
        </Card>
      ) : null}

      <Card label={t('send.done.recordsTitle')}>
        <div class="kv">
          <span>{t('send.done.parcel')}</span>
          <b class="mono-t">{m.parcel.parcelId}</b>
        </div>
        {m.parcel.trackingKey ? (
          <div class="kv">
            <span>{t('send.done.trackingKey')}</span>
            <b class="mono-t">{m.parcel.trackingKey}</b>
          </div>
        ) : null}
        <div class="kv">
          <span>{t('send.youPay')}</span>
          <b>{money(m.price.total)}</b>
        </div>
        {/* From the PARCEL's own price, not from a fresh quote — this is a receipt, and it must show the
            tax this shipment was actually sold with even if the rate has moved since. */}
        {mintTaxLine(m.price, t) ? <p class="card__note">{mintTaxLine(m.price, t)}</p> : null}
      </Card>

      <div class="scr__cta">
        <Button onClick={openLabel} disabled={!svg}>
          {t('send.done.openLabel')}
        </Button>
      </div>

      <Button variant="outline" onClick={() => actions.go('parcels')}>
        {t('send.done.seeInParcels')}
      </Button>

      <div class="scr__foot">
        <Button variant="link" full={false} onClick={actions.startAgain}>
          {t('send.done.another')}
        </Button>
        <ReadAloud text={() => t('send.done.aloud', { shop: fromName, price: money(m.price.total) })} label={t('send.readAloud')} />
      </div>
    </div>
  );
}
