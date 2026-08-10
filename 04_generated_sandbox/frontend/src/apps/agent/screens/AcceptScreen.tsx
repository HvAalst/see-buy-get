import { Button, Card, ErrorNote, GlanceNumber, Icon, Note, PlaceMap, Pill, ReadAloud, ScanField, Sheet } from '../../../shared/ui';
import { NATURES, acceptMissing, bookFreightMissing, parcelStatusWord, pointDistance, selectablePoints, sizeMeta } from '../logic';
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
  const t = Date.parse(iso);
  return Number.isNaN(t) ? '' : new Date(t).toLocaleString();
}

/** F2 — the plain-words site-equipment advisory shown on the freight receipt (which end can't lift the load). */
function freightGapDetail(gaps: Array<'origin' | 'dest'>): string {
  const here = gaps.includes('origin');
  const there = gaps.includes('dest');
  const where = here && there ? 'to load it here and unload it at the destination' : here ? 'to load it here' : 'to unload it at the destination';
  return `This load may need a forklift or tail-lift ${where}. Arrange it before the truck arrives.`;
}

/**
 * Take in a parcel. Scanning the sticker decides which counter this is (PG4): a code the
 * network already knows — a peer send booked in the Send app (collect the locked cash) or
 * a prepaid store order — shows a confirm card with everything pre-filled; a fresh sticker
 * falls through to the walk-up form (size, destination, phones, photo) exactly as before.
 */
