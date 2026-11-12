import type { components } from '../../lib/sbg';
import type { MessageKey, Translate } from '../../shared/i18n';

/** 2026-11-12 — where hubs are needed (the plan "Hubs on the Road", step 3): the words and colours of the console's map. */
export type HubDensity = components['schemas']['HubDensityView'];
export type HubSuggestion = components['schemas']['HubSuggestion'];
type DensityZone = components['schemas']['DensityZone'];

/** Coverage in the colours of a state (good, to watch, wrong); demand in one hue, deeper with more parcels. */
const COVERAGE_FILL = { near: '#2e7d32', far: '#f9a825', too_far: '#c62828' } as const;
const DEMAND_STEPS = ['#e3e7f7', '#b8c2ec', '#8796db', '#5566c4', '#2d3c9e'];

export function densityFill(zone: DensityZone | undefined, layer: 'coverage' | 'demand', maxParcels: number): string {
  if (!zone) return '#cccccc';
  if (layer === 'coverage') return COVERAGE_FILL[zone.coverage];
  const share = (zone.sent30 + zone.received30) / Math.max(1, maxParcels);
  return DEMAND_STEPS[Math.min(DEMAND_STEPS.length - 1, Math.floor(share * DEMAND_STEPS.length))];
}

/** A suggestion's reason with its numbers, in a sentence. */
export function suggestionLine(s: HubSuggestion, t: Translate): string {
  const n = s.numbers;
  switch (s.kind) {
    case 'hub_needed':
      return t('tower.density.line.hub_needed' as MessageKey, { zones: s.zoneNames.slice(0, 3).join(', ') + (s.zoneNames.length > 3 ? '…' : ''), shops: n.shops ?? 0, parcels: n.parcels ?? 0, km: n.km ?? '—', reach: n.reach ?? '—', hub: s.hubNames[0] ?? '—' });
    case 'extra_hub':
      return n.ratio != null ? t('tower.density.line.extra_hub_ratio' as MessageKey, { hub: s.hubNames[0], full: n.fullDays ?? 0, days: n.days ?? 14, ratio: n.ratio, zone: s.zoneNames[0] ?? '—' }) : t('tower.density.line.extra_hub' as MessageKey, { hub: s.hubNames[0], full: n.fullDays ?? 0, days: n.days ?? 14, zone: s.zoneNames[0] ?? '—' });
    case 'too_close':
      return t('tower.density.line.too_close' as MessageKey, { a: s.hubNames[0], b: s.hubNames[1], km: n.apart ?? 0, min: n.min ?? 0 });
    default:
      return t('tower.density.line.road_gap' as MessageKey, { a: s.hubNames[0], b: s.hubNames[1], km: n.apart ?? 0 });
  }
}

/** D7 — the invitation staff share: the hub sign-up, with the place filled in. */
export function invitationLink(s: HubSuggestion, origin: string): string {
  const q = new URLSearchParams({ join: 'mdp', near: `${s.place.lat.toFixed(4)},${s.place.lng.toFixed(4)}` });
  if (s.place.name) q.set('place', s.place.name);
  return `${origin.replace(/\/+$/, '')}/?${q.toString()}`;
}
