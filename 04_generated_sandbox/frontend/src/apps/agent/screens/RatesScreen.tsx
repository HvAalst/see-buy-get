import { BandScale, Button, Card, ErrorNote, ReadAloud } from '../../../shared/ui';
import { money, priceBand } from '../logic';
import type { AgentActions, AgentState } from '../useAgentApp';

export interface RatesScreenProps {
  state: AgentState;
  actions: AgentActions;
}

/**
 * Competitive price discovery: the shop's handling fee against nearby shops — one band,
 * one sentence, one "match the going rate" action. Numbers live in the copy; the scale is
 * for finding yourself without reading.
 */
export function RatesScreen({ state, actions }: RatesScreenProps) {
  const mine = Number(state.agent?.pricePerParcel ?? 0);
  const b = state.rates?.benchmark;
  const band = priceBand(mine, b ?? null);
  const pins = (state.rates?.pins ?? []).filter((p) => p.id !== state.agent?.did).slice(0, 8);

  return (
    <div class="scr">
      <h1 class="scr__title">Prices near you</h1>
      <p class="scr__lede">What nearby shops charge to handle one parcel.</p>

      {state.error ? <ErrorNote error={state.error} onRetry={() => actions.go('rates')} /> : null}

      {state.ratesState === 'loading' ? <p class="hint">Looking at nearby shops…</p> : null}

      {state.ratesState === 'ready' && !band ? (
        <Card>
          <p class="t-body">No nearby shop has published a price yet.</p>
          <p class="card__note">{`You charge ${money(mine)} — you are setting the benchmark.`}</p>
        </Card>
      ) : null}

      {band && b ? (
        <>
          <Card label={`Nearby shops · ${b.count}${state.rates?.radiusKm ? ` · within ${state.rates.radiusKm} km` : ''}`}>
            <p class="rates__median">{money(b.median)}</p>
            <p class="card__note">{`Most shops charge between ${money(b.p25)} and ${money(b.p75)}.`}</p>
            <BandScale
              min={b.min}
              p25={b.p25}
              median={b.median}
              p75={b.p75}
              max={b.max}
              mine={mine}
              label={`Prices go from ${money(b.min)} to ${money(b.max)}. You charge ${money(mine)}.`}
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
        <Card label="Shop by shop">
          {pins.map((p) => (
            <div key={p.id} class="kv">
              <span>{`${p.label}${p.km != null ? ` · ${p.km} km` : ''}`}</span>
              <b>{money(p.price)}</b>
            </div>
          ))}
        </Card>
      ) : null}

      <div class="scr__foot">
        <ReadAloud text={() => band?.detail ?? 'No nearby prices yet. You are setting the benchmark.'} label="Read this aloud" />
      </div>
    </div>
  );
}
