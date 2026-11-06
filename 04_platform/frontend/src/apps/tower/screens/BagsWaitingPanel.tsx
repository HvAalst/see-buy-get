import { useEffect, useState } from 'preact/hooks';
import { useT } from '../../../shared/i18n';
import { narrow } from '../../../lib/sbg';
import type { TowerActions, TowerState } from '../useTowerApp';

interface CaseBag {
  code: string;
  destination?: string;
  waitedHours: number;
  claimed: boolean;
  offeredWide: boolean;
}
interface BagDriver {
  driverDid: string;
  name: string;
  km: number;
  vehicleClass?: string;
}

/**
 * 2026-11-06 — A BAGS_WAITING CASE'S BAGS (the owner: "go ahead"): the closed bags waiting at the place the case is named
 * after, and — for one a driver is not already coming for — the working drivers an offer would reach now, nearest first.
 * Staff offer it to the one they choose: that driver's own offer, a notice that opens it, a note on the case.
 */
export function BagsWaitingPanel({ caseId, state, actions }: { caseId: string; state: TowerState; actions: TowerActions }) {
  const t = useT();
  const client = actions.client();
  const [bags, setBags] = useState<CaseBag[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [choosing, setChoosing] = useState<string | null>(null);
  const [drivers, setDrivers] = useState<BagDriver[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const load = () => {
    if (!client) return;
    void client.api.caseBags(caseId).then((r) => {
      if (r.error) return setFailed(r.error.detail || r.error.title);
      setBags(narrow<{ bags: CaseBag[] }>(r.data)?.bags ?? []);
    });
  };
  useEffect(load, [client, caseId]);

  const choose = (code: string) => {
    if (!client) return;
    setChoosing(code);
    setDrivers(null);
    setDone(null);
    void client.api.bagDrivers(code).then((r) => {
      if (r.error) return setFailed(r.error.detail || r.error.title);
      setDrivers(narrow<BagDriver[]>(r.data) ?? []);
    });
  };

  const offer = async (code: string, d: BagDriver) => {
    if (!client) return;
    setBusy(true);
    const by = state.who?.name;
    const r = await client.api.offerBag(code, d.driverDid, by);
    setBusy(false);
    if (r.error) return setFailed(r.error.detail || r.error.title);
    setFailed(null);
    setChoosing(null);
    setDrivers(null);
    setDone(t('tower.bags.offered', { name: d.name }));
    load();
  };

  return (
    <section class="cons__panel">
      <div class="cons__panelhead">
        <span class="cons__panelt">{t('tower.bags.title')}</span>
      </div>
      <p class="chint">{t('tower.bags.lede')}</p>
      {failed ? <p class="cerr">{failed}</p> : null}
      {done ? <p class="chint">{done}</p> : null}
      {bags === null ? (
        <p class="cons__empty">{t('tower.imports.loading')}</p>
      ) : bags.length === 0 ? (
        <p class="cons__empty">{t('tower.bags.none')}</p>
      ) : (
        <div class="crows">
          {bags.map((b) => (
            <div class="crow crow--static" key={b.code}>
              <span class="crow__body">
                <span class="crow__top">
                  <span class="crow__name">{t('tower.bags.line', { code: b.code, destination: b.destination ?? '—', hours: b.waitedHours })}</span>
                  {b.claimed ? <span class="ctag ctag--info">{t('tower.bags.coming')}</span> : b.offeredWide ? <span class="ctag ctag--quiet">{t('tower.bags.offeredWide')}</span> : null}
                </span>
                {!b.claimed && choosing === b.code ? (
                  drivers === null ? (
                    <span class="crow__sub">{t('tower.bags.loading')}</span>
                  ) : drivers.length === 0 ? (
                    <span class="crow__sub">{t('tower.bags.noDrivers')}</span>
                  ) : (
                    <span class="twr-bagdrivers">
                      {drivers.map((d) => (
                        <span class="twr-bagdriver" key={d.driverDid}>
                          <span>{t('tower.bags.driver', { name: d.name, km: d.km })}</span>
                          <button type="button" class="cbtn cbtn--primary cbtn--sm" disabled={busy} onClick={() => void offer(b.code, d)}>
                            {t('tower.bags.offer')}
                          </button>
                        </span>
                      ))}
                    </span>
                  )
                ) : null}
              </span>
              {!b.claimed && choosing !== b.code ? (
                <span class="crow__tail">
                  <button type="button" class="cbtn cbtn--ghost cbtn--sm" disabled={busy} onClick={() => choose(b.code)}>
                    {t('tower.bags.choose')}
                  </button>
                </span>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
