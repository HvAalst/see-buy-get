import { Button, Card, ErrorNote, Explainer, Icon, Pill, ReadAloud } from '../../../shared/ui';
import { formatDate, useT } from '../../../shared/i18n';
import { Abbreviated } from '../../../shared/ui/Abbr';
import { cash } from '../../../shared/money';
import { blockerTone } from '../../../shared/board';
import { boardVsMarket } from '../../../shared/market';
import { dispatchDistanceLine, dispatchRowState, dispatchSummary } from '../logic';
import type { DispatchRow } from '../types';
import type { FleetActions, FleetState } from '../useFleetApp';

const RADII = [15, 50, 0] as const;

/**
 * FP5 — the office puts a load on a driver.
 *
 * Until now a load reached a fleet's driver in two ways only: the driver claimed it, or the network offered
 * it. A fleet is a business with a dispatcher, and the dispatcher had no door. This is it — and it shows the
 * market EXACTLY as the chosen driver would see it: priced against their vehicle, judged from where they
 * are, every reason it cannot be taken marked in the same colours. What the office assigns, the driver could
 * have claimed; what the driver could not take, the office cannot force.
 */
export function DispatchScreen({ state, actions }: { state: FleetState; actions: FleetActions }) {
  const t = useT();
  const v = state.dispatch;
  const drivers = v?.drivers ?? [];
  const me = drivers.find((d) => d.did === (v?.driver ?? state.dispatchDriver));
  const loading = state.dispatchState === 'loading' || state.dispatchState === 'idle';
  const rows = v?.rows ?? [];
  const can = rows.filter((r) => dispatchRowState(r) === 'take').length;
  // Only the two answers worth a dispatcher’s attention. "The market is busy and you have work" is a
  // sentence nobody needs on a screen that is already showing them the work.
  const verdict = boardVsMarket(rows.length, state.market);
  const marketLine = verdict === 'market-thin' ? 'fleet.dispatch.market.thin' : verdict === 'board-thin' ? 'fleet.dispatch.market.board' : null;

  return (
    <div class="scr">
      <div class="scr__back">
        <Button variant="link" chevron={false} onClick={() => actions.go('dash')}>
          <Icon name="chevronLeft" size={20} /> {t('fleet.dispatch.back')}
        </Button>
      </div>
      <h1 class="scr__title">{t('fleet.dispatch.title')}</h1>
      <Explainer who={state.manager?.did} id="fleet.dispatch.how" text={t('fleet.dispatch.lede')} />
      {state.error ? <ErrorNote error={state.error} onRetry={() => actions.openDispatch()} /> : null}

      <Card label={t('fleet.dispatch.who')}>
        {v && drivers.length === 0 ? (
          <p class="hint">{t('fleet.dispatch.nobody')}</p>
        ) : (
          <div class="chips">
            {drivers.map((d) => {
              const on = d.did === (v?.driver ?? state.dispatchDriver);
              return (
                <button key={d.did} type="button" class={'chip chip--tap' + (on ? ' chip--on' : '')} aria-pressed={on} onClick={() => actions.setDispatchDriver(d.did)}>
                  {t('fleet.dispatch.driverChip', { name: d.name, plate: d.plate, kg: d.remainingKg })}
                </button>
              );
            })}
          </div>
        )}
      </Card>

      {me ? (
        <Card label={t('fleet.dispatch.howFar')}>
          <div class="chips">
            {RADII.map((km) => {
              const on = state.dispatchRadius === km;
              return (
                <button key={km} type="button" class={'chip chip--tap' + (on ? ' chip--on' : '')} aria-pressed={on} onClick={() => actions.setDispatchRadius(km)}>
                  {km === 0 ? t('fleet.dispatch.whole') : t('fleet.dispatch.radius', { km })}
                </button>
              );
            })}
          </div>
          {/* Every distance and price below hangs off this point, so it is said rather than assumed. */}
          <p class="hint" style="margin-top:8px">{v?.from.source === 'driver' ? t('fleet.dispatch.fromDriver', { name: me.name }) : t('fleet.dispatch.fromDepot', { name: me.name })}</p>
        </Card>
      ) : null}

      {me ? (
        <Card title={loading ? t('fleet.dispatch.loading') : t('fleet.dispatch.count', { n: rows.length, can })}>
          {!loading && marketLine ? <p class="hint">{t(marketLine)}</p> : null}
          {!loading && rows.length === 0 ? (
            <p class="hint">{t('fleet.dispatch.empty')}</p>
          ) : (
            <div class="rows" role="list">
              {rows.map((row) => (
                <LoadRow key={row.freightId} row={row} driver={me} state={state} actions={actions} />
              ))}
            </div>
          )}
        </Card>
      ) : null}

      <div class="scr__foot">
        <ReadAloud text={() => dispatchSummary(v, t)} label={t('fleet.readAloud')} />
      </div>
    </div>
  );
}

function LoadRow({ row, driver, state, actions }: { row: DispatchRow; driver: { did: string; name: string }; state: FleetState; actions: FleetActions }) {
  const t = useT();
  const kind = dispatchRowState(row);
  const busy = state.busy === 'assign:' + row.freightId;
  return (
    <div class="row row--static" role="listitem">
      <span class="row__body">
        <span class="row__t">
          <span class="mono">{row.code}</span> · <Abbreviated text={row.description} />
        </span>
        <span class="row__s">{t('fleet.dispatch.meta', { kg: row.weightKg, pickup: row.pickupLabel, dest: row.destLabel })}</span>
        <span class="row__s">
          {dispatchDistanceLine(row, t)}
          {row.price ? ' · ' + t('fleet.dispatch.earns', { name: driver.name, amount: cash(row.price.total, state.dashboard?.currency) }) : ''}
        </span>
        {row.scheduledPickupAt ? <span class="row__s">{t('fleet.dispatch.scheduled', { date: formatDate(row.scheduledPickupAt) })}</span> : null}
        {row.deliveryWindow ? <span class="row__s row__s--warn">{t('common.instructions.deliver', { window: row.deliveryWindow })}</span> : null}
        {/* A match: who pays the driver it is put on — and what drivers say of this shipper (2026-10-27). */}
        {row.paidByShipper ? <span class="row__s">{t('fleet.dispatch.paidByShipper')}</span> : null}
        {row.shipperUnpaid ? <span class="row__s row__s--warn">{t('common.paidDirect.shipperUnpaid', { n: row.shipperUnpaid })}</span> : null}
        {row.shipperDisputed ? <span class="row__s">{t('common.paidDirect.shipperDisputed', { n: row.shipperDisputed })}</span> : null}
        {kind === 'negotiate' ? <span class="row__s">{t('fleet.dispatch.negotiate')}</span> : null}
        {row.blockers.length ? (
          <span class="chips" style="margin-top:4px">
            {row.blockers.map((b) => (
              <Pill key={b.code} tone={blockerTone(b.kind)} dot>
                {b.message}
              </Pill>
            ))}
          </span>
        ) : null}
        {kind === 'take' ? (
          <span style="display:block;margin-top:8px">
            <Button chevron={false} full={false} busy={busy} disabled={Boolean(state.busy) && !busy} onClick={() => void actions.assignLoad(row.freightId, driver.did, row.code, driver.name)}>
              {t('fleet.dispatch.put', { name: driver.name })}
            </Button>
          </span>
        ) : null}
      </span>
    </div>
  );
}
