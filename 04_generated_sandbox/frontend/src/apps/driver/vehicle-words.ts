import type { MessageKey } from '../../shared/i18n';
import type { components } from '../../lib/sbg/schema';

/**
 * THE APP CALLS THE VEHICLE WHAT THE DRIVER ACTUALLY RIDES.
 *
 * The home tab said "My van" to everybody. A bicycle courier has no van, and an app that insists otherwise
 * is telling them, gently and constantly, that it was built for somebody else. (The user, 2026-09-24:
 * *"hope bikers have a 'My bike' page so the app takes what is registered and names that throughout."*)
 *
 * The class is already registered against the vehicle, so the word is DERIVED rather than configured —
 * nothing to keep in step, and a fleet driver who takes a truck one morning and a van the next gets the
 * right word both mornings without anybody setting anything.
 *
 * The type comes off the generated schema, so this map is COMPLETE BY COMPILATION: add an eighth class on
 * the server, regenerate, and this file stops building until somebody writes the word for it. That is the
 * repo's "read the enum, never restate it" rule in the one shape a label map can honour it — a hand-listed
 * copy would simply have gone quietly wrong.
 */
export type VehicleClass = components['schemas']['CarriedBody']['vehicleClass'];

const NOUNS: Record<VehicleClass, MessageKey> = {
  bike: 'driver.vehicleWord.bike',
  motorcycle: 'driver.vehicleWord.motorcycle',
  tuktuk: 'driver.vehicleWord.tuktuk',
  car: 'driver.vehicleWord.car',
  van: 'driver.vehicleWord.van',
  bus: 'driver.vehicleWord.bus',
  truck: 'driver.vehicleWord.truck',
};

/**
 * WHERE THE COUPLING STICKER GOES, which is the trap the user spotted before it was built.
 *
 * "Put it on the dashboard, where it can be scanned from the driver's seat" is good instruction in a truck
 * and nonsense on a bicycle, which has neither. Wrong here is worse than vague: a courier reads it, finds
 * no dashboard, and concludes the sticker is not for them.
 *
 * Two answers, because there are only two real cases — a cab with a windscreen in front of the driver, and
 * a frame you stick it to. Anything ridden rather than driven gets the frame.
 */
const RIDDEN: ReadonlySet<VehicleClass> = new Set<VehicleClass>(['bike', 'motorcycle']);

/**
 * The noun for a registered class: "van", "bike", "truck".
 *
 * Falls back to a plain "vehicle" for a class this build has never heard of — a phone running last month's
 * bundle against a server that has learned an eighth class should say something slightly generic, never
 * `undefined` and never the wrong word.
 */
export function vehicleWord(vehicleClass: string | undefined, t: (key: MessageKey) => string): string {
  const key = NOUNS[vehicleClass as VehicleClass];
  return key ? t(key) : t('driver.vehicleWord.generic');
}

/** Where its sticker lives — "dashboard" for anything with a cab, "frame" for anything ridden. */
export function stickerPlace(vehicleClass: string | undefined, t: (key: MessageKey) => string): string {
  return RIDDEN.has(vehicleClass as VehicleClass) ? t('driver.stickerPlace.frame') : t('driver.stickerPlace.dashboard');
}

/** Whether this class is ridden rather than driven — the two cases the sticker copy has to tell apart. */
export function isRidden(vehicleClass: string | undefined): boolean {
  return RIDDEN.has(vehicleClass as VehicleClass);
}

/**
 * WHICH VEHICLE THE APP IS NAMED AFTER, which has to hold before the shift starts.
 *
 * On shift it is simply the one they coupled to this morning. Off shift there is no coupling, and the tab
 * still has to say something — so it falls to what they have driven, most recent first, which for an
 * owner-courier is the one vehicle they registered and for a fleet driver is the one they had yesterday.
 *
 * Undefined when a brand-new driver has neither, and every caller falls back to the plain noun. A first
 * morning reading "My vehicle" is honest; guessing "van" at somebody on a bicycle is what this replaces.
 */
export function namedVehicleClass(
  coupled: { vehicleClass?: string } | null | undefined,
  driven: readonly { vehicleClass?: string }[],
): string | undefined {
  return coupled?.vehicleClass ?? driven[0]?.vehicleClass;
}
