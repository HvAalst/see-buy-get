import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { t } from '../../shared/i18n';
import { ImportByRail, type ImportByRailView } from './screens/ImportByRail';
import { timingLine, type ExportDetail } from '../business/exports';

/*
 * WHERE ROAD MEETS RAIL (the user, 2026-10-29: "build the clock with the blocker as you said"). An import's road leg waits
 * for the railway's word, the importer alone sends it anyway, and the terminal's free days are said; an export's truck is
 * timed to the train's cut-off.
 */
const calls = { set: async () => ({}), arrived: async () => ({}), collectAnyway: async () => ({}), leftPort: async () => ({}) };
const rail = (over: Partial<ImportByRailView> = {}): ImportByRailView =>
  ({ terminal: { label: 'Nairobi Inland Container Depot', location: { lat: -1.32, lng: 36.9 } }, freeDays: 4, recordedAt: '2026-10-29T06:00:00Z', recordedBy: 'Wanjiku', clock: { state: 'not_started', freeDays: 4 }, ...over }) as ImportByRailView;
const render = (r: ImportByRailView | undefined, youAre: string) =>
  renderToString(<ImportByRail code="IMP-001" {...(r ? { rail: r } : {})} youAre={youAre} entityId="ent_1" api={null} calls={calls} onChanged={() => undefined} />);

describe('an import inland by rail', () => {
  it('while the box is on the train: the road leg waits, in the board’s own words, and the importer may send it anyway', () => {
    const html = render(rail({ roadWaits: 'The box is still on its way by rail to Nairobi Inland Container Depot: the railway has not said it is there.' }), 'importer');
    expect(html).toContain(t('tower.byRail.waits'));
    expect(html).toContain('still on its way by rail');
    expect(html).toContain(t('tower.byRail.recordArrival'));
    expect(html).toContain(t('tower.byRail.sendAnyway'));
    expect(html).toContain(t('tower.byRail.clock.notStarted'));
  });

  it('its agent records the arrival, but only the importer sends the truck anyway; staff only read', () => {
    const agent = render(rail(), 'agent');
    expect(agent).toContain(t('tower.byRail.recordArrival'));
    expect(agent).not.toContain(t('tower.byRail.sendAnyway'));
    const staff = render(rail(), 'onlooker');
    expect(staff).not.toContain(t('tower.byRail.recordArrival'));
    expect(staff).not.toContain(t('tower.byRail.save'));
  });

  it('arrived: the free days at the terminal are counted, and a word to go anyway is shown with its reason', () => {
    const html = render(rail({ arrival: { at: '2026-10-29T06:00:00Z', by: 'Juma', recordedAt: '2026-10-29T06:10:00Z', reference: 'KRC-AN-5521' }, clock: { state: 'due_soon', freeDays: 4, startedAt: '2026-10-29T06:00:00Z', freeUntil: '2026-11-02T06:00:00Z' } }), 'importer');
    expect(html).toContain(t('tower.byRail.there'));
    expect(html).toContain('KRC-AN-5521');
    expect(html).toContain(t('tower.byRail.clock.dueSoon', { terminal: 'Nairobi Inland Container Depot', until: '2026-11-02 06:00 UTC' }));
    expect(render(rail({ collectAnyway: { by: 'Wanjiku', at: '2026-10-29T06:00:00Z', reason: 'The depot confirmed by phone' } }), 'importer')).toContain('The depot confirmed by phone');
  });

  it('when the train left the port is asked of the importer or agent, and said once recorded', () => {
    expect(render(rail(), 'agent')).toContain(t('tower.byRail.recordLeftPort'));
    expect(render(rail(), 'onlooker')).not.toContain(t('tower.byRail.recordLeftPort'));
    expect(render(rail({ leftPort: { at: '2026-10-28T06:00:00Z', by: 'Juma', recordedAt: '2026-10-28T07:00:00Z' } }), 'importer')).toContain(t('tower.byRail.leftPortAt', { when: '2026-10-28 06:00 UTC', by: 'Juma' }));
  });

  it('a road leg taken before the rail leg was recorded is said, so its driver can be told', () => {
    expect(render(rail({ takenBefore: true }), 'importer')).toContain(t('tower.byRail.takenBefore'));
  });
});

describe('an export by rail', () => {
  it('the truck’s line is the train’s cut-off at the rail terminal, never the port gate', () => {
    const d = {
      timing: { state: 'on_time', leaveByAt: '2026-10-30T02:00:00Z', roadKm: 120, plannedHours: 3.5, handover: { place: 'Naivasha Inland Container Depot', cutoffAt: '2026-10-30T08:00:00Z', byRail: true } },
      consignment: { loadingPlace: { label: 'Kericho warehouse' }, terminal: { label: 'Kipevu container terminal' }, booking: { gateCutoffAt: '2026-11-01T12:00:00Z', partyName: 'Pwani Forwarders' } },
    } as unknown as ExportDetail;
    const line = timingLine(d, t);
    expect(line).toContain('Naivasha Inland Container Depot');
    expect(line).toContain('train’s cut-off');
    expect(line).not.toContain('Kipevu');
  });
});
