import { useState } from 'preact/hooks';
import { Button, Card, ErrorNote, ReadAloud, Sheet } from '../../../shared/ui';
import { toPlaceWords } from '../../../shared/placewords';
import { bagLine, fillPercent, fillingBags, freeBags, homeSummary, money, swatchIndex, unsortedAt } from '../logic';
import type { MdpActions, MdpState } from '../useMdpApp';

export interface HomeScreenProps {
  state: MdpState;
  actions: MdpActions;
}

/**
 * The floor at a glance: four tiles (the one that matters — TO SORT — first and alert
 * when non-zero), the loose inbound pile, the outbound destination bags with their fill
 * bars, and the hub's open-data sort fee.
 */
export function HomeScreen({ state, actions }: HomeScreenProps) {
  const [priceOpen, setPriceOpen] = useState(false);
  const hub = state.hub;
  const unsorted = hub ? unsortedAt(state.inbound, hub.mdpId) : [];
  const filling = fillingBags(state.totes);
  const free = freeBags(state.totes);

  return (
    <div class="scr">
      {state.error ? <ErrorNote error={state.error} onRetry={actions.refresh} /> : null}

      <div class="tiles">
        <Tile value={unsorted.length} label="To sort" alert={unsorted.length > 0} />
        <Tile value={filling.length} label="Outbound bags" />
        <Tile value={free.length} label="Empty totes" />
        <Tile value={hub?.zones.length ?? 0} label="Zones served" />
      </div>

      <Card
        title="Inbound — to sort"
        aside={<span class="row__count">{unsorted.length}</span>}
      >
        {unsorted.length === 0 ? (
          <p class="hint">Nothing to sort. Drop a bag to unload one.</p>
        ) : (
          <div>
            {unsorted.slice(0, 8).map((p) => (
              <div key={p.parcelId} class="kv">
                <span class="mono">{p.parcelId}</span>
                <b>{`→ ${p.destZone}`}</b>
              </div>
            ))}
            {unsorted.length > 8 ? <p class="hint">{`…and ${unsorted.length - 8} more`}</p> : null}
          </div>
        )}
        <div class="btnrow">
          <Button variant="outline" full={false} onClick={() => actions.go('drop')}>
            Drop a bag
          </Button>
          <Button full={false} chevron={false} disabled={unsorted.length === 0 && state.queue.length === 0} onClick={() => actions.go('sort')}>
            Sort parcels
          </Button>
        </div>
      </Card>

      <Card title="Outbound — destination bags" aside={<span class="hint">{`${filling.length} open · ${free.length} free`}</span>}>
        {filling.length === 0 ? (
          <p class="hint">No destination bags yet. Sort parcels to start one.</p>
        ) : (
          <div class="bags">
            {filling.map((t) => (
              <div key={t.code} class="bagrow bagrow--static">
                <span class={`swatch swatch--${swatchIndex(t.destinationNodeId)}`} aria-hidden="true" />
                <span class="bagrow__body">
                  <span class="bagrow__code">{t.code}</span>
                  <span class="bagrow__dest">{bagLine(t)}</span>
                  <span class="fillbar" role="progressbar" aria-valuenow={fillPercent(t.unitsUsed)} aria-valuemin={0} aria-valuemax={100} aria-label={`${t.code} fill`}>
                    <span style={`width:${fillPercent(t.unitsUsed)}%`} />
                  </span>
                </span>
              </div>
            ))}
          </div>
        )}
        <div class="btnrow">
          <Button full={false} chevron={false} disabled={filling.length === 0} onClick={() => actions.go('load')}>
            Load a bag
          </Button>
          <Button variant="outline" full={false} onClick={() => actions.go('newtote')}>
            New tote
          </Button>
        </div>
      </Card>

      {hub?.location ? (
        <Card label="Where this hub is">
          {/* The hub's three place words — what a new driver is told, address or not. */}
          <p class="words">{toPlaceWords(hub.location)}</p>
          <ReadAloud
            text={() => `This hub's three words are: ${toPlaceWords(hub.location!).split(' ').join(', ')}.`}
            label="Say the three words"
          />
        </Card>
      ) : null}

      <Card label="Your sort fee" aside={<b class="mono">{money(hub?.pricePerParcel)}</b>}>
        <p class="card__note">What the network pays this hub to sort one parcel. It is public — nearby hubs compete on it.</p>
        <div class="btnrow">
          <Button variant="link" full={false} onClick={() => actions.go('rates')}>
            Fees near you
          </Button>
          <Button variant="link" full={false} onClick={() => setPriceOpen(true)}>
            Change my fee
          </Button>
        </div>
      </Card>

      <div class="scr__foot">
        <ReadAloud text={() => homeSummary(unsorted.length, filling.length)} label="Read this aloud" />
        <Button variant="link" full={false} onClick={actions.signOut}>
          Sign out of this hub
        </Button>
      </div>

      <PriceSheet open={priceOpen} onClose={() => setPriceOpen(false)} state={state} actions={actions} />
    </div>
  );
}

function Tile({ value, label, alert }: { value: number; label: string; alert?: boolean }) {
  return (
    <div class={`tile${alert ? ' tile--alert' : ''}`}>
      <span class="tile__v">{value}</span>
      <span class="tile__l">{label}</span>
    </div>
  );
}

function PriceSheet({ open, onClose, state, actions }: { open: boolean; onClose: () => void; state: MdpState; actions: MdpActions }) {
  const [price, setPrice] = useState(money(state.hub?.pricePerParcel));
  const value = Number(price);
  return (
    <Sheet open={open} onClose={onClose} title="Your sort fee per parcel">
      <p class="t-body">Senders pay this fee for every parcel your hub sorts. Nearby hubs see it and compete.</p>
      <div class="field">
        <label class="field__label" for="fee">
          Fee per parcel
        </label>
        <input
          id="fee"
          class="input"
          type="number"
          inputMode="decimal"
          min="0"
          step="0.05"
          value={price}
          onInput={(e) => setPrice(e.currentTarget.value)}
        />
      </div>
      <Button
        chevron={false}
        busy={state.busy === 'price'}
        disabled={!(value >= 0)}
        onClick={() => {
          onClose();
          void actions.setPrice(Math.round(value * 100) / 100);
        }}
      >
        Save the new fee
      </Button>
      <Button variant="link" onClick={onClose}>
        Keep it as it is
      </Button>
    </Sheet>
  );
}
