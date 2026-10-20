import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * WHAT STAFF OPENED (the ISO 28000 check: "a log of what staff opened"; built without asking — the user: "continue to
 * close gaps that do not need my decision").
 *
 * Staff of SeeBuyGet read every record — a shop's papers, a person's account, a parcel's history, a hold's photographs —
 * and change nothing that is a company's own; what they did was on record, what they READ was not. Now every record a
 * member of staff opens is noted: who (their own staff account, by name — or the shared key, which is nobody), what (the
 * route and the record it names), when, and how many times in a row. Lists are not noted, only a record opened by its
 * name or number; the same record opened again within a few minutes by the same person counts once more on the same
 * line, so a screen that refreshes itself does not bury the log. Reading the log is noted too.
 */

/** The same record opened again by the same person within this long counts on the same line. */
export const STAFF_READ_WINDOW_MS = 10 * 60_000;
/** The most a page of the log shows. */
export const STAFF_READS_LIMIT = 200;

export type StaffReaderKind = 'staff' | 'key';

/** One record opened, as kept. */
export interface StaffRead {
  readId: string;
  /** When it was first opened in this run of opening it, and last. */
  at: string;
  lastAt: string;
  times: number;
  by: { kind: StaffReaderKind; name: string; staffId?: string };
  /** `GET /v1/sbg/agents/:did`. */
  route: string;
  /** The record it names: the values in the address, in order. */
  record: string;
}

export class StaffReadView {
  readId!: string;
  at!: string;
  lastAt!: string;
  times!: number;
  @ApiProperty({ enum: ['staff', 'key'] }) byKind!: StaffReaderKind;
  byName!: string;
  @ApiPropertyOptional() staffId?: string;
  route!: string;
  record!: string;
}

export class StaffReadList {
  @ApiProperty({ type: [StaffReadView] }) items!: StaffReadView[];
  /** How many lines match, of which `items` is the newest page. */
  total!: number;
}
