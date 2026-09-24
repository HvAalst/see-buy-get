import { describe, expect, it } from 'vitest';
import { t } from '../../shared/i18n'; // English is the base catalog, so the real `t` yields the English literals
import {
  EMPTY_JOIN,
  ROLES,
  bodyWords,
  codeLooksValid,
  emptyRunPct,
  isThin,
  km,
  joinSpoken,
  marketShape,
  marketWhere,
  marketWork,
  measuredPct,
  nextStep,
  normalizePhone,
  phoneLooksValid,
  prevStep,
  roleById,
  roleMeta,
  servedPct,
  needsLicence,
  onlyJoinable,
  pickedClasses,
  pickedVehicle,
  signupBody,
  stepBlocker,
  vehicleClassFor,
  stepsFor,
  type JoinForm,
  type RoleSpec,
} from './logic';

const role = (id: string): RoleSpec => roleById(id)!;

const filled = (over: Partial<JoinForm> = {}): JoinForm => ({
  ...EMPTY_JOIN,
  phone: '+254700111222',
  code: '1234',
  email: 'me@example.com',
  password: 'hunter22',
  displayName: 'Mama Sarah Shop',
  fullName: 'Sarah Njeri',
  nationalId: 'NID-1',
  location: { lat: -1.28, lng: 36.82 },
  zone: 'Z-A',
  country: 'KE',
  ...over,
});

describe('roles', () => {
  it('every role names an app path and a join kind', () => {
    expect(ROLES.length).toBe(5);
    for (const r of ROLES) {
      expect(r.app).toMatch(/^\/[a-z]+\/$/);
      expect(['signup', 'vendor', 'invite']).toContain(r.kind);
      expect(roleMeta(r, t).promise.length).toBeGreaterThan(0);
    }
    // The three roles the backend's /auth/signup actually supports.
    expect(ROLES.filter((r) => r.kind === 'signup').map((r) => r.id)).toEqual(['pudo', 'driver', 'mdp']);
  });
});

describe('phone + code', () => {
  it('accepts real international shapes and rejects junk', () => {
    expect(phoneLooksValid('+254 700 111 222')).toBe(true);
    expect(phoneLooksValid('0712345678')).toBe(true);
    expect(phoneLooksValid('(020) 123-4567')).toBe(true);
    expect(phoneLooksValid('12345')).toBe(false);
    expect(phoneLooksValid('not a phone')).toBe(false);
    expect(normalizePhone('+254 700-111 (222)')).toBe('+254700111222');
  });

  it('the OTP is 4 to 6 digits', () => {
    expect(codeLooksValid('1234')).toBe(true);
    expect(codeLooksValid(' 123456 ')).toBe(true);
    expect(codeLooksValid('12')).toBe(false);
    expect(codeLooksValid('12a4')).toBe(false);
  });
});

describe('wizard steps', () => {
  it('a vendor skips the phone gate the backend never asks for', () => {
    expect(stepsFor('vendor')).toEqual(['about', 'done']);
    expect(stepsFor('signup')[0]).toBe('phone');
  });

  it('next/prev stay inside the sequence', () => {
    expect(nextStep('signup', 'phone')).toBe('code');
    expect(prevStep('signup', 'phone')).toBe('phone');
    expect(nextStep('signup', 'done')).toBe('done');
    expect(prevStep('signup', 'login')).toBe('where');
  });
});

