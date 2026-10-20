import { useEffect, useState } from 'preact/hooks';
import { useT, type MessageKey } from '../../../shared/i18n';
import { narrow } from '../../../lib/sbg';
import type { TowerActions } from '../useTowerApp';

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

type StepKind = 'picked_up' | 'delivered' | 'note' | 'exception' | 'bag_closed' | 'bag_taken' | 'bag_received';
type StepState = 'intact' | 'altered' | 'not_anchored';

interface TrailView {
  ref: string;
  kind: 'load' | 'bag';
  steps: Array<{ kind: StepKind; at: string; state: StepState; detail?: string; txId?: string }>;
  chain?: { anchors: number; whole: boolean; brokenAt?: number; reason?: string };
}

const KIND: Record<StepKind, MessageKey> = {
  picked_up: 'tower.trail.kind.picked_up',
  delivered: 'tower.trail.kind.delivered',
  note: 'tower.trail.kind.note',
  exception: 'tower.trail.kind.exception',
  bag_closed: 'tower.trail.kind.bag_closed',
  bag_taken: 'tower.trail.kind.bag_taken',
  bag_received: 'tower.trail.kind.bag_received',
};
const STATE: Record<StepState, { key: MessageKey; tone: string }> = {
  intact: { key: 'tower.trail.state.intact', tone: 'ok' },
  altered: { key: 'tower.trail.state.altered', tone: 'danger' },
  not_anchored: { key: 'tower.trail.state.not_anchored', tone: 'quiet' },
};

/**
 * THE TRAIL (backend trail.types.ts) — a load's or a bag's steps, each anchored in the chain as it was kept and checked
 * now against what the record says: intact, changed since, or made before the trail was anchored.
 */
export function TrailPanel({ unitRef, actions }: { unitRef: string; actions: TowerActions }) {
  const t = useT();
  const client = actions.client();
  const [trail, setTrail] = useState<TrailView | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    setTrail(null);
    setFailed(false);
    if (!client || !unitRef) return;
    void client.api.trail(unitRef).then((r) => {
      if (!live) return;
      if (r.error) return setFailed(true);
      setTrail(narrow<TrailView>(r.data));
    });
    return () => {
      live = false;
    };
  }, [client, unitRef]);

  if (failed) return null;
  return (
    <div class="cons__panel" style="margin-top:12px">
      <div class="cons__panelhead">
        <span class="cons__panelt">{t('tower.trail.title')}</span>
        {trail?.chain ? (
          <span class={`ctag ${trail.chain.whole ? 'ctag--ok' : 'ctag--danger'}`}>
            {trail.chain.whole ? t('tower.trail.chainWhole', { n: trail.chain.anchors }) : t('tower.trail.chainBroken', { at: trail.chain.brokenAt ?? 0, why: trail.chain.reason ?? '' })}
          </span>
        ) : null}
      </div>
      <p class="chint">{t('tower.trail.lede')}</p>
      {trail === null ? (
        <p class="cons__empty">{t('tower.imports.loading')}</p>
      ) : trail.steps.length === 0 ? (
        <p class="cons__empty">{t('tower.trail.none')}</p>
      ) : (
        <div class="crows">
          {trail.steps.map((s, i) => (
            <div class="crow crow--static" key={`${s.kind}-${s.at}-${i}`}>
              <span class="crow__body">
                <span class="crow__top">
                  <span class="crow__name">
                    {t(KIND[s.kind])}
                    {s.detail ? ` · ${s.detail.replace(/_/g, ' ')}` : ''}
                  </span>
                  <span class={`ctag ctag--${STATE[s.state].tone}`}>{t(STATE[s.state].key)}</span>
                </span>
                <span class="crow__sub">
                  {when(s.at)}
                  {s.txId ? <span class="mono-t"> · {s.txId.slice(0, 16)}…</span> : null}
                </span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
