import { Button, Card } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import type { ParcelRow } from '../types';
import type { MdpActions, MdpState } from '../useMdpApp';

/** The new labels this hub has to put on: the one just scanned under its old label first, then every one not sorted yet. */
export function relabelRows(inbound: ParcelRow[], hubId: string | undefined, scanned: { oldId: string; newId: string } | null): Array<{ oldId: string; newId: string }> {
  const waiting = inbound.filter((p) => p.returnOf && p.atMdpId === hubId && !p.toteId).map((p) => ({ newId: p.parcelId, oldId: p.returnOf!.parcelId }));
  return scanned && !waiting.some((w) => w.newId === scanned.newId) ? [scanned, ...waiting] : waiting;
}

/**
 * CALLED OFF AT THIS HUB (the user, 2026-10-27: "Comes back, store pays"): a store called a parcel off while it was here. The
 * box still wears its old label; it goes back to a shop under a new one (the one it was handed in at, or one the store
 * picked) — printed here, put over the
 * old one, and then sorted like any parcel here. The old label scanned says which; every one still waiting for its new label
 * is listed, so the floor can print them from the notice without hunting for the box first.
 */
export function RelabelCard({ state, actions }: { state: MdpState; actions: MdpActions }) {
  const t = useT();
  const scanned = state.relabel;
  const rows = relabelRows(state.inbound, state.hub?.mdpId, scanned);
  if (!rows.length) return null;
  return (
    <Card title={t('mdp.relabel.title')} tone="soft">
      <p class={scanned ? 't-body' : 'hint'} role={scanned ? 'status' : undefined}>
        {scanned ? t('mdp.relabel.body', { old: scanned.oldId, new: scanned.newId }) : t('mdp.relabel.lede')}
      </p>
      <ul class="relabel">
        {rows.map((r) => (
          <li key={r.newId}>
            <span class="mono relabel__ids">{t('mdp.relabel.row', { old: r.oldId, new: r.newId })}</span>
            <Button variant="outline" full={false} chevron={false} busy={state.busy === `label:${r.newId}`} onClick={() => void actions.printNewLabel(r.newId)}>
              {t('mdp.relabel.print')}
            </Button>
            <Button variant="link" full={false} busy={state.busy === `thermal:${r.newId}`} onClick={() => void actions.thermalNewLabel(r.newId)}>
              {t('mdp.relabel.thermal')}
            </Button>
          </li>
        ))}
      </ul>
      {scanned ? (
        <Button variant="link" onClick={actions.dismissRelabel}>
          {t('mdp.relabel.done')}
        </Button>
      ) : null}
    </Card>
  );
}
