import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { GlosError } from '../../foundation/http/glos-error';

/**
 * 2026-11-01 — A TRUCK'S SLOT AT AN AIRLINE'S CARGO TERMINAL. Busy sheds give a truck a time to come, booked by the
 * forwarder or the agent; a truck without one waits, or is turned away. Its window and its reference, as the shed gave
 * them — ours to tell the driver and to time the truck by, never to book.
 */
export class TerminalSlot {
  @ApiProperty() from: string;
  @ApiProperty() to: string;
  @ApiPropertyOptional() reference?: string;
}

export class TerminalSlotDto {
  @IsString() from!: string;
  @IsString() to!: string;
  @IsOptional() @IsString() @MaxLength(40) reference?: string;
}

/** The slot changed, or (clear) there is none any more. */
export class TerminalSlotChangeDto extends TerminalSlotDto {
  @IsOptional() @IsBoolean() clear?: boolean;
}

/**
 * 2026-11-01 — AIRLINE PALLETS AND CONTAINERS BUILT UP (ULDs) RIDE ON A ROLLER FLOOR (equipment ROL): it takes them on at the
 * forwarder's shed and rolls them off at the terminal's dock. On any other body they would be broken down to load and
 * built up again — the work and the risk the forwarder built them up to avoid. Undefined: this vehicle may.
 */
export function palletVehicleRefusal(units: number | undefined, vehicle: { vehicleClass?: string; equipment?: readonly string[] } | null | undefined): string | undefined {
  if (!units || !vehicle) return undefined;
  if (vehicle.vehicleClass === 'truck' && vehicle.equipment?.includes('ROL')) return undefined;
  return `${units} built-up airline ${units === 1 ? 'pallet rides' : 'pallets ride'} on a truck with a roller floor, which rolls ${units === 1 ? 'it' : 'them'} on and off at the terminal’s dock without breaking ${units === 1 ? 'it' : 'them'} down.`;
}

/** A slot is a window of at most this long. */
export const SLOT_MAX_H = 12;

/**
 * A slot as given, checked: two moments, the first before the second, a window of at most twelve hours, not over yet —
 * and, for a handing-in, ending before the airline's latest acceptance time, or the truck cannot make the flight in it.
 */
export function slotOf(input: { from?: string; to?: string; reference?: string }, now: number, notAfter?: { at: string; what: string }): TerminalSlot {
  const from = Date.parse(input.from ?? '');
  const to = Date.parse(input.to ?? '');
  if (!Number.isFinite(from) || !Number.isFinite(to)) throw new GlosError('FIELD_REQUIRED', 'Give the slot’s start and end, as the shed gave them', { field: 'slot' });
  if (!(from < to)) throw new GlosError('VALIDATION_FAILED', 'The slot must end after it starts', { field: 'slot' });
  if (to - from > SLOT_MAX_H * 3_600_000) throw new GlosError('VALIDATION_FAILED', `A slot is a window of hours, ${SLOT_MAX_H} at most — give the one the shed gave the truck`, { field: 'slot' });
  if (to <= now) throw new GlosError('VALIDATION_FAILED', 'That slot is over already: give the one the truck has now', { field: 'slot' });
  if (notAfter && to > Date.parse(notAfter.at)) throw new GlosError('VALIDATION_FAILED', `The slot ends after ${notAfter.what}: in it the truck cannot make the flight. Ask for an earlier slot`, { field: 'slot' });
  const reference = input.reference?.trim();
  return { from: new Date(from).toISOString(), to: new Date(to).toISOString(), ...(reference ? { reference: reference.slice(0, 40) } : {}) };
}

/** The slot in words: "10:00–11:00 UTC on 2026-11-02 (slot S-120)". */
export function slotWords(slot: TerminalSlot): string {
  const day = slot.from.slice(0, 10);
  const hm = (iso: string) => iso.slice(11, 16);
  const sameDay = slot.to.slice(0, 10) === day;
  return `${hm(slot.from)}–${sameDay ? hm(slot.to) : `${slot.to.slice(0, 10)} ${hm(slot.to)}`} UTC on ${day}${slot.reference ? ` (slot ${slot.reference})` : ''}`;
}
