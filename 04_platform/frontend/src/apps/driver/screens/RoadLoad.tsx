import { useEffect } from 'preact/hooks';
import { Button, Card, Icon, Note, OpenInMaps } from '../../../shared/ui';
import { useLocale, useT } from '../../../shared/i18n';
import { countryNameIn } from '../../../shared/documents/documents';
import type { DriverActions, DriverState } from '../useDriverApp';

/** One bag waiting for a road route: where it waits, and what is in it. */
export interface RoadLoadBag {
  code: string;
  at: string;
  atId: string;
  location: { lat: number; lng: number };
  parcels: number;
  weightKg: number;
  fillPct: number;
}

/** A road route's load, as the server tells a driver of the fleet that runs it (2026-11-23, step 3c). */
export interface RoadLoadView {
  routes: Array<{ from: string; to: string; hubName: string; bags: RoadLoadBag[]; weightKg: number }>;
  vehicle?: { bagPlaces: number; freeBagPlaces: number; freeKg: number };
}

/**
 * The bags that fit, in the order shown, and how full the vehicle would then be. A bag that would go over the bag places or the
 * kilos left is left for the next run — or another driver of the fleet — instead of being sent to be refused.
 */
export function roadFit(bags: RoadLoadBag[], vehicle: RoadLoadView['vehicle']): { codes: string[]; all: boolean; used: number; places: number } {
  if (!vehicle) return { codes: [], all: false, used: 0, places: 0 };
  const codes: string[] = [];
  let kg = 0;
  for (const b of bags) {
    if (codes.length >= vehicle.freeBagPlaces || kg + b.weightKg > vehicle.freeKg) continue;
    codes.push(b.code);
    kg += b.weightKg;
  }
  return { codes, all: codes.length === bags.length, used: vehicle.bagPlaces - vehicle.freeBagPlaces + codes.length, places: vehicle.bagPlaces };
}

const placed = (p: { lat: number; lng: number }) => (p.lat === 0 && p.lng === 0 ? null : p);

/**
 * 2026-11-23 — THE ROAD ROUTE'S LOAD (the Netherlands–Bulgaria plan, step 3c; the owner, P3-1: "dedicated route drivers gather a
 * consolidated full load and take it to the central distribution hub in that nation"). For a driver of the fleet that runs a road
 * route: every bag waiting for it at the shops and hubs of the sending country, each with the way there; how full the vehicle
 * would be; and, on shift, taking the bags that fit in one tap. Nothing for any other driver.
 */
export function RoadLoadCard({ state, actions, onShift }: { state: DriverState; actions: DriverActions; onShift: boolean }) {
  const t = useT();
  const locale = useLocale();
  useEffect(() => {
    void actions.loadRoadLoad();
  }, []);
  const load = state.roadLoad;
  if (!load || !load.routes.length) return null;
  return (
    <>
      {load.routes.map((r) => {
        const fit = roadFit(r.bags, load.vehicle);
        const busy = state.busy === `road-${r.from}-${r.to}`;
        return (
          <Card key={`${r.from}-${r.to}`} title={t('driver.roadLoad.title', { to: countryNameIn(r.to, locale) })}>
            <p class="card__note">{t('driver.roadLoad.lede', { from: countryNameIn(r.from, locale), hub: r.hubName })}</p>
            <div class="rows" role="list">
              {r.bags.map((b) => (
                <div key={b.code} class="row row--static" role="listitem">
                  <span class="row__ic">
                    <Icon name="box" size={24} />
                  </span>
                  <span class="row__body">
                    <span class="row__t">{b.at}</span>
                    <span class="row__s">{t('driver.roadLoad.bag', { count: b.parcels, kg: b.weightKg, code: b.code })}</span>
                    <OpenInMaps point={placed(b.location)} label={t('driver.navigateTo', { label: b.at })} />
                  </span>
                </div>
              ))}
            </div>
            <p class="card__note">{t('driver.roadLoad.total', { count: r.bags.length, kg: r.weightKg })}</p>
            {!onShift || !load.vehicle ? (
              <p class="card__note">{t('driver.roadLoad.onShift')}</p>
            ) : fit.codes.length === 0 ? (
              <Note tone="warn" icon="box" title={t('driver.roadLoad.full')} />
            ) : (
              <>
                <p class="card__note">
                  {fit.all ? t('driver.roadLoad.fits', { used: fit.used, places: fit.places }) : t('driver.roadLoad.fitsSome', { count: fit.codes.length, used: fit.used, places: fit.places })}
                </p>
                <Button busy={busy} disabled={Boolean(state.busy) && !busy} onClick={() => void actions.takeRoadLoad(r.from, r.to, fit.codes, r.hubName)}>
                  {fit.all ? t('driver.roadLoad.takeAll', { count: fit.codes.length }) : t('driver.roadLoad.takeSome', { count: fit.codes.length })}
                </Button>
              </>
            )}
          </Card>
        );
      })}
    </>
  );
}