describe('stepBlocker', () => {
  it('walks a shop through in order', () => {
    const shop = role('pudo');
    expect(stepBlocker(shop, 'phone', EMPTY_JOIN, t)).toContain('phone');
    expect(stepBlocker(shop, 'phone', filled(), t)).toBeNull();
    expect(stepBlocker(shop, 'about', { ...filled(), displayName: '' }, t)).toContain('shop');
    expect(stepBlocker(shop, 'about', { ...filled(), fullName: '' }, t)).toContain('full name');
    // The country comes first on this step: it decides which company contracts them, and it narrows the
    // areas offered below it. A wizard that never asked is how a shop in Addis ended up billed by Nairobi.
    expect(stepBlocker(shop, 'where', { ...filled(), country: '' }, t)).toContain('country');
    expect(stepBlocker(shop, 'where', { ...filled(), location: null }, t)).toContain('map');
    expect(stepBlocker(shop, 'where', filled(), t)).toBeNull();
    expect(stepBlocker(shop, 'login', { ...filled(), password: '123' }, t)).toContain('6 characters');
    expect(stepBlocker(shop, 'login', filled(), t)).toBeNull();
  });

  it('a driver must say what they drive; a hub needs no personal ID', () => {
    expect(stepBlocker(role('driver'), 'about', { ...filled(), licenceClasses: [] }, t)).toContain('what you drive');
    expect(stepBlocker(role('mdp'), 'about', { ...filled(), fullName: '', nationalId: '' }, t)).toBeNull();
  });

  /*
   * THE FRONT DOOR USED TO REFUSE EVERY COURIER ABOVE A MOTORCYCLE.
   *
   * It asked what somebody drives and never asked for the licence the network requires to put them behind
   * it, so `drivers.register` answered LICENCE_REQUIRED and the only conclusion available to the person
   * refused was that they had to come in through a fleet — which is exactly what the user reported.
   */
  it('lets a bike or motorcycle courier through with no licence paperwork at all', () => {
    const rider = { ...filled(), licenceClasses: ['bike'], vehicleClass: 'bike', vehiclePlate: 'BCY-1' };
    expect(needsLicence(['bike'])).toBe(false);
    expect(needsLicence(['motorcycle'])).toBe(false);
    expect(stepBlocker(role('driver'), 'about', rider, t)).toBeNull();
  });

  it('asks a van or truck courier for the licence the network will demand anyway', () => {
    expect(needsLicence(['van'])).toBe(true);
    // Mixed: one heavy class among light ones still needs it — the registry is decided by the heaviest.
    expect(needsLicence(['bike', 'van'])).toBe(true);
    const base = { ...filled(), licenceClasses: ['van'], vehicleClass: 'van', vehiclePlate: 'KDD 1' };
    expect(stepBlocker(role('driver'), 'about', base, t)).toContain('licence number');
    expect(stepBlocker(role('driver'), 'about', { ...base, licenceNumber: 'DL-9' }, t)).toContain('runs out');
    // An expiry already past is refused HERE, not after the account is otherwise built.
    expect(stepBlocker(role('driver'), 'about', { ...base, licenceNumber: 'DL-9', licenceExpiresAt: '2020-01-01' }, t)).toContain('already run out');
    expect(stepBlocker(role('driver'), 'about', { ...base, licenceNumber: 'DL-9', licenceExpiresAt: '2099-01-01' }, t)).toBeNull();
  });

  it('will not let a courier join with no vehicle, because this door only makes self-employed ones', () => {
    const base = { ...filled(), licenceClasses: ['bike'], vehicleClass: 'bike' };
    expect(stepBlocker(role('driver'), 'about', { ...base, vehiclePlate: '' }, t)).toContain('number plate');
    // Owning a class you had not ticked is not an error — it is a reason to be cleared for it, so saying
    // so here grants the licence class rather than sending somebody back up the form.
    expect(pickedVehicle({ ...EMPTY_JOIN, licenceClasses: ['bike'], vehicleClass: 'bike' }, 'truck')).toMatchObject({
      licenceClasses: ['bike', 'truck'],
      vehicleClass: 'truck',
    });
    // And a truck is not registrable without its kind.
    const trucker = { ...filled(), licenceClasses: ['truck'], vehicleClass: 'truck', vehiclePlate: 'T-1', licenceNumber: 'DL-9', licenceExpiresAt: '2099-01-01' };
    expect(stepBlocker(role('driver'), 'about', trucker, t)).toContain('kind of truck');
    expect(stepBlocker(role('driver'), 'about', { ...trucker, truckSubtype: 'flatbed' }, t)).toBeNull();
  });

  it('DERIVES the vehicle from a single licence class, without waiting for a tap nobody knew to make', () => {
    /*
     * The bug a driver hit the day this shipped. The vehicle was only ever set by tapping a chip, so a
     * courier who accepted the default — or ticked one class and moved on — had no vehicle chosen, and
     * Continue stayed dead with the reason printed at the foot of a long form against a second row of
     * chips that looked like a repeat of the first.
     */
    expect(vehicleClassFor({ licenceClasses: ['van'], vehicleClass: '' })).toBe('van');
    expect(stepBlocker(role('driver'), 'about', { ...filled(), licenceClasses: ['bike'], vehicleClass: '', vehiclePlate: 'B-1' }, t)).toBeNull();
    // With two, there is a real choice and it must be made.
    expect(vehicleClassFor({ licenceClasses: ['van', 'truck'], vehicleClass: '' })).toBe('');
    // An answer already given survives — deriving never overrides somebody's own choice.
    expect(vehicleClassFor({ licenceClasses: ['van', 'truck'], vehicleClass: 'truck' })).toBe('truck');
    // And one that stopped being valid is dropped rather than quietly sent to the server.
    expect(vehicleClassFor({ licenceClasses: ['van'], vehicleClass: 'truck' })).toBe('van');
  });

  it('keeps the vehicle honest about the licence as the classes are tapped', () => {
    // One class to choose from is not a choice worth making somebody make.
    expect(pickedClasses({ ...EMPTY_JOIN, licenceClasses: [] }, 'van')).toMatchObject({ licenceClasses: ['van'], vehicleClass: 'van' });
    // Taking away the class the vehicle named clears the vehicle rather than leaving a pair the server refuses.
    expect(pickedClasses({ ...EMPTY_JOIN, licenceClasses: ['van', 'truck'], vehicleClass: 'truck' }, 'truck')).toMatchObject({ licenceClasses: ['van'], vehicleClass: 'van' });
    // A class that is not the vehicle's is added without disturbing it.
    expect(pickedClasses({ ...EMPTY_JOIN, licenceClasses: ['van', 'bike'], vehicleClass: 'van' }, 'car')).toMatchObject({ vehicleClass: 'van' });
    // A sub-type never survives the truck it described: dropping the truck clears both.
    expect(pickedClasses({ ...EMPTY_JOIN, licenceClasses: ['truck'], vehicleClass: 'truck', truckSubtype: 'tipper' }, 'truck')).toMatchObject({ vehicleClass: '', truckSubtype: '' });
    // But it survives a class being ADDED alongside — the vehicle is still that truck.
    expect(pickedClasses({ ...EMPTY_JOIN, licenceClasses: ['truck'], vehicleClass: 'truck', truckSubtype: 'tipper' }, 'van').truckSubtype).toBeUndefined();
  });

  it('SENDS the licence and the vehicle, which is the half that was missing', () => {
    const body = signupBody(role('driver'), filled({
      licenceClasses: ['van'], licenceNumber: 'DL-9', licenceExpiresAt: '2099-01-01', vehicleClass: 'van', vehiclePlate: ' kdd 1 ',
    }), 'x') as { profile: { driver: Record<string, unknown>; vehicle: Record<string, unknown> } };
    expect(body.profile.driver.licenceNumber).toBe('DL-9');
    expect(body.profile.driver.licenceExpiresAt).toBe('2099-01-01');
    expect(body.profile.vehicle).toEqual({ plate: 'kdd 1', vehicleClass: 'van' });
  });

  it('sends NO licence fields for a rider who needs none — an empty string is not "no licence"', () => {
    const body = signupBody(role('driver'), filled({ licenceClasses: ['bike'], vehicleClass: 'bike', vehiclePlate: 'B-1' }), 'x') as {
      profile: { driver: Record<string, unknown> };
    };
    expect(body.profile.driver.licenceNumber).toBeUndefined();
    expect(body.profile.driver.licenceExpiresAt).toBeUndefined();
  });

  /*
   * EVERY COUNTRY IS ON THE LIST, and the three states are the reason it can be.
   *
   * The list used to hold only the countries goods may be taken in — nine of two hundred and forty-three.
   * A driver in the Netherlands could not find their own and concluded the product could only be joined
   * through a fleet, which is the honest reading of a country that is simply absent. Absence teaches
   * nobody anything; a country you can pick and be answered about teaches you exactly where you stand.
   */
  it('refuses a country the network does not reach, at the country step rather than at the end', () => {
    const where = { ...filled(), country: 'NL' };
    // Offered, and refused here — with the reason on screen beside it, not by the server after sign-up.
    expect(stepBlocker(role('pudo'), 'where', where, t, ['NL', 'FR'])).toContain('do not reach that country');
    // A country we DO reach passes, whether or not a company of ours settles money there.
    expect(stepBlocker(role('pudo'), 'where', where, t, ['FR'])).toBeNull();
    // And with nothing said about reach at all, nothing is refused — the caller decides.
    expect(stepBlocker(role('pudo'), 'where', where, t)).toBeNull();
  });

  it('preselects a country only when there is genuinely one to join, not when the list is short', () => {
    const atlas = [
      { country: 'KE', joinable: true },
      { country: 'NL', joinable: false },
      { country: 'FR', joinable: false },
    ];
    expect(onlyJoinable(atlas)).toBe('KE');
    // Two open ones is a real question and must be asked.
    expect(onlyJoinable([...atlas, { country: 'ET', joinable: true }])).toBe('');
    // None open must never silently choose one somebody cannot register in.
    expect(onlyJoinable([{ country: 'NL', joinable: false }])).toBe('');
    // An older payload with no flag at all is treated as joinable — the field is additive.
    expect(onlyJoinable([{ country: 'KE' }])).toBe('KE');
  });

  it('a store needs its name and the country that will invoice it', () => {
    // A store never reaches the 'where' step, so its country is asked on this one — and it is not optional:
    // registering where the network has no company is refused, and the form should say so, not the server.
    expect(stepBlocker(role('vendor'), 'about', EMPTY_JOIN, t)).toContain('Name your store');
    expect(stepBlocker(role('vendor'), 'about', { ...EMPTY_JOIN, displayName: 'Nairobi Threads' }, t)).toContain('country');
    expect(stepBlocker(role('vendor'), 'about', { ...EMPTY_JOIN, displayName: 'Nairobi Threads', country: 'KE' }, t)).toBeNull();
  });
});

