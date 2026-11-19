import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsNumber, IsOptional, IsString, Matches, MaxLength, Min, MinLength } from 'class-validator';

/*
 * 2026-11-18 — PARCELS ACROSS A BORDER, STEP 1: THE ROUTES ON THE CONSOLE (the plan "Parcels across a border: the traveller
 * and the customs hold", D1–D9 "As recommended"; the owner on D1: "staff can block and open airports of a single country
 * (for example Schiphol yes, Maastricht airport block)"; and on the plan: "an agreement with customs at each arrival
 * airport names the warehouse where a parcel is held … to hold the temporary storage (TST) licence").
 *
 * A ROUTE is one country pair in one direction: off, waiting for a second person, or on. What it needs at the ARRIVAL end
 * belongs to that country and serves every route into it: which of its airports are open, the customs warehouse agreed
 * at each, who clears there, and our clearance fee there.
 */
export const BORDER_ROUTE_STATES = ['off', 'waiting', 'on'] as const;
export type BorderRouteState = (typeof BORDER_ROUTE_STATES)[number];

/** What a route needs before it may be switched on, each said by name when it is missing. */
export const BORDER_CONDITIONS = ['open-from', 'open-to', 'sells-from', 'sells-to', 'departure', 'carrier', 'price', 'clearer', 'fee', 'airport'] as const;
export type BorderCondition = (typeof BORDER_CONDITIONS)[number];

export const CLEARER_KINDS = ['agent', 'company'] as const;
export type ClearerKind = (typeof CLEARER_KINDS)[number];

export class BorderWarehouse {
  /** The hub that holds a parcel the traveller cannot take further: one of ours, in the airport's country. */
  @ApiProperty() mdpId: string;
  @ApiProperty() name: string;
  /** The customs licence for temporary storage it holds, as customs wrote it. */
  @ApiProperty() tstLicence: string;
  /** Until when that licence runs, where customs says (YYYY-MM-DD). Past it, the airport counts as having no warehouse. */
  @ApiPropertyOptional() validUntil?: string;
  /** The agreement with customs at this airport that names the warehouse: its reference. */
  @ApiProperty() agreement: string;
  @ApiProperty() by: string;
  @ApiProperty() at: string;
}

export class BorderAirport {
  /** Its three-letter code. */
  @ApiProperty() code: string;
  /** Open for parcels arriving from abroad. Blocked by default: staff open each one. */
  @ApiProperty() open: boolean;
  @ApiPropertyOptional({ type: BorderWarehouse }) warehouse?: BorderWarehouse;
  /** The warehouse's licence has run out: the airport takes no parcels until it is renewed. */
  @ApiProperty() lapsed: boolean;
}

export class BorderClearer {
  @ApiProperty({ enum: CLEARER_KINDS }) kind: ClearerKind;
  /** The clearing agent's company, or our own company in that country. */
  @ApiProperty() entityId: string;
  @ApiProperty() name: string;
  /** Our company's registration as a customs representative; absent for an agent. */
  @ApiPropertyOptional() registration?: string;
  /** When the agent accepted (its own act, on its side); our company needs none. Absent: waiting for the agent. */
  @ApiPropertyOptional() acceptedAt?: string;
  @ApiProperty() by: string;
  @ApiProperty() at: string;
}

export class BorderFee {
  @ApiProperty() amount: number;
  @ApiProperty() currency: string;
  @ApiProperty() by: string;
  @ApiProperty() at: string;
}

export class BorderOption {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
}

/** 2026-11-19 — how a receiver pays in this country (D17, D18): who collects duty on a held parcel, and how our part is paid. */
export class BorderPaymentView {
  @ApiProperty({ enum: ['agent', 'company'] }) dutyBy: 'agent' | 'company';
  @ApiProperty({ enum: ['collection', 'link'] }) ourPartBy: 'collection' | 'link';
}

