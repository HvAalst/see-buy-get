import { BandScale, Button, Card, ErrorNote, ReadAloud } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
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
  const t = useT();
  const mine = Number(state.agent?.pricePerParcel ?? 0);
  const b = state.rates?.benchmark;
  // Every price on this screen is in the one money the server compared them in; the shop's own price, before any
  // shop is beside it, in its company's.
  const currency = state.rates?.currency;
  const band = priceBand(mine, b ?? null, t, currency);
  const pins = (state.rates?.pins ?? []).filter((p) => p.id !== state.agent?.did).slice(0, 8);

  return (
    <div class="scr">
      <h1 class="scr__title">{t('agent.rates.title')}</h1>
      <p class="scr__lede">{t('agent.rates.lede')}</p>

      {state.error ? <ErrorNote error={state.error} onRetry={() => actions.go('rates')} /> : null}

      {state.ratesState === 'loading' ? <p class="hint">{t('agent.rates.looking')}</p> : null}

      {state.ratesState === 'ready' && !band ? (
        <Card>
          <p class="t-body">{t('agent.rates.noneYet')}</p>
          <p class="card__note">{t('agent.rates.benchmarkYou', { price: money(mine, state.agent?.currency) })}</p>
        </Card>
      ) : null}

      {band && b ? (
        <>
          <Card label={`${t('agent.rates.nearbyCount', { count: b.count })}${state.rates?.radiusKm ? ` · ${t('agent.rates.within', { km: state.rates.radiusKm })}` : ''}`}>
            <p class="rates__median">{money(b.median, currency)}</p>
            <p class="card__note">{t('agent.rates.between', { low: money(b.p25, currency), high: money(b.p75, currency) })}</p>
            <BandScale
              min={b.min}
              p25={b.p25}
              median={b.median}
              p75={b.p75}
              max={b.max}
              mine={mine}
              label={t('agent.rates.scaleLabel', { min: money(b.min, currency), max: money(b.max, currency), mine: money(mine, currency) })}
            />
            <p class="t-body" style="margin-top:6px">
              {band.headline}
            </p>
          </Card>

          {band.showMatch ? (
            <div class="scr__cta">
              <Button busy={state.busy === 'price'} onClick={() => void actions.setPrice(band.matchPrice)}>
                {t('agent.rates.matchPerParcel', { match: band.matchLabel })}
              </Button>
            </div>
          ) : null}
        </>
      ) : null}

      {pins.length ? (
        <Card label={t('agent.rates.shopByShop')}>
          {pins.map((p) => (
            <div key={p.id} class="kv">
              <span>{`${p.label}${p.km != null ? ` · ${p.km} km` : ''}`}</span>
              <b>{money(p.price, currency)}</b>
            </div>
          ))}
        </Card>
      ) : null}

      <div class="scr__foot">
        <ReadAloud text={() => band?.detail ?? t('agent.rates.aloudNone')} label={t('agent.readAloud')} />
      </div>
    </div>
  );
}
