import { ArrayMinSize, IsArray, IsBoolean, IsDateString, IsDefined, IsIn, IsNumber, IsObject, IsOptional, IsString, Matches, Max, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { DRIVER_ISSUES, DriverIssue } from './rating.service';
import { TRUCK_SUBTYPES } from './fleet.config';
import { MEDIA_KINDS, MediaKind } from './media.types';
import { CARGO_NATURES, CargoNature, EQUIPMENT, Equipment } from './cargo.types';

/** F1 — a scheduled pickup instant must be a full datetime WITH a timezone offset (Z or ±HH:MM), so the
 *  moment is unambiguous — a date-only or offset-less string would resolve to a server-timezone-dependent
 *  instant. Shared by every DTO that books a future pickup (RegisterFreightDto, BookFreightDto). */
const SCHEDULED_PICKUP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
const SCHEDULED_PICKUP_MSG = 'scheduledPickupAt must be a full datetime with a timezone offset (e.g. 2026-07-25T09:00:00Z)';

class GeoDto {
  @IsNumber() lat!: number;
  @IsNumber() lng!: number;
}

class RequirementsDto {
  @IsNumber() @Min(0) androidVersion!: number;
  @IsBoolean() reliablePower!: boolean;
  @IsString() tradingLicence!: string;
  @IsBoolean() criminalRecordClear!: boolean;
  @IsOptional() @IsBoolean() canFloatCod?: boolean;
}

export class ShelfDto {
  @IsNumber() @Min(1) rows!: number;
  @IsNumber() @Min(1) cols!: number;
  /** Labels (e.g. "Green-3") the agent designates as consolidation/bundle slots for small parcels. */
  @IsOptional() @IsArray() @IsString({ each: true }) consolidationSlots?: string[];
}

/** Move the shop's map pin (My-shop). */
export class SetLocationDto {
  @IsNumber() lat!: number;
  @IsNumber() lng!: number;
}

/** Point the shop-front photo at an uploaded media, or clear it with an empty string. */
export class ShopfrontDto {
  @IsString() mediaId!: string;
}

export class RegisterAgentDto {
  @IsString() shopName!: string;
  @IsString() zone!: string;
  /** The country the shop stands in (ISO-3166 alpha-2). Omitted = this deployment's home country. */
  @IsOptional() @IsString() country?: string;
  @IsOptional() @ValidateNested() @Type(() => GeoDto) location?: GeoDto; // map pin AND/OR physicalAddress
  @IsOptional() @IsString() physicalAddress?: string;
  @IsString() landmark!: string;
  @IsObject() openingHours!: Record<string, { open: string; close: string } | null>;
  @ValidateNested() @Type(() => ShelfDto) shelf!: ShelfDto;
  @IsString() fullName!: string;
  @IsString() nationalId!: string;
  @IsString() mobile!: string;
  @IsString() deviceImei!: string;
  @ValidateNested() @Type(() => RequirementsDto) requirements!: RequirementsDto;
  // S32c — load/unload equipment on hand at the shop (beyond manual handling, which is always assumed).
  @IsOptional() @IsArray() @IsIn(EQUIPMENT, { each: true }) equipment?: Equipment[];
}

export class SetHoursDto {
  @IsObject() openingHours!: Record<string, { open: string; close: string } | null>;
}

export class PlanJourneyDto {
  @IsOptional() @IsString() originAgentDid?: string;
  @IsString() destAgentDid!: string;
  @IsOptional() @ValidateNested() @Type(() => GeoDto) fromLocation?: GeoDto;
  @IsOptional() @IsNumber() weightKg?: number;
}

export class AssignNodeDto {
  @IsOptional() @ValidateNested() @Type(() => GeoDto) location?: GeoDto;
  @IsOptional() @IsString() zone?: string;
}

export class SubmitKycDto {
  @IsString() idCopyRef!: string;
  @IsString() tradingLicenceRef!: string;
  @IsArray() @ArrayMinSize(1) @IsString({ each: true }) shopPhotoRefs!: string[];
}

export class KycDecisionDto {
  @IsBoolean() approve!: boolean;
  @IsOptional() @IsString() by?: string;
}

export class AvailabilityDto {
  @IsBoolean() open!: boolean;
}

export class TopUpDto {
  @IsNumber() @Min(0.01) amount!: number;
  @IsOptional() @IsString() bankRef?: string;
}

export class CorridorDto {
  @IsString() name!: string;
  @IsString() originZone!: string;
  @IsString() destZone!: string;
  @IsOptional() @IsIn(['bus', 'truck']) vehicleType?: 'bus' | 'truck';
  @IsOptional() @IsString() schedule?: string;
}

export class DriverDto {
  @IsString() driverDid!: string;
  @IsString() name!: string;
  @IsString() corridorId!: string;
  @IsOptional() @IsIn(['bus', 'truck']) vehicleType?: 'bus' | 'truck';
  @IsOptional() @IsNumber() capacityKg?: number;
  @IsOptional() @IsString() badgeId?: string;
}

/** A measured parcel: length × width × height in cm. Declared here (before its first user) so the
 *  emitDecoratorMetadata reference in AcceptParcelDto's @Type resolves without a temporal-dead-zone error. */
class DimensionsDto {
  // 1 mm floor, not 1 cm — a thin item (an envelope / a letter at ~0.5 cm thick) is a valid parcel.
  @IsNumber() @Min(0.1) l!: number;
  @IsNumber() @Min(0.1) w!: number;
  @IsNumber() @Min(0.1) h!: number;
}

export class AcceptParcelDto {
  @IsOptional() @IsString() agentDid?: string; // operator-override only; normal actors are pinned to their token
  @IsString() parcelId!: string;
  /** The redesigned counter measures the parcel: dims + weight → the tier is DERIVED (like the vendor/Send
   *  mint). `size` remains for the legacy declared-tier path; at least one of {dimensionsCm+weightKg, size}
   *  should be present (the service falls back to M if truly nothing is given). */
  @IsOptional() @IsIn(['S', 'M', 'L', 'HEAVY']) size?: 'S' | 'M' | 'L' | 'HEAVY';
  @IsOptional() @ValidateNested() @Type(() => DimensionsDto) dimensionsCm?: DimensionsDto;
  @IsOptional() @IsNumber() @Min(0.01) weightKg?: number;
  @IsString() destZone!: string;
  @IsString() senderMobile!: string;
  @IsString() receiverMobile!: string;
  @IsString() dropoffPhotoRef!: string;
  @IsOptional() @IsIn(['cash', 'prepaid']) paymentMode?: 'cash' | 'prepaid';
  @IsOptional() @IsBoolean() fragile?: boolean;
  @IsOptional() @IsString() destPudoDid?: string;
  /** S30 — the commodity's primary cargo nature (default GEN). Drives the compatibility matrix. */
  @IsOptional() @IsIn(CARGO_NATURES) natureCode?: CargoNature;
}

export class HandoverDto {
  @IsOptional() @IsString() agentDid?: string; // operator-override only; normal actors are pinned to their token
  @IsString() driverBadgeId!: string;
  @IsString({ each: true }) parcelIds!: string[];
  // S25 completeness gate: a short load is refused unless the agent knowingly leaves parcels behind.
  @IsOptional() @IsBoolean() acknowledgeShortShip?: boolean;
  @IsOptional() @IsString() shortShipReason?: string;
}

/** S26 — upload one image as a base64 data URL (the client downscales + strips EXIF first). */
export class UploadMediaDto {
  @IsIn(MEDIA_KINDS) kind!: MediaKind;
  @IsString() dataUrl!: string; // data:image/jpeg;base64,…
  @IsOptional() @IsString() thumbDataUrl?: string; // a small thumbnail for the media grid
}

export class ArriveDto {
  @IsOptional() @IsString() destAgentDid?: string; // operator-override only; normal actors are pinned to their token
}

export class PickupDto {
  @IsOptional() @IsString() agentDid?: string; // operator-override only; normal actors are pinned to their token
  @IsString() otp!: string;
  @IsOptional() @IsString() deliveredPhotoRef?: string;
}

export class VoidDto {
  @IsOptional() @IsString() agentDid?: string; // operator-override only; normal actors are pinned to their token
  @IsString() voidedPhotoRef!: string;
}

export class CorridorStatusDto {
  @IsIn(['active', 'blocked']) status!: 'active' | 'blocked';
}

export class PingDto {
  @IsOptional() @IsObject() meta?: Record<string, unknown>;
}

export class RateDto {
  @IsNumber() @Min(1) stars!: number;
  @IsString() raterMobile!: string;
}

/** REP2 — an agent rates a driver on the movement leg (stars + the specific failings it witnessed). */
export class RateDriverDto {
  @IsOptional() @IsString() agentDid?: string; // operator-override only; a normal agent is pinned to its token
  @IsNumber() @Min(1) @Max(5) stars!: number;
  // @ApiPropertyOptional so the emitted contract is an ARRAY of the enum (the plugin otherwise infers a scalar).
  @IsOptional() @IsArray() @IsIn([...DRIVER_ISSUES], { each: true }) @ApiPropertyOptional({ enum: DRIVER_ISSUES, isArray: true }) issues?: DriverIssue[];
}

export class DriverPayoutDto {
  @IsString() driverId!: string;
  @IsNumber() @Min(0.01) amount!: number;
}

// S34b — an operator's manual market surge override for a zone. Give a cell key OR a lat/lng (the controller
// derives the cell); `factor` is the guaranteed market multiplier for that zone (clamped to the engine band).
export class SurgeRuleDto {
  @IsOptional() @IsString() cell?: string;
  @IsOptional() @ValidateNested() @Type(() => GeoDto) location?: GeoDto;
  @IsNumber() @Min(0.1) factor!: number;
  @IsString() reason!: string;
  @IsOptional() @IsString() by?: string;
  // A real date — a malformed expiry would otherwise become a permanent, watchtower-invisible surge.
  @IsOptional() @IsDateString() expiresAt?: string;
}

// --- inbound / e-commerce pickup-at-PUDO ---

class ShippingPolicyDto {
  @IsOptional() @IsIn(['full', 'capped']) mode?: 'full' | 'capped';
  @IsOptional() @IsNumber() @Min(0) freeOverSubtotal?: number;
  @IsOptional() @IsNumber() @Min(0) buyerContributionCap?: number;
  // S34c — the vendor's per-shipment dedicated-freight spend cap (0 = no cap).
  @IsOptional() @IsNumber() @Min(0) maxTransportSpend?: number;
}

export class RegisterVendorDto {
  @IsString() name!: string;
  @IsOptional() @IsString() callbackUrl?: string;
  @IsOptional() @IsString() secret?: string;
  @IsOptional() @ValidateNested() @Type(() => GeoDto) location?: GeoDto;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() country?: string;
  /** The store operator's phone (S20). When present, this vendor is linked to the operator's person
   *  identity so the same human can also send, receive or drive under one account — never a duplicate. */
  @IsOptional() @IsString() ownerPhone?: string;
  @IsOptional() @ValidateNested() @Type(() => ShippingPolicyDto) shippingPolicy?: ShippingPolicyDto;
}

export class VendorLoginDto {
  @IsString() vendorId!: string;
  @IsString() secret!: string;
}

export class UpdateVendorDto {
  @IsOptional() @IsString() callbackUrl?: string;
  @IsOptional() @ValidateNested() @Type(() => GeoDto) location?: GeoDto;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @ValidateNested() @Type(() => ShippingPolicyDto) shippingPolicy?: ShippingPolicyDto;
}

export class SetPriceDto {
  @IsNumber() @Min(0) price!: number;
}

/**
 * Mint a merchant API key.
 *
 * `mode` defaults to TEST, deliberately: the safe key is the one you get by not thinking about it, and a
 * live key should be a thing somebody chose.
 */
export class IssueApiKeyDto {
  @IsIn(['publishable', 'secret']) kind!: 'publishable' | 'secret';
  @IsOptional() @IsIn(['test', 'live']) mode?: 'test' | 'live';
  @IsOptional() @IsString() label?: string;
}

// --- the public shipping API (SSP): a price a buyer can see before deciding to buy ---

/** Where a shipment starts or ends, said the way somebody without a DID can say it. */
export class QuoteEndpointDto {
  /** A collection point by its public id — exact, and what a merchant's checkout already holds. */
  @IsOptional() @IsString() pointId?: string;
  /** …or where the person actually IS, in their own words: "Bole, Addis Ababa", "12 Biashara St, Kisumu". */
  @IsOptional() @IsString() address?: string;
  /** …or an area we already serve, named exactly. `country` narrows either of the two above. */
  @IsOptional() @IsString() country?: string;
  @IsOptional() @IsString() area?: string;
}

/** One line of what is in the box — what a border officer reads, from what a checkout already has. */
export class LineItemDto {
  @IsString() name!: string;
  @IsNumber() @Min(1) qty!: number;
}

export class QuoteDimsDto {
  @IsNumber() @Min(0.1) l!: number;
  @IsNumber() @Min(0.1) w!: number;
  @IsNumber() @Min(0.1) h!: number;
}

/**
 * Ask what a shipment would cost. Creates nothing.
 *
 * Give measurements when you have them — the size tier is DERIVED from them, exactly as it is at every
 * mint, so a quote and the shipment it becomes cannot disagree about how big the parcel was. `size` is the
 * fallback for a store that only knows its own tiers.
 */
export class PublicQuoteDto {
  @ValidateNested() @Type(() => QuoteEndpointDto) from!: QuoteEndpointDto;
  @ValidateNested() @Type(() => QuoteEndpointDto) to!: QuoteEndpointDto;
  @IsOptional() @ValidateNested() @Type(() => QuoteDimsDto) dimensionsCm?: QuoteDimsDto;
  @IsOptional() @IsNumber() @Min(0.01) weightKg?: number;
  @IsOptional() @IsIn(['S', 'M', 'L']) size?: 'S' | 'M' | 'L';
}

/**
 * Create a shipment from a quote. Needs a secret key; send `Idempotency-Key` to make retrying safe.
 *
 * The store is NOT named here — it is whoever the key belongs to. A merchant cannot mint against somebody
 * else's account by changing a field, because there is no field to change.
 */
export class MintShipmentDto {
  /** A price held earlier. Give this OR the four fields below — never both. */
  @IsOptional() @IsString() quoteId?: string;
  @IsOptional() @ValidateNested() @Type(() => QuoteEndpointDto) from?: QuoteEndpointDto;
  @IsOptional() @ValidateNested() @Type(() => QuoteEndpointDto) to?: QuoteEndpointDto;
  @IsOptional() @ValidateNested() @Type(() => QuoteDimsDto) dimensionsCm?: QuoteDimsDto;
  @IsOptional() @IsNumber() @Min(0.01) weightKg?: number;
  @IsOptional() @IsIn(['S', 'M', 'L']) size?: 'S' | 'M' | 'L';
  /** Somebody has to be told where to collect it. */
  @IsString() buyerMobile!: string;
  /** A photo of the contents — the baseline a damage claim is judged against. Upload it first. */
  @IsString() contentPhotoRef!: string;
  /** Your own order reference, carried through and returned on every callback. */
  @IsOptional() @IsString() externalOrderId?: string;
  /** What is in the box, and what it is worth. Required when the route crosses a border. */
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => LineItemDto) items?: LineItemDto[];
  @IsOptional() @IsNumber() @Min(0) subtotal?: number;
  @IsOptional() @IsIn(['flexible', 'locked']) routeMode?: 'flexible' | 'locked';
}

