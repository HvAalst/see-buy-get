import { describe, expect, it } from 'vitest';
import { RUN_CANCEL_ORDER, isRouteReason, runCancelWords } from './runCancel';
import type { Translate } from './i18n';

const t = ((key: string) => key) as unknown as Translate;

describe('why a run was called off, as the shipper reads it', () => {
  it('shares its truck and driver words with a single booking given back — the same act, described once', () => {
    expect(runCancelWords({ reason: 'vehicle_unavailable' }, t)).toBe('giveBack.vehicle_unavailable');
    expect(runCancelWords({ reason: 'no_driver' }, t)).toBe('giveBack.no_driver');
  });

  it('lets the carrier’s sentence be the reason for “other”', () => {
    expect(runCancelWords({ reason: 'other', note: 'Strike at the depot' }, t)).toBe('“Strike at the depot”');
  });

  it('treats only a closed road or border as being about the ROUTE', () => {
    expect(RUN_CANCEL_ORDER.filter(isRouteReason)).toEqual(['road_closed', 'border_closed']);
    expect(isRouteReason(undefined)).toBe(false);
  });
});
