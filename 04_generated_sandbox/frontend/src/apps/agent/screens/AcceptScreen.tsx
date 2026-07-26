import { Button, Card, ErrorNote, ReadAloud, ScanField } from '../../../shared/ui';
import { SIZES, acceptMissing } from '../logic';
import type { AgentActions, AgentState } from '../useAgentApp';
import { PhotoField } from './PhotoField';

export interface AcceptScreenProps {
  state: AgentState;
  actions: AgentActions;
}

/**
 * Take in a walk-up drop-off. One card per counter step: sticker, size, destination,
 * phones, proof photo. The CTA's helper line always names the NEXT missing thing.
 */
export function AcceptScreen({ state, actions }: AcceptScreenProps) {
  const f = state.accept;
  const missing = acceptMissing(f);

  return (
    <div class="scr">
      <h1 class="scr__title">Take in a parcel</h1>
      <p class="scr__lede">Stick a sticker on it, then fill this in together with the customer.</p>

      {state.error ? <ErrorNote error={state.error} /> : null}

      <Card>
        <ScanField
          id="sticker"
          label="Parcel sticker"
          value={f.parcelId}
          onValue={(v) => actions.setAccept({ parcelId: v })}
          expect="parcel"
          placeholder="Scan or type the sticker ID"
          upper
        />
      </Card>

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
    </div>
  );
}