/** Push one currency's standing against the base — from a feed, or by hand when the feed is down. */
export class SetFxRateDto {
  @IsString() currency!: string;
  @IsNumber() @Min(0) perBase!: number; // how many of this currency one unit of the base buys
  @IsOptional() @IsString() source?: string;
}

/** R0 — the vendor shipment register query. All optional; params arrive as strings on the query string. */
export class VendorOrdersQueryDto {
  @IsOptional() @IsString() q?: string; // smart search: order-ref / DID / parcelId / tracking / buyer / product / zone
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() pudo?: string; // the destination PUDO (destAgentDid)
  @IsOptional() @IsString() from?: string; // ISO or YYYY-MM-DD (inclusive)
  @IsOptional() @IsString() to?: string;
  @IsOptional() @IsIn(['paid', 'unpaid']) paid?: 'paid' | 'unpaid';
  @IsOptional() @IsIn(['newest', 'oldest', 'cost_desc', 'cost_asc']) sort?: 'newest' | 'oldest' | 'cost_desc' | 'cost_asc';
  @IsOptional() @IsString() limit?: string;
  @IsOptional() @IsString() offset?: string;
}

/** R3 — the vendor bookkeeping (ledger) register query: search / type / direction / date / sort + paging. */
export class VendorLedgerQueryDto {
  @IsOptional() @IsString() q?: string; // parcel id / note / type word
  @IsOptional() @IsIn(['TOP_UP', 'BILLING', 'REBATE']) type?: 'TOP_UP' | 'BILLING' | 'REBATE';
  @IsOptional() @IsIn(['in', 'out']) direction?: 'in' | 'out';
  @IsOptional() @IsString() from?: string; // ISO or YYYY-MM-DD (inclusive)
  @IsOptional() @IsString() to?: string;
  @IsOptional() @IsIn(['newest', 'oldest', 'amount_desc', 'amount_asc']) sort?: 'newest' | 'oldest' | 'amount_desc' | 'amount_asc';
  @IsOptional() @IsString() limit?: string;
  @IsOptional() @IsString() offset?: string;
}

