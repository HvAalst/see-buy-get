import { Button, Card, Checklist, ErrorNote, Note, ReadAloud } from '../../../shared/ui';
import { otpValid, releaseBlockedDetail, releaseStage } from '../logic';
import type { AgentActions, AgentState } from '../useAgentApp';

export interface ReleaseScreenProps {
  state: AgentState;
  actions: AgentActions;
}

/**
 * Release to the customer — the walk-up flow. Find the parcel by sticker, then the screen
 * follows its status: still on the bus → mark arrived (sends the code); ready → verify the
 * 4-digit code; delivered → take the rating. One stage on screen at a time.
 */
export function ReleaseScreen({ state, actions }: ReleaseScreenProps) {
  const f = state.release;
  const p = f.parcel;
  const stage = p ? releaseStage(p.status) : null;

  return (
    <div class="scr">
      <h1 class="scr__title">Hand to a customer</h1>
      <p class="scr__lede">Scan the sticker on the parcel the customer is asking for.</p>

      {state.error ? <ErrorNote error={state.error} /> : null}

      <Card>
        <div class="field">
          <label class="field__label" for="pick-id">
            Parcel sticker
          </label>
          <input
            id="pick-id"
            class="input input--mono"
            value={f.stickerId}
            onInput={(e) => actions.setRelease({ stickerId: e.currentTarget.value })}
            placeholder="Scan the sticker"
            autocapitalize="characters"
            autocomplete="off"
            spellcheck={false}
            enterkeyhint="search"
          />
        </div>
        <div style="margin-top:12px">
          <Button chevron={false} onClick={() => void actions.findRelease()} disabled={!f.stickerId.trim()} busy={state.busy === 'find'}>
            Find the parcel
          </Button>
        </div>
      </Card>

      {p && stage === 'arrive' ? (
        <Card title="It is still marked as on the bus" label={p.parcelId}>
          <p class="t-body">If the driver just dropped it here, mark it arrived — the customer gets their pickup code by message.</p>
          <div style="margin-top:12px">
            <Button chevron={false} onClick={() => void actions.markArrived()} busy={state.busy === 'arrive'}>
              Mark arrived — send the code
            </Button>
          </div>
        </Card>
      ) : null}

      {p && stage === 'otp' ? (
        <Card title="Ask for the 4-digit code" label={p.parcelId}>
          {p.binSlot ? <p class="t-body">{`Fetch it from shelf ${p.binSlot} first.`}</p> : null}
          <div class="field" style="margin-top:8px">
            <label class="field__label" for="otp">
              The customer's code
            </label>
            <input
              id="otp"
              class="input otp"
              value={f.otp}
              onInput={(e) => actions.setRelease({ otp: e.currentTarget.value })}
              inputMode="numeric"
              maxLength={4}
              placeholder="0000"
              autocomplete="one-time-code"
            />
          </div>
          {f.issuedOtp ? <p class="hint">{`Sandbox: the code sent to the customer is ${f.issuedOtp}`}</p> : null}
          <div style="margin-top:12px">
            <Button chevron={false} onClick={() => void actions.submitPickup()} disabled={!otpValid(f.otp)} busy={state.busy === 'pickup'}>
              Confirm and hand over
            </Button>
          </div>
        </Card>
      ) : null}

      {p && stage === 'rate' ? (
        <Card title="Delivered — how did it go?" label={p.parcelId}>
          <p class="t-body">Ask the customer to rate this delivery.</p>
          <div class="stars" role="group" aria-label="Rate this delivery from 1 to 5">
            {([1, 2, 3, 4, 5] as const).map((n) => (
              <button
                key={n}
                type="button"
                class={`starbtn${f.stars >= n ? ' starbtn--on' : ''}`}
                aria-pressed={f.stars >= n}
                aria-label={`${n} out of 5`}
                onClick={() => actions.setRelease({ stars: n })}
              >
                {n}
              </button>
            ))}
          </div>
          <p class="hint">{f.stars === 0 ? 'Tap a number — 5 is the best.' : f.stars >= 4 ? 'Great!' : f.stars === 3 ? 'Okay' : 'We will look into it.'}</p>
          <div style="margin-top:12px">
            <Button chevron={false} onClick={() => void actions.submitRating()} disabled={!f.stars} busy={state.busy === 'rate'}>
              Save the rating
            </Button>
          </div>
        </Card>
      ) : null}

      {p && stage === 'blocked' ? <Note tone="info" icon="clock" title="Nothing to hand over" detail={releaseBlockedDetail(p.status)} /> : null}

      {p && stage === 'otp' ? (
        <Card title="If they have no code" tone="soft">
          <Checklist items={['The code was sent to the receiver phone', 'They can show the message instead', 'Never hand over without the code']} />
        </Card>
      ) : null}

      <div class="scr__foot">
        <ReadAloud
          text={() =>
            !p
              ? 'Scan the parcel sticker to begin.'
              : stage === 'otp'
                ? 'Ask the customer for their four digit code, type it in, then confirm.'
                : stage === 'arrive'
                  ? 'Mark the parcel arrived to send the customer their code.'
                  : stage === 'rate'
                    ? 'Ask the customer to rate the delivery from one to five.'
                    : releaseBlockedDetail(p.status)
          }
          label="Read this aloud"
        />
      </div>
    </div>
  );
}
