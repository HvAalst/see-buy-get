import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { t } from '../../shared/i18n';
import { OFF_PLAN_REASONS, OffPlanSheet } from './screens/OffPlanSheet';

/*
 * 2026-11-06 — MOVEMENT UNIFICATION (the owner: "build the whole thing"): a parcel whose plan goes another way is not sent
 * this way silently. The counter sees where each one goes next by its plan, and keeps it for that way — or sends it this
 * way with one of four reasons, kept on the parcel.
 */
const sheet = (items: Array<{ parcelId: string; planned: string }>) =>
  renderToString(<OffPlanSheet open items={items} goingTo="Westlands" onSend={() => undefined} onKeep={() => undefined} />);

describe('a parcel whose plan goes another way', () => {
  it('says where each one goes next by its plan, and asks why before sending it this way', () => {
    const html = sheet([{ parcelId: 'PUD-1', planned: 'Industrial Hub' }]);
    expect(html).toContain(t('agent.offPlan.titleOne'));
    expect(html).toContain('PUD-1');
    expect(html).toContain(t('agent.offPlan.plannedTo', { place: 'Industrial Hub' }));
    expect(html).toContain(t('agent.offPlan.ask', { place: 'Westlands' }));
    for (const r of OFF_PLAN_REASONS) expect(html).toContain(t(r.labelKey));
    expect(html).toContain(t('agent.offPlan.keep'));
  });

  it('counts several', () => {
    expect(sheet([{ parcelId: 'PUD-1', planned: 'A' }, { parcelId: 'PUD-2', planned: 'B' }])).toContain(t('agent.offPlan.titleMany', { count: 2 }));
  });

  it('offers exactly the four reasons the server takes', () => {
    expect(OFF_PLAN_REASONS.map((r) => r.value)).toEqual(['no_transport', 'hub_full', 'faster', 'other']);
  });
});
