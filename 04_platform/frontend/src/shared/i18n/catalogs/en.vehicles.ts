/**
 * A VEHICLE AND THE ROAD, IN WORDS — what a vehicle is called, and a road's limits (height, weight, kind). The Driver
 * app and the Fleet app say them alike: kept under their driver.* names; the Driver app has them through its own
 * catalog (en.driver.ts), the Fleet app adds them on its own (apps/fleet/english.ts).
 */
export const enVehicles = {
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
};
