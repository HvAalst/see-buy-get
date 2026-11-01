import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { airlineOfPrefix, awbDigits, awbProblem, formatAwb } from '../../foundation/carriage-law/air';
import { GlosError } from '../../foundation/http/glos-error';

/**
 * 2026-11-01 — A TRUCK RUN AS A FLIGHT (a road feeder service): an airline's cargo moved by road under its air waybill and
 * a flight number. Which law then governs — the air convention (MC99 Art. 18(4)) or the road's — courts answer differently
 * (legal.html L38). The owner chose (2026-11-01): carry it as an ordinary road load under the law of the road, the waybill
 * and the flight a reference only, said so to both sides and on the consignment note. Nobody on SeeBuyGet acts for the airline.
 */
export class FreightTruckFlight {
  @ApiProperty() awb: string;
  @ApiProperty() flight: string;
  @ApiProperty() airline: string;
}

export class TruckFlightDto {
  @IsString() @MaxLength(20) awb!: string;
  @Matches(/^\s*[A-Z0-9]{2}\s?\d{1,4}[A-Z]?\s*$/i, { message: 'A flight is the airline’s two-character code and its number, like KQ 9301' }) flight!: string;
  /** The airline's name, where its prefix is not one we hold. */
  @IsOptional() @IsString() @MaxLength(80) airline?: string;
}

/** The truck flight as given, checked: the waybill's number and its check digit, the flight, and whose airline it is. */
export function truckFlightOf(input: { awb?: string; flight?: string; airline?: string }): FreightTruckFlight {
  const problem = awbProblem(input.awb ?? '');
  if (problem === 'format') throw new GlosError('VALIDATION_FAILED', 'An air waybill number is eleven digits: the airline’s three, and eight more — like 706-12345675', { field: 'truckFlight.awb' });
  if (problem === 'check_digit') throw new GlosError('VALIDATION_FAILED', 'That air waybill number’s last digit does not check: look at the number again', { field: 'truckFlight.awb' });
  const digits = awbDigits(input.awb ?? '');
  const airline = airlineOfPrefix(digits.slice(0, 3))?.name ?? input.airline?.trim();
  if (!airline) throw new GlosError('FIELD_REQUIRED', `We do not hold the airline for prefix ${digits.slice(0, 3)}: say which airline it is`, { field: 'truckFlight.airline' });
  const flight = (input.flight ?? '').replace(/\s+/g, ' ').trim().toUpperCase();
  if (!/^[A-Z0-9]{2} ?\d{1,4}[A-Z]?$/.test(flight)) throw new GlosError('VALIDATION_FAILED', 'A flight is the airline’s two-character code and its number, like KQ 9301', { field: 'truckFlight.flight' });
  return { awb: formatAwb(digits), flight, airline: airline.slice(0, 80) };
}

/** What everybody is told about a truck flight — the poster, the driver, the note. */
export function truckFlightWords(t: FreightTruckFlight): string {
  return `Moved for ${t.airline} under air waybill ${t.awb}, flight ${t.flight}: carried as a road load under the law of the road. The air waybill is a reference only, and nobody on SeeBuyGet acts for the airline.`;
}

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

/**
 * 2026-11-01 — A LOAD BIGGER THAN THE LOAD SPACE THE FLEET DECLARED does not fit, whatever it weighs: light, bulky cargo fills
 * a body before it weighs it down. Undefined: it fits, or one of the two figures is not known (said apart, never guessed).
 */
export function volumeRefusal(loadM3: number | undefined, vehicle: { volumeM3?: number } | null | undefined): string | undefined {
  if (!loadM3 || !vehicle?.volumeM3 || loadM3 <= vehicle.volumeM3) return undefined;
  const over = Math.round((loadM3 - vehicle.volumeM3) * 10) / 10;
  return `The load takes ${loadM3} m³ — ${over} m³ more than your vehicle’s load space of ${vehicle.volumeM3} m³`;
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
