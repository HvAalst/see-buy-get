import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { FiscalCodeCard } from './dispatch.types';

/** What one thing aboard is: a load, a bag of parcels, a booking on a run, or a parcel a shop handed the driver loose. */
export type AboardKind = 'freight' | 'bag' | 'booking' | 'parcel';

/** Why a manifest line wants a look (the owner's brief, feature 3). Romania's two only on a load taken over or delivered there. */
export type ManifestFlag = 'missing_code' | 'over_500kg' | 'over_ron_10000' | 'code_expiring' | 'code_expired';
export const MANIFEST_FLAGS: readonly ManifestFlag[] = ['missing_code', 'over_500kg', 'over_ron_10000', 'code_expiring', 'code_expired'];

/** A crossing a load on the vehicle passed, as its driver said it on the road. */
export class ManifestCrossing {
  @ApiProperty() freightCode: string;
  @ApiProperty({ description: 'at_border, cleared, …: the load passage kind' }) kind: string;
  @ApiPropertyOptional() post?: string;
  @ApiPropertyOptional() from?: string;
  @ApiPropertyOptional() to?: string;
  @ApiProperty() at: string;
}

/** A money amount as declared, in its own currency. */
export class ManifestAmount {
  @ApiProperty() amount: number;
  @ApiProperty() currency: string;
}

/** One line of the manifest. */
export class ManifestItem {
  @ApiProperty({ enum: ['freight', 'bag', 'booking', 'parcel'] }) kind: AboardKind;
  /** The load's id, the bag's code, the booking's id or the parcel's id. */
  @ApiProperty() ref: string;
  /** What a person reads: the load's or bag's code, the booking's description, the parcel's id. */
  @ApiProperty() label: string;
  @ApiProperty({ enum: ['aboard', 'to_collect'] }) state: 'aboard' | 'to_collect';
  @ApiPropertyOptional() from?: string;
  @ApiPropertyOptional() to?: string;
  @ApiPropertyOptional() pickupCountry?: string;
  @ApiPropertyOptional() destCountry?: string;
  @ApiProperty() weightKg: number;
  @ApiPropertyOptional() parcels?: number;
  @ApiPropertyOptional({ type: ManifestAmount }) declaredValue?: ManifestAmount;
  /** The declared value in lei, where the day's rate is known: Romania's threshold is RON 10,000. */
  @ApiPropertyOptional() valueRon?: number;
  @ApiPropertyOptional({ type: [FiscalCodeCard] }) fiscalCodes?: FiscalCodeCard[];
  @ApiProperty({ enum: MANIFEST_FLAGS, isArray: true }) flags: ManifestFlag[];
}

/**
 * 2026-11-24 — EVERYTHING ABOARD ONE VEHICLE (the owner's brief, feature 3: "a Master Manifest / Consolidated Run view grouping
 * all shipments assigned to a vehicle/driver"): its plates and driver, each thing aboard or still to collect, the totals, the
 * crossings passed, and what wants a look first.
 */
export class VehicleManifest {
  /** The run's own id: the vehicle and the start of the shift it is on. */
  @ApiProperty() manifestId: string;
  @ApiProperty() vehicleId: string;
  @ApiProperty() truckPlate: string;
  @ApiPropertyOptional() trailerPlate?: string;
  @ApiProperty() driverDid: string;
  @ApiPropertyOptional() driverName?: string;
  @ApiPropertyOptional() fleetDid?: string;
  @ApiProperty() shiftStartedAt: string;
  @ApiProperty({ type: [ManifestItem] }) items: ManifestItem[];
  @ApiProperty() totalWeightKg: number;
  @ApiProperty({ type: [ManifestAmount] }) totalValue: ManifestAmount[];
  /** The declared values together in lei, where every one has a rate; absent where any has none. */
  @ApiPropertyOptional() totalValueRon?: number;
  @ApiProperty() flagged: number;
  @ApiProperty({ type: [ManifestCrossing] }) crossings: ManifestCrossing[];
  @ApiProperty() at: string;
}