export class BorderArrivalView {
  @ApiProperty() country: string;
  @ApiProperty({ type: BorderPaymentView }) payment: BorderPaymentView;
  @ApiProperty({ type: [BorderAirport] }) airports: BorderAirport[];
  @ApiPropertyOptional({ type: BorderClearer }) clearer?: BorderClearer;
  @ApiPropertyOptional({ type: BorderFee }) fee?: BorderFee;
  /** The money a fee here is in: its company's. Absent where no company of ours stands. */
  @ApiPropertyOptional() currency?: string;
  /** The hubs that may be named as a warehouse here: approved, in this country. */
  @ApiProperty({ type: [BorderOption] }) hubs: BorderOption[];
  /** The clearing agents in this country that may be named. */
  @ApiProperty({ type: [BorderOption] }) agents: BorderOption[];
}

/**
 * 2026-11-18 — STEP 2a: WHERE A ROUTE LEAVES, WHO CARRIES IT, WHAT IT COSTS (the owner: D13 "Named per route", D14 "A carrier
 * from the directory", D10 "air or road carriage uses a route price"). Set by the sending country's staff.
 */
export const ROUTE_SIZES = ['S', 'M', 'L'] as const;
export type RouteSize = (typeof ROUTE_SIZES)[number];

export class BorderDeparture {
  /** The airport in the sending country the parcels leave from. */
  @ApiProperty() airport: string;
  /** The hub of ours that hands them to the carrier there. */
  @ApiProperty() mdpId: string;
  @ApiProperty() name: string;
  @ApiProperty() by: string;
  @ApiProperty() at: string;
}

/** 2026-11-18 — D16: the airport in the arrival country the route arrives at, among the open ones. */
export class BorderArrivalAirport {
  @ApiProperty() airport: string;
  @ApiProperty() by: string;
  @ApiProperty() at: string;
}

/** 2026-11-18 — a country a counter can send a parcel to (step 2b): a route on from its own, and the airports it goes by. */
export class CounterAbroadRoute {
  @ApiProperty() to: string;
  @ApiProperty() name: string;
  @ApiProperty() departure: string;
  @ApiProperty() arrival: string;
}

export class CounterAbroadView {
  @ApiProperty({ type: [CounterAbroadRoute] }) routes: CounterAbroadRoute[];
}

/** 2026-11-18 — a stop of a route as a parcel booked on it keeps it: an airport and the hub of ours there. */
export class BookedStop {
  @ApiProperty() airport: string;
  @ApiProperty() mdpId: string;
  @ApiProperty() name: string;
}

export class BookedCarrier {
  @ApiProperty() entityId: string;
  @ApiProperty() name: string;
}

export class BookedPrices {
  @ApiProperty() S: number;
  @ApiProperty() M: number;
  @ApiProperty() L: number;
  @ApiProperty() currency: string;
}

/** 2026-11-18 — what a parcel booked on a route keeps of it (the plan, step 2b): the route as it stood when it was booked. */
export class BookedRoute {
  @ApiProperty() from: string;
  @ApiProperty() to: string;
  @ApiProperty({ type: BookedStop }) departure: BookedStop;
  @ApiProperty({ type: BookedStop }) arrival: BookedStop;
  @ApiProperty({ type: BookedCarrier }) carrier: BookedCarrier;
  @ApiProperty({ type: BookedPrices }) prices: BookedPrices;
}

export class BorderCarrier {
  /** A forwarder or haulier from the directory. */
  @ApiProperty() entityId: string;
  @ApiProperty() name: string;
  @ApiProperty() by: string;
  @ApiProperty() at: string;
}

export class BorderPrices {
  /** The international leg for a small, a medium and a large parcel, in the sending company's money. */
  @ApiProperty() S: number;
  @ApiProperty() M: number;
  @ApiProperty() L: number;
  @ApiProperty() currency: string;
  @ApiProperty() by: string;
  @ApiProperty() at: string;
}