/** R4 — the agent parcel-history register query: search / status / role / date / sort + paging. */
export class AgentParcelsQueryDto {
  @IsOptional() @IsString() q?: string; // parcel id / DID / tracking / zone
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsIn(['origin', 'dest']) role?: 'origin' | 'dest';
  @IsOptional() @IsString() from?: string; // ISO or YYYY-MM-DD (inclusive)
  @IsOptional() @IsString() to?: string;
  @IsOptional() @IsIn(['newest', 'oldest']) sort?: 'newest' | 'oldest';
  @IsOptional() @IsString() limit?: string;
  @IsOptional() @IsString() offset?: string;
}

/** R4 — the agent earnings-ledger register query. */
export class AgentLedgerQueryDto {
  @IsOptional() @IsString() q?: string; // reference (parcel id / bank ref) or type word
  @IsOptional() @IsIn(['TOP_UP', 'FEE', 'LABOR_PAYOUT', 'REFUND']) type?: 'TOP_UP' | 'FEE' | 'LABOR_PAYOUT' | 'REFUND';
  @IsOptional() @IsIn(['in', 'out']) direction?: 'in' | 'out';
  @IsOptional() @IsString() from?: string; // ISO or YYYY-MM-DD (inclusive)
  @IsOptional() @IsString() to?: string;
  @IsOptional() @IsIn(['newest', 'oldest', 'amount_desc', 'amount_asc']) sort?: 'newest' | 'oldest' | 'amount_desc' | 'amount_asc';
  @IsOptional() @IsString() limit?: string;
  @IsOptional() @IsString() offset?: string;
}

