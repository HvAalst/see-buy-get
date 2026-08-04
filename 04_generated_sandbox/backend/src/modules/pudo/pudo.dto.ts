import { ArrayMinSize, IsArray, IsBoolean, IsDateString, IsIn, IsNumber, IsObject, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { TRUCK_SUBTYPES } from './fleet.config';
import { MEDIA_KINDS, MediaKind } from './media.types';
import { CARGO_NATURES, CargoNature, EQUIPMENT, Equipment } from './cargo.types';

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
}

export class RegisterAgentDto {
  @IsString() shopName!: string;
  @IsString() zone!: string;
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

export class OverdraftDto {
  @IsNumber() @Min(0.01) amount!: number;
  @IsOptional() @IsString() adminId?: string; // operator-override only; normal actors are pinned to their token
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

export class AcceptParcelDto {
  @IsOptional() @IsString() agentDid?: string; // operator-override only; normal actors are pinned to their token
  @IsString() parcelId!: string;
  @IsIn(['S', 'M', 'L', 'HEAVY']) size!: 'S' | 'M' | 'L' | 'HEAVY';
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

class OrderItemDto {
  @IsString() name!: string;
  @IsNumber() @Min(1) qty!: number;
}

class DimensionsDto {
  @IsNumber() @Min(1) l!: number;
  @IsNumber() @Min(1) w!: number;
  @IsNumber() @Min(1) h!: number;
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
  @IsNumber() @Min(1) l!: number;
  @IsNumber() @Min(1) w!: number;
  @IsNumber() @Min(1) h!: number;
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

export class IntakeDto {
  @IsOptional() @IsString() agentDid?: string; // operator-override only; normal actors are pinned to their token
}

export class ShelveDto {
  @IsOptional() @IsString() agentDid?: string; // operator-override only; normal actors are pinned to their token
  @IsOptional() @IsString() binId?: string;
}

export class CollectDto {
  @IsOptional() @IsString() agentDid?: string; // operator-override only; normal actors are pinned to their token
  @IsString() collectionCode!: string;
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
}

export class DriverKycDto {
  @IsString() idCopyRef!: string;
  @IsString() licenceCopyRef!: string;
}

export class DriverKycDecisionDto {
  @IsBoolean() approve!: boolean;
  @IsOptional() @IsString() by?: string;
}

export class CoupleDto {
  @IsString() vehicleId!: string;
  @IsOptional() @IsString() corridorId?: string;
}

export class AssignCorridorDto {
  @IsString() corridorId!: string;
}

export class StartSessionDto {
  @IsString() vehicleQr!: string;
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

/** S33b — a driver logging a temperature reading for a cold-chain freight in transit. */
export class RecordTempDto {
  @IsOptional() @IsString() driverDid?: string;
  @IsNumber() celsius!: number;
}
