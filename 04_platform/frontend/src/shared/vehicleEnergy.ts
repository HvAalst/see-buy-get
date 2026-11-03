import type { components } from '../lib/sbg/schema';
import type { MessageKey, Translate } from './i18n';

/**
 * WHAT A VEHICLE RUNS ON (2026-11-03 — the owner, on ISO 14083: "go ahead"). Asked of every vehicle where it is registered,
 * because the emissions of a trip are worked out from it, and what a vehicle ran on cannot be asked of its past trips later.
 * The server decides what fits (fleet.config.ts energyMisfit): a bicycle is pedalled or electric; nothing with an engine is
 * pedalled. Here: the same rule, so a form never offers what the server refuses, and the order most usual for each class.
 *
 * The type comes off the generated schema, so the word map is COMPLETE BY COMPILATION: a seventh energy on the server stops
 * this building until somebody writes its word.
 */
export type VehicleEnergy = NonNullable<components['schemas']['Vehicle']['energy']>;

const WORD: Record<VehicleEnergy, MessageKey> = {
  petrol: 'vehicle.energy.petrol',
  diesel: 'vehicle.energy.diesel',
  electric: 'vehicle.energy.electric',
  hybrid: 'vehicle.energy.hybrid',
  gas: 'vehicle.energy.gas',
  pedal: 'vehicle.energy.pedal',
};

/** Most usual first, for East Africa's roads: a boda is petrol, a lorry diesel. Every engine is offered every fuel. */
const ORDER: Record<string, VehicleEnergy[]> = {
  bike: ['pedal', 'electric'],
  motorcycle: ['petrol', 'electric', 'hybrid', 'gas', 'diesel'],
  tuktuk: ['petrol', 'gas', 'electric', 'diesel', 'hybrid'],
  car: ['petrol', 'diesel', 'hybrid', 'electric', 'gas'],
  van: ['diesel', 'petrol', 'electric', 'hybrid', 'gas'],
  bus: ['diesel', 'electric', 'hybrid', 'gas', 'petrol'],
  truck: ['diesel', 'electric', 'gas', 'hybrid', 'petrol'],
};
const ENGINE: VehicleEnergy[] = ['petrol', 'diesel', 'electric', 'hybrid', 'gas'];

/** What a vehicle of this class can run on, most usual first. A class this build has never heard of: any engine. */
export const energiesFor = (vehicleClass: string): VehicleEnergy[] => ORDER[vehicleClass] ?? ENGINE;

/** Whether it fits the class — kept on a class change only when it does, so a "pedalled" van is never sent. */
export const energyFits = (vehicleClass: string, energy: string): energy is VehicleEnergy => energiesFor(vehicleClass).includes(energy as VehicleEnergy);

/** The word for it; an energy this build has never heard of is shown as the server says it. */
export const energyWord = (energy: string, t: Translate): string => (energy in WORD ? t(WORD[energy as VehicleEnergy]) : energy);

/** What a form says is still missing: null once it is answered. */
export const energyMissing = (vehicleClass: string, energy: string, t: Translate): string | null =>
  energyFits(vehicleClass, energy) ? null : t(vehicleClass === 'bike' ? 'vehicle.energy.missingBike' : 'vehicle.energy.missing');
