import { Button, Card, Chip, CodeCard, ErrorNote, GlanceNumber, Icon, Note, OptionPicker, PlaceMap, Pill, ReadAloud, ScanField, Sheet } from '../../../shared/ui';
import { agentConfig } from '../api';
import { useT, type Translate } from '../../../shared/i18n';
import { BODY_HINTS, EXCLUDABLE_BODIES, NATURES, PACKAGING_HELP, acceptMissing, bookFreightMissing, chooseBodyHint, parcelStatusWord, pointDistance, selectablePoints, sizeMeta, toggleExcludedBody, type BodyHint, type PackagingChoice } from '../logic';
import type { NetworkPoint } from '../types';
import type { AgentActions, AgentState } from '../useAgentApp';
import { PhotoField } from './PhotoField';

export interface AcceptScreenProps {
  state: AgentState;
  actions: AgentActions;
}

/** DT — open the label SVG in a new tab so the agent can print it and stick it on the parcel. */
function openLabel(svg: string) {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
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
  const blockReason = acceptMissing(f, t);
  const freightBlock = bookFreightMissing(f, Date.now(), t);
  // Only a SETTLED preview drives the confirm card — never a stale one still resolving under a new scan.
  const pm = state.preMintState === 'ready' ? state.preMint : null;
  const booked = pm && (pm.kind === 'peer_send' || pm.kind === 'vendor_order');
  // The walk-up form applies to a FRESH sticker (idle) or when a preview blipped (error, so a plain
  // walk-up is never blocked by a network hiccup). While a code is resolving, neither shows.
  const walkUp = state.preMintState === 'idle' || state.preMintState === 'error';

  return (
    <div class="scr">
      <h1 class="scr__title">{t('agent.accept.title')}</h1>
      <p class="scr__lede">{t('agent.accept.lede')}</p>

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
            <GlanceNumber label={t('agent.accept.collectCash')} value={pm.cashDue.toFixed(2)} sub={t('agent.accept.priceLocked')} />
          ) : (
            <Note tone="info" icon="wallet" title={t('agent.accept.prepaidTitle')} detail={t('agent.accept.prepaidDetail')} />
          )}

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

          {pm.kind === 'peer_send' ? (
            <Card label={t('agent.accept.proofPhoto')}>
              <PhotoField id="intake-photo" value={state.intakePhotoRef} label={t('agent.accept.takePhoto')} upload={(file) => actions.uploadPhoto('dropoff', file)} onCapture={actions.setIntakePhoto} />
              <p class="card__note">{t('agent.accept.photoNote')}</p>
            </Card>
          ) : null}

          <div class="scr__cta">
            <Button
              onClick={() => void actions.submitIntake()}
              disabled={pm.kind === 'peer_send' && !state.intakePhotoRef}
              busy={state.busy === 'intake'}
            >
              {pm.kind === 'peer_send' ? t('agent.accept.collectAndTakeIn', { amount: pm.cashDue.toFixed(2) }) : t('agent.accept.takeIn')}
            </Button>
            {pm.kind === 'peer_send' && !state.intakePhotoRef ? <p class="hint" style="margin-top:8px">{t('agent.accept.photoFirst')}</p> : null}
          </div>

          <div class="scr__foot">
            <ReadAloud
              text={() => (pm.kind === 'peer_send' ? t('agent.accept.aloudBooked', { amount: pm.cashDue.toFixed(2) }) : t('agent.accept.aloudPrepaid'))}
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
              ['kg', t('agent.accept.dimKg')],
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
          <FreightBookingCard state={state} actions={actions} />
          <div class="scr__cta">
            <Button onClick={() => void actions.submitBookFreight()} disabled={Boolean(freightBlock)} busy={state.busy === 'book-freight'}>
              {t('agent.accept.bookFreight')}
            </Button>
            {freightBlock ? <p class="hint" style="margin-top:8px">{freightBlock}</p> : null}
          </div>
          <div class="scr__foot">
            <ReadAloud text={() => freightBlock ?? t('agent.accept.freightReady')} label={t('agent.accept.whatMissing')} />
          </div>
        </>
      ) : (
        <>

      <Card label={t('agent.accept.phones')}>
        <div class="field">
          <label class="field__label" for="sender">
            {t('agent.accept.senderPhone')}
          </label>
          <input
            id="sender"
            class="input"
            type="tel"
            inputMode="tel"
            value={f.senderMobile}
            onInput={(e) => actions.setAccept({ senderMobile: e.currentTarget.value })}
            placeholder="07…"
            autocomplete="off"
          />
        </div>
        <div class="field" style="margin-top:12px">
          <label class="field__label" for="receiver">
            {t('agent.accept.receiverPhone')}
          </label>
          <input
            id="receiver"
            class="input"
            type="tel"
            inputMode="tel"
            value={f.receiverMobile}
            onInput={(e) => actions.setAccept({ receiverMobile: e.currentTarget.value })}
            placeholder="07…"
            autocomplete="off"
          />
        </div>
        <p class="card__note">{t('agent.accept.phonesNote')}</p>
      </Card>

      <Card label={t('agent.accept.proofPhoto')}>
        <PhotoField id="accept-photo" value={f.photoRef} label={t('agent.accept.takePhoto')} upload={(file) => actions.uploadPhoto('dropoff', file)} onCapture={(ref) => actions.setAccept({ photoRef: ref })} />
        <p class="card__note">{t('agent.accept.photoNote')}</p>
      </Card>

      <div class="scr__cta">
        <Button onClick={() => void actions.submitAccept()} disabled={Boolean(blockReason)} busy={state.busy === 'accept'}>
          {t('agent.accept.confirm')}
        </Button>
        {blockReason ? <p class="hint" style="margin-top:8px">{blockReason}</p> : null}
      </div>

      <div class="scr__foot">
        <ReadAloud text={() => blockReason ?? t('agent.accept.ready')} label={t('agent.accept.whatMissing')} />
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
                ? t('agent.accept.doneCash', { amount: state.intakeDone.cashDue.toFixed(2) })
                : t('agent.accept.donePrepaid')}
            </p>
            {state.intakeDone.destShopName ? <p class="hint">{t('agent.accept.doneTravels', { shop: state.intakeDone.destShopName })}</p> : null}
            <Button onClick={actions.dismissIntakeDone}>{t('agent.accept.doneAnother')}</Button>
          </>
        ) : null}
      </Sheet>

      {/* DT — the parcel is born with a printable label; show it so the agent prints + sticks it on the parcel. */}
      <Sheet open={Boolean(state.acceptedLabel)} onClose={actions.dismissAcceptedLabel} title={t('agent.accept.labelReadyTitle')}>
        {state.acceptedLabel ? (
          <>
            <p class="t-body">{t('agent.accept.labelBody', { parcel: state.acceptedLabel.parcelId })}</p>
            {state.acceptedLabel.svg ? (
              <>
                {/* Trusted markup: the SVG comes from OUR backend label builder, nothing user-authored. */}
                <div class="labelbox" dangerouslySetInnerHTML={{ __html: state.acceptedLabel.svg }} />
                <Button chevron={false} onClick={() => state.acceptedLabel?.svg && openLabel(state.acceptedLabel.svg)}>
                  {t('agent.accept.openLabel')}
                </Button>
              </>
            ) : null}
            {state.acceptedLabel.trackingKey ? <p class="hint" style="margin-top:8px">{t('agent.accept.trackingKey', { key: state.acceptedLabel.trackingKey })}</p> : null}
            {/* The pickup code, given to the SENDER who is standing right here — they pass it to the person
                collecting. It is deliberately not printed on the parcel and the receiving shop never sees
                it, so this is the moment it has to be handed over. */}
            {state.acceptedLabel.releaseCode ? (
              <>
                <CodeCard label={t('agent.accept.pickupCodeLabel')} code={state.acceptedLabel.releaseCode} />
                <p class="hint">{t('agent.accept.pickupCodeHint')}</p>
                <ReadAloud
                  text={() => t('agent.accept.pickupCodeAloud', { digits: state.acceptedLabel!.releaseCode!.split('').join(', ') })}
                  label={t('agent.accept.pickupCodeSay')}
                />
              </>
            ) : null}
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
              <p class="hint">{t('agent.accept.freightCollect', { amount: state.bookedFreight.maxSpend.toFixed(2) })}</p>
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
  const points = selectablePoints(state.acceptPoints, state.agent?.did ?? undefined, near);
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
          {state.acceptGeoNote ? <p class="card__note">{state.acceptGeoNote}</p> : null}
        </>
      ) : null}

      {f.destMode === 'map' && mapPins.length ? (
        <div style="margin-top:10px">
          <PlaceMap
            label={t('agent.accept.mapLabel', { count: mapPins.length })}
            pins={mapPins}
            selectedId={f.destPudoDid || null}
            reference={near}
            onPick={(did) => { const p = points.find((x) => x.did === did); if (p) pick(p); }}
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

/**
 * F2 — the counter-freight booking card (shown only for a dedicated/P4+ walk-up). The cash budget cap (the
 * most the customer will pay → the freight's ceiling), immediate vs planned pickup (a future day, with the
 * F1 early-reservation choice), and an optional customer phone. No sticker, no proof photo — freight isn't
 * shelved; the printed tracking code is the artefact.
 */
function FreightBookingCard({ state, actions }: { state: AgentState; actions: AgentActions }) {
  const t = useT();
  const f = state.accept;
  return (
    <Card label={t('agent.accept.bookAsFreight')}>
      <div class="field">
        <label class="field__label" for="freight-budget">
          {t('agent.accept.budgetLabel')}
        </label>
        <input
          id="freight-budget"
          class="input"
          type="number"
          inputMode="decimal"
          min="0"
          step="0.5"
          value={f.budgetCap}
          onInput={(e) => actions.setAccept({ budgetCap: e.currentTarget.value })}
          placeholder={t('agent.accept.budgetPh')}
        />
      </div>
      <p class="card__note">{t('agent.accept.budgetNote')}</p>

      <div class="seg" role="group" aria-label={t('agent.accept.whenAria')} style="margin-top:12px">
        <button type="button" class={`seg__btn${f.freightWhen === 'now' ? ' seg__btn--on' : ''}`} aria-pressed={f.freightWhen === 'now'} onClick={() => actions.setAccept({ freightWhen: 'now' })}>
          <Icon name="truck" size={18} /> {t('agent.accept.shipNow')}
        </button>
        <button type="button" class={`seg__btn${f.freightWhen === 'planned' ? ' seg__btn--on' : ''}`} aria-pressed={f.freightWhen === 'planned'} onClick={() => actions.setAccept({ freightWhen: 'planned' })}>
          <Icon name="clock" size={18} /> {t('agent.accept.planned')}
        </button>
      </div>

      {f.freightWhen === 'planned' ? (
        <>
          <div class="field" style="margin-top:12px">
            <label class="field__label" for="freight-date">
              {t('agent.accept.pickupWhen')}
            </label>
            <input id="freight-date" class="input" type="datetime-local" value={f.freightDate} onInput={(e) => actions.setAccept({ freightDate: e.currentTarget.value })} />
          </div>
          <label class="checkline" style="margin-top:12px">
            <input type="checkbox" checked={f.allowEarlyClaim} onChange={(e) => actions.setAccept({ allowEarlyClaim: e.currentTarget.checked })} />
            <span>{t('agent.accept.earlyClaim')}</span>
          </label>
        </>
      ) : null}

      {/* FB5 — how it is PACKED, asked FIRST because it is the only one of these the clerk can simply see,
          and because the two questions below read differently once it is answered. Sacks and pallets are the
          same goods and not the same job: one is worked on and off an open deck, the other is forklifted into
          something that shuts, and only one of them needs nothing at all to lift it. */}
      <div class="field" style="margin-top:12px">
        <span class="field__label" id="freight-packaging-label">
          {t('agent.accept.packaging')}
        </span>
        {/* Chosen by LOOKING. The sheet shows all seven with their pictures, the chosen one ticked — which is
            both halves of the rule at once: everything side by side while you decide, your own answer marked
            once you have. The cast is safe by construction: every key is a PACKAGING_OPTIONS value, and that
            list is the literal set the API's own enum is matched against. */}
        <OptionPicker
          id="freight-packaging"
          labelledBy="freight-packaging-label"
          topic="packaging"
          title={t('agent.accept.packaging')}
          options={PACKAGING_HELP.map((p) => ({ key: p.value, label: t(p.labelKey as 'agent.accept.packBagged'), detail: t(p.detailKey as 'agent.accept.packBaggedWhy') }))}
          value={f.packaging}
          onChange={(key) => actions.setAccept({ packaging: key as PackagingChoice })}
          placeholder={t('agent.accept.packagingChoose')}
          config={agentConfig()}
        />
      </div>
      <p class="card__note">{t('agent.accept.packagingNote')}</p>

      {/* FB2c — the two facts a tape measure cannot supply, asked of the one person standing at the load.
          `indivisible` is not cosmetic: at this weight it is the difference between two ordinary trips on an
          open deck and a low-loader with a permit. */}
      <label class="checkline" style="margin-top:12px">
        <input type="checkbox" checked={f.indivisible} onChange={(e) => actions.setAccept({ indivisible: e.currentTarget.checked })} />
        <span>{t('agent.accept.indivisible')}</span>
      </label>
      <p class="card__note">{t('agent.accept.indivisibleNote')}</p>

      <div class="field" style="margin-top:12px">
        <span class="field__label" id="freight-body-label">
          {t('agent.accept.bodyHint')}
        </span>
        {/* Bodies are the case the pictures were made for: a clerk who could not name a curtain-side knows one
            on sight. Note this list keeps "I don't know" as a ROW rather than as the placeholder — here it is
            a real and often correct answer (the hint is advisory, and no opinion is the honest one), not the
            absence of one. The cast is safe by construction: every key is a BODY_HINTS value, and BODY_HINTS
            is the literal list the API's own enum is matched against. */}
        <OptionPicker
          id="freight-body"
          labelledBy="freight-body-label"
          topic="body"
          title={t('agent.accept.bodyHint')}
          options={BODY_HINTS.map((b) => ({ key: b.value, label: t(b.labelKey as 'agent.accept.bodyAny'), detail: t(b.detailKey as 'agent.accept.bodyFlatbedWhy') }))}
          value={f.bodyHint}
          onChange={(key) => actions.setAccept(chooseBodyHint(f, key as BodyHint))}
          placeholder={t('agent.accept.bodyAny')}
          config={agentConfig()}
        />
      </div>
      <p class="card__note">{t('agent.accept.bodyHintNote')}</p>

      {/* FB2d — the shipper's own refusals, which is a different question from the one above and asked of a
          different person: the clerk GUESSES what would work, the customer DECIDES what they will not have.
          This one binds a claim, so it is worth the row of chips rather than being folded into the hint. */}
      <div class="field" style="margin-top:12px">
        <span class="field__label" id="freight-exclude">
          {t('agent.accept.excludedBodies')}
        </span>
        <div class="chiprow" role="group" aria-labelledby="freight-exclude">
          {EXCLUDABLE_BODIES.map((b) => (
            <Chip key={b.value} label={t(b.labelKey as 'agent.accept.bodyAny')} active={f.excludedBodies.includes(b.value)} onClick={() => actions.setAccept(toggleExcludedBody(f, b.value))} />
          ))}
        </div>
      </div>
      <p class="card__note">{t('agent.accept.excludedBodiesNote')}</p>

      {/* FB2b — how the load is TAKEN, as against when it is picked up. An awkward walk-up is exactly the
          case where the formula's price is worst and a driver's own number is best. */}
      <label class="checkline" style="margin-top:12px">
        <input type="checkbox" checked={f.negotiate} onChange={(e) => actions.setAccept({ negotiate: e.currentTarget.checked })} />
        <span>{t('agent.accept.negotiate')}</span>
      </label>
      <p class="card__note">{t('agent.accept.negotiateNote')}</p>

      <div class="field" style="margin-top:12px">
        <label class="field__label" for="freight-phone">
          {t('agent.accept.customerPhone')}
        </label>
        <input id="freight-phone" class="input" type="tel" inputMode="tel" value={f.customerMobile} onInput={(e) => actions.setAccept({ customerMobile: e.currentTarget.value })} placeholder="07…" autocomplete="off" />
      </div>
      <p class="card__note">{t('agent.accept.customerPhoneNote')}</p>
    </Card>
  );
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
