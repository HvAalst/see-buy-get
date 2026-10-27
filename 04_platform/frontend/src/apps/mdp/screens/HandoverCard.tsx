import { useState } from 'preact/hooks';
import { Button, Card, ScanField } from '../../../shared/ui';
import { useT, type Translate } from '../../../shared/i18n';
import type { HubHandover } from '../types';
import type { MdpActions, MdpState } from '../useMdpApp';

/** Where a box set aside for its driver stands: nobody has taken its load yet, or the driver who did, to hand it to. */
export function handoverLine(h: HubHandover, t: Translate): string {
  if (h.load.status === 'claimed') return h.load.driverName ? t('mdp.handover.takenBy', { name: h.load.driverName, code: h.load.code }) : t('mdp.handover.taken', { code: h.load.code });
  return t('mdp.handover.waiting', { code: h.load.code });
}

/**
 * CALLED OFF HERE, GOING TO ITS STORE'S DOOR (the user, 2026-10-27: "As a load to its door"): a store called a parcel off
 * while it was here, and it goes home as a load from this hub. The box is kept aside and handed to nobody but the driver who
 * took that load — their pass scanned at the counter, as a bag is handed over. Its old label scanned at the sort says so.
 */
export function HandoverCard({ state, actions }: { state: MdpState; actions: MdpActions }) {
  const t = useT();
  const [passes, setPasses] = useState<Record<string, string>>({});
  const aside = state.aside;
  if (!state.handovers.length && !aside) return null;
  return (
    <Card title={t('mdp.handover.title')} tone="soft">
      <p class={aside ? 't-body' : 'hint'} role={aside ? 'status' : undefined}>
        {aside ? t('mdp.handover.scanned', { parcel: aside.parcelId, code: aside.loadCode }) : t('mdp.handover.lede')}
      </p>
      <ul class="relabel">
        {state.handovers.map((h) => {
          const taken = h.load.status === 'claimed';
          const pass = passes[h.parcelId] ?? '';
          return (
            <li key={h.parcelId}>
              <span class="mono relabel__ids">{t('mdp.handover.row', { parcel: h.parcelId, code: h.load.code })}</span>
              <span class="hint relabel__ids">{handoverLine(h, t)}</span>
              {taken ? (
                <>
                  <span class="relabel__ids">
                    <ScanField id={`hand-${h.parcelId}`} label={t('mdp.handover.passLabel')} value={pass} onValue={(v) => setPasses((p) => ({ ...p, [h.parcelId]: v }))} expect="badge" placeholder={t('mdp.handover.passScan')} upper />
                  </span>
                  <Button full={false} chevron={false} busy={state.busy === `hand:${h.parcelId}`} disabled={!pass.trim()} onClick={() => void actions.handToDriver(h.parcelId, pass.trim())}>
                    {t('mdp.handover.hand')}
                  </Button>
                </>
              ) : null}
            </li>
          );
        })}
      </ul>
      {aside ? (
        <Button variant="link" onClick={actions.dismissAside}>
          {t('mdp.relabel.done')}
        </Button>
      ) : null}
    </Card>
  );
}
