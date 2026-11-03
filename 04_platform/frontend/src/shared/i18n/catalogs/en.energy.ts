/**
 * WHAT A VEHICLE RUNS ON, IN WORDS (2026-11-03 — the owner, on ISO 14083: "go ahead"). Asked wherever a vehicle is
 * registered: the Fleet app's form, a courier's sign-up on the front door, and the Driver app's "ride for yourself".
 * Its own small catalogue so the front door adds these and nothing else of the vehicles' words (apps/home/english.ts);
 * the Driver and Fleet apps have it through en.vehicles.ts.
 */
export const enEnergy = {
  'vehicle.energy.label': 'What it runs on',
  'vehicle.energy.petrol': 'Petrol',
  'vehicle.energy.diesel': 'Diesel',
  'vehicle.energy.electric': 'Electric',
  'vehicle.energy.hybrid': 'Hybrid (petrol and electric)',
  'vehicle.energy.gas': 'Gas (autogas or natural gas)',
  'vehicle.energy.pedal': 'Pedalled',
  'vehicle.energy.hint': 'Asked of every vehicle: the emissions of a trip are worked out from what the vehicle runs on.',
  'vehicle.energy.missing': 'Say what the vehicle runs on',
  'vehicle.energy.missingBike': 'Say whether the bike is pedalled or electric',
  'vehicle.energy.notOnRecord': 'What it runs on is not on record',
  'vehicle.energy.add': 'Say what it runs on',
  'vehicle.energy.change': 'Change what it runs on',
  'vehicle.energy.save': 'Save',
  'vehicle.energy.saved': 'Saved: {plate} runs on {energy}',
  'vehicle.energy.runsOn': 'Runs on: {energy}',
  'vehicle.energy.askTitle': 'What does your {vehicle} run on?',
  'vehicle.energy.askDetail': 'Every vehicle is asked now. Tap the one that fits.',
} as const;