/** R5 — the driver jobs + earnings register query (over the driver's freight hauls). */
export class DriverJobsQueryDto {
  @IsOptional() @IsString() q?: string; // job code / description / destination / tracking / order ref
  @IsOptional() @IsIn(['available', 'claimed', 'in_transit', 'delivered']) status?: 'available' | 'claimed' | 'in_transit' | 'delivered';
  @IsOptional() @IsIn(['paid', 'unpaid']) paid?: 'paid' | 'unpaid';
  @IsOptional() @IsString() from?: string; // ISO or YYYY-MM-DD (inclusive)
  @IsOptional() @IsString() to?: string;
  @IsOptional() @IsIn(['newest', 'oldest', 'earn_desc', 'earn_asc']) sort?: 'newest' | 'oldest' | 'earn_desc' | 'earn_asc';
  @IsOptional() @IsString() limit?: string;
  @IsOptional() @IsString() offset?: string;
}

class OrderItemDto {
  @IsString() name!: string;
  @IsNumber() @Min(1) qty!: number;
}


/** A buyer's checkout selection captured by the embedded node / webhook / manual entry. */
export class CheckoutDto {
  @IsString() destPudoDid!: string;
  @IsString() buyerEmail!: string;
  @IsOptional() @IsString() buyerMobile?: string;
  @IsOptional() @IsString() externalOrderId?: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => OrderItemDto) items?: OrderItemDto[];
  @IsOptional() @IsNumber() @Min(0) subtotal?: number;
  @IsOptional() @IsIn(['node', 'webhook', 'manual']) source?: 'node' | 'webhook' | 'manual';
}

export class ClassifyDto {
  @IsNumber() @Min(0.1) l!: number;
  @IsNumber() @Min(0.1) w!: number;
  @IsNumber() @Min(0.1) h!: number;
  @IsNumber() @Min(0.01) kg!: number;
}

