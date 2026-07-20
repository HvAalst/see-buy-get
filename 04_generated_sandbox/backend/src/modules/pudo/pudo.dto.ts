import { ArrayMinSize, IsArray, IsBoolean, IsIn, IsNumber, IsObject, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { TRUCK_SUBTYPES } from './fleet.config';

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
}

export class HandoverDto {
  @IsOptional() @IsString() agentDid?: string; // operator-override only; normal actors are pinned to their token
  @IsString() driverBadgeId!: string;
  @IsString({ each: true }) parcelIds!: string[];
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

// --- inbound / e-commerce pickup-at-PUDO ---

class ShippingPolicyDto {
  @IsOptional() @IsIn(['full', 'capped']) mode?: 'full' | 'capped';
  @IsOptional() @IsNumber() @Min(0) freeOverSubtotal?: number;
  @IsOptional() @IsNumber() @Min(0) buyerContributionCap?: number;
}

export class RegisterVendorDto {
  @IsString() name!: string;
  @IsOptional() @IsString() callbackUrl?: string;
  @IsOptional() @IsString() secret?: string;
  @IsOptional() @ValidateNested() @Type(() => GeoDto) location?: GeoDto;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() country?: string;
  @IsOptional() @ValidateNested() @Type(() => ShippingPolicyDto) shippingPolicy?: ShippingPolicyDto;
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
  @IsOptional() @IsString() managerDid?: string;
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
}
