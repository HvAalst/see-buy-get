import { BandScale, Button, Card, ErrorNote, ReadAloud } from '../../../shared/ui';
import { money, priceBand } from '../logic';
import type { MdpActions, MdpState } from '../useMdpApp';

export interface RatesScreenProps {
  state: MdpState;
  actions: MdpActions;
}

/** The hub's sort fee against nearby hubs — the agent app's band, hub wording. */
export function RatesScreen({ state, actions }: RatesScreenProps) {
  const mine = Number(state.hub?.pricePerParcel ?? 0);
  const b = state.rates?.benchmark;
  const band = priceBand(mine, b ?? null);
  const pins = (state.rates?.pins ?? []).filter((p) => p.id !== state.hub?.mdpId).slice(0, 8);

  return (
    <div class="scr">
      <h1 class="scr__title">Fees near you</h1>
      <p class="scr__lede">What nearby hubs charge to sort one parcel.</p>

      {state.error ? <ErrorNote error={state.error} onRetry={() => actions.go('rates')} /> : null}

      {state.ratesState === 'loading' ? <p class="hint">Looking at nearby hubs…</p> : null}

      {state.ratesState === 'ready' && !band ? (
        <Card>
          <p class="t-body">No nearby hub has published a fee yet.</p>
          <p class="card__note">{`You charge ${money(mine)} — you are setting the benchmark.`}</p>
        </Card>
      ) : null}

      {band && b ? (
        <>
          <Card label={`Nearby hubs · ${b.count}${state.rates?.radiusKm ? ` · within ${state.rates.radiusKm} km` : ''}`}>
            <p class="rates__median">{money(b.median)}</p>
            <p class="card__note">{`Most hubs charge between ${money(b.p25)} and ${money(b.p75)}.`}</p>
            <BandScale
              min={b.min}
              p25={b.p25}
              median={b.median}
              p75={b.p75}
              max={b.max}
              mine={mine}
              label={`Fees go from ${money(b.min)} to ${money(b.max)}. You charge ${money(mine)}.`}
            />
            <p class="t-body" style="margin-top:6px">
              {band.headline}
            </p>
          </Card>

          {band.showMatch ? (
            <div class="scr__cta">
              <Button busy={state.busy === 'price'} onClick={() => void actions.setPrice(band.matchPrice)}>
                {`${band.matchLabel} per parcel`}
              </Button>
            </div>
          ) : null}
        </>
      ) : null}

      {pins.length ? (
        <Card label="Hub by hub">
          {pins.map((p) => (
            <div key={p.id} class="kv">
              <span>{`${p.label}${p.km != null ? ` · ${p.km} km` : ''}`}</span>
              <b>{money(p.price)}</b>
            </div>
          ))}
        </Card>
      ) : null}

      <div class="scr__foot">
        <ReadAloud text={() => band?.detail ?? 'No nearby fees yet. You are setting the benchmark.'} label="Read this aloud" />
      </div>
    </div>
  );
}
