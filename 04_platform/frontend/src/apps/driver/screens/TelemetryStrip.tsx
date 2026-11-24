import { Note } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';

/** What the server says of the GPS watch with each position the app sends (backend telemetry.types.ts, TelemetryDriverView). */
export interface TelemetryView {
  roStatus: 'PENDING_BORDER' | 'ACTIVE_IN_RO' | 'SIGNAL_LOST' | 'COMPLETED';
  provider: string;
  everyMinute: boolean;
  lastPingAt?: string;
  enteredRoAt?: string;
}

/** How often the app asks the phone for a position: every minute near or in Romania (ANAF wants at most 2 apart), else every 4. */
export const telemetryAskMs = (t: TelemetryView | null | undefined): number => (t?.everyMinute ? 60_000 : 4 * 60_000);

/**
 * 2026-11-24 — THE GPS WATCH, AS THE DRIVER SEES IT (the owner's brief, feature 4): in Romania, or near it, the app sends a position
 * every minute and says so; after a silence, a warning to check the phone. Nothing where the run is not watched.
 */
export function TelemetryStrip({ telemetry }: { telemetry: TelemetryView | null | undefined }) {
  const t = useT();
  if (!telemetry || telemetry.roStatus === 'COMPLETED') return null;
  if (telemetry.roStatus === 'SIGNAL_LOST') return <Note tone="danger" icon="warning" title={t('driver.telemetry.lost')} detail={t('driver.telemetry.lostDetail')} />;
  if (telemetry.roStatus === 'ACTIVE_IN_RO') return <Note tone="info" icon="pin" title={t('driver.telemetry.active')} detail={t('driver.telemetry.activeDetail')} />;
  return telemetry.everyMinute ? <Note tone="info" icon="pin" title={t('driver.telemetry.near')} detail={t('driver.telemetry.activeDetail')} /> : null;
}