describe('signupBody', () => {
  it('a shop carries the Golden Record, the pin and workable defaults', () => {
    const body = signupBody(role('pudo'), filled(), 'dev-marker') as {
      role: string;
      phone: string;
      profile: { agent: Record<string, unknown> };
    };
    expect(body.role).toBe('pudo');
    expect(body.phone).toBe('+254700111222');
    const a = body.profile.agent;
    expect(a.shopName).toBe('Mama Sarah Shop');
    expect(a.mobile).toBe('+254700111222'); // the verified number, not a second entry
    expect(a.deviceImei).toBe('dev-marker');
    expect(a.location).toEqual({ lat: -1.28, lng: 36.82 });
    expect(a.shelf).toEqual({ rows: 4, cols: 5 });
    expect(Object.keys(a.openingHours as object)).toHaveLength(7);
    expect((a.requirements as { criminalRecordClear: boolean }).criminalRecordClear).toBe(true);
    expect(a.country).toBe('KE'); // which company contracts this shop — never inferred from the pin
  });

  it('sends the country every role is contracted through, normalised', () => {
    const shop = signupBody(role('pudo'), filled({ country: 'et' }), 'x') as { profile: { agent: { country: string } } };
    expect(shop.profile.agent.country).toBe('ET');

    // A hub stands in one country even when it serves zones across a border.
    const hub = signupBody(role('mdp'), filled({ country: 'et' }), 'x') as { profile: { mdp: { country: string } } };
    expect(hub.profile.mdp.country).toBe('ET');

    // An INDEPENDENT courier is contracted by a sister and says which; a fleet-attached one carries no
    // jurisdiction at all by design, and the backend drops this for them.
    const driver = signupBody(role('driver'), filled({ country: 'et' }), 'x') as { profile: { driver: { jurisdiction: string } } };
    expect(driver.profile.driver.jurisdiction).toBe('ET');
  });

  it('a driver sends licence classes and a home zone; a hub sends its zone list', () => {
    const d = signupBody(role('driver'), filled({ licenceClasses: ['bike', 'van'] }), 'x') as {
      profile: { driver: Record<string, unknown> };
    };
    expect(d.profile.driver.licenceClasses).toEqual(['bike', 'van']);
    expect(d.profile.driver.homeZone).toBe('Z-A');

    const m = signupBody(role('mdp'), filled(), 'x') as { profile: { mdp: Record<string, unknown> } };
    expect(m.profile.mdp.zones).toEqual(['Z-A']);
    expect(m.profile.mdp.location).toEqual({ lat: -1.28, lng: 36.82 });
  });

  it('a landmark is optional — the pin is the address', () => {
    const body = signupBody(role('pudo'), filled({ landmark: '' }), 'x') as { profile: { agent: { landmark: string } } };
    expect(body.profile.agent.landmark).toContain('Pin');
  });
});

