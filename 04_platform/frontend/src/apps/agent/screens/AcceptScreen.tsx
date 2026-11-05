import { AskToOpen } from '../../../shared/opening/AskToOpen';
import { Abbreviated } from '../../../shared/ui/Abbr';
import { useEffect, useState } from 'preact/hooks';
import { Button, Card, CheckGate, ErrorNote, Explainer, GlanceNumber, Icon, Note, OptionPicker, OsmCredit, Pill, PlaceMap, ReadAloud, ScanField, Sheet, PhoneField, WeightInput } from '../../../shared/ui';
import { agentConfig } from '../api';
import { useT, type Translate } from '../../../shared/i18n';
import { BODY_HINTS, NATURES, acceptMissing, freightStepMissing, money, parcelStatusWord, pointDistance, selectablePoints, sizeMeta, takeInTermsNotice, termsBlock, termsNeedTelling } from '../logic';
import { FreightBooking } from './FreightBooking';
import type { NetworkPoint, TakeInTerms } from '../types';
import type { AgentActions, AgentState } from '../useAgentApp';
import { PhotoField } from './PhotoField';
import { TakenInLabel } from './TakenInLabel';

export interface AcceptScreenProps {
  state: AgentState;
  actions: AgentActions;
}

/** F2 — a human day/time for the freight receipt (the booking confirmation, not a data surface). */
function whenText(iso?: string): string {
  if (!iso) return '';
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? '' : new Date(ms).toLocaleString();
}

/** F2 — the plain-words site-equipment advisory shown on the freight receipt (which end can't lift the load). */
function freightGapDetail(gaps: Array<'origin' | 'dest'>, t: Translate): string {
  const here = gaps.includes('origin');
  const there = gaps.includes('dest');
  const where = here && there ? t('agent.accept.gapBoth') : here ? t('agent.accept.gapHere') : t('agent.accept.gapThere');
  return t('agent.accept.gapDetail', { where });
}

/** FB2d — the clerk's own word for a body where the short picker has one, the API's made readable where it
 *  does not. The receipt reads the SERVER's copy of the load, so it must stay legible if that list widens. */
function bodyLabel(value: string, t: Translate): string {
  const known = BODY_HINTS.find((b) => b.value === value);
  return known ? t(known.labelKey as 'agent.accept.bodyAny') : value.replace(/_/g, ' ');
}

/**
 * Take in a parcel. Scanning the sticker decides which counter this is (PG4): a code the
 * network already knows — a peer send booked in the Send app (collect the locked cash) or
 * a prepaid store order — shows a confirm card with everything pre-filled; a fresh sticker
 * falls through to the walk-up form (size, destination, phones, photo) exactly as before.
 */