export function AcceptScreen({ state, actions }: AcceptScreenProps) {
  const f = state.accept;
  // A dedicated (P4+) walk-up no longer dead-ends (F2): it switches the tail to the "book as freight" flow.
  // So the parcel-accept block is just the missing walk-up fields; the freight branch owns its own block.
  const isDedicated = Boolean(state.acceptDerived?.dedicated);
  const blockReason = acceptMissing(f);
  const freightBlock = bookFreightMissing(f, Date.now());
  // Only a SETTLED preview drives the confirm card — never a stale one still resolving under a new scan.
  const pm = state.preMintState === 'ready' ? state.preMint : null;
  const booked = pm && (pm.kind === 'peer_send' || pm.kind === 'vendor_order');
  // The walk-up form applies to a FRESH sticker (idle) or when a preview blipped (error, so a plain
  // walk-up is never blocked by a network hiccup). While a code is resolving, neither shows.
  const walkUp = state.preMintState === 'idle' || state.preMintState === 'error';

  return (
    <div class="scr">
      <h1 class="scr__title">Take in a parcel</h1>
      <p class="scr__lede">Scan the label or sticker first — booked parcels fill themselves in.</p>

      {state.error ? <ErrorNote error={state.error} /> : null}

      <Card>
        <ScanField
          id="sticker"
          label="Parcel label or sticker"
          value={f.parcelId}
          onValue={(v) => actions.setAccept({ parcelId: v })}
          expect="parcel"
          placeholder="Scan or type the code"
          upper
        />
        {state.preMintState === 'loading' ? <p class="card__note">Checking the code…</p> : null}
      </Card>

      {state.preMintState === 'error' && state.preMintError ? <ErrorNote error={state.preMintError} onRetry={actions.retryPreview} /> : null}

      {pm && !booked ? (
        <Note tone="warn" icon="warning" title="This sticker is already in use" detail={`It belongs to a parcel that is ${parcelStatusWord(pm.status).toLowerCase()}. Every new parcel needs a fresh sticker.`} />
      ) : null}

      {pm && booked && !pm.intakeReady ? (
        pm.kind === 'vendor_order' && pm.status === 'Created' ? (
          <Note tone="warn" icon="wallet" title="Awaiting the store's payment" detail="Don't take this in yet — the store must top up and pay for the shipment first." />
        ) : (
          <Note tone="warn" icon="warning" title="Already taken in" detail={`This parcel is ${parcelStatusWord(pm.status).toLowerCase()} — nothing to do at the counter.`} />
        )
      ) : null}

      {pm && booked && pm.intakeReady ? (
        <>
          {pm.kind === 'peer_send' ? (
            <GlanceNumber label="Collect in cash" value={pm.cashDue.toFixed(2)} sub="The price was locked when the sender booked — no arguing at the counter." />
          ) : (
            <Note tone="info" icon="wallet" title="Prepaid by the store" detail="Nothing to collect — the store already paid for this shipment." />
          )}

          <Card label={pm.kind === 'peer_send' ? 'Booked in the Send app' : 'Store order'}>
            <div class="kv">
              <span>Going to</span>
              <b>{pm.destShopName ?? pm.destZone}</b>
            </div>
            <div class="kv">
              <span>Size</span>
              <b>{`${pm.size} · ${pm.weightKg} kg${pm.fragile ? ' · fragile' : ''}`}</b>
            </div>
          </Card>

          {pm.kind === 'peer_send' ? (
            <Card label="Proof photo">
              <PhotoField id="intake-photo" value={state.intakePhotoRef} label="Take the proof photo" upload={(file) => actions.uploadPhoto('dropoff', file)} onCapture={actions.setIntakePhoto} />
              <p class="card__note">One photo of the parcel on your counter protects you if anything is disputed.</p>
            </Card>
          ) : null}

          <div class="scr__cta">
            <Button
              onClick={() => void actions.submitIntake()}
              disabled={pm.kind === 'peer_send' && !state.intakePhotoRef}
              busy={state.busy === 'intake'}
            >
              {pm.kind === 'peer_send' ? `Collect ${pm.cashDue.toFixed(2)} and take it in` : 'Take it in'}
            </Button>
            {pm.kind === 'peer_send' && !state.intakePhotoRef ? <p class="hint" style="margin-top:8px">The proof photo first.</p> : null}
          </div>

          <div class="scr__foot">
            <ReadAloud
              text={() => (pm.kind === 'peer_send' ? `A booked parcel. Collect ${pm.cashDue.toFixed(2)} in cash, take the proof photo, then take it in.` : 'A prepaid store order. Take the photo-free intake — nothing to collect.')}
              label="Read this aloud"
            />
          </div>
        </>
      ) : null}

      {!walkUp ? null : (
        <>
      <Card label="Dimensions">
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
          <Pill tone={state.acceptDerived.dedicated ? 'warn' : 'info'}>{`Size ${sizeMeta(state.acceptDerived.size).label} — ${sizeMeta(state.acceptDerived.size).hint}`}</Pill>
        ) : (
          <p class="card__note">Fill all four — the size is worked out for you, so there is nothing to argue about later.</p>
        )}
        <label class="checkline" style="margin-top:12px">
          <input type="checkbox" checked={f.fragile} onChange={(e) => actions.setAccept({ fragile: e.currentTarget.checked })} />
          <span>Fragile — keep it off two-wheelers</span>
        </label>
      </Card>

      <Card label="What's inside?">
        <select class="select" value={f.natureCode} onChange={(e) => actions.setAccept({ natureCode: e.currentTarget.value as typeof f.natureCode })}>
          {NATURES.map((n) => (
            <option key={n.key} value={n.key}>
              {n.label}
            </option>
          ))}
        </select>
        <p class="card__note">Most parcels are general goods. This keeps unsafe mixes apart — e.g. cement dust never travels with fresh food.</p>
      </Card>

      <DestinationCard state={state} actions={actions} />

      {isDedicated ? (
        <>
          <Note tone="info" icon="truck" title="Too big for the bus — book it as freight" detail="This is dedicated cargo: it needs a truck, not the shared bus. Book it as freight here — set the cash budget, and the pickup day if it isn't going today." />
          <FreightBookingCard state={state} actions={actions} />
          <div class="scr__cta">
            <Button onClick={() => void actions.submitBookFreight()} disabled={Boolean(freightBlock)} busy={state.busy === 'book-freight'}>
              Book the freight
            </Button>
            {freightBlock ? <p class="hint" style="margin-top:8px">{freightBlock}</p> : null}
          </div>
          <div class="scr__foot">
            <ReadAloud text={() => freightBlock ?? 'Everything is filled in. Collect the cash budget, then book the freight.'} label="What is still missing?" />
          </div>
        </>
      ) : (
        <>

      <Card label="Phone numbers">
        <div class="field">
          <label class="field__label" for="sender">
            Sender phone
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
            Receiver phone
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
        <p class="card__note">The receiver gets the tracking message and the pickup code.</p>
      </Card>

      <Card label="Proof photo">
        <PhotoField id="accept-photo" value={f.photoRef} label="Take the proof photo" upload={(file) => actions.uploadPhoto('dropoff', file)} onCapture={(ref) => actions.setAccept({ photoRef: ref })} />
        <p class="card__note">One photo of the parcel on your counter protects you if anything is disputed.</p>
      </Card>

      <div class="scr__cta">
        <Button onClick={() => void actions.submitAccept()} disabled={Boolean(blockReason)} busy={state.busy === 'accept'}>
          Confirm and accept
        </Button>
        {blockReason ? <p class="hint" style="margin-top:8px">{blockReason}</p> : null}
      </div>

      <div class="scr__foot">
        <ReadAloud text={() => blockReason ?? 'Everything is filled in. Tap confirm and accept.'} label="What is still missing?" />
      </div>
        </>
      )}
        </>
      )}

      {/* PG4 — the booked-parcel intake confirmation: what was collected, where it goes next. */}
      <Sheet open={Boolean(state.intakeDone)} onClose={actions.dismissIntakeDone} title="Parcel taken in">
        {state.intakeDone ? (
          <>
            <p class="t-body">
              {state.intakeDone.kind === 'peer_send'
                ? `Cash collected: ${state.intakeDone.cashDue.toFixed(2)}. The sender's label is already on the parcel.`
                : 'Prepaid store order — nothing to collect.'}
            </p>
            {state.intakeDone.destShopName ? <p class="hint">{`It travels to ${state.intakeDone.destShopName}. It will appear in your handover list for the next bus.`}</p> : null}
            <Button onClick={actions.dismissIntakeDone}>Done — take in another</Button>
          </>
        ) : null}
      </Sheet>

      {/* DT — the parcel is born with a printable label; show it so the agent prints + sticks it on the parcel. */}
      <Sheet open={Boolean(state.acceptedLabel)} onClose={actions.dismissAcceptedLabel} title="Parcel label ready">
        {state.acceptedLabel ? (
          <>
            <p class="t-body">{`Print this and stick it on ${state.acceptedLabel.parcelId}. It carries the tracking QR the customer follows.`}</p>
            {state.acceptedLabel.svg ? (
              <>
                {/* Trusted markup: the SVG comes from OUR backend label builder, nothing user-authored. */}
                <div class="labelbox" dangerouslySetInnerHTML={{ __html: state.acceptedLabel.svg }} />
                <Button chevron={false} onClick={() => state.acceptedLabel?.svg && openLabel(state.acceptedLabel.svg)}>
                  Open and print the label
                </Button>
              </>
            ) : null}
            {state.acceptedLabel.trackingKey ? <p class="hint" style="margin-top:8px">Tracking key: {state.acceptedLabel.trackingKey}</p> : null}
            <Button variant="link" onClick={actions.dismissAcceptedLabel}>
              Done — take in another
            </Button>
          </>
        ) : null}
      </Sheet>

      {/* F2 — the counter-freight receipt: the tracking code to print, the cash cap to collect, and a lifting advisory. */}
      <Sheet open={Boolean(state.bookedFreight)} onClose={actions.dismissBookedFreight} title="Freight booked">
        {state.bookedFreight ? (
          <>
            <p class="t-body">
              {state.bookedFreight.status === 'scheduled'
                ? `Booked for pickup on ${whenText(state.bookedFreight.scheduledPickupAt)}. A truck can reserve it ahead of the day.`
                : 'On the marketplace now — a nearby truck will be offered this load.'}
            </p>
            <Card label="Tracking code">
              <p class="t-body">
                <b style="font-size:22px; letter-spacing:1px">{state.bookedFreight.code}</b>
              </p>
              <p class="card__note">Write this on the customer’s receipt — it is how they follow the shipment.</p>
              {state.bookedFreight.trackingKey ? <p class="hint">Key: {state.bookedFreight.trackingKey}</p> : null}
            </Card>
            {state.bookedFreight.maxSpend != null ? (
              <p class="hint">Collect up to {state.bookedFreight.maxSpend.toFixed(2)} in cash now — give change once the driver’s price is set.</p>
            ) : null}
            {state.bookedFreight.equipmentGaps?.length ? (
              <Note tone="warn" icon="warning" title="Lifting help may be needed" detail={freightGapDetail(state.bookedFreight.equipmentGaps)} />
            ) : null}
            <Button onClick={actions.dismissBookedFreight}>Done — book another</Button>
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
  const f = state.accept;
  const near = f.destMode === 'address' ? state.acceptNear : null;
  // Exclude the accepting shop — a parcel can't be sent to the shop taking it in.
  const points = selectablePoints(state.acceptPoints, state.agent?.did ?? undefined, near);
  const mapPins = points.filter((p) => p.location && p.openState === 'open').map((p) => ({ id: p.did, label: p.shopName, point: p.location! }));
  const pick = (p: NetworkPoint) => actions.pickDest({ did: p.did, zone: p.zone, shopName: p.shopName });

  return (
    <Card label="Where does it go?">
      {/* Names the picking METHOD, not the surface — so it doesn't collide with PlaceMap's own Map/Simple toggle. */}
      <div class="seg" role="group" aria-label="How to pick the destination">
        <button type="button" class={`seg__btn${f.destMode === 'map' ? ' seg__btn--on' : ''}`} aria-pressed={f.destMode === 'map'} onClick={() => actions.setDestMode('map')}>
          <Icon name="home" size={18} /> Pick a shop
        </button>
        <button type="button" class={`seg__btn${f.destMode === 'address' ? ' seg__btn--on' : ''}`} aria-pressed={f.destMode === 'address'} onClick={() => actions.setDestMode('address')}>
          <Icon name="search" size={18} /> By area
        </button>
      </div>

      {state.acceptPointsState === 'loading' ? <p class="hint" style="margin-top:10px">Finding shops…</p> : null}
      {state.acceptPointsState === 'error' ? (
        <p class="hint" style="margin-top:10px">Couldn’t load shops. <button type="button" class="linkbtn" onClick={() => actions.go('accept')}>Try again</button></p>
      ) : null}

      {f.destMode === 'address' ? (
        <>
          <div class="reg__dates" style="margin-top:10px">
            <div class="field" style="flex:1">
              <label class="field__label" for="dest-address">Area or place</label>
              <input id="dest-address" class="input" value={f.addressText} onInput={(e) => actions.setAddress(e.currentTarget.value)} placeholder="e.g. Westlands, Karen, Thika" autocapitalize="words" />
            </div>
            <Button variant="outline" full={false} chevron={false} busy={state.acceptGeoBusy} onClick={() => void actions.geocodeAddress()}>
              Find
            </Button>
          </div>
          {state.acceptGeoNote ? <p class="card__note">{state.acceptGeoNote}</p> : null}
        </>
      ) : null}

      {f.destMode === 'map' && mapPins.length ? (
        <div style="margin-top:10px">
          <PlaceMap
            label={`Map of ${mapPins.length} shops`}
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
        <p class="hint" style="margin-top:10px">No shops on the network to send toward yet.</p>
      ) : null}

      {f.destShopName ? <p class="card__note">Going to <b>{f.destShopName}</b>.</p> : null}
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
  const f = state.accept;
  return (
    <Card label="Book as freight">
      <div class="field">
        <label class="field__label" for="freight-budget">
          Cash budget — the most the customer will pay
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
          placeholder="e.g. 40"
        />
      </div>
      <p class="card__note">No driver can be paid more than this. Collect it in cash now; give change once the price is set.</p>

      <div class="seg" role="group" aria-label="When is it picked up" style="margin-top:12px">
        <button type="button" class={`seg__btn${f.freightWhen === 'now' ? ' seg__btn--on' : ''}`} aria-pressed={f.freightWhen === 'now'} onClick={() => actions.setAccept({ freightWhen: 'now' })}>
          <Icon name="truck" size={18} /> Ship now
        </button>
        <button type="button" class={`seg__btn${f.freightWhen === 'planned' ? ' seg__btn--on' : ''}`} aria-pressed={f.freightWhen === 'planned'} onClick={() => actions.setAccept({ freightWhen: 'planned' })}>
          <Icon name="clock" size={18} /> Planned
        </button>
      </div>

      {f.freightWhen === 'planned' ? (
        <>
          <div class="field" style="margin-top:12px">
            <label class="field__label" for="freight-date">
              Pickup day and time
            </label>
            <input id="freight-date" class="input" type="datetime-local" value={f.freightDate} onInput={(e) => actions.setAccept({ freightDate: e.currentTarget.value })} />
          </div>
          <label class="checkline" style="margin-top:12px">
            <input type="checkbox" checked={f.allowEarlyClaim} onChange={(e) => actions.setAccept({ allowEarlyClaim: e.currentTarget.checked })} />
            <span>Let a driver reserve it before the day — useful when trucks are scarce</span>
          </label>
        </>
      ) : null}

      <div class="field" style="margin-top:12px">
        <label class="field__label" for="freight-phone">
          Customer phone (optional)
        </label>
        <input id="freight-phone" class="input" type="tel" inputMode="tel" value={f.customerMobile} onInput={(e) => actions.setAccept({ customerMobile: e.currentTarget.value })} placeholder="07…" autocomplete="off" />
      </div>
      <p class="card__note">If they have a phone they can follow the shipment. If not, the printed code is enough.</p>
    </Card>
  );
}

function DestRow({ point, picked, away, onPick }: { point: NetworkPoint; picked: boolean; away: string | null; onPick: () => void }) {
  const closed = point.openState === 'closed';
  return (
    <button type="button" class="row" disabled={closed} aria-pressed={picked} onClick={onPick}>
      <span class="row__ic">
        <Icon name={picked ? 'check' : 'home'} size={24} />
      </span>
      <span class="row__body">
        <span class="row__t">{point.shopName}</span>
        <span class="row__s">{closed ? 'Closed right now' : `${away ? `${away} · ` : ''}Zone ${point.zone}${point.landmark ? ` · ${point.landmark}` : ''}`}</span>
      </span>
      <span class="row__end">{closed ? <Pill tone="idle" dot>Closed</Pill> : <Icon name="chevronRight" size={22} />}</span>
    </button>
  );
}