describe('speaking', () => {
  it('every step has a spoken line', () => {
    for (const step of stepsFor('signup')) {
      expect(joinSpoken(role('pudo'), step, t).length).toBeGreaterThan(0);
    }
  });
});

describe('reading the public market (FB3b)', () => {
  const row = (over: Partial<Parameters<typeof marketWork>[0]> & { area?: string; destArea?: string } = {}) => ({
    weightKg: 400,
    bodyDerived: { body: 'flatbed', basis: 'measured' as const },
    ...over,
  });

  it('names the body in words a reader outside the trade would use', () => {
    expect(bodyWords('flatbed', t)).toBe('Open flatbed');
    expect(bodyWords('skeletal', t)).toBe('Container chassis');
    // A body added to the catalogue but not yet to the catalog still renders as something readable.
    expect(bodyWords('quantum_hauler', t)).toBe('quantum hauler');
    expect(bodyWords(undefined, t)).toBe('Truck');
  });

  it('leads a row with the BODY, because that is the question the page answers', () => {
    expect(marketWork(row(), t)).toBe('Open flatbed · 400 kg');
  });

  it('says out loud when a body was guessed from weight alone', () => {
    // An investment thesis built on a derivation nobody measured deserves to know it was a derivation.
    const guessed = marketWork(row({ bodyDerived: { body: 'flatbed', basis: 'weight-only' } }), t);
    expect(guessed).toContain('worked out from the weight alone');
  });

  it('gives the corridor in TOWNS, and degrades rather than inventing one', () => {
    expect(marketWhere({ area: 'Thika', destArea: 'Mombasa' }, t)).toBe('Thika → Mombasa');
    expect(marketWhere({ area: 'Thika' }, t)).toBe('From Thika');
    expect(marketWhere({ destArea: 'Mombasa' }, t)).toBe('To Mombasa');
    expect(marketWhere({}, t)).toBe('Away from any town we know');
  });

  it('counts DISTINCT bodies — the shape of demand, which a list read top to bottom never shows', () => {
    const shape = marketShape([
      { bodyDerived: { body: 'flatbed' } },
      { bodyDerived: { body: 'box' } },
      { bodyDerived: { body: 'flatbed' } },
      { bodyDerived: { body: 'flatbed' } },
    ]);
    expect(shape.total).toBe(4);
    expect(shape.bodies).toEqual([
      { body: 'flatbed', n: 3 },
      { body: 'box', n: 1 },
    ]);
  });

  it('orders equal counts stably, so two reads of one market do not disagree', () => {
    const shape = marketShape([{ bodyDerived: { body: 'tipper' } }, { bodyDerived: { body: 'box' } }]);
    expect(shape.bodies.map((b) => b.body)).toEqual(['box', 'tipper']);
  });

  it('counts a load with no derived body in the total but not against any body', () => {
    // Dropping it from the total would understate the market; inventing a body for it would misstate its shape.
    const shape = marketShape([{ bodyDerived: { body: 'flatbed' } }, {}]);
    expect(shape.total).toBe(2);
    expect(shape.bodies).toEqual([{ body: 'flatbed', n: 1 }]);
  });
});

