import { describe, expect, it } from 'vitest';
import type { MediaView } from './media';
import { BIN_META, groupByBin, retentionLabel } from './media-logic';

const NOW = Date.parse('2026-07-26T00:00:00Z');
const inDays = (d: number) => new Date(NOW + d * 86400000).toISOString();

const m = (over: Partial<MediaView> = {}): MediaView => ({
  mediaId: `med_${Math.round(Math.abs(Math.sin(over.createdAt ? Date.parse(over.createdAt) : 1)) * 1e6)}`,
  kind: 'pod',
  retentionClass: 'shipment-proof',
  contentType: 'image/jpeg',
  hasThumb: true,
  createdAt: inDays(-1),
  status: 'active',
  ...over,
});

describe('media-library logic (S27)', () => {
  it('groups active media by bin in display order, dropping empty bins and expired items', () => {
    const media = [
      m({ retentionClass: 'shipment-proof', createdAt: inDays(-2) }),
      m({ retentionClass: 'vehicle-asset', createdAt: inDays(-1) }),
      m({ retentionClass: 'shipment-proof', createdAt: inDays(-1) }),
      m({ retentionClass: 'dispute-evidence', status: 'expired' }), // removed → dropped
    ];
    const groups = groupByBin(media);
    expect(groups.map((g) => g.bin)).toEqual(['shipment-proof', 'vehicle-asset']); // order; no empty dispute bin
    expect(groups[0].items).toHaveLength(2);
    expect(groups[0].items[0].createdAt).toBe(inDays(-1)); // newest first
    expect(groups[0].meta).toBe(BIN_META['shipment-proof']);
  });

  it('turns machine state into a plain-language retention chip', () => {
    const linked = { type: 'parcel', id: 'P-1' };
    expect(retentionLabel(m({ status: 'expired' }), NOW)).toEqual({ text: 'Removed', tone: 'idle' });
    // Active, no clock yet, but LINKED: asset is Saved; open-case evidence warns.
    expect(retentionLabel(m({ retentionClass: 'vehicle-asset', expiresAt: undefined, link: linked }), NOW).text).toBe('Saved');
    expect(retentionLabel(m({ retentionClass: 'dispute-evidence', expiresAt: undefined, link: linked }), NOW).text).toBe('Kept — case open');
    // Active, no clock, NOT linked → an abandoned upload the reaper will remove; never claim it's saved.
    expect(retentionLabel(m({ expiresAt: undefined, link: undefined }), NOW)).toEqual({ text: 'Not saved yet', tone: 'warn' });
    // A running clock counts down; the last week warns; a far date is calm.
    expect(retentionLabel(m({ expiresAt: inDays(40) }), NOW)).toEqual({ text: 'Kept 40 more days', tone: 'ok' });
    expect(retentionLabel(m({ expiresAt: inDays(5) }), NOW).tone).toBe('warn');
    expect(retentionLabel(m({ expiresAt: inDays(1) }), NOW).text).toBe('Kept 1 more day');
    expect(retentionLabel(m({ expiresAt: inDays(-1) }), NOW).text).toBe('Removing…');
  });
});