export class InboundOrderDto {
  @IsString() vendorId!: string;
  @IsOptional() @IsString() checkoutId?: string; // pre-fill from a captured checkout handoff
  @IsOptional() @IsString() externalOrderId?: string;
  @IsString() originPudoDid!: string;
  @IsString() destPudoDid!: string;
  @IsOptional() @IsString() buyerMobile?: string;
  @IsOptional() @IsString() buyerEmail?: string;
  @IsOptional() @IsIn(['S', 'M', 'L', 'HEAVY']) size?: 'S' | 'M' | 'L' | 'HEAVY';
  @IsOptional() @ValidateNested() @Type(() => DimensionsDto) dimensionsCm?: DimensionsDto;
  @IsOptional() @IsNumber() @Min(0.01) weightKg?: number;
  @IsString() contentPhotoRef!: string;
  @IsOptional() @IsNumber() @Min(0) subtotal?: number;
  @IsOptional() @IsIn(['flexible', 'locked']) routeMode?: 'flexible' | 'locked';
  @IsOptional() @IsBoolean() fragile?: boolean;
  /** S30 — the commodity's primary cargo nature (default GEN). Drives the compatibility matrix. */
  @IsOptional() @IsIn(CARGO_NATURES) natureCode?: CargoNature;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => OrderItemDto) items?: OrderItemDto[];
}

/** PG1 — a signed-in person's in-app peer-send mint (the Send app's parcel genesis). The sender's identity
 *  comes from the TOKEN, never the body; real dims + weight are REQUIRED and the size tier is DERIVED,
 *  exactly like the vendor mint (no self-declared S/M/L/HEAVY). No routeMode: a person's send is always
 *  priced at the LOCKED (cheapest) leg — the flexible ceiling's delivery rebate rides the vendor prepaid
 *  rail, which a cash-at-counter person doesn't have, so flexible would silently overcharge them. */
export class ConsumerSendDto {
  @IsString() receiverMobile!: string;
  @IsString() originPudoDid!: string;
  @IsString() destPudoDid!: string;
  @ValidateNested() @Type(() => DimensionsDto) dimensionsCm!: DimensionsDto;
  @IsNumber() @Min(0.01) weightKg!: number;
  @IsOptional() @IsBoolean() fragile?: boolean;
  @IsOptional() @IsIn(CARGO_NATURES) natureCode?: CargoNature;
  /** The locked total the sender consented to at the quote step. If the market moved before mint, the
   *  server rejects with PRICE_CHANGED (carrying the fresh total) so the app can re-confirm — never
   *  silently bill a different amount than the one shown. */
  @IsOptional() @IsNumber() @Min(0) expectedTotal?: number;
}

export class IntakeDto {
  @IsOptional() @IsString() agentDid?: string; // operator-override only; normal actors are pinned to their token
  /** PG2 — required when the scanned parcel is a person's pre-minted peer send (walk-up parity: the
   *  drop-off photo is the fraud defence, taken at the counter). Ignored for a vendor inbound. */
  @IsOptional() @IsString() dropoffPhotoRef?: string;
}

export class ShelveDto {
  @IsOptional() @IsString() agentDid?: string; // operator-override only; normal actors are pinned to their token
  @IsOptional() @IsString() binId?: string;
}

export class CollectDto {
  @IsOptional() @IsString() agentDid?: string; // operator-override only; normal actors are pinned to their token
  @IsString() collectionCode!: string;
}

/** Open a bag at a shop. With a destZone it is addressed at the same time; without, it is a bare tote. */
export class OpenBagDto {
  @IsOptional() @IsString() destZone?: string;
}

/** Seal a shop's bag. Leaving a waiting parcel out of it must be deliberate, exactly as at handover. */
export class SealBagDto {
  @IsOptional() @IsBoolean() acknowledgeShortShip?: boolean;
  @IsOptional() @IsString() shortShipReason?: string;
}

/** A sister's own margin, as a fraction (0.02 = 2%). Bounds are enforced in the service. */
export class EntityFeeDto {
  @IsNumber() feePct!: number;
}

/** Control-tower reissue of a burned release secret; `by` names the human behind the operator token. */
export class ReissueReleaseDto {
  @IsOptional() @IsString() by?: string;
}

export class DisputeDto {
  @IsOptional() @IsString() agentDid?: string; // operator-override only; normal actors are pinned to their token
  @IsString() reason!: string;
  @IsString() photoProofRef!: string;
}

// --- MDP hubs + tote-bag sorting ---

export class RegisterMdpDto {
  @IsString() name!: string;
  @IsArray() @ArrayMinSize(1) @IsString({ each: true }) zones!: string[];
  /** The country the hub stands in. A hub may serve zones across a border; it stands in one country. */
  @IsOptional() @IsString() country?: string;
  @ValidateNested() @Type(() => GeoDto) location!: GeoDto;
}

export class AssignToteDto {
  @IsString() destinationNodeId!: string;
  @IsString() destinationLabel!: string;
}

export class FillToteDto {
  @IsString() parcelId!: string;
}

export class LoadBagDto {
  @IsString() driverBadgeId!: string;
}

export class DropBagDto {
  @IsString() code!: string;
}

export class ReceiveBagDto {
  @IsString() code!: string;
}

export class CancelParcelDto {
  @IsOptional() @IsString() by?: string;
  @IsOptional() @IsString() reason?: string;
}

export class SortParcelDto {
  @IsString() parcelId!: string;
}

// --- fleet manager onboarding (Ch 19) ---

class FleetManagerRequirementsDto {
  @IsString() businessRegistrationNo!: string;
  @IsString() transportOperatorLicence!: string;
  @IsString() taxId!: string;
  @IsOptional() @IsNumber() declaredFleetSize?: number;
}

