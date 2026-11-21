/**
 * A VEHICLE AND THE ROAD, IN WORDS — what a vehicle is called, and a road's limits (height, weight, kind). The Driver
 * app and the Fleet app say them alike: kept under their driver.* names; the Driver app has them through its own
 * catalog (en.driver.ts), the Fleet app adds them on its own (apps/fleet/english.ts).
 */
import { enEnergy } from './en.energy';
import { enEquipment } from './en.equipment';
import { enTrailers } from './en.trailers';

export const enVehicles = {
  // 2026-11-03 — what a vehicle runs on (en.energy.ts), said alike wherever a vehicle is registered.
  ...enEnergy,
  // 2026-11-13 — loading equipment (en.equipment.ts), said alike by the Fleet and Driver apps.
  ...enEquipment,
  // 2026-11-13 — trailers (en.trailers.ts), said alike by the Driver and Fleet apps.
  ...enTrailers,
  /* WHAT THE DRIVER ACTUALLY RIDES. The class is registered against the vehicle, so the word is derived
     rather than fixed — see vehicle-words.ts. The map there is complete by compilation: an eighth class
     on the server stops this app building until somebody writes its noun. */
  'driver.vehicleWord.bike': 'bike',
  'driver.vehicleWord.motorcycle': 'motorbike',
  'driver.vehicleWord.tuktuk': 'tuk-tuk',
  'driver.vehicleWord.car': 'car',
  'driver.vehicleWord.van': 'van',
  'driver.vehicleWord.bus': 'bus',
  'driver.vehicleWord.truck': 'truck',
  /* For a class this build has never heard of. Slightly generic beats confidently wrong. */
  'driver.vehicleWord.generic': 'vehicle',
  'driver.road.metres': '{n} m',
  'driver.road.tonnes': '{n} t',
  // The eight things a driver can report, in the words they would use looking out of a windscreen.
  'driver.road.kind.LOW_BRIDGE': 'Low bridge',
  'driver.road.kind.HEIGHT_BARRIER': 'Height barrier',
  'driver.road.kind.WEIGHT_LIMIT': 'Weight limit',
  'driver.road.kind.NO_HAZMAT': 'No dangerous goods',
  'driver.road.kind.WASHOUT': 'Road washed out',
  'driver.road.kind.WEIGHBRIDGE': 'Weighbridge',
  'driver.road.kind.FERRY': 'Ferry',
  'driver.road.kind.CHECKPOINT': 'Checkpoint',
  'driver.road.kind.ROAD_CLOSED': 'Road closed',
  'driver.road.kind.BORDER_CLOSED': 'Border closed',
  'plate.claim.ask': 'I bought {plate}: ask its owner',
  'plate.claim.askHint': 'Its owner is asked in the app whether they sold it. You are not told who they are.',
  'plate.claim.askedTitle': 'The owner of {plate} is asked',
  'plate.claim.askedDetail': 'You hear here when they answer. If they do not within {days, plural, one {# day} other {# days}}, SeeBuyGet staff look at it.',
  'plate.claim.soldTitle': 'Did you sell {plate}?',
  'plate.claim.soldDetail': '{name} says they bought it. If you sold it, take it off your vehicles: what it did stays on its record. Not answered in {days, plural, one {# day} other {# days}}, SeeBuyGet staff look at it.',
  'plate.claim.yesSold': 'Yes, I sold it: take it off',
  'plate.claim.stillMine': 'No, it is still mine',
  'plate.claim.askedListTitle': 'Plates you asked about',
  'plate.claim.state.asked': 'Its owner is asked, until {day}',
  'plate.claim.state.lapsed': 'Not answered: SeeBuyGet staff look at it',
  'plate.claim.state.free': 'Free: add it now',
  'plate.claim.state.kept': 'Its owner says it is still theirs: ask the help centre, with the registration papers in your name',
  'plate.claim.state.left': 'SeeBuyGet staff left it where it is:',
};