describe('reading the market series (FB4)', () => {
  const body = (over: Partial<{ offeredLoads: number; offeredKm: number; offeredMeasured: number; movedLoads: number; movedKm: number; deadheadKm: number }> = {}) => ({
    offeredLoads: 10,
    offeredKm: 1000,
    offeredMeasured: 10,
    movedLoads: 8,
    movedKm: 800,
    deadheadKm: 200,
    ...over,
  });

  it('rounds kilometres to something a person can read off a screen and repeat', () => {
    expect(km(48213.7)).toBe((48214).toLocaleString());
    expect(km(0)).toBe('0');
    expect(km(undefined)).toBe('0');
  });

  it('says what share of the work asked for actually moved', () => {
    expect(servedPct(body({ offeredKm: 1000, movedKm: 250 }))).toBe(25);
  });

  it('refuses to compute a share of nothing', () => {
    // 0 km moved out of 0 km offered is not "0% served" — it is no market, and a zero there would invent a
    // shortfall out of an empty row.
    expect(servedPct(body({ offeredKm: 0, movedKm: 0 }))).toBeNull();
    expect(servedPct(body({ offeredKm: 0, movedKm: 40 }))).toBeNull();
  });

  it('marks a handful of loads as too few to read as a market', () => {
    // The rateBand rule applied to bodies: a median of one vehicle is not a market, and a percentage off two
    // loads says less than nothing because it looks like a measurement.
    expect(isThin(body({ offeredLoads: 1, movedLoads: 1 }))).toBe(true);
    expect(isThin(body({ offeredLoads: 3, movedLoads: 2 }))).toBe(false); // 5 is the floor
    expect(isThin(body({ offeredLoads: 10, movedLoads: 8 }))).toBe(false);
  });

  it('reports how much of the series rests on a MEASURED body rather than a guess', () => {
    expect(measuredPct({ offeredLoads: 10 }, [{ offeredMeasured: 5 }, { offeredMeasured: 2 }])).toBe(70);
    expect(measuredPct({ offeredLoads: 4 }, [{ offeredMeasured: 4 }])).toBe(100);
    // No loads, no claim to qualify.
    expect(measuredPct({ offeredLoads: 0 }, [])).toBeNull();
  });

  it('reports the empty-run share out of every kilometre TURNED, not just the loaded ones', () => {
    // 800 loaded + 200 empty = 1000 turned, of which a fifth was empty.
    expect(emptyRunPct({ movedKm: 800, deadheadKm: 200 })).toBe(20);
    expect(emptyRunPct({ movedKm: 0, deadheadKm: 0 })).toBeNull();
    // All deadhead and nothing delivered is a real, and damning, 100%.
    expect(emptyRunPct({ movedKm: 0, deadheadKm: 120 })).toBe(100);
  });
});