export class RegisterFleetManagerDto {
  @IsString() companyName!: string;
  /** Country of incorporation (ISO-3166-alpha-2) — the sister that contracts and pays this fleet. */
  @IsOptional() @IsString() jurisdiction?: string;
  @IsOptional() @IsString() tradingName?: string;
  @IsString() contactPhone!: string;
  @IsOptional() @IsString() contactEmail?: string;
  @IsString() ownerFullName!: string;
  @IsString() ownerNationalId!: string;
  @IsOptional() @IsString() depotAddress?: string;
  @IsOptional() @ValidateNested() @Type(() => GeoDto) location?: GeoDto;
  @ValidateNested() @Type(() => FleetManagerRequirementsDto) requirements!: FleetManagerRequirementsDto;
}

export class ManagerKycDto {
  @IsString() businessRegCertRef!: string;
  @IsString() operatorLicenceRef!: string;
  @IsString() ownerIdRef!: string;
  @IsString() proofOfAddressRef!: string;
}

export class ManagerKycDecisionDto {
  @IsBoolean() approve!: boolean;
  @IsOptional() @IsString() by?: string;
}

export class ManagerLoginDto {
  @IsString() code!: string;
}

// --- participant accounts (sign in / sign up) ---

export class SignupDto {
  @IsIn(['pudo', 'driver', 'mdp']) role!: 'pudo' | 'driver' | 'mdp';
  @IsString() email!: string;
  @IsString() password!: string;
  @IsString() phone!: string;
  @IsObject() profile!: Record<string, unknown>;
}

export class PhoneRequestDto {
  @IsString() phone!: string;
}

export class PhoneVerifyDto {
  @IsString() phone!: string;
  @IsString() code!: string;
}

export class LoginDto {
  @IsString() email!: string;
  @IsString() password!: string;
}

export class ForgotDto {
  @IsString() email!: string;
}

export class ResetDto {
  @IsString() token!: string;
  @IsString() password!: string;
}

// --- person identity (S20): one person, one account, many roles ---

const PERSON_ROLES = ['consumer', 'driver', 'agent', 'mdp', 'fleet_manager', 'vendor'] as const;

/** Enroll (or return) the consumer for an OTP-verified phone; optionally set the 4-digit PIN in one step. */
export class EnrollDto {
  @IsString() phone!: string;
  @IsOptional() @IsString() pin?: string;
  /** S24: if the person arrived via an invite link, credit the inviter on first join. */
  @IsOptional() @IsString() inviteToken?: string;
}

/** Create (or return) the person's reusable invite link (S24) — channels = how it was shared. No phone:
 *  the invite holds no invitee number, so it can never become a membership probe. */
export class CreateInviteDto {
  @IsOptional() @IsArray() @IsString({ each: true }) channels?: string[];
}

/** Reopen the app: phone + 4-digit PIN, no OTP. */
export class PinLoginDto {
  @IsString() phone!: string;
  @IsString() pin!: string;
}

/** Set or change the signed-in person's 4-digit PIN. */
export class SetPinDto {
  @IsString() pin!: string;
}

/** Role switch — "act as" one of the roles the person holds. */
export class SwitchRoleDto {
  @IsIn(PERSON_ROLES) role!: (typeof PERSON_ROLES)[number];
}

/** Set the person's self-managed profile (S29): a display name and/or an already-uploaded avatar mediaId.
 *  Both optional and independent — send only the field that changed. */
export class ProfileDto {
  @IsOptional() @IsString() displayName?: string;
  @IsOptional() @IsString() avatarMediaId?: string;
}

/** The receiver's delivered-state proof photo (S23). */
export class PodDto {
  @IsString() photoRef!: string;
}

/** The receiver files a delivery dispute from their app (S23): reason + delivered-state photo. */
export class BuyerDisputeDto {
  @IsString() reason!: string;
  @IsString() photoRef!: string;
}

// --- drivers + fleet (Ch 19) ---

const VEHICLE_CLASSES = ['bike', 'motorcycle', 'tuktuk', 'car', 'van', 'bus', 'truck'] as const;
type VClass = (typeof VEHICLE_CLASSES)[number];

class VehicleDocumentsDto {
  @IsOptional() @IsString() registrationPhotoRef?: string;
  @IsOptional() @IsString() factoryId?: string;
  @IsOptional() @IsString() insuranceRef?: string;
  @IsOptional() @IsString() insuranceExpiresAt?: string;
}

export class RegisterVehicleDto {
  @IsString() plate!: string;
  @IsIn(VEHICLE_CLASSES) vehicleClass!: VClass;
  @IsOptional() @IsIn(TRUCK_SUBTYPES) truckSubtype?: string;
  @IsOptional() @IsNumber() @Min(1) capacityKg?: number;
  @IsOptional() @IsIn(['driver_owned', 'fleet_owned', 'third_party']) ownerType?: string;
  @IsString() ownerName!: string;
  @IsOptional() @ValidateNested() @Type(() => VehicleDocumentsDto) documents?: VehicleDocumentsDto;
  // S26 — mediaIds of the owner's uploaded vehicle-body and trailer photos.
  @IsOptional() @IsArray() @IsString({ each: true }) vehiclePhotoRefs?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) trailerPhotoRefs?: string[];
  @IsOptional() @IsString() managerDid?: string;
  // S32 — declared load/unload equipment beyond the subtype baseline (a tail-lift, a pallet jack, straps).
  @IsOptional() @IsArray() @IsIn(EQUIPMENT, { each: true }) equipment?: Equipment[];
  // S34 — the dynamic-pricing profile (defaults per class if unset): flag-down fee + the multiplier corridor.
  @IsOptional() @IsNumber() @Min(0) baseFee?: number;
  @IsOptional() @IsNumber() @Min(0.1) minMultiplier?: number;
  @IsOptional() @IsNumber() @Min(0.1) maxMultiplier?: number;
}

