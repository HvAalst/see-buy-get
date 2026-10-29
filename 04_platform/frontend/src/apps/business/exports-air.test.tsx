import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { t } from '../../shared/i18n';
import { ExportPanel } from './screens/ExportsScreen';
import { awbState } from './screens/ExportByAir';
import { timingLine, type ExportDetail } from './exports';
import { exportJourney } from '../tower/screens/JourneyStrip';
import type { BusinessClient, BusinessView } from './api';

/*
 * AN EXPORT BY AIR, ON THE SCREEN (2026-10-29). The waybill as copied and as checked, the leave-by with its working, the
 * journey road → air — and none of the sea's steps: no box, no box clock, no weighing, no train, no bill of lading.
 */
const air = (over: Partial<NonNullable<ExportDetail['consignment']['air']>> = {}): NonNullable<ExportDetail['consignment']['air']> => ({
  awb: '706-12345675',
  waybillKind: 'master',
  airline: 'Kenya Airways',
  bookingStatus: 'confirmed',
  flights: [{ flight: 'KQ 112', date: '2026-11-02', from: 'NBO', to: 'AMS', departsLocal: '23:55' }],
  latAt: '2026-11-02T17:00:00.000Z',
  pieces: 40,
  weightKg: 600,
  handler: 'Kenya Airfreight Handling',
  fromAirport: 'NBO',
  toAirport: 'AMS',
  security: { status: 'unsecured' },
  temp: { minC: 2, maxC: 4, preCooled: true },
  inspectionAtAirport: true,
  ...over,
});

const detail = (a = air(), over: Partial<ExportDetail> = {}): ExportDetail =>
  ({
    consignment: {
      exportId: 'exp_9',
      code: 'EXP-009',
      goodsDescription: 'Cut roses, 40 boxes',
      originCountry: 'KE',
      destCountry: 'NL',
      loadingPort: 'NBO — JKIA cargo terminal',
      natureCode: 'FOP',
      mode: 'air',
      air: a,
      booking: { reference: a.awb, bookedWith: 'forwarder', partyName: 'Pwani Forwarders', gateCutoffAt: a.latAt },
      loadingPlace: { label: 'Naivasha pack house', location: { lat: -0.72, lng: 36.43 } },
      terminal: { label: 'JKIA cargo terminal', location: { lat: -1.33, lng: 36.93 } },
      createdAt: '2026-10-29T08:00:00.000Z',
    },
    timing: { state: 'on_time', leaveByAt: '2026-11-02T10:30:00.000Z', roadKm: 104, plannedHours: 6.5, handover: { place: 'JKIA cargo terminal', cutoffAt: a.latAt, byRail: false, byAir: true }, air: { driveHours: 2.5, bufferHours: 1, inspectionHours: 3 } },
    seals: [],
    papers: [{ key: 'air_waybill', label: 'Air waybill (copy)', group: 'kept', optional: true }],
    missing: ['A load to the cargo terminal'],
    documents: [],
    box: { kind: 'unknown', overdue: false, dueSoon: false, basis: '' },
    you: 'exporter',
    exporterName: 'Naivasha Roses',
    feeState: 'none',
    sli: { versions: [], gaps: ['Fill in the form'], stale: false, hazardous: false, fromPacking: false },
    invoice: { versions: [], totals: { lines: 0, goods: 0, charges: 0, total: 0, unvalued: 0, withoutHs: 0, withoutOrigin: 0 }, gaps: ['Bring in the packing list'], notes: [], stale: false, listColumns: [], truth: 'True.' },
    air: {
      check: { number: a.awb, airline: 'Kenya Airways', airlineSource: 'handlers', regime: 'mc99', rules: 'The Montreal Convention 1999', sources: ['ICAO'], missing: [], ask: [], mismatches: ['Weight: the waybill says 600 kg, our papers 640 kg.'], electronicPossible: true, limits: ['At most 26 SDR a kilogram.'], claims: ['Damage: complain within 14 days of receipt.'], caveats: [] },
      warnings: ['Kept between 2 and 4 °C: a reefer or insulated body, its set-point inside the range, and the temperature recorded on the way.'],
    },
    ...over,
  }) as ExportDetail;

