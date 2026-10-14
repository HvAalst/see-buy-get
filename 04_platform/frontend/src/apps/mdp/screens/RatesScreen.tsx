import { BandScale, Button, Card, ErrorNote, Explainer, ReadAloud } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import { money, priceBand } from '../logic';
import type { MdpActions, MdpState } from '../useMdpApp';

export interface RatesScreenProps {
  state: MdpState;
  actions: MdpActions;
}

/** The hub's sort fee against nearby hubs — the agent app's band, hub wording. */
export function RatesScreen({ state, actions }: RatesScreenProps) {
  const t = useT();
  const mine = Number(state.hub?.pricePerParcel ?? 0);
  const b = state.rates?.benchmark;
  const band = priceBand(mine, b ?? null, t);
  const pins = (state.rates?.pins ?? []).filter((p) => p.id !== state.hub?.mdpId).slice(0, 8);

  return (
    <div class="scr">
      <h1 class="scr__title">{t('mdp.rates.title')}</h1>
      <Explainer who={state.hub?.did} id="mdp.rates.how" text={t('mdp.rates.lede')} />

      {state.error ? <ErrorNote error={state.error} onRetry={() => actions.go('rates')} /> : null}

      {state.ratesState === 'loading' ? <p class="hint">{t('mdp.rates.looking')}</p> : null}

      {state.ratesState === 'ready' && !band ? (
        <Card>
          <p class="t-body">{t('mdp.rates.nonePublished')}</p>
          <p class="card__note">{t('mdp.rates.settingBenchmark', { price: money(mine) })}</p>
        </Card>
      ) : null}

      {band && b ? (
        <>
          <Card label={`${t('mdp.rates.nearbyHubs', { count: b.count })}${state.rates?.radiusKm ? t('mdp.rates.withinKm', { km: state.rates.radiusKm }) : ''}`}>
            <p class="rates__median">{money(b.median)}</p>
            <p class="card__note">{t('mdp.rates.mostCharge', { low: money(b.p25), high: money(b.p75) })}</p>
            <BandScale
              min={b.min}
              p25={b.p25}
              median={b.median}
              p75={b.p75}
              max={b.max}
              mine={mine}
              label={t('mdp.rates.bandAria', { min: money(b.min), max: money(b.max), mine: money(mine) })}
            />
            <p class="t-body" style="margin-top:6px">
              {band.headline}
            </p>
          </Card>

          {band.showMatch ? (
            <div class="scr__cta">
              <Button busy={state.busy === 'price'} onClick={() => void actions.setPrice(band.matchPrice)}>
                {t('mdp.rates.matchPerParcel', { label: band.matchLabel })}
              </Button>
            </div>
          ) : null}
        </>
      ) : null}

      {pins.length ? (
        <Card label={t('mdp.rates.hubByHub')}>
          {pins.map((p) => (
            <div key={p.id} class="kv">
              <span>{`${p.label}${p.km != null ? t('mdp.rates.kmSuffix', { km: p.km }) : ''}`}</span>
              <b>{money(p.price)}</b>
            </div>
          ))}
        </Card>
      ) : null}

      <div class="scr__foot">
        <ReadAloud text={() => band?.detail ?? t('mdp.rates.aloudNoFees')} label={t('mdp.readAloud')} />
      </div>
    </div>
  );
}