export class VehicleDocsDto {
  @IsOptional() @IsString() registrationPhotoRef?: string;
  @IsOptional() @IsString() factoryId?: string;
  @IsOptional() @IsString() insuranceRef?: string;
  @IsOptional() @IsString() insuranceExpiresAt?: string;
}

export class RegisterDriverDto {
  @IsString() displayName!: string;
  @IsString() fullName!: string;
  @IsString() nationalId!: string;
  @IsString() mobile!: string;
  @IsArray() @ArrayMinSize(1) @IsIn(VEHICLE_CLASSES, { each: true }) licenceClasses!: VClass[];
  @IsOptional() @IsString() licenceNumber?: string;
  @IsOptional() @IsString() licenceExpiresAt?: string;
  @IsOptional() @IsBoolean() criminalRecordClear?: boolean;
  @IsOptional() @IsString() homeZone?: string;
  @IsOptional() @IsString() managerDid?: string;
  /** Legal residence (ISO-3166-alpha-2) — for an INDEPENDENT courier, who the network pays directly.
   *  Ignored when managerDid is set: the fleet is paid, and its drivers are the fleet's business. */
  @IsOptional() @IsString() jurisdiction?: string;
}

export class DriverKycDto {
  @IsString() idCopyRef!: string;
  @IsString() licenceCopyRef!: string;
}

export class DriverKycDecisionDto {
  @IsBoolean() approve!: boolean;
  @IsOptional() @IsString() by?: string;
}

/** The road a driver says they are running this shift — both ends named AND pinned (see DeclaredLeg). */
export class DeclareLegDto {
  @IsString() fromLabel!: string;
  @ValidateNested() @Type(() => GeoDto) from!: GeoDto;
  @IsString() toLabel!: string;
  @ValidateNested() @Type(() => GeoDto) to!: GeoDto;
}

/** A vendor's own dock: where a driver comes to collect, and how many bags can wait there. */
export class CollectionPointDto {
  @IsString() label!: string;
  @IsString() zone!: string;
  /** The country the dock stands in. Omitted = the store's own — a warehouse abroad says so. */
  @IsOptional() @IsString() country?: string;
  @ValidateNested() @Type(() => GeoDto) location!: GeoDto;
  @IsOptional() @IsNumber() @Min(1) bays?: number;
}

/** Open a bag on the dock for one destination zone. */
export class OpenDockBagDto {
  @IsString() destZone!: string;
}

/** Hold new offers. Omitted `minutes` = until the driver resumes (bounded by the shift either way). */
export class SnoozeDto {
  @IsOptional() @IsNumber() @Min(1) minutes?: number;
}

/** "I work within this many km of me" — the patch a rider declares instead of a road. */
export class DeclareAreaDto {
  @IsNumber() @Min(1) radiusKm!: number;
}

/** Find work around a point: where I am, how far I will go, and my own earning floor. */
export class SuggestNearbyDto {
  @ValidateNested() @Type(() => GeoDto) at!: GeoDto;
  @IsNumber() @Min(1) radiusKm!: number;
  @IsOptional() @IsNumber() @Min(0) minEarn?: number;
}

export class CoupleDto {
  @IsString() vehicleId!: string;
  @IsOptional() @IsString() corridorId?: string;
  /** Where they are going. Optional: a driver may couple first and say afterwards. */
  @IsOptional() @ValidateNested() @Type(() => DeclareLegDto) leg?: DeclareLegDto;
}

/** The one-shot capability from a push notification's "Not now" — see DispatchService.mintDeclineToken. */
export class DeclineOfferDto {
  @IsString() token!: string;
}

/** How many outbound bags a shop can stage on its floor at once. */
export class BagBaysDto {
  @IsNumber() @Min(1) bays!: number;
}

export class AssignCorridorDto {
  @IsString() corridorId!: string;
}

/**
 * Start the day. Either scan the dashboard QR (a NEW vehicle, or one you are standing at) or name a vehicle
 * you have driven before — a driver opens the app over a coffee, not at the bus. One of the two is required.
 */
export class StartSessionDto {
  @IsOptional() @IsString() vehicleQr?: string;
  @IsOptional() @IsString() vehicleId?: string;
  /** The leg for this shift, declared in the same breath as picking the vehicle. */
  @IsOptional() @ValidateNested() @Type(() => DeclareLegDto) leg?: DeclareLegDto;
}

export class LocateDto {
  @IsNumber() lat!: number;
  @IsNumber() lng!: number;
}

// --- dispatch marketplace (Ch 19) ---

export class SuggestRouteDto {
  @ValidateNested() @Type(() => GeoDto) from!: GeoDto;
  @ValidateNested() @Type(() => GeoDto) to!: GeoDto;
  @IsOptional() @IsString() departAt?: string;
  // S34c — the driver's minimum freight earning: hide freight offers paying less than this (their own filter).
  @IsOptional() @IsNumber() @Min(0) minEarn?: number;
}

