import { useEffect, useState } from 'preact/hooks';
import { Icon, Sheet } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import { publicPageUrl } from '../../../lib/sbg/config';
import { dayTakeUp } from '../market';
import type { LaneSeries } from '../../../shared/market';

export interface LaneCarrierView {
  name: string;
  kind: 'fleet' | 'driver';
  handle?: string;
  loads: number;
}

export interface LaneCarriersView {
  lane: string;
  claimedLoads: number;
  carriers: LaneCarrierView[];
  unattributedLoads: number;
  basis: string;
}

type Api = { laneCarriers: (q: { from: string; to: string; since?: string }) => Promise<{ data?: unknown; error?: { detail?: string; title?: string } | null }> };

/**
 * WHAT A LANE IS, WHEN YOU CLICK ON IT.
 *
 * The complaint that produced this was exact: "clicking there has no result. I feel like hitting a wall
 * rather than opening a door." A row that highlights a line on a map and does nothing else is a control
 * that acknowledges the click and answers nothing.
 *
 * So: the numbers already derived for this lane, and then the question somebody actually opens a lane to
 * ask — who runs it — with a way to reach them. Fetched when the sheet opens rather than with the series,
 * because it is one lane out of however many and nobody wants the carriers for four hundred of them.
 *
 * WHAT IT NAMES. Whoever the network contracted with — the fleet that fielded the vehicle, or the
 * owner-driver who is their own — alphabetically, each linked to the public page the directory issued
 * them. A driver EMPLOYED by a fleet is never named: the load was taken from their fleet, and an
 * employment record kept by somebody who is not the employer is the thing this network does not do.
 */
export function LaneSheet({ lane, since, api, onClose }: { lane: LaneSeries; since: string; api: Api | null; onClose: () => void }) {
  const t = useT();
  const [who, setWho] = useState<LaneCarriersView | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');

  useEffect(() => {
    let live = true;
    if (!api) return undefined;
    setState('loading');
    void api.laneCarriers({ from: lane.from, to: lane.to, since }).then((r) => {
      if (!live) return;
      if (r.error || !r.data) {
        setState('failed');
        return;
      }
      setWho(r.data as LaneCarriersView);
      setState('ready');
    });
    return () => {
      live = false;
    };
  }, [api, lane.from, lane.to, since]);

  // Withheld on a thin lane: a ratio IS the claim, so one load out of two would publish as 50%.
  const takeUp = lane.thin ? null : dayTakeUp(lane);

  return (
    <Sheet open onClose={onClose} title={lane.lane}>
      <div class="cons__facts">
        <div class="cons__fact">
          <span class="cons__factk">{t('tower.market.col.posted')}</span>
          <span class="cons__factv">{lane.postedLoads}</span>
        </div>
        <div class="cons__fact">
          <span class="cons__factk">{t('tower.market.col.claimed')}</span>
          <span class="cons__factv">
            {lane.claimedLoads}
            {takeUp == null ? null : ` · ${t('tower.market.tookUp', { pct: takeUp })}`}
          </span>
        </div>
        <div class="cons__fact">
          <span class="cons__factk">{t('tower.market.col.before')}</span>
          <span class="cons__factv">
            {lane.priorPostedLoads}
            {/* The verdict is withheld on a thin sample and the FIGURES are still shown — the rule this
                whole screen runs on. A hedged verdict still reads as a verdict. */}
            {lane.thin ? <span class="chint">{t('tower.market.laneThin')}</span> : lane.quiet ? <span class="ctag ctag--warn">{t('tower.market.quiet')}</span> : null}
          </span>
        </div>
        {lane.fromPoint && lane.toPoint ? null : (
          <div class="cons__fact">
            <span class="cons__factk">{t('tower.market.onMap')}</span>
            <span class="cons__factv">{t('tower.market.notOnMap')}</span>
          </div>
        )}
      </div>

      <div class="cons__panelhead">
        <span class="cons__panelt">{t('tower.market.whoTitle')}</span>
      </div>

      {state === 'loading' ? <p class="cons__empty">{t('tower.market.whoLoading')}</p> : null}
      {state === 'failed' ? <p class="cons__caveat">{t('tower.market.whoFailed')}</p> : null}
      {state === 'ready' && who ? (
        <>
          {who.carriers.length === 0 ? (
            <p class="cons__empty">{t('tower.market.whoNoneTaken')}</p>
          ) : (
            <div class="cdocs">
              {who.carriers.map((c) => (
                <div class="cdoc" key={c.name}>
                  {/* The kind is on the row, because "Amos" and "Kilima Logistics" are different kinds
                      of answer to "who carries this" and a reader is entitled to know which they are
                      looking at before they ring one of them. */}
                  <span class="cdoc__tile" aria-hidden="true">
                    {t(c.kind === 'driver' ? 'tower.market.whoDriverShort' : 'tower.market.whoFleetShort')}
                  </span>
                  <span class="cdoc__body">
                    <span class="cdoc__name">{c.name}</span>
                    <span class="cdoc__meta">
                      {t(c.kind === 'driver' ? 'tower.market.whoDriver' : 'tower.market.whoFleet')} · {t('tower.market.whoLoads', { n: c.loads })}
                    </span>
                  </span>
                  <span class="cdoc__acts">
                    {/* The page the directory already issued them. A new tab, because the console is a
                        place somebody is working and a public page is a thing they are checking. */}
                    {c.handle && publicPageUrl(c.handle) ? (
                      <a class="cbtn cbtn--ghost cbtn--sm" href={publicPageUrl(c.handle) ?? undefined} target="_blank" rel="noopener noreferrer">
                        <Icon name="person" size={13} />@{c.handle}
                      </a>
                    ) : (
                      <span class="chint">{t('tower.market.whoNoPage')}</span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
          {/* It should be nought. Shown when it is not, because the rows above are meant to add up to
              the loads and a reader who can check that is a reader who can catch us out. */}
          {who.unattributedLoads > 0 ? <p class="chint">{t('tower.market.whoUnattributed', { n: who.unattributedLoads })}</p> : null}
          {/* Verbatim. A list of companies with no basis under it reads as a recommendation. */}
          <p class="chint">{who.basis}</p>
        </>
      ) : null}
    </Sheet>
  );
}
