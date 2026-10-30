import { airArrivalWarning, vetAgencyOf } from './air-release.types';
import { requiredLoadKeys } from './heavy-cargo';
import { animalVehicleRefusal, animalWords, chickWindow, liveAnimalsOf, type LiveAnimalsDto } from './live-animals.types';

/**
 * LIVE ANIMALS BY AIR, AND A LANDING THAT MAY WAIT FOR MONDAY (the user, 2026-10-30: "build 1 and 2"). The declaration is
 * checked before anything is written; the vehicle is made for the animals; the driver's own checks join the pickup list;
 * day-old chicks' 72 hours are said as the breeder's figure; and a weekend or holiday landing is warned where an office
 * its release waits on keeps weekday hours.
 */
describe('live animals, as data', () => {
  const heifers: LiveAnimalsDto = { kind: 'livestock', species: 'Dairy heifers', count: 20, permit: 'VS03-2026-118', healthCertificate: 'NL-VC-55120', fitToTravel: true };
  const now = Date.parse('2026-10-30T08:00:00Z');

  it('asks for the permit, the health certificate, the keeper’s word that none is unfit — and on an export, the shipper’s certification', () => {
    expect(() => liveAnimalsOf({ ...heifers, species: ' ' }, 'import', 'Wanjiku', now)).toThrow(/^Say what the animals are/);
    expect(() => liveAnimalsOf({ ...heifers, permit: '' }, 'import', 'Wanjiku', now)).toThrow(/^Give the import permit’s number: animals do not leave the airport until it is produced/);
    expect(() => liveAnimalsOf({ ...heifers, healthCertificate: ' ' }, 'import', 'Wanjiku', now)).toThrow(/health certificate/);
    expect(() => liveAnimalsOf({ ...heifers, fitToTravel: false }, 'import', 'Wanjiku', now)).toThrow(/in the last tenth of its pregnancy, has given birth in the last 48 hours/);
    expect(() => liveAnimalsOf({ ...heifers, citesListed: true }, 'import', 'Wanjiku', now)).toThrow(/CITES travels with its permit/);
    expect(() => liveAnimalsOf(heifers, 'export', 'Wanjiku', now)).toThrow(/shipper’s certification for live animals/);
    expect(() => liveAnimalsOf({ ...heifers, hatchedAt: '2026-10-31T08:00:00Z' }, 'import', 'Wanjiku', now)).toThrow(/a moment that has come/);
    const kept = liveAnimalsOf({ ...heifers, citesListed: false, citesPermit: 'X-1', attendantName: 'Kiprono', attendantPhone: '+254700000001' }, 'import', 'Wanjiku', now, { label: 'Kabete quarantine station', location: { lat: -1.25, lng: 36.73 } });
    expect(kept).toMatchObject({ kind: 'livestock', count: 20, fitToTravel: { by: 'Wanjiku', at: '2026-10-30T08:00:00.000Z' }, attendant: { name: 'Kiprono' }, destination: { label: 'Kabete quarantine station', namedOn: 'import permit VS03-2026-118' } });
    // A permit given while the species is not listed is not kept as a CITES permit.
    expect(kept.cites).toBeUndefined();
    const words = animalWords(kept);
    expect(words).toMatch(/Kiprono \(\+254700000001\) looks after them on the way\./);
    expect(words).toMatch(/The originals ride with them: the veterinary health certificate NL-VC-55120, the import permit VS03-2026-118\./);
    expect(words).toMatch(/They go to Kabete quarantine station — the place the veterinary officer named — and nowhere else\./);
    expect(animalWords({ ...kept, attendant: undefined })).toMatch(/You are their handler on the way\./);
  });

  it('puts livestock on a livestock body, and crated animals in a closed vehicle — never on a bike, a motorcycle, a tuk-tuk or an open truck', () => {
    const cattle = { kind: 'livestock' as const, species: 'Dairy heifers', count: 20 };
    const chicks = { kind: 'crated' as const, species: 'Day-old chicks', count: 4000 };
    expect(animalVehicleRefusal(cattle, { vehicleClass: 'truck', truckSubtype: 'livestock' })).toBeUndefined();
    expect(animalVehicleRefusal(cattle, { vehicleClass: 'truck', truckSubtype: 'flatbed' })).toMatch(/go on a livestock body/);
    expect(animalVehicleRefusal(cattle, { vehicleClass: 'van' })).toMatch(/go on a livestock body/);
    for (const ok of [{ vehicleClass: 'van' }, { vehicleClass: 'car' }, { vehicleClass: 'truck', truckSubtype: 'box' }, { vehicleClass: 'truck', truckSubtype: 'refrigerated' }]) expect(animalVehicleRefusal(chicks, ok)).toBeUndefined();
    for (const no of [{ vehicleClass: 'motorcycle' }, { vehicleClass: 'bike' }, { vehicleClass: 'tuktuk' }, { vehicleClass: 'truck', truckSubtype: 'flatbed' }, { vehicleClass: 'truck', truckSubtype: 'curtain_side' }]) expect(animalVehicleRefusal(chicks, no)).toMatch(/closed body with air/);
    // No animals, or no vehicle to judge: nothing said.
    expect(animalVehicleRefusal(undefined, { vehicleClass: 'motorcycle' })).toBeUndefined();
    expect(animalVehicleRefusal(chicks, null)).toBeUndefined();
  });

  it('adds the driver’s own look to the pickup list, by how the animals ride', () => {
    const base = { bulk: false, fragile: false, requiredCapabilities: [] };
    expect(requiredLoadKeys(base)).not.toContain('animals_fit');
    expect(requiredLoadKeys({ ...base, animalKind: 'livestock' })).toEqual(expect.arrayContaining(['animals_fit', 'animals_papers', 'animals_cleaned', 'animals_air', 'animals_ramp']));
    expect(requiredLoadKeys({ ...base, animalKind: 'crated' })).toEqual(expect.arrayContaining(['animals_fit', 'animals_crates']));
    expect(requiredLoadKeys({ ...base, animalKind: 'crated' })).not.toContain('animals_ramp');
  });

  it('counts day-old chicks’ hours to their 72, as the breeder’s figure', () => {
    expect(chickWindow(undefined, now)).toBeUndefined();
    expect(chickWindow('2026-10-28T08:00:00Z', now)).toEqual({ hoursOld: 48, over: false });
    expect(chickWindow('2026-10-27T07:00:00Z', now)).toEqual({ hoursOld: 73, over: true });
    expect(chickWindow('2026-10-27T08:00:00Z', now)).toEqual({ hoursOld: 72, over: false });
  });
});