export function AcceptScreen({ state, actions }: AcceptScreenProps) {
  const t = useT();
  const f = state.accept;
  // A dedicated (P4+) walk-up no longer dead-ends (F2): it switches the tail to the "book as freight" flow.
  // So the parcel-accept block is just the missing walk-up fields; the freight branch owns its own block.
  const isDedicated = Boolean(state.acceptDerived?.dedicated);
  // P3 — the terms are part of what must be complete before the goods are accepted, not a legend beside it.
  const blockReason = acceptMissing(f, t) ?? termsBlock(state.takeInTerms, state.takeInTermsState, state.termsTold, t);
  const terms = state.takeInTermsState === 'ready' ? state.takeInTerms : null;
  const termsAloud = terms ? `${takeInTermsNotice(terms, t).title}. ${takeInTermsNotice(terms, t).detail} ` : '';
  // A walk-up too big for the bus is booked as freight once it is measured and has a shop to go to.
  const entryBlock = freightStepMissing('goods', f, Date.now(), t);
  const [booking, setBooking] = useState(false);
  // Only a SETTLED preview drives the confirm card — never a stale one still resolving under a new scan.
  const pm = state.preMintState === 'ready' ? state.preMint : null;
  // 2026-11-04 — NOTHING CAN BE TAKEN IN HERE (the owner: "it should rather move to the top"): said first, with the way to ask
  // SeeBuyGet to open in this country — not above the button that cannot work.
  const closedHere = terms?.promise === 'none' ? terms : pm?.terms?.promise === 'none' ? pm.terms : null;
  // Round 13 — which parcel's papers the counter saw in the pouch: a tick belongs to one parcel, never the next one scanned.
  const [papersSeen, setPapersSeen] = useState<string | null>(null);
  const booked = pm && (pm.kind === 'peer_send' || pm.kind === 'vendor_order');
  // The walk-up form applies to a FRESH sticker (idle) or when a preview blipped (error, so a plain
  // walk-up is never blocked by a network hiccup). While a code is resolving, neither shows.
  const walkUp = state.preMintState === 'idle' || state.preMintState === 'error';

  // Booked (the take-in is cleared) or no longer too big: the next walk-up starts at the take-in again.
  useEffect(() => {
    if (!isDedicated) setBooking(false);
  }, [isDedicated]);

  // Booking it as freight is the whole screen, one part at a time, until it is booked or taken back to the take-in.
  if (booking && isDedicated && walkUp && !entryBlock) {
    return (
      <div class="scr">
        {state.error ? <ErrorNote error={state.error} /> : null}
        <FreightBooking state={state} actions={actions} onTakeIn={() => setBooking(false)} />
      </div>
    );
  }

  return (
    <div class="scr">
      <h1 class="scr__title">{t('agent.accept.title')}</h1>
      {closedHere ? (
        <>
          <TermsNote terms={closedHere} />
          {state.staff ? null : <AskToOpen country={closedHere.jurisdiction} kind="shop" config={agentConfig()} />}
        </>
      ) : null}
      <Explainer who={state.agent?.did} id="agent.accept.how" text={t('agent.accept.lede')} />

      {state.error ? <ErrorNote error={state.error} /> : null}

      <Card>
        <ScanField
          id="sticker"
          label={t('agent.accept.scanLabel')}
          value={f.parcelId}
          onValue={(v) => actions.setAccept({ parcelId: v })}
          expect="parcel"
          placeholder={t('agent.scanPlaceholder')}
          upper
        />
        {state.preMintState === 'loading' ? <p class="card__note">{t('agent.accept.checking')}</p> : null}
      </Card>

      {state.preMintState === 'error' && state.preMintError ? <ErrorNote error={state.preMintError} onRetry={actions.retryPreview} /> : null}

      {pm && !booked ? (
        <Note tone="warn" icon="warning" title={t('agent.accept.inUseTitle')} detail={t('agent.accept.inUseDetail', { status: parcelStatusWord(pm.status, t).toLowerCase() })} />
      ) : null}

      {pm && booked && !pm.intakeReady ? (
        pm.kind === 'vendor_order' && pm.status === 'Created' ? (
          <Note tone="warn" icon="wallet" title={t('agent.accept.awaitPayTitle')} detail={t('agent.accept.awaitPayDetail')} />
        ) : (
          <Note tone="warn" icon="warning" title={t('agent.accept.alreadyTitle')} detail={t('agent.accept.alreadyDetail', { status: parcelStatusWord(pm.status, t).toLowerCase() })} />
        )
      ) : null}

      {pm && booked && pm.intakeReady ? (
        <>
          {pm.kind === 'peer_send' ? (
            <GlanceNumber label={t('agent.accept.collectCash')} value={money(pm.cashDue, pm.currency)} sub={t('agent.accept.priceLocked')} />
          ) : (
            <Note tone="info" icon="wallet" title={t('agent.accept.prepaidTitle')} detail={t('agent.accept.prepaidDetail')} />
          )}

          {pm.terms && pm.terms.promise !== 'none' ? <TermsNote terms={pm.terms} /> : null}

          <Card label={pm.kind === 'peer_send' ? t('agent.accept.bookedInApp') : t('agent.accept.storeOrder')}>
            <div class="kv">
              <span>{t('agent.accept.goingTo')}</span>
              <b>{pm.destShopName ?? pm.destZone}</b>
            </div>
            <div class="kv">
              <span>{t('agent.accept.size')}</span>
              <b>{`${pm.size} · ${pm.weightKg} kg${pm.fragile ? ` · ${t('agent.accept.fragile')}` : ''}`}</b>
            </div>
          </Card>

          {/* Round 13 — a store's parcel crossing a border goes with its papers: the shop looks for them before taking it in. */}
          {pm.papers ? (
            <Card label={t('agent.accept.papersLabel')}>
              <p class="card__note">{t('agent.accept.papersNote', { crossing: pm.papers.crossing })}</p>
              <CheckGate items={[{ key: 'papers', label: t('agent.accept.papersItem', { n: pm.papers.copies }) }]} checked={papersSeen === pm.parcelId ? ['papers'] : []} onChange={(keys) => setPapersSeen(keys.length ? pm.parcelId : null)} />
            </Card>
          ) : null}

          {pm.kind === 'peer_send' ? (
            <Card label={t('agent.accept.proofPhoto')}>
              <PhotoField id="intake-photo" value={state.intakePhotoRef} label={t('agent.accept.takePhoto')} upload={(file) => actions.uploadPhoto('dropoff', file)} onCapture={actions.setIntakePhoto} />
              <p class="card__note">{t('agent.accept.photoNote')}</p>
            </Card>
          ) : null}

          <div class="scr__cta">
            <Button
              onClick={() => void actions.submitIntake(papersSeen === pm.parcelId)}
              disabled={(pm.kind === 'peer_send' && !state.intakePhotoRef) || pm.terms?.promise === 'none' || (pm.papers ? papersSeen !== pm.parcelId : false)}
              busy={state.busy === 'intake'}
            >
              {pm.kind === 'peer_send' ? t('agent.accept.collectAndTakeIn', { amount: money(pm.cashDue, pm.currency) }) : t('agent.accept.takeIn')}
            </Button>
            {pm.kind === 'peer_send' && !state.intakePhotoRef ? <p class="hint" style="margin-top:8px">{t('agent.accept.photoFirst')}</p> : null}
            {pm.papers && papersSeen !== pm.parcelId ? <p class="hint" style="margin-top:8px">{t('agent.accept.papersFirst')}</p> : null}
          </div>

          <div class="scr__foot">
            <ReadAloud
              text={() =>
                (pm.terms ? `${takeInTermsNotice(pm.terms, t).title}. ${takeInTermsNotice(pm.terms, t).detail} ` : '') +
                (pm.kind === 'peer_send' ? t('agent.accept.aloudBooked', { amount: money(pm.cashDue, pm.currency) }) : t('agent.accept.aloudPrepaid'))
              }
              label={t('agent.readAloud')}
            />
          </div>
        </>
      ) : null}

      {!walkUp ? null : (
        <>
      <Card label={t('agent.accept.dimensions')}>
        <div class="dims">
          {(
            [
              ['l', t('agent.accept.dimL')],
              ['w', t('agent.accept.dimW')],
              ['h', t('agent.accept.dimH')],
            ] as const
          ).map(([k, label]) => (
            <div key={k} class="field">
              <label class="field__label" for={`accept-dim-${k}`}>
                {label}
              </label>
              <input
                id={`accept-dim-${k}`}
                class="input"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.1"
                value={f.dims[k]}
                onInput={(e) => actions.setDims({ [k]: e.currentTarget.value } as never)}
                onBlur={() => void actions.deriveSize()}
              />
            </div>
          ))}
          {/* 2026-11-05 — the weight in kilograms or grams; the form still holds kilograms. */}
          <div class="field">
            <label class="field__label" for="accept-dim-kg">
              {t('agent.accept.dimKg')}
            </label>
            <WeightInput id="accept-dim-kg" value={f.dims.kg} onInput={(kg) => actions.setDims({ kg } as never)} onBlur={() => void actions.deriveSize()} />
          </div>
        </div>
        {state.acceptDerived ? (
          <Pill tone={state.acceptDerived.dedicated ? 'warn' : 'info'}>
            {t('agent.accept.sizePill', { label: sizeMeta(state.acceptDerived.size, t).label, hint: sizeMeta(state.acceptDerived.size, t).hint })}
          </Pill>
        ) : (
          <p class="card__note">{t('agent.accept.dimsNote')}</p>
        )}
        <label class="checkline" style="margin-top:12px">
          <input type="checkbox" checked={f.fragile} onChange={(e) => actions.setAccept({ fragile: e.currentTarget.checked })} />
          <span>{t('agent.accept.fragileCheck')}</span>
        </label>
      </Card>

      <Card label={t('agent.accept.whatsInside')}>
        {/* No field label of its own — the Card is already headed "What's inside?", so the picker takes that
            as its title and the sheet asks the same question back. */}
        <OptionPicker
          topic="nature"
          title={t('agent.accept.whatsInside')}
          options={NATURES.map((n) => ({ key: n.key, label: t(n.labelKey), detail: t(n.detailKey) }))}
          value={f.natureCode}
          onChange={(key) => actions.setAccept({ natureCode: key as typeof f.natureCode })}
          placeholder={t('agent.accept.whatsInside')}
          config={agentConfig()}
        />
        <p class="card__note">{t('agent.accept.natureNote')}</p>
      </Card>

      <DestinationCard state={state} actions={actions} />

      {isDedicated ? (
        <>
          <Note tone="info" icon="truck" title={t('agent.accept.tooBigTitle')} detail={t('agent.accept.tooBigDetail')} />
          {/* 2026-11-03 — measured and its shop chosen, the booking itself is one part per screen (FreightBooking.tsx). */}
          <div class="scr__cta">
            <Button onClick={() => setBooking(true)} disabled={Boolean(entryBlock)}>
              {t('agent.freightSteps.open')}
            </Button>
            {entryBlock ? <p class="hint" style="margin-top:8px"><Abbreviated text={entryBlock} /></p> : null}
          </div>
          <div class="scr__foot">
            <ReadAloud text={() => entryBlock ?? t('agent.freightSteps.openReady')} label={t('agent.accept.whatMissing')} />
          </div>
        </>
      ) : (
        <>

      <Card label={t('agent.accept.phones')}>
        <div class="field">
          <label class="field__label" for="sender">
            {t('agent.accept.senderPhone')}
          </label>
          <PhoneField id="sender" value={f.senderMobile} onInput={(v) => actions.setAccept({ senderMobile: v })} autoComplete="off" />
        </div>
        <div class="field" style="margin-top:12px">
          <label class="field__label" for="receiver">
            {t('agent.accept.receiverPhone')}
          </label>
          <PhoneField id="receiver" value={f.receiverMobile} onInput={(v) => actions.setAccept({ receiverMobile: v })} autoComplete="off" />
        </div>
        <p class="card__note">{t('agent.accept.phonesNote')}</p>
      </Card>

      <Card label={t('agent.accept.proofPhoto')}>
        <PhotoField id="accept-photo" value={f.photoRef} label={t('agent.accept.takePhoto')} upload={(file) => actions.uploadPhoto('dropoff', file)} onCapture={(ref) => actions.setAccept({ photoRef: ref })} />
        <p class="card__note">{t('agent.accept.photoNote')}</p>
      </Card>

      {/* P3 — said out loud before acceptance: whose promise, who answers, and the cover. Directly above the
          button, so it is the last thing read before the goods change hands. */}
      {state.takeInTermsState === 'error' ? (
        <Note tone="warn" icon="warning" title={t('agent.accept.termsFailed')} detail="" />
      ) : null}
      {state.takeInTermsState === 'error' ? (
        <Button variant="outline" chevron={false} onClick={actions.retryTerms}>
          {t('agent.tryAgain')}
        </Button>
      ) : null}
      {terms && terms.promise !== 'none' ? <TermsNote terms={terms} /> : null}
      {termsNeedTelling(terms) ? (
        <label class="checkline" style="margin-top:12px">
          <input type="checkbox" checked={state.termsTold} onChange={(e) => actions.setTermsTold(e.currentTarget.checked)} />
          <span>{t(terms?.promise === 'theirs' ? 'agent.accept.termsTheirsTick' : 'agent.accept.termsNoCoverTick')}</span>
        </label>
      ) : null}

      <div class="scr__cta">
        <Button onClick={() => void actions.submitAccept()} disabled={Boolean(blockReason)} busy={state.busy === 'accept'}>
          {t('agent.accept.confirm')}
        </Button>
        {blockReason ? <p class="hint" style="margin-top:8px">{blockReason}</p> : null}
      </div>

      <div class="scr__foot">
        <ReadAloud text={() => termsAloud + (blockReason ?? t('agent.accept.ready'))} label={t('agent.accept.whatMissing')} />
      </div>
        </>
      )}
        </>
      )}

      {/* PG4 — the booked-parcel intake confirmation: what was collected, where it goes next. */}
      <Sheet open={Boolean(state.intakeDone)} onClose={actions.dismissIntakeDone} title={t('agent.accept.takenInTitle')}>
        {state.intakeDone ? (
          <>
            <p class="t-body">
              {state.intakeDone.kind === 'peer_send'
                ? t('agent.accept.doneCash', { amount: money(state.intakeDone.cashDue, state.intakeDone.currency) })
                : t('agent.accept.donePrepaid')}
            </p>
            {state.intakeDone.destShopName ? <p class="hint">{t('agent.accept.doneTravels', { shop: state.intakeDone.destShopName })}</p> : null}
            <Button onClick={actions.dismissIntakeDone}>{t('agent.accept.doneAnother')}</Button>
          </>
        ) : null}
      </Sheet>

      {/* DT — the parcel is born with a printable label; show it so the agent prints + sticks it on the parcel. */}
      <Sheet open={Boolean(state.acceptedLabel)} onClose={actions.dismissAcceptedLabel} title={t(state.acceptedLabel?.queued ? 'agent.accept.queuedTitle' : 'agent.accept.labelReadyTitle')}>
        {state.acceptedLabel ? (
          <>
            <p class="t-body">{t(state.acceptedLabel.queued ? 'agent.accept.queuedBody' : 'agent.accept.labelBody', { parcel: state.acceptedLabel.parcelId })}</p>
            {/* The label, the tracking key and the pickup code for the SENDER standing here — or, taken in without a
                signal, nothing yet: they are made when it reaches SeeBuyGet, and shown then. */}
            <TakenInLabel label={state.acceptedLabel} onThermal={(id) => void actions.thermalLabel(id)} busy={state.busy === 'thermal'} />
            <Button variant="link" onClick={actions.dismissAcceptedLabel}>
              {t('agent.accept.doneAnother')}
            </Button>
          </>
        ) : null}
      </Sheet>

      {/* F2 — the counter-freight receipt: the tracking code to print, the cash cap to collect, and a lifting advisory. */}
      <Sheet open={Boolean(state.bookedFreight)} onClose={actions.dismissBookedFreight} title={t('agent.accept.freightBookedTitle')}>
        {state.bookedFreight ? (
          <>
            <p class="t-body">
              {state.bookedFreight.status === 'scheduled'
                ? t('agent.accept.freightScheduled', { when: whenText(state.bookedFreight.scheduledPickupAt) })
                : t('agent.accept.freightMarket')}
            </p>
            <Card label={t('agent.accept.trackingCode')}>
              <p class="t-body">
                <b style="font-size:22px; letter-spacing:1px">{state.bookedFreight.code}</b>
              </p>
              <p class="card__note">{t('agent.accept.freightReceiptNote')}</p>
              {state.bookedFreight.trackingKey ? <p class="hint">{t('agent.accept.freightKey', { key: state.bookedFreight.trackingKey })}</p> : null}
            </Card>
            {state.bookedFreight.maxSpend != null ? (
              <p class="hint">{t('agent.accept.freightCollect', { amount: money(state.bookedFreight.maxSpend, state.bookedFreight.currency) })}</p>
            ) : null}
            {/* FB2c — hand the conclusion back to the person who supplied the facts it ran on. It is also the
                only place a clerk finds out that skipping the measurements left us guessing from weight. */}
            {state.bookedFreight.bodyDerived ? (
              <p class="hint">
                {state.bookedFreight.bodyDerived.basis === 'measured'
                  ? t('agent.accept.derivedBody', { body: state.bookedFreight.bodyDerived.body.replace('_', ' ') })
                  : t('agent.accept.derivedBodyGuess', { body: state.bookedFreight.bodyDerived.body.replace('_', ' ') })}
              </p>
            ) : null}
            {/* FB2d — what the customer's refusal actually became. Worth its own line on the receipt because
                it is the one recorded fact that will TURN A DRIVER AWAY, and the customer should be told the
                shop wrote it down before it does. */}
            {state.bookedFreight.excludedBodies?.length ? <p class="hint">{t('agent.accept.excludedRecorded', { bodies: state.bookedFreight.excludedBodies.map((b) => bodyLabel(b, t)).join(', ') })}</p> : null}
            {state.bookedFreight.equipmentGaps?.length ? (
              <Note tone="warn" icon="warning" title={t('agent.accept.liftTitle')} detail={freightGapDetail(state.bookedFreight.equipmentGaps, t)} />
            ) : null}
            <Button onClick={actions.dismissBookedFreight}>{t('agent.accept.freightAnother')}</Button>
          </>
        ) : null}
      </Sheet>
    </div>
  );
}