export class BorderConditionView {
  @ApiProperty({ enum: BORDER_CONDITIONS }) key: BorderCondition;
  @ApiProperty() met: boolean;
}

export class BorderRouteView {
  @ApiProperty() from: string;
  @ApiProperty() to: string;
  @ApiProperty({ enum: BORDER_ROUTE_STATES }) state: BorderRouteState;
  @ApiPropertyOptional() proposedBy?: string;
  @ApiPropertyOptional() proposedAt?: string;
  @ApiPropertyOptional() approvedBy?: string;
  @ApiPropertyOptional() approvedAt?: string;
  /** Said per reader: the person who proposed it may not approve it. */
  @ApiProperty() mine: boolean;
  @ApiProperty({ type: [BorderConditionView] }) conditions: BorderConditionView[];
  @ApiPropertyOptional({ type: BorderDeparture }) departure?: BorderDeparture;
  @ApiPropertyOptional({ type: BorderCarrier }) carrier?: BorderCarrier;
  @ApiPropertyOptional({ type: BorderPrices }) prices?: BorderPrices;
  @ApiPropertyOptional({ type: BorderArrivalAirport }) arrival?: BorderArrivalAirport;
  /** The arrival country's airports, for naming where it arrives. */
  @ApiProperty({ type: [String] }) arrivalAirports: string[];
  /** What may be named here: the sending country's airports, its approved hubs, the forwarders and hauliers in its directory. */
  @ApiProperty({ type: [String] }) departureAirports: string[];
  @ApiProperty({ type: [BorderOption] }) departureHubs: BorderOption[];
  @ApiProperty({ type: [BorderOption] }) carriers: BorderOption[];
  /** The money its prices are in: the sending company's. Absent where none stands. */
  @ApiPropertyOptional() currency?: string;
}

export class BorderChange {
  @ApiProperty() at: string;
  @ApiProperty() by: string;
  /** What changed, in a word: propose, approve, decline, off, airport-open, airport-block, warehouse, clearer, fee. */
  @ApiProperty() what: string;
  @ApiProperty() country: string;
  @ApiPropertyOptional() to?: string;
  @ApiPropertyOptional() airport?: string;
}

export class BorderRoutesView {
  @ApiProperty({ type: [BorderRouteView] }) routes: BorderRouteView[];
  @ApiProperty({ type: [BorderArrivalView] }) arrivals: BorderArrivalView[];
  @ApiProperty({ type: [BorderChange] }) changes: BorderChange[];
}

/* ------------------------------------------------------------------ what staff send -- */

export class BorderByDto {
  /** Who is doing it, where the sign-in carries no name of its own (the shared key on a laptop). */
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) by?: string;
}

export class BorderAirportDto extends BorderByDto {
  @ApiProperty() @IsBoolean() open!: boolean;
}

export class BorderWarehouseDto extends BorderByDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(80) mdpId!: string;
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(60) tstLicence!: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) validUntil?: string;
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(80) agreement!: string;
}

export class BorderClearerDto extends BorderByDto {
  @ApiProperty({ enum: CLEARER_KINDS }) @IsIn(CLEARER_KINDS) kind!: ClearerKind;
  /** The agent's company; for our own company, left out (it is the country's). */
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) entityId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(3) @MaxLength(60) registration?: string;
}

export class BorderDepartureDto extends BorderByDto {
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(3) airport!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(80) mdpId!: string;
}

export class BorderArrivalAirportDto extends BorderByDto {
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(3) airport!: string;
}

export class BorderCarrierDto extends BorderByDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(80) entityId!: string;
}

export class BorderPricesDto extends BorderByDto {
  @ApiProperty() @IsNumber() @Min(0.01) S!: number;
  @ApiProperty() @IsNumber() @Min(0.01) M!: number;
  @ApiProperty() @IsNumber() @Min(0.01) L!: number;
}

export class BorderFeeDto extends BorderByDto {
  @ApiProperty() @IsNumber() @Min(0.01) amount!: number;
}
