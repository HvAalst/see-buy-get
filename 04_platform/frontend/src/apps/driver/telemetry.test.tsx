import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { t } from '../../shared/i18n';
import { TelemetryStrip, telemetryAskMs, type TelemetryView } from './screens/TelemetryStrip';

/*
 * 2026-11-24 — THE GPS WATCH IN THE DRIVER APP (the owner's brief, feature 4): in or near Romania a position every minute, said;
 * after a silence, a warning; nothing where the run is not watched.
 */
const view = (over: Partial<TelemetryView>): TelemetryView => ({ roStatus: 'PENDING_BORDER', provider: 'DRIVER_APP_GPS', everyMinute: false, ...over });

describe('the GPS watch, as the driver sees it', () => {
  it('asks the phone every minute in or near Romania, every four minutes elsewhere', () => {
    expect(telemetryAskMs(view({ everyMinute: true }))).toBe(60_000);
    expect(telemetryAskMs(view({}))).toBe(240_000);
    expect(telemetryAskMs(null)).toBe(240_000);
  });

  it('says it in Romania, near it, and after a silence; nothing far from it, done, or unwatched', () => {
    expect(renderToString(<TelemetryStrip telemetry={view({ roStatus: 'ACTIVE_IN_RO', everyMinute: true })} />)).toContain(t('driver.telemetry.active'));
    expect(renderToString(<TelemetryStrip telemetry={view({ everyMinute: true })} />)).toContain(t('driver.telemetry.near'));
    expect(renderToString(<TelemetryStrip telemetry={view({ roStatus: 'SIGNAL_LOST', everyMinute: true })} />)).toContain(t('driver.telemetry.lost'));
    expect(renderToString(<TelemetryStrip telemetry={view({})} />)).toBe('');
    expect(renderToString(<TelemetryStrip telemetry={view({ roStatus: 'COMPLETED' })} />)).toBe('');
    expect(renderToString(<TelemetryStrip telemetry={null} />)).toBe('');
  });

  it('sends with the pace the last answer gave, and keeps what each answer says', () => {
    const src = readFileSync(join('src/apps/driver', 'useDriverApp.ts'), 'utf8');
    expect(src).toMatch(/askEvery\(send, everyMinute \? 60_000 : ASK_EVERY_MS\)/);
    expect(src).toMatch(/narrow<\{ telemetry\?: TelemetryView \}>\(r\.data\)\?\.telemetry \?\? null/);
    expect(src).toMatch(/\}, \[client, did, state\.session\.active, everyMinute\]\);/);
  });
});