const business = { entityId: 'ent_x', activities: ['shipper'], you: { role: 'owner', name: 'Achieng' } } as unknown as BusinessView;
const render = (d: ExportDetail) => renderToString(<ExportPanel exportId="exp_9" business={business} client={{} as BusinessClient} works onChanged={() => undefined} initial={d} />);

describe('an export by air, on the screen', () => {
  it('checks a waybill number’s last digit as it is typed — the server checks it again', () => {
    expect(awbState('')).toBe('empty');
    expect(awbState('706-1234567')).toBe('short');
    expect(awbState('706-12345675')).toBe('ok');
    expect(awbState('706 1234 5675')).toBe('ok');
    expect(awbState('706-12345674')).toBe('wrong');
  });

  it('says the leave-by with its working, and the journey road → air', () => {
    const d = detail();
    expect(timingLine(d, t)).toBe('To be at JKIA cargo terminal before the airline’s latest acceptance time, 2 Nov 2026 17:00 UTC, the load must leave Naivasha pack house by 2 Nov 2026 10:30 UTC — 104 km: 2.5 h on the road, 1 h at the terminal before that time and 3 h for the plant-health inspection at the airport.');
    const noInspection = detail(air({ inspectionAtAirport: undefined }), { timing: { ...d.timing, air: { driveHours: 2.5, bufferHours: 1, inspectionHours: 0 } } });
    expect(timingLine(noInspection, t)).not.toContain('plant-health');
    expect(timingLine(detail(air(), { timing: { ...d.timing, state: 'missed' } }), t)).toBe('The airline’s latest acceptance time at JKIA cargo terminal passed at 2 Nov 2026 17:00 UTC without the cargo. Ask Pwani Forwarders for the next flight.');
    const legs = exportJourney(d, t);
    expect(legs.map((l) => l.mode)).toEqual(['road', 'air']);
    expect(legs[1]).toMatchObject({ from: 'NBO', to: 'AMS', doc: 'Air waybill 706-12345675', state: 'Booked' });
    expect(exportJourney(detail(air({ bookingStatus: 'queued' })), t)[1]).toMatchObject({ state: 'Not confirmed by the airline', tone: 'warn' });
  });

  it('shows the waybill as read, and none of the sea’s steps', () => {
    const html = render(detail());
    for (const shown of [t('business.exports.air.panelTitle'), '706-12345675 — Kenya Airways', 'KQ 112 2026-11-02 NBO→AMS 23:55', '40 pieces, 600 kg', '2 to 4 °C, pre-cooled', 'The Montreal Convention 1999', 'Weight: the waybill says 600 kg, our papers 640 kg.', t('business.exports.laden.postAir'), 'Naivasha pack house → JKIA cargo terminal (NBO)']) expect(html).toContain(shown);
    for (const sea of [t('business.exports.box.title'), t('business.exports.clock.title'), t('business.exports.vgm.title'), t('business.exports.bl.label'), t('business.exports.d.gateCutoff'), t('business.exports.laden.weight')]) expect(html).not.toContain(sea);
    // Secured, and not confirmed: said on the panel and the load's hint.
    const secured = render(detail(air({ bookingStatus: 'queued', security: { status: 'secured', agentName: 'Swissport Kenya RA', agentNumber: 'RA-KE-0042' } })));
    expect(secured).toContain(t('business.exports.air.tagQueued'));
    expect(secured).toContain('Secured by Swissport Kenya RA (RA-KE-0042) — their status, not SeeBuyGet’s');
    expect(secured).toContain('it goes in a closed vehicle, with a driver whose ID has been seen');
  });
});