export class RegisterFreightDto {
  @IsString() description!: string;
  @ValidateNested() @Type(() => GeoDto) pickupLocation!: GeoDto;
  @IsString() pickupLabel!: string;
  @IsString() destLabel!: string;
  @IsOptional() @ValidateNested() @Type(() => GeoDto) destLocation?: GeoDto;
  @IsNumber() @Min(1) weightKg!: number;
  @IsOptional() @IsBoolean() fragile?: boolean;
  @IsOptional() @IsBoolean() bulk?: boolean;
  /** S32 — the freight's primary cargo nature (default GEN); drives the required vehicle capability. */
  @IsOptional() @IsIn(CARGO_NATURES) natureCode?: CargoNature;
  /** F1 — a FUTURE pickup date: the load is booked for later. Must be a full datetime WITH an offset (Z or
   *  ±HH:MM) so the instant is unambiguous — a date-only or offset-less string would resolve to a server-
   *  timezone-dependent moment. Absent = ship now. */
  @IsOptional() @Matches(SCHEDULED_PICKUP_RE, { message: SCHEDULED_PICKUP_MSG }) scheduledPickupAt?: string;
  /** F1 — the shipper's early-claim choice for a scheduled load: true (default) → a driver may RESERVE it
   *  ahead of its pickup date; false → it stays out of the marketplace until due. */
  @IsOptional() @IsBoolean() allowEarlyClaim?: boolean;
}

/** F2 — the PUDO counter books a too-big (dedicated, P4+) walk-up as FREIGHT instead of refusing it. The
 *  agent measures the load, picks a destination PUDO, and sets a CASH budget cap (the most the walk-in
 *  customer will pay — dispatch won't let a driver claim above it). Immediate or planned pickup (reusing the
 *  F1 scheduled fields). A phone-less customer just carries the printed tracking code. */
export class BookFreightDto {
  @IsOptional() @IsString() agentDid?: string; // operator-override only; a normal agent is pinned to its token
  // @IsDefined() — @ValidateNested alone short-circuits on an omitted field, so a required nested object needs an
  // explicit presence guard, else a missing dims 500s in the controller instead of returning a clean 400.
  @IsDefined() @ValidateNested() @Type(() => DimensionsDto) dimensionsCm!: DimensionsDto; // freight is always measured (no declared tier)
  @IsNumber() @Min(0.01) weightKg!: number;
  @IsOptional() @IsIn(CARGO_NATURES) natureCode?: CargoNature;
  @IsOptional() @IsBoolean() fragile?: boolean;
  @IsString() destPudoDid!: string; // a network PUDO — its coordinates + equipment drive routing, pricing and the site-gap advisory
  @IsOptional() @IsString() customerMobile?: string; // optional — the walk-in customer's phone (joins it to their "my shipments")
  @IsNumber() @Min(0.01) budgetCap!: number; // the cash cap the customer prepays → the freight's maxSpend ceiling
  @IsOptional() @Matches(SCHEDULED_PICKUP_RE, { message: SCHEDULED_PICKUP_MSG }) scheduledPickupAt?: string; // absent = ship now; present = planned
  @IsOptional() @IsBoolean() allowEarlyClaim?: boolean; // planned only: may a driver reserve it before the date (default true)
}

/** S32b — a driver advancing a claimed freight (pickup/deliver). driverDid is the claimer, verified against
 *  the freight's claimedBy so only the driver who claimed it may advance it.
 *  S33 — plus the safety gate: `confirmed` are the checklist item keys the driver ticked (load at pickup,
 *  unload at delivery) and `securementPhotoId` the uploaded mediaId of the secured load (pickup only). */
export class FreightActionDto {
  @IsOptional() @IsString() driverDid?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) confirmed?: string[];
  @IsOptional() @IsString() securementPhotoId?: string;
}

/** F3 — a cooperative opens a consolidation lot for a durable dry commodity. The owner's site (the freight's
 *  pickup) is resolved from the owner agent, not the body; dest is where the truckload goes. */
export class OpenConsignmentDto {
  @IsOptional() @IsString() ownerDid?: string; // operator-override only; a normal owner is pinned to its token
  @IsOptional() @IsIn(CARGO_NATURES) natureCode?: CargoNature; // must be durable (non-perishable) — the service refuses cold-chain
  /** Where the lot is actually collected. A cooperative aggregates where the crop is — a shed, a yard, a
   *  farm gate — which is often nowhere near the PUDO counter that owns the lot. Omitted → the owner's site. */
  @IsOptional() @IsString() pickupLabel?: string;
  @IsOptional() @ValidateNested() @Type(() => GeoDto) pickupLocation?: GeoDto;
  @IsString() destLabel!: string;
  @IsOptional() @ValidateNested() @Type(() => GeoDto) destLocation?: GeoDto;
  @IsNumber() @Min(1) targetKg!: number; // the truckload target the lot fills toward
  @IsOptional() @IsNumber() @Min(0) maxSpend?: number; // optional cash budget cap for the eventual haul (0 = no cap)
}

/** F3 — a member deposit (kg) into a consolidation lot. memberRef is a free label (thin attribution). */
export class ConsignmentDepositDto {
  @IsString() memberRef!: string;
  @IsNumber() @Min(0.01) weightKg!: number;
}

/** S33b — a driver logging a temperature reading for a cold-chain freight in transit. */
export class RecordTempDto {
  @IsOptional() @IsString() driverDid?: string;
  @IsNumber() celsius!: number;
}