describe('a landing that may wait for Monday', () => {
  const kebs = [{ key: 'kebs', name: 'Kenya Bureau of Standards (KEBS)' }];
  it('warns a Saturday or Sunday landing in Kenya — customs verification keeps weekday hours — and names Form C.1', () => {
    // 31 October 2026 is a Saturday.
    const sat = airArrivalWarning({ country: 'KE', landsOn: '2026-10-31', agencies: kebs });
    expect(sat).toMatchObject({ kind: 'saturday', landsOn: '2026-10-31', offices: ['customs verification (KRA)', 'Kenya Bureau of Standards (KEBS)'] });
    expect(sat!.text).toBe('It lands on Saturday 31 October. Customs verification (KRA) and Kenya Bureau of Standards (KEBS) work Monday to Friday at the airport, so the release may wait for the next working day. Your agent may ask for officers to attend out of hours on Form C.1, at least 24 hours before — on a Sunday or a public holiday at a minimum charge of three hours (EAC Customs Management Regulations 2010, regs 4–6).');
    expect(airArrivalWarning({ country: 'KE', landsOn: '2026-11-01', agencies: [] })).toMatchObject({ kind: 'sunday', offices: ['customs verification (KRA)'] });
    // An agency that works every day adds nothing.
    expect(airArrivalWarning({ country: 'KE', landsOn: '2026-11-01', agencies: [{ key: 'kephis', name: 'KEPHIS' }] })!.offices).toEqual(['customs verification (KRA)']);
  });

  it('a Friday afternoon may wait too; a Friday morning, a weekday, or a country whose hours we have not read says nothing', () => {
    expect(airArrivalWarning({ country: 'KE', landsOn: '2026-10-30', landsAt: '14:30', agencies: [] })).toMatchObject({ kind: 'friday_late' });
    expect(airArrivalWarning({ country: 'KE', landsOn: '2026-10-30', landsAt: '12:00', agencies: [] })).toMatchObject({ kind: 'friday_late' });
    expect(airArrivalWarning({ country: 'KE', landsOn: '2026-10-30', landsAt: '09:15', agencies: [] })).toBeUndefined();
    expect(airArrivalWarning({ country: 'KE', landsOn: '2026-10-28', agencies: kebs })).toBeUndefined();
    expect(airArrivalWarning({ country: 'UG', landsOn: '2026-10-31', agencies: [] })).toBeUndefined();
    expect(airArrivalWarning({ country: 'KE', agencies: [] })).toBeUndefined();
  });

  it('a day the country’s own calendar marks closed is said with the company and its note', () => {
    const holiday = airArrivalWarning({ country: 'KE', landsOn: '2026-10-28', agencies: [], closed: { company: 'SeeBuyGet Kenya', note: 'Public holiday' } });
    expect(holiday).toMatchObject({ kind: 'holiday' });
    expect(holiday!.text).toMatch(/^It lands on Wednesday 28 October, which SeeBuyGet Kenya’s calendar marks closed \(Public holiday\)\. Customs verification \(KRA\) works Monday to Friday/);
  });

  it('names each country’s veterinary authority where we list one', () => {
    expect(vetAgencyOf('KE')?.key).toBe('dvs');
    expect(vetAgencyOf('UG')?.key).toBe('maaif');
    expect(vetAgencyOf('TZ')?.key).toBe('tz_vet');
    expect(vetAgencyOf('XX')).toBeUndefined();
  });
});