/**
 * The destination-PUDO picker (walk-up intake): a Map | Address toggle over the same shop directory. On the
 * map, tap a pin or a row to pick the collection shop. In Address mode, type an area and tap Find — the
 * shops re-rank nearest-first around it (place/area geocoding, flagged when only approximate). Either way
 * the pick is a specific dest PUDO, not a coarse zone.
 */
function DestinationCard({ state, actions }: { state: AgentState; actions: AgentActions }) {
  const t = useT();
  const f = state.accept;
  const near = f.destMode === 'address' ? state.acceptNear : null;
  // Exclude the accepting shop — a parcel can't be sent to the shop taking it in.
  const points = selectablePoints(state.acceptPoints, state.agent?.did ?? undefined, near, state.agent?.country);
  const mapPins = points.filter((p) => p.location && p.openState === 'open').map((p) => ({ id: p.did, label: p.shopName, point: p.location! }));
  const pick = (p: NetworkPoint) => actions.pickDest({ did: p.did, zone: p.zone, shopName: p.shopName });

  return (
    <Card label={t('agent.accept.whereGo')}>
      {/* Names the picking METHOD, not the surface — so it doesn't collide with PlaceMap's own Map/Simple toggle. */}
      <div class="seg" role="group" aria-label={t('agent.accept.pickMethodAria')}>
        <button type="button" class={`seg__btn${f.destMode === 'map' ? ' seg__btn--on' : ''}`} aria-pressed={f.destMode === 'map'} onClick={() => actions.setDestMode('map')}>
          <Icon name="home" size={18} /> {t('agent.accept.pickShop')}
        </button>
        <button type="button" class={`seg__btn${f.destMode === 'address' ? ' seg__btn--on' : ''}`} aria-pressed={f.destMode === 'address'} onClick={() => actions.setDestMode('address')}>
          <Icon name="search" size={18} /> {t('agent.accept.byArea')}
        </button>
      </div>

      {state.acceptPointsState === 'loading' ? <p class="hint" style="margin-top:10px">{t('agent.accept.findingShops')}</p> : null}
      {state.acceptPointsState === 'error' ? (
        <p class="hint" style="margin-top:10px">{t('agent.accept.loadShopsFail')} <button type="button" class="linkbtn" onClick={() => actions.go('accept')}>{t('agent.tryAgain')}</button></p>
      ) : null}

      {f.destMode === 'address' ? (
        <>
          <div class="reg__dates" style="margin-top:10px">
            <div class="field" style="flex:1">
              <label class="field__label" for="dest-address">{t('agent.accept.areaLabel')}</label>
              <input id="dest-address" class="input" value={f.addressText} onInput={(e) => actions.setAddress(e.currentTarget.value)} placeholder={t('agent.accept.areaPh')} autocapitalize="words" />
            </div>
            <Button variant="outline" full={false} chevron={false} busy={state.acceptGeoBusy} onClick={() => void actions.geocodeAddress()}>
              {t('agent.accept.find')}
            </Button>
          </div>
          {state.acceptGeoNote ? <p class="card__note" role="status">{state.acceptGeoNote}</p> : null}
          <OsmCredit />
        </>
      ) : null}

      {/* The map in both ways of picking (2026-10-25): "By area" had none, so a place found from a typed name could not
          be checked by eye. Found, it closes in on the place and its three nearest shops, and a tap corrects it. */}
      {mapPins.length ? (
        <div style="margin-top:10px">
          <PlaceMap
            label={t('agent.accept.mapLabel', { count: mapPins.length })}
            pins={mapPins}
            selectedId={f.destPudoDid || null}
            reference={near}
            nearest={near ? 3 : undefined}
            onPick={(did) => { const p = points.find((x) => x.did === did); if (p) pick(p); }}
            onDrop={f.destMode === 'address' ? actions.markDestNear : undefined}
          />
        </div>
      ) : null}

      {points.length ? (
        <div class="rows" role="list" style="margin-top:10px">
          {points.map((p) => (
            <DestRow key={p.did} point={p} picked={f.destPudoDid === p.did} away={pointDistance(p, near)} onPick={() => pick(p)} />
          ))}
        </div>
      ) : state.acceptPointsState === 'ready' ? (
        <p class="hint" style="margin-top:10px">{t('agent.accept.noShops')}</p>
      ) : null}

      {f.destShopName ? <p class="card__note">{t('agent.accept.goingTo')} <b>{f.destShopName}</b>.</p> : null}
    </Card>
  );
}

/** P3 — whose promise these goods are under, in the words the server's answer supplies. */
function TermsNote({ terms }: { terms: TakeInTerms }) {
  const t = useT();
  const n = takeInTermsNotice(terms, t);
  return <Note tone={n.tone} icon={n.icon} title={n.title} detail={n.detail} />;
}

function DestRow({ point, picked, away, onPick }: { point: NetworkPoint; picked: boolean; away: string | null; onPick: () => void }) {
  const t = useT();
  const closed = point.openState === 'closed';
  return (
    <button type="button" class="row" disabled={closed} aria-pressed={picked} onClick={onPick}>
      <span class="row__ic">
        <Icon name={picked ? 'check' : 'home'} size={24} />
      </span>
      <span class="row__body">
        <span class="row__t">{point.shopName}</span>
        <span class="row__s">{closed ? t('agent.accept.closedNow') : `${away ? `${away} · ` : ''}${t('agent.zone', { zone: point.zone })}${point.landmark ? ` · ${point.landmark}` : ''}`}</span>
      </span>
      <span class="row__end">{closed ? <Pill tone="idle" dot>{t('agent.closed')}</Pill> : <Icon name="chevronRight" size={22} />}</span>
    </button>
  );
}
