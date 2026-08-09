import { Button, Card, ErrorNote, GlanceNumber, Note, ReadAloud, ScanField, Sheet } from '../../../shared/ui';
import { NATURES, SIZES, acceptMissing, parcelStatusWord } from '../logic';
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

/**
 * Take in a parcel. Scanning the sticker decides which counter this is (PG4): a code the
 * network already knows — a peer send booked in the Send app (collect the locked cash) or
 * a prepaid store order — shows a confirm card with everything pre-filled; a fresh sticker
 * falls through to the walk-up form (size, destination, phones, photo) exactly as before.
 */
export function AcceptScreen({ state, actions }: AcceptScreenProps) {
  const f = state.accept;
  const missing = acceptMissing(f);
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
      <Card label="How big is it?">
        <div class="sizes" role="group" aria-label="Parcel size">
          {SIZES.map((s) => (
            <button
              key={s.key}
              type="button"
              class={`size${f.size === s.key ? ' size--on' : ''}`}
              aria-pressed={f.size === s.key}
              onClick={() => actions.setAccept({ size: s.key })}
            >
              <span class="size__k">{s.label}</span>
              <span class="size__h">{s.hint}</span>
            </button>
          ))}
        </div>
      </Card>

      <Card label="What kind of goods?">
        <select class="select" value={f.natureCode} onChange={(e) => actions.setAccept({ natureCode: e.currentTarget.value as typeof f.natureCode })}>
          {NATURES.map((n) => (
            <option key={n.key} value={n.key}>
              {n.label}
            </option>
          ))}
        </select>
        <p class="card__note">This keeps unsafe mixes apart — e.g. cement dust never travels with fresh food.</p>
      </Card>

      <Card label="Where is it going?">
        {state.zones.length ? (
          <select class="select" value={f.destZone} onChange={(e) => actions.setAccept({ destZone: e.currentTarget.value })}>
            <option value="">Pick the destination</option>
            {state.zones.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
        ) : (
          <input
            class="input"
            value={f.destZone}
            onInput={(e) => actions.setAccept({ destZone: e.currentTarget.value })}
            placeholder="Destination zone"
            autocapitalize="characters"
          />
        )}
      </Card>

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
        <Button onClick={() => void actions.submitAccept()} disabled={Boolean(missing)} busy={state.busy === 'accept'}>
          Confirm and accept
        </Button>
        {missing ? <p class="hint" style="margin-top:8px">{missing}</p> : null}
      </div>

      <div class="scr__foot">
        <ReadAloud text={() => missing ?? 'Everything is filled in. Tap confirm and accept.'} label="What is still missing?" />
      </div>
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
    </div>
  );
}
