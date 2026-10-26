import { openNowLine, type HubReachView } from '../hubReach';
import { useT } from '../i18n';
import { CallButton } from './CallButton';
import { Pill } from './Pill';

/**
 * A HUB AT A GLANCE, where a driver or a store meets it: open now (or when it next opens) on its own clock, who to ask
 * for, where to come in — and a button that calls it. Nothing it did not write is said; with nothing written, nothing.
 */
export function HubReach({ hub, showName = true }: { hub: HubReachView; showName?: boolean }) {
  const t = useT();
  const open = openNowLine(hub.openNow, t);
  if (!open && !hub.phone && !hub.askFor && !hub.gate) return null;
  return (
    <div class="hubreach">
      <div class="hubreach__head">
        {showName ? <span class="hubreach__name">{hub.name}</span> : null}
        {open ? <Pill tone={hub.openNow?.open ? 'ok' : 'idle'}>{open}</Pill> : null}
      </div>
      {hub.askFor ? <span class="hubreach__line">{t('common.hub.askFor', { who: hub.askFor })}</span> : null}
      {hub.gate ? <span class="hubreach__line">{t('common.hub.gate', { gate: hub.gate })}</span> : null}
      {hub.phone ? <CallButton phone={hub.phone} label={t('common.hub.call', { name: hub.name })} /> : null}
    </div>
  );
}
