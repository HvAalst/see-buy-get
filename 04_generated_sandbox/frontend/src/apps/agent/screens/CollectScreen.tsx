import { Button, Card, Checklist, ErrorNote, QrBlock, ReadAloud, Sheet } from '../../../shared/ui';
import { qrPayload } from '../../../shared/qr';
import type { AgentActions, AgentState } from '../useAgentApp';
import { PhotoField } from './PhotoField';

export interface CollectScreenProps {
  state: AgentState;
  actions: AgentActions;
}

/**
 * Click-and-collect counter flow: the buyer shows their collection code, the screen answers
 * with the SHELF SLOT (the one thing the shopkeeper needs, so it is the hero), the buyer
 * checks the contents, then confirm — or file a dispute with a reason + photo.
 */
export function CollectScreen({ state, actions }: CollectScreenProps) {
  const f = state.collect;
  const found = f.found;
  const items = found?.parcel.items ?? [];
  const slot = f.found?.binSlot || found?.parcel.binSlot;

  return (
    <div class="scr">
      <h1 class="scr__title">Collect an order</h1>
      <p class="scr__lede">Ask the buyer for their collection code.</p>

      {state.error ? <ErrorNote error={state.error} /> : null}

      <Card>
        <div class="field">
          <label class="field__label" for="collect-code">
            Collection code
          </label>
          <input
            id="collect-code"
            class="input input--mono"
            value={f.code}
            onInput={(e) => actions.setCollect({ code: e.currentTarget.value })}
            placeholder="Scan or type the code"
            autocapitalize="characters"
            autocomplete="off"
            spellcheck={false}
            enterkeyhint="search"
          />
        </div>
        <div style="margin-top:12px">
          <Button chevron={false} onClick={() => void actions.findCollect()} disabled={!f.code.trim()} busy={state.busy === 'collect-find'}>
            Find the order
          </Button>
        </div>
      </Card>

      {found ? (
        <>
          <section class="slot" aria-label="Shelf slot">
            <p class="slot__label">Fetch it from shelf</p>
            <p class="slot__value">{slot ?? '—'}</p>
            <p class="slot__sub">{found.parcel.parcelId}</p>
          </section>

          {/* The parcel's own code, so a shelf search can be a scan rather than a squint
              at a sticker in bad light. */}
          <Card label="Parcel code">
            <QrBlock
              value={qrPayload('parcel', found.parcel.parcelId)}
              size={132}
              caption={found.parcel.parcelId}
              label={`Parcel ${found.parcel.parcelId} as a scannable code`}
            />
          </Card>

          <Card label="Let the buyer check the contents">
            {items.length ? (
              <Checklist items={items.map((it) => `${it.qty} × ${it.name}`)} />
            ) : (
              <p class="hint">No item list came with this order.</p>
            )}
          </Card>

          <div class="scr__cta">
            <Button onClick={() => void actions.confirmCollect()} busy={state.busy === 'collect-confirm'}>
              Hand over — all good
            </Button>
          </div>
          <Button variant="outline" onClick={() => actions.setCollect({ disputing: true })}>
            Report a problem instead
          </Button>
        </>
      ) : null}

      <div class="scr__foot">
        <ReadAloud
          text={() =>
            found
              ? `Fetch the parcel from shelf ${slot ?? 'unknown'}. Let the buyer check it, then hand it over.`
              : 'Ask the buyer for their collection code and type it in.'
          }
          label="Read this aloud"
        />
      </div>

      <Sheet open={f.disputing} onClose={() => actions.setCollect({ disputing: false })} title="What is wrong?">
        <div class="field">
          <label class="field__label" for="dispute-reason">
            The problem
          </label>
          <input
            id="dispute-reason"
            class="input"
            value={f.reason}
            onInput={(e) => actions.setCollect({ reason: e.currentTarget.value })}
            placeholder="e.g. the box is crushed"
          />
        </div>
        <PhotoField id="dispute-photo" value={f.photoRef} label="Photo of the problem" onCapture={(ref) => actions.setCollect({ photoRef: ref })} />
        <Button
          chevron={false}
          disabled={!f.reason.trim() || !f.photoRef}
          busy={state.busy === 'dispute'}
          onClick={() => void actions.submitDispute()}
        >
          Send the report
        </Button>
        <Button variant="link" onClick={() => actions.setCollect({ disputing: false })}>
          Go back
        </Button>
      </Sheet>
    </div>
  );
}
