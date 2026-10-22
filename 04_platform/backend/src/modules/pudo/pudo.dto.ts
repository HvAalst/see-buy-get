import { ParcelInvoiceDto } from './parcel-invoice.types';
import { BagClosureDto, BagReceiptDto } from './bag-closure.types';
import { MAX_SEALS, SEALS_AT_DELIVERY, SealReadDto, type SealsAtDelivery } from './load-seal.types';
import { DESTINATION_KINDS } from './destination.types';
import { PaperCaseView } from '../../foundation/entity/company-paper-reports.service';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDateString, IsDefined, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateIf, ValidateNested } from 'class-validator';
import { INCOTERM_CODES } from '../../foundation/incoterms/catalogue';
import { INTEREST_KINDS, MAX_INTEREST_MESSAGE } from '../../foundation/interest/interest.service';
import { CLAIM_KINDS, DELAY_PLACES, GIVE_BACK_REASONS, RATE_BASES, RUN_CANCEL_REASONS, SETTLE_METHODS, SETTLE_WHEN, type DelayPlace, type GiveBackReason, type RunCancelReason } from './departure.types';
import { PRESENCE_LEVELS, type PresenceLevel } from '../../foundation/presence/presence.types';
import { Type } from 'class-transformer';
import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { DRIVER_ISSUES, DriverIssue } from './rating.service';
import { MERCHANT_TAGS, MerchantTag } from './merchant-rating.service';
import { TRUCK_SUBTYPES } from './fleet.config';
import { CARRIER_PAPER_KINDS } from './papers';
import { SITE_KINDS, type SiteKind } from './site.service';
import { PACKAGING, type Packaging } from './packaging';
import { MEDIA_KINDS, MediaKind } from './media.types';
import { CONSTRAINT_KINDS, ConstraintKind } from './route-constraint.types';
import { NOTE_STAGES } from './note-archive.types';
import { CARGO_LANES, CARGO_NATURES, CargoLane, CargoNature, EQUIPMENT, Equipment } from './cargo.types';

import { CLEARANCE_SPECIALISMS, CONSIGNMENT_MODES, CUSTOMS_HOLD_KINDS, HOLD_STANCES } from './import.types';
import { BOX_ENDINGS, CONDITION_STANCES, FREE_DAY_KINDS, INTERCHANGE_SIDES } from './container-box';

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
  /** Required when refusing: the applicant is SHOWN this, and a refusal they cannot act on leaves them
   *  exactly where a silent one did. Validated in the service, where the approve flag is known. */
  @IsOptional() @IsString() reason?: string;
  /**
   * Round 40 — REQUIRED when approving: the last day the shop's trading licence is valid (YYYY-MM-DD), read off the licence
   * it sent. Checked in the service, which answers in words the console shows.
   */
  @IsOptional() @IsString() @MaxLength(20) licenceExpiresAt?: string;
}

/** Round 40 — a shop sends its renewed trading licence: a photograph it uploaded as kyc_licence, and the date it runs to as the shop reads it. */
export class ShopLicenceRenewalDto {
  @IsString() @MaxLength(80) copyRef!: string;
  @IsString() @MaxLength(20) expiresAt!: string;
}

/** Round 40 — staff record the date a shop's trading licence runs to, read off the licence. */
export class ShopLicenceRecordDto {
  @IsString() @MaxLength(20) expiresAt!: string;
  /** Who is recording it, for a console on the shared key; a named sign-in's own name wins. */
  @IsOptional() @IsString() @MaxLength(120) by?: string;
}

/** Round 39 — a light courier sends a photo of their ID: the media id of a photograph they uploaded as kyc_id. */
export class IdPhotoDto {
  @IsString() @MaxLength(80) photoRef!: string;
}

/** Round 39 — a member of staff looked at a light courier's ID photo: it is theirs, or it is not, with the reason they are shown. */
export class IdPhotoDecisionDto {
  @IsBoolean() seen!: boolean;
  @IsOptional() @IsString() by?: string;
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

export class AvailabilityDto {
  @IsBoolean() open!: boolean;
}

export class TopUpDto {
  @IsNumber() @Min(0.01) amount!: number;
  @IsOptional() @IsString() bankRef?: string;
  /**
   * The number the payment prompt should go to — STK push, the main path the user chose on 2026-09-22.
   *
   * Optional because the fallback has to keep working: a payer who gives no number is shown a paybill
   * and a reference, which is how somebody paying from a kiosk or another person's handset pays. Given,
   * it is the phone that will ring asking for a PIN, so it is TYPED BY THE PAYER rather than read off
   * their record — the phone that pays is often not the one we have on file.
   */
  @IsOptional() @IsString() phone?: string;
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
  /** How long this take-in took at the counter, by the app's own clock, in seconds — for the pilot's numbers. */
  @IsOptional() @IsNumber() @Min(0) @Max(86_400) takeInSeconds?: number;
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
  /** Round 23 — when the shop or hub did it, by its phone's clock: a step kept on the phone with no signal. */
  @IsOptional() @IsDateString() observedAt?: string;
}

/** The driver's pass, shown: the bus's list is read with it (the handover itself checks it again). */
export class HandoverManifestDto {
  @IsOptional() @IsString() agentDid?: string; // operator-override only; normal actors are pinned to their token
  @IsString() driverBadgeId!: string;
}

export class HandoverDto {
  @IsOptional() @IsString() agentDid?: string; // operator-override only; normal actors are pinned to their token
  @IsString() driverBadgeId!: string;
  @IsString({ each: true }) parcelIds!: string[];
  // S25 completeness gate: a short load is refused unless the agent knowingly leaves parcels behind.
  @IsOptional() @IsBoolean() acknowledgeShortShip?: boolean;
  @IsOptional() @IsString() shortShipReason?: string;
  /** Round 23 — when the shop or hub did it, by its phone's clock: a step kept on the phone with no signal. */
  @IsOptional() @IsDateString() observedAt?: string;
}

/** S26 — upload one image as a base64 data URL (the client downscales + strips EXIF first). */
/** Round 30 — a store's own system sends the photo of a shipment's contents (POST shipping/photos). */
export class ShippingPhotoDto {
  /** The photo as a data URL: data:image/jpeg;base64,… (JPEG, PNG or WebP, up to 500 KB). */
  @IsString() dataUrl!: string;
  /** A small thumbnail the same way, up to 64 KB: what a list shows before the full photo is asked for. */
  @IsOptional() @IsString() thumbDataUrl?: string;
}

export class UploadMediaDto {
  @IsIn(MEDIA_KINDS) kind!: MediaKind;
  @IsString() dataUrl!: string; // data:image/jpeg;base64,…
  @IsOptional() @IsString() thumbDataUrl?: string; // a small thumbnail for the media grid
}

/** The illustration an SBG admin curates for one option of a choosable vocabulary. Topic and key ride in the
 *  path (and are validated against the canonical lists), so the body carries only the picture. */
export class PutHelpImageDto {
  @IsString() dataUrl!: string; // data:image/jpeg;base64,…  — validated for real raster bytes on decode
}

export class ArriveDto {
  @IsOptional() @IsString() destAgentDid?: string; // operator-override only; normal actors are pinned to their token
  /** Round 23 — when the shop or hub did it, by its phone's clock: a step kept on the phone with no signal. */
  @IsOptional() @IsDateString() observedAt?: string;
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

/**
 * Setting a country's standing. The level is the headline; an override is a capability deliberately
 * held down or lifted on its own, because money, tax, claims and payouts arrive on different days.
 */
export class PresenceDto {
  @IsIn(PRESENCE_LEVELS as unknown as string[]) level!: PresenceLevel;
  @IsOptional() @IsObject() overrides?: Record<string, boolean>;
  /** CL1 — the trade terms this country allows, per direction. Replaces the stored sets outright. */
  @IsOptional() @IsObject() incoterms?: { origin?: string[]; destination?: string[] };
  /** Why. A country’s standing is a decision, and a decision with no reason cannot be reviewed. */
  @IsOptional() @IsString() note?: string;
  @IsOptional() @IsString() by?: string;
}

/** CA2 — the second person's answer on a proposed change to a country. */
export class PresenceDecisionDto {
  @IsOptional() @IsString() by?: string;
  /** Required to decline: a refusal is kept with its reason. */
  @IsOptional() @IsString() reason?: string;
}

/** CA3/CA7 — create a company of ours (sister) or a partner, as a draft, in a country from the catalogue. */
export class CreateCompanyDto {
  @ApiProperty({ enum: ['sister', 'partner'] }) @IsIn(['sister', 'partner']) kind!: 'sister' | 'partner';
  @IsString() jurisdiction!: string;
  @IsString() name!: string;
  @IsOptional() @IsString() by?: string;
}

/**
 * CA3 — sections of a company's legal record. Each section sent replaces the one on record; the service checks every
 * field (forms, dates, shares, signing authority, what a licence supports) and says which one is wrong.
 */
export class CompanyRecordDto {
  @IsOptional() @IsString() legalName?: string;
  @IsOptional() @IsString() tradingName?: string;
  @IsOptional() @IsString() legalForm?: string;
  @IsOptional() @IsString() registrationNumber?: string;
  @IsOptional() @IsString() registrationDate?: string;
  @IsOptional() @IsObject() registeredAddress?: Record<string, unknown>;
  @IsOptional() @IsObject() operatingAddress?: Record<string, unknown>;
  @IsOptional() @IsArray() representatives?: Record<string, unknown>[];
  @IsOptional() @IsArray() beneficialOwners?: Record<string, unknown>[];
  @IsOptional() @IsArray() taxRegistrations?: Record<string, unknown>[];
  @IsOptional() @IsArray() bankAccounts?: Record<string, unknown>[];
  @IsOptional() @IsArray() licences?: Record<string, unknown>[];
  @IsOptional() @IsArray() insurance?: Record<string, unknown>[];
  @IsOptional() @IsArray() obligations?: Record<string, unknown>[];
  @IsOptional() @IsString() by?: string;
}

/**
 * A company's own change to a part of its record that switches something — a licence, an insurance policy, a bank
 * account, who may sign — with the paper behind it, in one act. `was` names the item being changed or taken off (its
 * number, or the person's name); `item` is how it is to be (absent: it is taken off); the paper is a base64 data URL
 * like every company document.
 */
export class CompanyDeclarationDto {
  @IsString() section!: string;
  @IsOptional() @IsString() was?: string;
  @IsOptional() @IsObject() item?: Record<string, unknown>;
  @IsOptional() @IsString() paperKind?: string;
  @IsOptional() @IsString() paperTitle?: string;
  @IsOptional() @IsString() paperDataUrl?: string;
}

/** A REPORT ON A COMPANY'S PAPER: what is wrong, in a category and in words, and what shows it — a screenshot or a photograph, as a data URL. */
export class ReportPaperDto {
  @IsString() category!: string;
  @IsOptional() @IsString() note?: string;
  @IsOptional() @IsString() evidenceDataUrl?: string;
  @IsOptional() @IsString() by?: string;
}

/** The company's answer to a report: what is right, and optionally what shows it. */
export class AnswerPaperReportDto {
  @IsOptional() @IsString() note?: string;
  @IsOptional() @IsString() evidenceDataUrl?: string;
}

/** A member of staff deciding a report: the reason (for a dismissal, or for the strike they propose), and who they are on a shared key. */
export class DecidePaperReportDto {
  @IsOptional() @IsString() reason?: string;
  @IsOptional() @IsString() by?: string;
}

/**
 * A report by somebody who CONTRACTS with the company: which licence or policy, by its number as they were shown it,
 * and what is wrong with it. Never a company or a document: the server works both out from who is asking.
 */
export class ReportContractPaperDto {
  @IsIn(['licence', 'insurance']) source!: 'licence' | 'insurance';
  @IsString() number!: string;
  @IsString() category!: string;
  @IsOptional() @IsString() note?: string;
  @IsOptional() @IsString() evidenceDataUrl?: string;
}

/** One licence or insurance policy of the company somebody contracts with, as that somebody is shown it. */
export class ContractPaperView {
  @ApiProperty({ enum: ['licence', 'insurance'] }) source!: 'licence' | 'insurance';
  kind!: string;
  /** Who issued the licence, or the insurer. */
  issuer!: string;
  /** The licence or policy number: what a reader checks against the issuer's own register. */
  number!: string;
  expiresAt!: string;
  lapsed!: boolean;
  /** There is a paper on record behind it that counts, so it can be reported. */
  reportable!: boolean;
  /** What became of THIS reader's own report on it, if they made one. */
  @ApiPropertyOptional() yourReport?: { at: string; state: 'open' | 'dismissed' | 'struck'; reason?: string };
}

/** The company somebody contracts with, and the papers it trades on. No company: none of ours is there. */
export class ContractCompanyView {
  @ApiPropertyOptional() company?: { name: string; jurisdiction?: string };
  @ApiProperty({ type: [ContractPaperView] }) papers!: ContractPaperView[];
}

export class PaperCaseList {
  @ApiProperty({ type: [PaperCaseView] }) items!: PaperCaseView[];
  /** How many wait on staff. */
  waiting!: number;
}

/** CA4 — a company document, as a base64 data URL (PDF, PNG or JPEG), fingerprinted on arrival. */
export class CompanyDocumentDto {
  @IsString() kind!: string;
  @IsString() title!: string;
  @IsString() dataUrl!: string;
  /** Which licence, policy (its number) or obligation (its key) this paper is for. */
  @IsOptional() @IsString() relatesTo?: string;
  @IsOptional() @IsString() expiresAt?: string;
  @IsOptional() @IsString() by?: string;
}

/** CA4 — verifying or rejecting a document. A rejection needs its reason. */
export class DocumentDecisionDto {
  @IsOptional() @IsString() by?: string;
  @IsOptional() @IsString() reason?: string;
}

/* ------------------------------------------ CL2a — importing a container -- */

/** CL2a — a container on its way. Countries are two-letter codes; the port is a label, not a modelled place. */
export class RegisterImportDto {
  /** Whose goods. A company administrator may only name their own; staff must name one. */
  @IsOptional() @IsString() importerEntityId?: string;
  @IsString() @MaxLength(200) goodsDescription!: string;
  @IsString() @MaxLength(2) originCountry!: string;
  @IsString() @MaxLength(2) destCountry!: string;
  /** Where it CLEARS. A saved place of kind 'clearance' supplies this on a screen; staff may type it. */
  @IsString() @MaxLength(80) destPort!: string;
  @IsOptional() @IsString() clearanceSiteId?: string;
  /** Where the vessel put it down, when that is somewhere else. A label off a bill of lading. */
  @IsOptional() @IsString() @MaxLength(80) dischargePort?: string;
  @IsOptional() @IsString() dischargeSiteId?: string;
  @IsOptional() @IsString() @MaxLength(20) containerNo?: string;
  /** The carrier's own reference. Recorded, and read by nothing yet — the carrier seam is not wired. */
  @IsOptional() @IsString() @MaxLength(60) carrierRef?: string;
  @IsOptional() @IsString() etaAt?: string;
  /**
   * How the goods arrived — sea, air, road, rail. A LABEL: no airline, no waybill, no schedule.
   *
   * It has to be on the DTO and not only on the service, which is what the drive caught: validation
   * whitelists, so a field the DTO does not declare is stripped in silence and an air consignment was
   * recorded as sea. The service accepted it and nothing errored anywhere.
   */
  @IsOptional() @IsIn(CONSIGNMENT_MODES as unknown as string[]) @ApiPropertyOptional({ enum: CONSIGNMENT_MODES }) mode?: string;
  @IsOptional() @IsString() by?: string;
}

/** CL2a — appoint a clearing agent, which is what creates the two grants over the papers. */
export class AppointAgentDto {
  @IsString() agentEntityId!: string;
  @IsOptional() @IsString() entityId?: string;
  @IsOptional() @IsString() by?: string;
}

/** CL2a — end an appointment. A reason is optional; the revocation itself is not negotiable. */
export class RevokeAgentDto {
  @IsOptional() @IsString() @MaxLength(300) reason?: string;
  @IsOptional() @IsString() entityId?: string;
  @IsOptional() @IsString() by?: string;
}

/** CL2a — one line of the list the agent publishes. */
export class RequiredPaperItemDto {
  @IsOptional() @IsString() @MaxLength(60) key?: string;
  @IsString() @MaxLength(120) label!: string;
  @IsOptional() @IsNumber() copies?: number;
  @IsOptional() @IsString() @MaxLength(300) note?: string;
}

/** CL2a — the agent publishes what this consignment will need. Replaces the list, keeps what was supplied. */
export class PublishRequiredDto {
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => RequiredPaperItemDto) items!: RequiredPaperItemDto[];
  @IsOptional() @IsString() entityId?: string;
  @IsOptional() @IsString() by?: string;
}

/** CL2a — the importer attaches one of their OWN papers to a line. No upload here, by design. */
export class SupplyPaperDto {
  @IsString() @MaxLength(60) key!: string;
  @IsString() documentId!: string;
  @IsOptional() @IsString() entityId?: string;
  @IsOptional() @IsString() by?: string;
}

/**
 * CL5 — what somebody was asked for, by somebody who was standing there.
 *
 * `firstHand` is a required BOOLEAN rather than an assumed true: a form that does not ask the question
 * cannot refuse the wrong answer, and refusing a rumour at intake is the whole rule.
 */
export class FieldObservationDto {
  @IsString() @Matches(/^[A-Za-z]{2}$/, { message: 'Say which country this was, as its two-letter code' }) country!: string;
  @IsString() @MaxLength(120) place!: string;
  @IsString() @MaxLength(160) subject!: string;
  @IsOptional() @IsString() @MaxLength(600) note?: string;
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Say when it happened, written YYYY-MM-DD' }) happenedOn!: string;
  @IsBoolean() firstHand!: boolean;
  /** A photograph already uploaded through the media rail. Both gates are checked in the service. */
  @IsOptional() @IsString() evidenceMediaId?: string;
  @IsOptional() @IsBoolean() consentAgreed?: boolean;
  @IsOptional() @IsString() consentNoticeVersion?: string;
  @IsOptional() @IsString() by?: string;
}

export class RemoveEvidenceDto {
  @IsString() @MaxLength(200) reason!: string;
  @IsOptional() @IsString() by?: string;
}

/** BL1 — the agent records that customs let the container go. Nothing to say but who. */
export class ReleaseDto {
  @IsOptional() @IsString() entityId?: string;
  @IsOptional() @IsString() by?: string;
}

/**
 * BL1 — a carrier's permission to move goods that have not been cleared.
 *
 * The country is validated for SHAPE only: two letters. Which countries exist is the catalogue's business
 * and which are switched on is the presence ladder's, and a validator restating either would be a third
 * copy going stale — the trap this project has now hit three times with enums.
 */
export class TransitAuthorityDto {
  @IsString() carrierDid!: string;
  @IsString() @Matches(/^[A-Za-z]{2}$/, { message: 'A transit authority runs in ONE country — give its two-letter code' }) country!: string;
  @IsString() @MaxLength(80) reference!: string;
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Say when it runs out, written YYYY-MM-DD' }) expiresAt!: string;
  @IsOptional() @IsString() by?: string;
}

export class WithdrawTransitDto {
  @IsString() @MaxLength(200) reason!: string;
  @IsOptional() @IsString() by?: string;
}

/** CL2a — the agent ticks a paper off, or sends it back with a reason. */
export class PaperDecisionDto {
  @IsOptional() @IsString() @MaxLength(300) reason?: string;
  @IsOptional() @IsString() entityId?: string;
  @IsOptional() @IsString() by?: string;
}

/** CL2a — what agents have been asked for at one port. A country, and optionally the port itself. */
export class KnownPapersQueryDto {
  @IsString() @MaxLength(2) country!: string;
  @IsOptional() @IsString() @MaxLength(80) port?: string;
}

/** CL2b — the agent names their price for clearing one container. A quote, not a charge. */
export class QuoteClearanceFeeDto {
  @IsNumber() @Min(1) amount!: number;
  /** Three letters. Absent: the money of the country the goods clear in. */
  @IsOptional() @IsString() @MaxLength(3) currency?: string;
  /** The agent's own quotation or proforma number. */
  @IsOptional() @IsString() @MaxLength(60) reference?: string;
  @IsOptional() @IsString() @MaxLength(300) note?: string;
  @IsOptional() @IsString() entityId?: string;
  @IsOptional() @IsString() by?: string;
}

/** CL2b — the importer agrees the figure. Nothing moves; agreeing is not paying. */
export class AcceptClearanceFeeDto {
  @IsOptional() @IsString() entityId?: string;
  @IsOptional() @IsString() by?: string;
}

/** CL2b — the importer or the agent says the fee is paid, or back to open. A record, never a posting. */
export class ClearanceFeeStatusDto {
  @IsIn(['open', 'paid']) @ApiProperty({ enum: ['open', 'paid'] }) status!: 'open' | 'paid';
  /** The payment's own reference — a bank or mobile-money transaction. */
  @IsOptional() @IsString() @MaxLength(80) reference?: string;
  @IsOptional() @IsString() entityId?: string;
  @IsOptional() @IsString() by?: string;
}

/** CL2b — the road leg from the port of destination, minted by a person on the existing freight machinery. */
export class MintRoadLegDto {
  /**
   * THE PLACES, BY ID. A site carries its own name and point, so the leg stops asking for coordinates.
   *
   * The raw fields below are still accepted, and only for network staff acting through the API on a
   * company with no saved places yet. A screen sends ids.
   */
  @IsOptional() @IsString() pickupSiteId?: string;
  @IsOptional() @IsString() destSiteId?: string;
  /*
   * OPTIONAL NOW, AND THE CONTROLLER SAYS SO IF BOTH ROUTES ARE EMPTY.
   *
   * Found by driving it: validation runs BEFORE any handler code, so a required destLabel refused a
   * request that carried a saved place perfectly capable of supplying one. A decorator that duplicates
   * a rule the handler also holds ends up enforcing the older version of it — the same trap as the @Min
   * that once shadowed the box's tare sentence.
   */
  @IsOptional() @ValidateNested() @Type(() => GeoDto) pickupLocation?: GeoDto;
  /** Defaults to the port the container is cleared at. */
  @IsOptional() @IsString() @MaxLength(120) pickupLabel?: string;
  @IsOptional() @IsString() @MaxLength(120) destLabel?: string;
  @IsOptional() @ValidateNested() @Type(() => GeoDto) destLocation?: GeoDto;
  @IsNumber() @Min(1) weightKg!: number;
  @IsOptional() @IsString() entityId?: string;
  @IsOptional() @IsString() by?: string;
}

/**
 * CL4 — what the state did to a container. NO PHOTOGRAPH FIELD, and that is deliberate: a hold notice is
 * a photograph of an official document, and whether we may hold those is the open legal question blocking
 * CL5. Words, a date and an attribution are available today.
 */
export class RecordCustomsHoldDto {
  @IsIn(CUSTOMS_HOLD_KINDS) @ApiProperty({ enum: CUSTOMS_HOLD_KINDS }) kind!: string;
  /** When it happened, as the party recording it says. Defaults to now. */
  @IsOptional() @IsString() at?: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
  @IsOptional() @IsString() entityId?: string;
  @IsOptional() @IsString() by?: string;
}

/** The other party's account of the same hold. A dispute must carry words — see the service. */
export class AnswerCustomsHoldDto {
  @IsIn(HOLD_STANCES) @ApiProperty({ enum: HOLD_STANCES }) stance!: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
  @IsOptional() @IsString() entityId?: string;
  @IsOptional() @IsString() by?: string;
}

export class ReleaseCustomsHoldDto {
  @IsOptional() @IsString() at?: string;
  @IsOptional() @IsString() entityId?: string;
  @IsOptional() @IsString() by?: string;
}


/* ------------------------------ Y0 + Y1: the box's own dates, and never its money -- */

/**
 * WHEN IT LANDED. A date, stated by a person, because nothing here watches a vessel berth.
 *
 * Deliberately not derived from the ETA: an expectation is not an event, and demurrage counted from a
 * guess is a number somebody would have acted on.
 */
export class BoxArrivedDto {
  @IsString() at!: string;
  @IsOptional() @IsString() entityId?: string;
  @IsOptional() @IsString() by?: string;
}

/**
 * HOW MANY FREE DAYS THE IMPORTER SAYS THEY HAVE — a claim, carried and attributed.
 *
 * Two kinds, because there are two clocks: demurrage runs inside the terminal and detention outside it,
 * and a single "days" field would be a number nobody could act on. No rate, no amount, no currency — the
 * charge is between the importer and the line, exactly as duty is.
 */
export class BoxFreeDaysDto {
  @IsIn(FREE_DAY_KINDS) @ApiProperty({ enum: FREE_DAY_KINDS }) kind!: string;
  @IsNumber() @Min(0) @Max(365) days!: number;
  @IsOptional() @IsString() entityId?: string;
  @IsOptional() @IsString() by?: string;
}

/**
 * HOW THE SPELL ENDED — and there are two endings, which is the user's correction to this design.
 *
 * `returned` is the one a first draft assumes is the only one. `bought` is the ordinary market: containers
 * are traded goods, sold and never returned, and a box that was bought must never read as overdue.
 */
/**
 * Y2 — the leg home, laden or empty.
 *
 * A `cargo` present means there is something in it, which is the ordinary case: a box travelling portward is
 * a dry lockable body and freight goes inside it. Absent means empty, and the leg says so on the board.
 * The weight is what the truck will carry — the box's own tare when there is nothing in it.
 */
/**
 * Y3 — one party's account of the box's condition at a gate.
 *
 * Two stances and no third, because a third invites a paragraph where a word is wanted. Photographs are
 * the caller's own uploads: the service ADOPTS them, so a ref that is not theirs is dropped rather than
 * cited, and a record never names evidence nobody can produce.
 */
/**
 * Y4 — a yard says it holds empties. A claim, like an agent's advertisement: attributed and never checked.
 *
 * No slots, rows or tiers here, and that is the design rather than an omission — see the service.
 */
export class DeclareDepotDto {
  @IsString() @MaxLength(120) placeLabel!: string;
  @IsString() @MaxLength(2) country!: string;
  @IsOptional() @ValidateNested() @Type(() => GeoDto) location?: GeoDto;
  @IsOptional() @IsString() @MaxLength(600) note?: string;
  @IsOptional() @IsString() entityId?: string;
  @IsOptional() @IsString() by?: string;
}

/** One box the yard says is standing there, with the position IN THEIR OWN WORDS if they keep one. */
export class DepotBoxDto {
  @IsString() @MaxLength(20) containerNo!: string;
  /** "C-12, third row" — their handwriting. We record a position; we never assign one. */
  @IsOptional() @IsString() @MaxLength(60) position?: string;
  @IsOptional() @IsString() @MaxLength(300) note?: string;
  @IsOptional() @IsString() entityId?: string;
  @IsOptional() @IsString() by?: string;
}

/** Nothing but who is acting — for the acts that need no other word. */
export class ByDto {
  @IsOptional() @IsString() entityId?: string;
  @IsOptional() @IsString() by?: string;
}

/**
 * A company's own entry — how to reach them. Every field optional, because a yard with a telephone number
 * and nothing else is a yard a haulier can reach.
 *
 * A MERGE: what is absent stays as it was, and an EMPTY STRING clears. Shapes are checked and choices are
 * not — we never ring the number, write to the address or open the site.
 */
export class ContactCardDto {
  @IsOptional() @IsString() @MaxLength(80) contactName?: string;
  @IsOptional() @IsString() @MaxLength(24) phone?: string;
  @IsOptional() @IsString() @MaxLength(24) phoneAlt?: string;
  /** Round 39 — the operations desk a driver held at a checkpoint in this company's country rings. Never published. */
  @IsOptional() @IsString() @MaxLength(24) deskPhone?: string;
  @IsOptional() @IsString() @MaxLength(120) email?: string;
  @IsOptional() @IsString() @MaxLength(160) website?: string;
  @IsOptional() @IsString() @MaxLength(300) address?: string;
  @IsOptional() @IsString() @MaxLength(120) hours?: string;
  /** The days visitors are received: `mon` … `sun`. An empty list clears them. */
  @IsOptional() @IsArray() @IsString({ each: true }) visitDays?: string[];
  /** From when until when on those days, `HH:MM`. An empty string clears one. */
  @IsOptional() @IsString() @MaxLength(5) visitFrom?: string;
  @IsOptional() @IsString() @MaxLength(5) visitTo?: string;
  /** A day of the week with hours of its own: `{ sat: { from: '09:00', to: '12:00' } }`. The object REPLACES the days'
   *  own hours; an empty one clears them, and a day given null keeps the hours of most days. */
  @IsOptional() @IsObject() visitHoursByDay?: Record<string, { from?: string; to?: string } | null>;
  /** The dates it is closed: public holidays, one-off closures — or, with `from` and `to`, a shorter day. The list
   *  REPLACES the list; an empty one clears it. */
  @IsOptional() @IsArray() closedDates?: Array<{ date: string; note?: string; from?: string; to?: string }>;
  /** How many visitors it sees in an hour. Zero clears it: then no hour fills. */
  @IsOptional() @IsNumber() @Min(0) @Max(200) visitorsPerHour?: number;
  @IsOptional() @IsString() entityId?: string;
  @IsOptional() @IsString() by?: string;
}

export class BoxInterchangeDto {
  @IsIn(INTERCHANGE_SIDES) @ApiProperty({ enum: INTERCHANGE_SIDES }) side!: string;
  @IsIn(CONDITION_STANCES) @ApiProperty({ enum: CONDITION_STANCES }) stance!: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) photoIds?: string[];
  @IsOptional() @IsString() entityId?: string;
  @IsOptional() @IsString() by?: string;
}

export class BoxReturnLegDto {
  @IsString() @MaxLength(120) depotLabel!: string;
  @IsOptional() @ValidateNested() @Type(() => GeoDto) depotLocation?: GeoDto;
  /** Taken from the laden leg's destination when we have one; asked for only when we do not. */
  @IsOptional() @IsString() @MaxLength(120) fromLabel?: string;
  @IsOptional() @ValidateNested() @Type(() => GeoDto) fromLocation?: GeoDto;
  /** Y4 — a yard picked from the register, so the box lands on ITS list. Never matched from the label. */
  @IsOptional() @IsString() depotEntityId?: string;
  /**
   * NO @Min HERE, deliberately — the service owns this rule and answers it in a sentence.
   *
   * The drive found the reason: a decorator refusing with "weightKg must not be less than 1" shadowed the
   * only useful thing anybody could say, which is that an empty container is not a light one and its tare
   * is painted on its door. One rule, in the place that can explain it.
   */
  @IsNumber() weightKg!: number;
  /** What is in it, if anything. Absent is an EMPTY run, published as one. */
  @IsOptional() @IsString() @MaxLength(200) cargo?: string;
  @IsOptional() @IsString() entityId?: string;
  @IsOptional() @IsString() by?: string;
}

export class BoxEndingDto {
  @IsIn(BOX_ENDINGS) @ApiProperty({ enum: BOX_ENDINGS }) kind!: string;
  @IsOptional() @IsString() at?: string;
  /** The depot it went back to, when it was returned. A label a person types, like a port. */
  @IsOptional() @IsString() @MaxLength(120) where?: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
  @IsOptional() @IsString() entityId?: string;
  @IsOptional() @IsString() by?: string;
}
/**
 * CL6 — what an agent says they clear. A CLAIM, and the only asserted thing in the agent design.
 *
 * A fixed vocabulary because a finder cannot honestly match free text, plus `words` for what a vocabulary
 * cannot hold. Nothing here is verified and no screen may present it as if it were.
 */
export class ClearanceOfferDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsIn(CLEARANCE_SPECIALISMS as unknown as string[], { each: true })
  @ApiProperty({ enum: CLEARANCE_SPECIALISMS, isArray: true })
  specialisms!: string[];
  /** Ports, airports and border posts they work — labels. We run no ports and validate none. */
  @IsOptional() @IsArray() @IsString({ each: true }) places?: string[];
  @IsOptional() @IsString() @MaxLength(600) words?: string;
  @IsOptional() @IsString() by?: string;
}

/** What an importer is looking for. Every field optional: no filter at all is a real question. */
export class FindAgentsQueryDto {
  @IsOptional() @IsIn(CLEARANCE_SPECIALISMS as unknown as string[]) @ApiPropertyOptional({ enum: CLEARANCE_SPECIALISMS }) specialism?: string;
  /** A port, airport or border post, matched loosely against what they say AND where we have seen them. */
  @IsOptional() @IsString() @MaxLength(120) place?: string;
  @IsOptional() @IsString() @MaxLength(2) country?: string;
}

/** A tank's last cargoes and its cleaning certificate — the only thing that makes one food-grade. */
export class TankDeclarationDto {
  @IsArray() @ArrayMinSize(1) @IsString({ each: true }) lastCargoes!: string[];
  @IsOptional() @IsString() cleanedAt?: string;
  /** One of the importer's OWN documents. A file uploaded into here would be a register nobody verifies. */
  @IsOptional() @IsString() certificateDocumentId?: string;
}

/** The importer's dangerous-goods declaration. We check the SHAPE of a UN number and never the choice. */
export class DangerousGoodsDto {
  @IsString() @MaxLength(10) unNumber!: string;
  @IsString() @MaxLength(8) imdgClass!: string;
  @IsOptional() @IsString() @MaxLength(200) properShippingName?: string;
}

/**
 * CL7 — what kind of box, and what is in it.
 *
 * The box is SELECTED from the container catalogue, so its height and handling are derived. The goods are
 * DECLARED, because no code distinguishes a tank of edible oil from a tank of gas oil, and deciding it
 * from a description would be us classifying goods.
 */
export class DeclareCargoDto {
  /**
   * The container number, usually typed later than the booking: it arrives with the bill of lading.
   *
   * CHECKED AND NOT TRUSTED — the service runs the ISO 6346 mod-11 arithmetic and refuses a number that
   * cannot be right. A field on a service that is not on its DTO is stripped in silence, which is why
   * this line exists at all.
   */
  @IsOptional() @IsString() @MaxLength(20) containerNo?: string;
  /** The date on the CSC safety-approval plate. Carried, with nothing stated about it. */
  @IsOptional() @IsString() cscPlateDate?: string;
  /**
   * ANY ISO 6346 size/type code — not an enum of a shortlist.
   *
   * Four characters, validated for shape here and RESOLVED by the service against the standard's three
   * tables. An enum would have frozen the API at whatever subset somebody had seen, which is the mistake
   * the first version of this made.
   */
  @IsOptional() @IsString() @Matches(/^[0-9A-Za-z]{4}$/, { message: 'An ISO 6346 code is four characters — 45G1, 22U1, 22T4' }) containerType?: string;
  @IsOptional() @IsIn(CARGO_NATURES as unknown as string[]) @ApiPropertyOptional({ enum: CARGO_NATURES }) natureCode?: string;
  /** How tall the CARGO stands, for an open box whose own height is only the floor it sits on. */
  @IsOptional() @IsNumber() @Min(0.1) @Max(10) cargoHeightM?: number;
  @IsOptional() @ValidateNested() @Type(() => TankDeclarationDto) tank?: TankDeclarationDto;
  @IsOptional() @ValidateNested() @Type(() => DangerousGoodsDto) dangerous?: DangerousGoodsDto;
  @IsOptional() @IsString() entityId?: string;
  @IsOptional() @IsString() by?: string;
}

/** CA6 — the rule for crossing from one country into another. Absent a rule, a foreign vehicle may not carry inside. */
export class BorderRuleDto {
  @IsString() from!: string;
  @IsString() to!: string;
  /** Each `{ name, hours?, note? }`. */
  @IsOptional() @IsArray() crossings?: Record<string, unknown>[];
  @IsOptional() @IsArray() @IsString({ each: true }) permits?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) regionalInsurance?: string[];
  @IsOptional() @IsNumber() maxWeightKg?: number;
  @IsOptional() @IsNumber() maxLengthM?: number;
  @IsOptional() @IsNumber() maxHeightM?: number;
  @ApiPropertyOptional({ enum: ['allowed', 'forbidden'] }) @IsOptional() @IsIn(['allowed', 'forbidden']) cabotage?: 'allowed' | 'forbidden';
  @IsOptional() @IsString() note?: string;
  @IsOptional() @IsString() by?: string;
}

export class CorridorStatusDto {
  @IsIn(['active', 'blocked']) status!: 'active' | 'blocked';
}

/** F1 — a fleet proposes a line of its own. Nothing routes on it until the network publishes it. */
export class ProposeLineDto {
  @IsOptional() @IsString() name?: string;
  @IsString() originZone!: string;
  @IsString() destZone!: string;
  @IsOptional() @IsIn(['bus', 'truck']) vehicleType?: 'bus' | 'truck';
  @IsOptional() @IsString() schedule?: string;
  /** Why this line — read by the operator deciding whether to publish it. */
  @IsOptional() @IsString() note?: string;
}

export class PingDto {
  @IsOptional() @IsObject() meta?: Record<string, unknown>;
}

export class RateDto {
  @IsNumber() @Min(1) stars!: number;
  @IsString() raterMobile!: string;
}

/** REP2 — an agent rates a driver on the movement leg (stars + the specific failings it witnessed). */
/**
 * A receiver's verdict on the store they bought from — stars plus TAGS, never prose.
 *
 * Tags rather than free text for the reason the driver rating already chose them: prose brings
 * moderation, defamation exposure, personal details in public strings and translation across five
 * locales, while a catalogue key aggregates and translates and has nothing in it to moderate.
 */
export class RateMerchantDto {
  @IsNumber() @Min(1) @Max(5) stars!: number;
  // @ApiPropertyOptional so the emitted contract is an ARRAY of the enum — the plugin infers a SCALAR
  // from @IsArray + @IsIn alone, which is the exact trap the driver-issue tags fell into and the
  // generated client then refuses an array against. Same fix, same reason.
  @IsOptional() @IsArray() @IsIn([...MERCHANT_TAGS], { each: true }) @ApiPropertyOptional({ enum: MERCHANT_TAGS, isArray: true }) tags?: MerchantTag[];
}

export class RateDriverDto {
  @IsOptional() @IsString() agentDid?: string; // operator-override only; a normal agent is pinned to its token
  @IsNumber() @Min(1) @Max(5) stars!: number;
  // @ApiPropertyOptional so the emitted contract is an ARRAY of the enum (the plugin otherwise infers a scalar).
  @IsOptional() @IsArray() @IsIn([...DRIVER_ISSUES], { each: true }) @ApiPropertyOptional({ enum: DRIVER_ISSUES, isArray: true }) issues?: DriverIssue[];
}

/** FP7 — CMR box 13: the sender's instructions for the door. All optional; blank clears. */
export class FreightInstructionsDto {
  @IsOptional() @IsString() @MaxLength(500) text?: string;
  @IsOptional() @IsString() @MaxLength(80) contactName?: string;
  @IsOptional() @IsString() @MaxLength(32) contactPhone?: string;
  @IsOptional() @IsString() @MaxLength(80) deliveryWindow?: string;
}

/** FP8 — a driver hands a claimed load back before pickup. */
export class HandBackDto {
  @IsString() @MaxLength(500) reason!: string;
}

/** FP6 — the shipper's verdict on a delivered load: stars, and what went wrong if anything. */
export class RateFreightDto {
  @IsNumber() @Min(1) @Max(5) stars!: number;
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

/** The store's insurer: a name to address the report to, and the address a link to it is emailed to. */
class InsurerDto {
  @IsString() @MaxLength(80) name!: string;
  @IsString() @MaxLength(254) @Matches(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, { message: 'The insurer’s email address is not one' }) email!: string;
}

class ShippingPolicyDto {
  /** Null takes the insurer off the policy. */
  @IsOptional() @ValidateIf((_, v) => v !== null) @ValidateNested() @Type(() => InsurerDto) insurer?: InsurerDto | null;
  @IsOptional() @IsIn(['full', 'capped']) mode?: 'full' | 'capped';
  @IsOptional() @IsNumber() @Min(0) freeOverSubtotal?: number;
  @IsOptional() @IsNumber() @Min(0) buyerContributionCap?: number;
  // S34c — the vendor's per-shipment dedicated-freight spend cap (0 = no cap).
  @IsOptional() @IsNumber() @Min(0) maxTransportSpend?: number;
  /** The goods value above which this store wants an uncollected parcel shipped back to it. Omitted =
   *  never offer; 0 = always ask. Two different statements, and both are real. */
  @IsOptional() @IsNumber() @Min(0) recoverAboveValue?: number;
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
  /**
   * THE STORE'S OWN ACCOUNT: the email and the password its people sign in to the Store app with. Given together.
   * A store registered without them (by a script, by an integration) sets them up the first time somebody signs in.
   */
  @IsOptional() @IsString() @MaxLength(200) email?: string;
  @IsOptional() @IsString() @MaxLength(200) password?: string;
}

/** A store that already exists sets up its account: the email and password it will sign in with from now on. */
export class StoreAccountDto {
  @IsString() @MaxLength(200) email!: string;
  @IsString() @MaxLength(200) password!: string;
}

export class VendorLoginDto {
  @IsString() vendorId!: string;
  @IsString() secret!: string;
}

export class UpdateVendorDto {
  @IsOptional() @IsString() callbackUrl?: string;
  /** Include the collection code in the ready_for_pickup callback (default true — see Vendor). */
  @IsOptional() @IsBoolean() callbackCarriesCode?: boolean;
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
/** Why it was called off. Optional and free text — a store's own words, kept on the audit trail. */
export class CancelShipmentDto {
  @IsOptional() @IsString() @MaxLength(200) reason?: string;
}

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
  /** Round 13 — the commercial invoice, for a shipment that crosses a border: what customs reads, item by item. */
  @IsOptional() @ValidateNested() @Type(() => ParcelInvoiceDto) invoice?: ParcelInvoiceDto;
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

/**
 * CONNECTING SOMEWHERE TO PUT THE DOCUMENTS — a protocol rather than a vendor, so "any other" works.
 */
export class ConnectDestinationDto {
  @IsIn(DESTINATION_KINDS) @ApiProperty({ enum: DESTINATION_KINDS }) kind!: string;
  @IsOptional() @IsString() @MaxLength(80) label?: string;
  @IsString() @MaxLength(400) endpoint!: string;
  @IsOptional() @IsString() @MaxLength(120) bucket?: string;
  @IsOptional() @IsString() @MaxLength(60) region?: string;
  /** Path style is the default; virtual-host style is the exception AWS allows. */
  @IsOptional() @IsBoolean() pathStyle?: boolean;
  @IsOptional() @IsString() @MaxLength(200) prefix?: string;
  @IsOptional() @IsString() @MaxLength(200) accessKeyId?: string;
  @IsOptional() @IsString() @MaxLength(400) secretAccessKey?: string;
  @IsOptional() @IsString() @MaxLength(200) username?: string;
  @IsOptional() @IsString() @MaxLength(400) password?: string;
}

/**
 * VERIFYING A CONSIGNMENT NOTE somebody is holding.
 *
 * Either the fingerprint printed at the foot of the page, or the note's own JSON out of an export
 * bundle — whichever the holder has to hand. Both reduce to the same 64 hex characters.
 */
export class VerifyNoteDto {
  @IsOptional() @IsString() sha256?: string;
  /** The note as it was exported (copies/NN-stage.json). Canonicalised and hashed here. */
  @IsOptional() @IsObject() note?: Record<string, unknown>;
}

/**
 * THE SHIPMENT ARCHIVE register query — the consignment notes a caller was a party to.
 *
 * No `:did` in the path and none here: the archive answers for whoever is asking, because a document's
 * readers were frozen with it and are not a relationship that can be looked up afresh a year later.
 */
export class NoteArchiveQueryDto {
  @IsOptional() @IsString() q?: string; // note number / party / plate / place / nature / status
  @IsOptional() @IsIn(['board', 'run']) path?: 'board' | 'run';
  @IsOptional() @IsIn(NOTE_STAGES) stage?: string;
  @IsOptional() @IsString() from?: string; // ISO or YYYY-MM-DD (inclusive)
  @IsOptional() @IsString() to?: string;
  @IsOptional() @IsString() limit?: string;
  @IsOptional() @IsString() offset?: string;
}

/** R4 — the agent earnings-ledger register query. */
export class AgentLedgerQueryDto {
  @IsOptional() @IsString() q?: string; // reference (parcel id / bank ref) or type word
  @IsOptional() @IsIn(['TOP_UP', 'TOP_UP_FEE', 'FEE', 'LABOR_PAYOUT', 'REFUND']) type?: 'TOP_UP' | 'TOP_UP_FEE' | 'FEE' | 'LABOR_PAYOUT' | 'REFUND';
  @IsOptional() @IsIn(['in', 'out']) direction?: 'in' | 'out';
  @IsOptional() @IsString() from?: string; // ISO or YYYY-MM-DD (inclusive)
  @IsOptional() @IsString() to?: string;
  @IsOptional() @IsIn(['newest', 'oldest', 'amount_desc', 'amount_asc']) sort?: 'newest' | 'oldest' | 'amount_desc' | 'amount_asc';
  @IsOptional() @IsString() limit?: string;
  @IsOptional() @IsString() offset?: string;
}

/** R5 — the driver jobs + earnings register query (over the driver's freight hauls). */
/** FP1 — the fleet's register: the driver's filters, plus which driver. */
export class FleetEarningsQueryDto {
  @IsOptional() @IsString() q?: string;
  @IsOptional() @IsIn(['available', 'claimed', 'in_transit', 'delivered', 'cancelled']) status?: 'available' | 'claimed' | 'in_transit' | 'delivered' | 'cancelled';
  @IsOptional() @IsIn(['paid', 'unpaid']) paid?: 'paid' | 'unpaid';
  @IsOptional() @IsString() driver?: string;
  @IsOptional() @IsString() from?: string;
  @IsOptional() @IsString() to?: string;
  @IsOptional() @IsIn(['newest', 'oldest', 'earn_desc', 'earn_asc']) sort?: 'newest' | 'oldest' | 'earn_desc' | 'earn_asc';
  @IsOptional() @IsString() limit?: string;
  @IsOptional() @IsString() offset?: string;
}

export class DriverJobsQueryDto {
  @IsOptional() @IsString() q?: string; // job code / description / destination / tracking / order ref
  @IsOptional() @IsIn(['available', 'claimed', 'in_transit', 'delivered', 'cancelled']) status?: 'available' | 'claimed' | 'in_transit' | 'delivered' | 'cancelled';
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
  /** CL1 — the trade term the parties agreed, and the place it names. Selected from the eleven, never invented. */
  @IsOptional() @IsIn(INCOTERM_CODES as string[]) @ApiPropertyOptional({ enum: INCOTERM_CODES }) incoterm?: string;
  @IsOptional() @IsString() @MaxLength(120) namedPlace?: string;
  /** FP8 — box 13 for an order that ships as freight: what the driver needs at the door, and when. No contact —
   *  the goods go to a shop, whose counter is the contact. Ignored for a parcel-sized order, which has no box 13. */
  @IsOptional() @IsString() @MaxLength(500) instructions?: string;
  @IsOptional() @IsString() @MaxLength(80) deliveryWindow?: string;
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
  /** Round 13 — the commercial invoice, for a shipment that crosses a border: what customs reads, item by item. */
  @IsOptional() @ValidateNested() @Type(() => ParcelInvoiceDto) invoice?: ParcelInvoiceDto;
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
  /** How long this take-in took at the counter, by the app's own clock, in seconds — for the pilot's numbers. */
  @IsOptional() @IsNumber() @Min(0) @Max(86_400) takeInSeconds?: number;
  /** Round 13 — for a parcel crossing a border: the shop saw its commercial invoice's copies in the pouch. */
  @IsOptional() @IsBoolean() papersInPouch?: boolean;
  /** PG2 — required when the scanned parcel is a person's pre-minted peer send (walk-up parity: the
   *  drop-off photo is the fraud defence, taken at the counter). Ignored for a vendor inbound. */
  @IsOptional() @IsString() dropoffPhotoRef?: string;
  /** Round 23 — when the shop or hub did it, by its phone's clock: a step kept on the phone with no signal. */
  @IsOptional() @IsDateString() observedAt?: string;
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
  /** Round 23 — when the shop or hub did it, by its phone's clock: a step kept on the phone with no signal. */
  @IsOptional() @IsDateString() observedAt?: string;
  /** Round 36 — how it is closed: its coded seal's number and a photograph, or a photograph alone. Asked for by name. */
  @IsOptional() @ValidateNested() @Type(() => BagClosureDto) closure?: BagClosureDto;
}

/** A sister's own margin, as a fraction (0.02 = 2%). Bounds are enforced in the service. */
export class EntityFeeDto {
  @IsNumber() feePct!: number;
}

/**
 * Turn one or more of a sister's three rate knobs, for one lane of work or for everything it does.
 *
 * Every layer is OPTIONAL and they mean three different things: absent = leave it alone, a number = set
 * it, `null` = clear it back to the fallback. Turning the cost-of-risk knob must not silently reset a
 * margin somebody set last month, and "back to default" has to be sayable without guessing a value.
 */
export class EntityRatesDto {
  /** Which kind of work this applies to. Omitted = the sister's default for everything. */
  @IsOptional() @IsIn(CARGO_LANES) @ApiPropertyOptional({ enum: CARGO_LANES }) lane?: CargoLane;
  /** What carrying the exposure costs — an insurance premium, or the provision standing in for one. */
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsNumber() costOfRiskPct?: number | null;
  /** What the sister earns for choosing to carry it — where a specialised vehicle pays itself back. */
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsNumber() profitOnRiskPct?: number | null;
  /** The general company layer, on everything. */
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsNumber() marginPct?: number | null;
}

/**
 * Set what a sister collects for its tax authority, for one lane of work or for everything it does.
 *
 * Same three-way optionality as the rate knobs: absent leaves it alone, a number sets it, `null` clears it.
 *
 * `registration` is here rather than on its own endpoint on purpose. A rate above zero is refused without
 * one, so an operator turning tax on for the first time can do it in a single call instead of discovering
 * halfway through that the two halves of one decision were split across two screens.
 */
export class EntityTaxDto {
  /** Which kind of work this applies to. Omitted = the sister's default for everything. */
  @IsOptional() @IsIn(CARGO_LANES) @ApiPropertyOptional({ enum: CARGO_LANES }) lane?: CargoLane;
  /** As a FRACTION — sixteen percent is 0.16, not 16. Bounds are enforced in the service. */
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsNumber() ratePct?: number | null;
  /** What the authority calls it: 'VAT', 'GST'. The network has no default worth having. */
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() label?: string | null;
  /** The number this sister collects under. Required before any rate above zero will be accepted. */
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() registration?: string | null;
}

/**
 * Set figures on a company's list of amounts: what a parcel costs and what each step pays, in its own currency
 * (modules/pudo/amounts.ts).
 *
 * The same three meanings as its neighbour above: a key left out is left alone, a number sets it, `null` puts it
 * back to what every company starts from. No lane: a wage for shelving a parcel is not a lane of work.
 */
export class EntityAmountsDto {
  /** What a parcel taken in at the counter costs the shop's float. Also the float a shop needs to take one in. */
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsNumber() @Min(0) wholesale?: number | null;
  /** Paid to a shop for taking in a parcel that was paid for already. */
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsNumber() @Min(0) labourFee?: number | null;
  /** Paid to a shop for handing a batch to the driver. */
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsNumber() @Min(0) handoverFee?: number | null;
  /** Paid to the receiving shop when the parcel lands on its shelf… */
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsNumber() @Min(0) shelvingFee?: number | null;
  /** …and when it hands it over. */
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsNumber() @Min(0) releaseFee?: number | null;
  /** Paid to a driver for scanning a bag aboard. */
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsNumber() @Min(0) toteLoadFee?: number | null;
  /** Paid to a hub for each parcel it sorts. */
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsNumber() @Min(0) mdpSortFee?: number | null;
  /** What a day of holding a parcel costs once its free time has ended. */
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsNumber() @Min(0) holdingFeePerDay?: number | null;
}

/**
 * Set what a sister charges a shop or a store to put money in — flat below a threshold, free above it.
 *
 * NOT the three-way optionality of its neighbours, and the difference is the point. A fee is one decision
 * with two halves: a charge nobody can escape by topping up more is not this fee, and a threshold with
 * nothing behind it charges nobody. So the two numbers travel together or the whole rule comes off —
 * `{}` removes it, which is how "we charge nothing to top up here" is said. Half a rule is not a state
 * this knob can be left in.
 *
 * No lane, unlike every other knob on that screen: a top-up is not a lane of work, so there is nothing
 * for it to vary by.
 */
export class EntityTopUpFeeDto {
  /** Top up this much or more and it costs nothing, in the sister's own currency. */
  @IsOptional() @IsNumber() @ApiPropertyOptional() freeAbove?: number;
  /** The flat charge below that threshold. The service refuses one worth a fifth of the threshold or more. */
  @IsOptional() @IsNumber() @ApiPropertyOptional() amount?: number;
}

/**
 * Set what a sister covers when it breaks something, and what it charges to cover more.
 *
 * Same three-way optionality as the rate and tax knobs: absent leaves it alone, a number sets it,
 * null clears it back to the network default of no cover and no charge.
 */
/** Create an administrator for a company. The password is generated and returned once — never taken. */
export class EntityAdminDto {
  @IsString() @MaxLength(120) email!: string;
  /** What the audit trail will record against every change this person makes. */
  @IsString() @MaxLength(80) name!: string;
}

/** Changing your own password: the current one is the proof, not the session. */
export class EntityAdminPasswordDto {
  @IsString() @MaxLength(120) email!: string;
  @IsString() @MaxLength(200) password!: string;
  @IsString() @MaxLength(200) newPassword!: string;
}

/** A company administrator signing in. */
export class EntityAdminLoginDto {
  @IsString() @MaxLength(120) email!: string;
  @IsString() @MaxLength(200) password!: string;
}

/** A member of staff signs in: the password, and — once two-step sign-in is on, or to turn it on — the authenticator's code. */
export class StaffLoginDto extends EntityAdminLoginDto {
  @IsOptional() @IsString() @MaxLength(12) @ApiPropertyOptional() code?: string;
}

/** Declining a staff account somebody asked for. Somebody else's needs the reason; the one who asked is told it. */
export class StaffProposalDeclineDto {
  @IsOptional() @IsString() @MaxLength(300) @ApiPropertyOptional() reason?: string;
}

/** The token off the link a new member of staff was emailed: whose is it? */
export class StaffWelcomeCheckDto {
  @IsString() @MaxLength(200) token!: string;
}

/** A new member of staff chooses their own password, proven by the token off the link they were emailed. */
export class StaffWelcomeDto extends StaffWelcomeCheckDto {
  @IsString() @MaxLength(200) password!: string;
}

/** The six digits an authenticator app shows. */
export class TwoStepCodeDto {
  @IsString() @MaxLength(12) code!: string;
}

export class EntityInsuranceDto {
  /** Which kind of work this applies to. Omitted = the sister's default for everything. */
  @IsOptional() @IsIn(CARGO_LANES) @ApiPropertyOptional({ enum: CARGO_LANES }) lane?: CargoLane;
  /** Charged on the declared value ABOVE the free limit, as a FRACTION — two percent is 0.02. */
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsNumber() @Min(0) premiumPct?: number | null;
  /** Covered on every shipment without anybody declaring anything, in the sister's own currency. */
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsNumber() @Min(0) freeLimit?: number | null;
}

/** Control-tower reissue of a burned release secret; `by` names the human behind the operator token. */
/**
 * The receiver's answer to "your collection window has closed".
 *
 * Every choice DOES something (see ReceiverIntent), which is the whole reason this is a fixed list and
 * not a free-text box: a reason field that changes nothing is a survey, and nobody fills in a survey
 * about a parcel. The note is optional and never required — demanding an explanation before somebody may
 * tell you they are ill is how you get silence instead.
 */
export class CollectionResponseDto {
  @IsIn(['coming', 'proxy', 'relinquish', 'not-mine']) choice!: 'coming' | 'proxy' | 'relinquish' | 'not-mine';
  @IsOptional() @IsString() note?: string;
}

/** Naming somebody to collect on the receiver's behalf. A name, because the shop has to ask for one. */
export class NominateCollectorDto {
  @IsString() name!: string;
  @IsOptional() @IsString() phone?: string;
}

/** An operator closing out a relinquished parcel under the local disposal rule. */
export class WriteOffParcelDto {
  @IsOptional() @IsString() by?: string;
  @IsOptional() @IsString() reason?: string;
}

export class ReissueReleaseDto {
  @IsOptional() @IsString() by?: string;
}

/**
 * An operator decision on a dispute.
 *
 * The note is REQUIRED on every outcome, rejections included. A claimant who is told no and given no
 * reason has not been answered, they have been dismissed — and the note is the only part of a decision
 * that reaches a human rather than a ledger.
 */
export class ResolveDisputeDto {
  @IsIn(['upheld', 'partly_upheld', 'rejected']) @ApiPropertyOptional({ enum: ['upheld', 'partly_upheld', 'rejected'] }) decision!: 'upheld' | 'partly_upheld' | 'rejected';
  /** In the parcel's own currency. Ignored on a rejection, required above zero on the other two. */
  @IsOptional() @IsNumber() @Min(0) award?: number;
  @IsString() note!: string;
  /** The human behind the operator token, for the audit line a decision deserves. */
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
  /** Round 23 — when the shop or hub did it, by its phone's clock: a step kept on the phone with no signal. */
  @IsOptional() @IsDateString() observedAt?: string;
}

export class LoadBagDto {
  /** What the shop or hub scanned on the driver's phone. A driver loading a bag themselves sends none: it goes onto their own badge. */
  @IsOptional() @IsString() driverBadgeId?: string;
  /** Round 23 — when the shop or hub did it, by its phone's clock: a step kept on the phone with no signal. */
  @IsOptional() @IsDateString() observedAt?: string;
  /** Round 37 — a driver loading it themselves: the number read off its seal, a photograph, as it was closed. */
  @IsOptional() @ValidateNested() @Type(() => BagReceiptDto) take?: BagReceiptDto;
}

export class DropBagDto {
  @IsString() code!: string;
  /** Round 36 — the bag as it arrived: its photograph, the number read off its seal, whether it is as it was closed. */
  @IsOptional() @ValidateNested() @Type(() => BagReceiptDto) receipt?: BagReceiptDto;
}

export class ReceiveBagDto {
  @IsString() code!: string;
  /** Round 36 — the bag as it arrived: its photograph, the number read off its seal, whether it is as it was closed. */
  @IsOptional() @ValidateNested() @Type(() => BagReceiptDto) receipt?: BagReceiptDto;
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

/**
 * The dates on a fleet operator's own papers. Every field optional and nullable: recording a licence
 * expiry must not require retyping a policy number, and clearing a date somebody mistyped has to be
 * possible without clearing the rest.
 */
export class CarrierPapersRecordDto {
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() licenceExpiresAt?: string | null;
  /** A renewed licence can carry a new number. Omitted leaves the number on record alone. */
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(64) licenceNumber?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() insurancePolicy?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() insuranceExpiresAt?: string | null;
}

/**
 * Giving a booked space back. Both fields optional HERE: a shipper giving back their own space owes no
 * reason. A carrier giving back a sold one does — refused by the service, in the sentence the fleet sees,
 * rather than by a decorator answering in its own words.
 */
export class CancelBookingDto {
  @IsOptional() @IsIn(GIVE_BACK_REASONS) @ApiPropertyOptional({ enum: GIVE_BACK_REASONS }) reason?: GiveBackReason;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

/**
 * The fleet sends a renewed licence or policy: the image it uploaded, and what it read off it. There is no
 * field for a copy on RECORD — that is set by staff recording a date from this, never typed by anybody.
 */
export class SendCarrierPaperDto {
  @IsIn(CARRIER_PAPER_KINDS) @ApiProperty({ enum: CARRIER_PAPER_KINDS }) kind!: string;
  @IsString() @MaxLength(64) copyRef!: string;
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) expiresAt!: string;
  @IsOptional() @IsString() @MaxLength(120) reference?: string;
}

/** Staff do not accept what a fleet sent. Type only: an empty reason is refused by the SERVICE, in its own words. */
export class RefuseCarrierPaperDto {
  @IsIn(CARRIER_PAPER_KINDS) @ApiProperty({ enum: CARRIER_PAPER_KINDS }) kind!: string;
  @IsString() @MaxLength(500) reason!: string;
}

/**
 * Which carrier papers a sister refuses to trade without.
 *
 * READS the kinds from papers.ts rather than restating them, so a paper added there cannot be silently
 * unsettable here. `@ApiProperty` is spelled out because `@IsIn(..., { each: true })` publishes a SCALAR
 * enum into the schema, not an array of one — a trap this codebase has been caught by twice.
 */
/** Round 38 — the roles a member of staff is to hold: at least one of support, vetting, money, admin. */
export class StaffRolesDto {
  @IsArray() @ArrayMinSize(1) @IsIn(['support', 'vetting', 'money', 'admin'], { each: true })
  @ApiProperty({ type: [String], enum: ['support', 'vetting', 'money', 'admin'], isArray: true })
  roles!: string[];
}

/** Round 38 — a staff account asked for: who, and the roles they are to hold. */
export class StaffProposalDto extends StaffRolesDto {
  @IsString() email!: string;
  @IsString() name!: string;
}

/** Round 38 — one kind of partner's custody cap: what a new one holds or carries at once, and after how many hand-overs it lifts. */
export class CustodyCapDto {
  @IsInt() @Min(1) start!: number;
  @IsInt() @Min(1) liftedAfter!: number;
}

/** Round 38 — the custody cap for new shops and new independent riders. A kind left out is not capped: the whole rule, not a patch. */
export class CustodyCapsDto {
  @IsOptional() @ValidateNested() @Type(() => CustodyCapDto) shop?: CustodyCapDto;
  @IsOptional() @ValidateNested() @Type(() => CustodyCapDto) rider?: CustodyCapDto;
}

/** Round 38 — where a country's company requires a seal. Both said every time: the whole rule, not a patch. */
export class SealRulesDto {
  @IsBoolean() crossBorder!: boolean;
  @IsBoolean() containers!: boolean;
}

export class CarrierPapersDto {
  @IsOptional()
  @IsArray()
  @IsIn(CARRIER_PAPER_KINDS, { each: true })
  @ApiPropertyOptional({ type: [String], enum: CARRIER_PAPER_KINDS, isArray: true })
  enforce?: string[];
}

export class ManagerKycDecisionDto {
  @IsBoolean() approve!: boolean;
  @IsOptional() @IsString() by?: string;
  /** Why not — required when refusing: whoever puts the papers on record again reads it. */
  @IsOptional() @IsString() @MaxLength(300) reason?: string;
}

/** Step one: which fleet. The code NAMES a company; it no longer signs anybody in. */
export class ManagerLoginDto {
  @IsString() code!: string;
}

/**
 * Step two: which person.
 *
 * The company code alone used to be the whole of the fleet console's authentication — one shared secret
 * per company, for a company that may run twenty managers across as many depots. That gave no audit
 * trail of who did what, no way to cut off one leaver without re-issuing to everyone, and nothing that
 * could be scoped to a depot. It also meant a code, once seen, was permanent access.
 *
 * The person's phone and PIN are the credential now, checked against the identity spine that already
 * counts wrong attempts and locks out — protection the fleet code never had.
 */
export class ManagerSessionDto {
  /** The fleet code — or `did`, the fleet chosen after phone + PIN (fleet/managers/mine). Either only names the fleet. */
  @IsOptional() @IsString() code?: string;
  @IsOptional() @IsString() did?: string;
  @IsString() phone!: string;
  @IsString() pin!: string;
  /** The key this device was handed when a code to the phone was typed on it. Without it the PIN is not looked at. */
  @IsOptional() @IsString() @MaxLength(120) device?: string;
}

/** Forgot the fleet code: phone + PIN name the fleets this person manages. */
export class ManagerChoicesDto {
  @IsString() phone!: string;
  @IsString() pin!: string;
  /** The key this device was handed when a code to the phone was typed on it. Without it the PIN is not looked at. */
  @IsOptional() @IsString() @MaxLength(120) device?: string;
}

/** A driver signs in: the phone they were registered with, and their PIN. `did` only picks one if the phone drives for several. */
export class DriverSessionDto {
  @IsString() phone!: string;
  @IsString() pin!: string;
  @IsOptional() @IsString() did?: string;
  /** The key this device was handed when a code to the phone was typed on it. Without it the PIN is not looked at. */
  @IsOptional() @IsString() @MaxLength(120) device?: string;
}

/** A fleet offers a place to a driver already registered — by the phone number they sign in with. */
export class FleetOfferDto {
  @IsString() @MaxLength(40) phone!: string;
}

/** An offer as the fleet office sees it: the number it typed (its last three digits), and what became of it. */
export class FleetOfferView {
  @ApiProperty() offerId!: string;
  @ApiProperty() phoneEnding!: string;
  @ApiProperty({ enum: ['open', 'accepted', 'declined', 'withdrawn', 'lapsed'] }) status!: 'open' | 'accepted' | 'declined' | 'withdrawn' | 'lapsed';
  @ApiProperty() offeredAt!: string;
  @ApiProperty() expiresAt!: string;
  @ApiPropertyOptional() closedAt?: string;
  /** Only once they said yes — until then a phone number names nobody to the office. */
  @ApiPropertyOptional() driverName?: string;
}

/** An offer waiting on the driver: who, until when, and what they would have to finish before saying yes. */
export class DriverOfferView {
  @ApiProperty() offerId!: string;
  @ApiProperty() fleetDid!: string;
  @ApiProperty() companyName!: string;
  @ApiProperty() offeredAt!: string;
  @ApiProperty() expiresAt!: string;
  /** The fleet they drive for now — absent for a courier on their own, or a driver between fleets. */
  @ApiPropertyOptional() fromCompany?: string;
  /** Each thing to finish first, as a sentence the driver can act on. Empty means they can say yes now. */
  @ApiProperty({ type: [String] }) blockers!: string[];
}

/** A bearer token as issued — the same shape every sign-in answers with. */
export class IssuedTokenView {
  @ApiProperty() access_token!: string;
  @ApiProperty({ enum: ['Bearer'] }) token_type!: 'Bearer';
  @ApiProperty() expires_in!: number;
}

/** After a driver said yes: the fleet they now drive for, and a fresh sign-in (every earlier one carried the old fleet). */
export class FleetMoveView {
  @ApiProperty() did!: string;
  @ApiProperty() companyName!: string;
  @ApiPropertyOptional({ type: IssuedTokenView }) token?: IssuedTokenView;
}

/** A driver left their fleet by themselves: what they are now, and a sign-in that no longer names the fleet. */
export class FleetLeaveView {
  @ApiProperty() did!: string;
  /** The fleet they left. */
  @ApiProperty() companyName!: string;
  /** The runs of that fleet they were on and are now off. */
  @ApiProperty({ type: [String] }) runs!: string[];
  @ApiPropertyOptional({ type: IssuedTokenView }) token?: IssuedTokenView;
}

/** A driver who is in no fleet rides for themselves: where they live, and the vehicle of their own. */
export class RideAloneDto {
  /** ISO country code of where they legally reside: it decides the company of ours that contracts them. */
  @IsString() @Matches(/^[A-Za-z]{2}$/) country!: string;
  @IsString() @MaxLength(32) vehicleClass!: string;
  @IsString() @MaxLength(32) plate!: string;
  /** A truck's body — a truck is registered with one. */
  @IsOptional() @IsString() @MaxLength(32) truckSubtype?: string;
  /** Anything heavier than a motorcycle: their own photographs of their ID card and their driving licence, for staff to read. */
  @IsOptional() @IsString() @MaxLength(80) idCopyRef?: string;
  @IsOptional() @IsString() @MaxLength(80) licenceCopyRef?: string;
}

/** A fleet takes a driver off — always with a reason the driver is shown. */
export class RemoveDriverDto {
  @IsIn(['left', 'ended', 'other']) reason!: 'left' | 'ended' | 'other';
  /** The fleet's own words — required for `other`. */
  @IsOptional() @IsString() @MaxLength(300) note?: string;
}

// --- participant accounts (sign in / sign up) ---

export class SignupDto {
  @IsIn(['pudo', 'driver', 'mdp']) role!: 'pudo' | 'driver' | 'mdp';
  @IsString() email!: string;
  @IsString() password!: string;
  @IsString() phone!: string;
  @IsObject() profile!: Record<string, unknown>;
}

/**
 * Somebody in a country the network has not reached, asking to be told when it does.
 *
 * No name, no address, no identity document, no phone. It holds an email and a sentence from somebody
 * with no account in a country we do not operate in, so it holds as little as it can and nothing that
 * would identify them beyond the address they would be written to.
 */
export class InterestDto {
  @IsIn(INTEREST_KINDS) @ApiProperty({ enum: INTEREST_KINDS }) kind!: string;
  @IsString() @MaxLength(160) email!: string;
  /** Why they are asking. The motivation is the evidence a switch-on decision is made on. */
  @IsString() @MaxLength(MAX_INTEREST_MESSAGE) message!: string;
}

/**
 * F3 — a fleet putting space for sale on a run it is making anyway.
 *
 * Both capacity axes, because whichever runs out first is what "full" means for a vehicle; and the price
 * BASIS, because per-kilogram is the one that loses money on the loads that actually fill a truck.
 */
export class DeclareDepartureDto {
  /** Which truck. Required: a run that names no vehicle is selling a number somebody typed. */
  @IsString() vehicleId!: string;
  @IsString() corridorId!: string;
  @IsString() leavesAt!: string;
  /** How much of the vehicle is for sale. Absent means all of it — the registry already knows. */
  @IsOptional() @IsNumber() @Min(1) capacityKg?: number;
  /** Cubic metres of hold. Absent where the fleet has not measured it — then only weight can bind. */
  @IsOptional() @IsNumber() @Min(0.1) capacityM3?: number;
  @IsIn(RATE_BASES) @ApiProperty({ enum: RATE_BASES }) basis!: string;
  /**
   * How the shipper pays the fleet — a RECORD, never a posting. Required of a new run: a price with no
   * way to pay it is the hole this closes. Optional here only because the same shape reads back records
   * declared before it existed.
   */
  @IsOptional() @IsIn(SETTLE_METHODS) @ApiPropertyOptional({ enum: SETTLE_METHODS }) settleMethod?: string;
  @IsOptional() @IsIn(SETTLE_WHEN) @ApiPropertyOptional({ enum: SETTLE_WHEN }) settleWhen?: string;
  /**
   * WHAT THE CARRIER’S OWN POLICY COVERS, per load. Zero is a real answer — "I carry none" is exactly
   * what a forwarder needs to hear, and a different fact from a carrier who has not said.
   */
  @IsOptional() @IsNumber() @Min(0) coverLimit?: number;
  /** The insurer and policy, as the carrier writes it. What a forwarder rings to verify. */
  @IsOptional() @IsString() @MaxLength(160) coverPolicy?: string;
  @IsNumber() @Min(0.01) amount!: number;
  /** The least the run will take. What stopping and strapping down already cost. */
  @IsOptional() @IsNumber() @Min(0) minCharge?: number;
  /**
   * Waiting time, and it is both or neither. `waitingPerHour` without `freeMin` is refused by the service:
   * billing from the moment the truck arrives is a surcharge on loading, not a charge for a delay.
   */
  @IsOptional() @IsNumber() @Min(0) freeMin?: number;
  @IsOptional() @IsNumber() @Min(0.01) waitingPerHour?: number;
  /** Required when charging by the kilometre — otherwise every booking prices at nothing. */
  @IsOptional() @IsNumber() @Min(1) km?: number;
  @IsOptional() @IsString() @MaxLength(240) note?: string;
}

/** Who is running this departure. Rostered after the space is sold, which is the ordinary way round. */
export class AssignDepartureDriverDto {
  @IsString() driverDid!: string;
}

/** Clocking a stop: the time is the server's, so all this carries is WHERE. */
export class WaitingStopDto {
  @IsIn(DELAY_PLACES) @ApiProperty({ enum: DELAY_PLACES }) where!: DelayPlace;
}

/** Letting a waiting charge go. The reason is required — see waiveWaiting. */
export class WaiveWaitingDto {
  @IsIn(DELAY_PLACES) @ApiProperty({ enum: DELAY_PLACES }) where!: DelayPlace;
  @IsString() @MaxLength(240) reason!: string;
}

/** Taking some of that space. */
export class BookDepartureDto {
  @IsString() @MaxLength(160) description!: string;
  /**
   * WHAT THE GOODS ARE, in the board’s own vocabulary — the thing a free-text description could never
   * say. Absent means general dry, which is most freight; what is refused is a value nobody agreed on.
   */
  @IsOptional() @IsIn(CARGO_NATURES) @ApiPropertyOptional({ enum: CARGO_NATURES }) nature?: string;
  /** What it is worth, as the shipper declares it. Never verified, and never a promise of ours. */
  @IsOptional() @IsNumber() @Min(0) declaredValue?: number;
  @IsNumber() @Min(0.1) weightKg!: number;
  @IsOptional() @IsNumber() @Min(0.01) volumeM3?: number;
  /** A load already on the board, where this is space for one. */
  @IsOptional() @IsString() freightId?: string;
  /** B4 — an expeditor booking it for one of its clients, as their agent. A business sign-in only. */
  @IsOptional() @IsString() forClientId?: string;
}

/** Put another of the fleet's own trucks on a run. */
export class SwapVehicleDto {
  @IsString() @MaxLength(64) vehicleId!: string;
}

export class DepartureStatusDto {
  @IsIn(['open', 'closed', 'departed', 'cancelled']) status!: 'open' | 'closed' | 'departed' | 'cancelled';
  /**
   * Why, and required by the SERVICE when anybody is aboard rather than by this class.
   *
   * Optional here because the same route closes a run and marks it gone, and neither of those owes
   * anybody an explanation. Calling off a loaded run does, and that is a rule about the run's state —
   * which a DTO cannot see.
   */
  @IsOptional() @IsIn(RUN_CANCEL_REASONS) @ApiPropertyOptional({ enum: RUN_CANCEL_REASONS }) reason?: RunCancelReason;
  /** The carrier's own words: required for `other`, optional beside any coded reason. */
  @IsOptional() @IsString() @MaxLength(500) note?: string;
  /**
   * WHERE the road or border is closed, when the carrier puts it on the hazard map. Optional — a carrier who
   * knows the road is shut but not where exactly still calls the run off honestly — and accepted only with
   * `road_closed` or `border_closed`. It files an ordinary hazard report, under the ordinary rules.
   */
  @IsOptional() @ValidateNested() @Type(() => GeoDto) closureAt?: GeoDto;
}

/**
 * The driver, or the office, saying a load came off the truck — at the board’s standard.
 *
 * Every field here is REQUIRED in effect: the service refuses without a name, a photograph and a
 * completed unload checklist, exactly as deliverFreight has since FP3. They are optional on the class
 * only so the refusal comes back in the service’s own words rather than a decorator’s.
 */
export class DeliverDepartureDto {
  /** Who took the goods, in their own name. Two characters minimum — "x" is not a receiver. */
  @IsOptional() @IsString() @MaxLength(120) receiverName?: string;
  /** A mediaId for the photograph of the goods as put down. The driver’s own, unattached upload. */
  @IsOptional() @IsString() photoRef?: string;
  /** Anything worth putting on the record — a reservation, a remark about the state of the goods. */
  @IsOptional() @IsString() @MaxLength(500) remarks?: string;
  /** The unload checklist keys confirmed. */
  @IsOptional() @IsArray() @IsString({ each: true }) confirmed?: string[];
}

/**
 * A shipper saying something went wrong — recorded and evidenced, never adjudicated by us.
 *
 * The same three kinds as a board claim, in the same words, because a shipper should not have to learn
 * a second vocabulary for the same bad day.
 */
export class OpenBookingClaimDto {
  @IsIn(CLAIM_KINDS) @ApiProperty({ enum: CLAIM_KINDS }) kind!: 'damaged' | 'short' | 'not_received';
  @IsString() @MaxLength(1000) description!: string;
  /** Their own photograph of what arrived — beside the carrier’s two, not instead of them. */
  @IsOptional() @IsString() photoRef?: string;
  /** What they say it cost them. Their figure, like the declared value: never verified by us. */
  @IsOptional() @IsNumber() @Min(0) amount?: number;
}

/** The carrier’s own words about their own liability. Never binding through us. */
export class AnswerBookingClaimDto {
  @IsIn(['accepted', 'refused']) answer!: 'accepted' | 'refused';
  /** Required on a refusal: a refusal with no reason is not an answer the other side can act on. */
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

/** What the driver confirmed before pulling away, and the photograph of the load as secured. */
export class SecureDepartureDto {
  @IsOptional() @IsArray() @IsString({ each: true }) confirmed?: string[];
  @IsOptional() @IsString() securementPhotoRef?: string;
}

/**
 * F4 — a load the fleet already had, put on its own run so the space stops being advertised.
 *
 * No shipper, because there is no account to name: this is the fleet's own customer, settled between the
 * two of them exactly as it was before any of this existed.
 */
export class AddOwnLoadDto {
  /** Whose it is, in the fleet's own words. */
  @IsString() @MaxLength(120) customer!: string;
  /** What the goods are. The fleet’s own customer’s load can clash with what is already aboard too. */
  @IsOptional() @IsIn(CARGO_NATURES) @ApiPropertyOptional({ enum: CARGO_NATURES }) nature?: string;
  @IsString() @MaxLength(160) description!: string;
  @IsNumber() @Min(0.1) weightKg!: number;
  @IsOptional() @IsNumber() @Min(0.01) volumeM3?: number;
  /** What the fleet charges them, for the fleet's own run sheet. We quote nothing and post nothing. */
  @IsOptional() @IsNumber() @Min(0) charge?: number;
}

export class PhoneRequestDto {
  @IsString() phone!: string;
}

export class PhoneVerifyDto {
  @IsString() phone!: string;
  @IsString() code!: string;
}

/** Change your own password, proven with the current one. */
export class ChangePasswordDto {
  @IsString() @MaxLength(120) email!: string;
  @IsString() @MaxLength(200) password!: string;
  @IsString() @MaxLength(200) newPassword!: string;
  /** A shop changes its password only from a phone or browser it confirmed: this one's key. */
  @IsOptional() @IsString() @MaxLength(80) device?: string;
}

/** Change your own PIN, proven with the current one. */
export class ChangePinDto {
  @IsString() phone!: string;
  @IsString() pin!: string;
  @IsString() newPin!: string;
  /** The key this device was handed when a code to the phone was typed on it. Without it the PIN is not looked at. */
  @IsOptional() @IsString() @MaxLength(120) device?: string;
}

/** Rotate a store's signing secret, proven with the current one. */
/**
 * A second proof, beyond being signed in, for replacing a store's signing secret: the account's PASSWORD where the
 * store has an account, the CURRENT secret where it does not.
 */
export class RotateSecretDto {
  @IsOptional() @IsString() @MaxLength(200) secret?: string;
  @IsOptional() @IsString() @MaxLength(200) password?: string;
}

export class LoginDto {
  @IsString() email!: string;
  @IsString() password!: string;
  /** The key this phone or browser was given when it was confirmed — a shop's sign-in works only on those. */
  @IsOptional() @IsString() @MaxLength(80) device?: string;
}

/** The code texted to the shop's number, typed on the phone or browser asking to be confirmed. */
export class AccountDeviceDto {
  @IsString() @MaxLength(40) challenge!: string;
  @IsString() @MaxLength(10) code!: string;
}

/** Round 40 — an account with no number gives one: the challenge its sign-in was answered with, and the number. */
export class AccountDevicePhoneDto {
  @IsString() @MaxLength(40) challenge!: string;
  @IsString() @MaxLength(24) phone!: string;
}

/** This phone or browser's key, for the shop's own list of its phones. */
export class ShopDevicesDto {
  @IsOptional() @IsString() @MaxLength(80) device?: string;
}

/** Every other phone forgotten: the password again, and this one's key so it stays. */
export class ShopForgetOthersDto {
  @IsString() @MaxLength(200) password!: string;
  @IsString() @MaxLength(80) device!: string;
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
  /**
   * The key this device already holds for this number, if it has one. A PIN replaced on a device the PIN already
   * worked on needs the code to the phone; on any other it needs the code to the recovery email as well.
   */
  @IsOptional() @IsString() @MaxLength(120) device?: string;
  /**
   * The recovery email — needed the first time a PIN is chosen, with the code sent to it. It is how somebody gets
   * back in when their number is gone, and where we warn them. Not asked again once one is confirmed.
   */
  @IsOptional() @IsString() @MaxLength(254) email?: string;
  @IsOptional() @IsString() @MaxLength(12) emailCode?: string;
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
  /** The key this device was handed when a code to the phone was typed on it. Without it the PIN is not looked at. */
  @IsOptional() @IsString() @MaxLength(120) device?: string;
}

/** Confirm THIS device for a number that already has an account: the code to the phone has just been typed on it. */
export class ConfirmDeviceDto {
  @IsString() @MaxLength(40) phone!: string;
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

/**
 * The account, as any app may set it — the person's own name, photo and address.
 *
 * `address` allows the empty string on purpose: it is how somebody takes theirs back. A field that can
 * only ever be filled in is a field nobody should fill in.
 */
export class AccountProfileDto {
  @IsOptional() @IsString() @MaxLength(80) displayName?: string;
  @IsOptional() @IsString() avatarMediaId?: string;
  @IsOptional() @IsString() @MaxLength(240) address?: string;
}

/** Ask for a code at an email address — to confirm it as a recovery address. */
export class EmailCodeDto {
  @IsString() @MaxLength(254) email!: string;
}

/** Ask for a code at the address ON an account — to get back in, or to undo a number change. */
export class AccountCodeDto {
  @IsString() @MaxLength(254) email!: string;
  @IsIn(['recover', 'undo']) why!: 'recover' | 'undo';
}

/** Undo a number change: the OLD number and the PIN as it was, or the account's email and a code sent to it. */
export class UndoNumberDto {
  @IsOptional() @IsString() @MaxLength(40) phone?: string;
  @IsOptional() @IsString() @MaxLength(8) pin?: string;
  @IsOptional() @IsString() @MaxLength(254) email?: string;
  @IsOptional() @IsString() @MaxLength(12) code?: string;
}

/** The number is gone and the PIN forgotten: the inbox, the national ID where one is on record, a new number, a new PIN. */
export class RecoverAccountDto {
  @IsString() @MaxLength(254) email!: string;
  @IsOptional() @IsString() @MaxLength(12) code?: string;
  @IsOptional() @IsString() @MaxLength(60) nationalId?: string;
  @IsString() @MaxLength(40) newPhone!: string;
  @IsString() @MaxLength(8) pin!: string;
}

/** The signed-in person moves their own account to another number: the PIN again, and a code already confirmed on the new number. */
export class ChangeNumberDto {
  @IsString() @MaxLength(8) pin!: string;
  @IsString() @MaxLength(40) newPhone!: string;
}

/** The signed-in person blocks the number their account used to have: the PIN again, as for everything else under Settings. */
export class BlockOldNumberDto {
  @IsString() @MaxLength(8) pin!: string;
}

/** The signed-in person sets or replaces their recovery email: the PIN again, and the code sent to the new address. */
export class AccountEmailDto {
  @IsString() @MaxLength(8) pin!: string;
  @IsString() @MaxLength(254) email!: string;
  @IsString() @MaxLength(12) code!: string;
}

/** Changing your own PIN. No phone: the account being changed is the one the token signed in as. */
/** Close my account: the PIN, as for every change that cannot be undone. */
export class AccountCloseDto {
  @IsString() pin!: string;
}

export class AccountPinDto {
  @IsString() currentPin!: string;
  @IsString() newPin!: string;
}

/**
 * The device keys the asking browser holds — one per number that ever signed in on it. An account does not know its
 * own number (only a hash of it is kept), so the browser cannot say which key is "mine": it sends what it has, and
 * the one that belongs to the signed-in person is the one that counts. The others are compared and dropped.
 */
export class PinDevicesDto {
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(100, { each: true }) devices?: string[];
}

/** Forget every other phone and browser: the PIN again, and this browser's keys so that its own is kept. */
export class ForgetOtherDevicesDto extends PinDevicesDto {
  @IsString() pin!: string;
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
  /** FP4 — YYYY-MM-DD; the day after it, the vehicle is off the road until renewed. */
  @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}/) insuranceExpiresAt?: string;
  @IsOptional() @IsString() inspectionRef?: string;
  @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}/) inspectionExpiresAt?: string;
}

export class RegisterVehicleDto {
  @IsString() plate!: string;
  @IsIn(VEHICLE_CLASSES) vehicleClass!: VClass;
  @IsOptional() @IsIn(TRUCK_SUBTYPES) truckSubtype?: string;
  @IsOptional() @IsNumber() @Min(1) capacityKg?: number;
  /**
   * How high the loading deck stands, in metres — the other half of a bridge check.
   *
   * Declared, because only the fleet can measure it and a class average would clear a load under a bridge
   * on arithmetic about somebody else's truck. Absent leaves the hazard map answering HEIGHT_UNKNOWN,
   * which is the truth.
   */
  @IsOptional() @IsNumber() @Min(0.1) @Max(3) deckM?: number;
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
  /** FP4 — YYYY-MM-DD; the day after it, the vehicle is off the road until renewed. */
  @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}/) insuranceExpiresAt?: string;
  @IsOptional() @IsString() inspectionRef?: string;
  @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}/) inspectionExpiresAt?: string;
}

/** FP4 — a renewed driving licence: the new expiry (YYYY-MM-DD), and the number if it changed. */
export class RenewLicenceDto {
  @IsOptional() @IsString() @MaxLength(64) number?: string;
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}/) expiresAt!: string;
  /** Who is recording it, for a console on the shared key; a named sign-in's own name wins. */
  @IsOptional() @IsString() @MaxLength(120) by?: string;
}

/** FP4 — a courier without a fleet sends the renewed card: the photograph, and the date they read off it. */
export class SendLicenceRenewalDto {
  @IsString() @MaxLength(64) copyRef!: string;
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}/) expiresAt!: string;
  @IsOptional() @IsString() @MaxLength(64) number?: string;
}

/**
 * FP4 — the card they sent is not accepted. Type only: an empty reason is refused by the SERVICE, in the
 * sentence the courier is shown, not by a decorator that would answer in its own words instead.
 */
export class RefuseLicenceRenewalDto {
  @IsString() @MaxLength(500) reason!: string;
  @IsOptional() @IsString() @MaxLength(120) by?: string;
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
  /** The driver's face for their badge — optional by design; see DriverPortrait. */
  @IsOptional() @IsString() photoRef?: string;
}

export class DriverKycDecisionDto {
  @IsBoolean() approve!: boolean;
  /**
   * The record check, recorded BY THE PERSON WHO DID IT, at the moment they approve.
   *
   * A fleet asserts this when it registers its own driver. Nobody asserted it for a courier who
   * registered themselves, so `criminalRecordClear` stayed false and approval was blocked for ever with
   * no way to unblock it — the last locked door on the independent path. It is deliberately not something
   * the applicant can tick: a self-declared clear record is not a check, and the whole point of this gate
   * is that somebody looked.
   */
  @IsOptional() @IsBoolean() criminalRecordClear?: boolean;
  @IsOptional() @IsString() by?: string;
  /** Required when refusing: the driver is shown it, and is the only person who can put it right. */
  @IsOptional() @IsString() reason?: string;
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

/** Turn the worked-out road on or off. `on: false` also clears it — leaving it in place while promising it
 *  is off would be the worst of both. */
export class DerivedLegDto {
  @IsBoolean() on!: boolean;
}

/**
 * "Do not wake me for less than this." OMITTED, or zero, clears the floor.
 *
 * Optional rather than required so that clearing it is the same call as setting it — a separate "clear"
 * endpoint is how a driver ends up with a silencer they cannot find the switch for.
 */
/** A store declining a return. Its own words, kept on the offer. */
export class DeclineReturnDto {
  @IsOptional() @IsString() @MaxLength(200) reason?: string;
}

export class NudgeMinEarnDto {
  @IsOptional() @IsNumber() @Min(0) amount?: number;
}

/** Why a payout did not go, or came back. Free text because a rail's reason is a rail's own words. */
export class PayoutFailureDto {
  @IsString() reason!: string;
}

/** The rail's confirmation. Its reference, when it gives a better one than the submit call did. */
/** Who is acting, typed: on a laptop's shared staff key only, where a name is all there is to tell two people apart. */
export class PayoutStaffDto {
  @IsOptional() @IsString() @MaxLength(80) by?: string;
}

export class PayoutSettleDto {
  @IsOptional() @IsString() providerRef?: string;
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

/** The fleet office puts a vehicle on a driver's list for today. It starts no shift. */
export class SuggestVehicleDto {
  @IsString() vehicleId!: string;
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
  /**
   * The driver's PIN — required when they start their OWN shift. A phone left signed in is not proof of who is
   * holding it, and the start of a shift is where the network records who is driving which vehicle.
   */
  @IsOptional() @IsString() @MaxLength(8) pin?: string;
  /** The leg for this shift, declared in the same breath as picking the vehicle. */
  @IsOptional() @ValidateNested() @Type(() => DeclareLegDto) leg?: DeclareLegDto;
  /** What the odometer says as the shift starts, in whole km. Checked before the shift starts: lower than the last is refused. */
  @IsOptional() @IsInt() @Min(0) @Max(9_999_999) odometerKm?: number;
}

/** Ending a shift: what the odometer says now, if the driver read it. It never stops the shift ending. */
export class EndSessionDto {
  @IsOptional() @IsInt() @Min(0) @Max(9_999_999) odometerKm?: number;
  /** Round 24 — when the driver ended it, by the phone's clock: a shift ended with no signal waits on the phone. */
  @IsOptional() @IsDateString() observedAt?: string;
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
  /** CL1 — the trade term the parties agreed, and the place it names. Selected from the eleven, never invented. */
  @IsOptional() @IsIn(INCOTERM_CODES as string[]) @ApiPropertyOptional({ enum: INCOTERM_CODES }) incoterm?: string;
  @IsOptional() @IsString() @MaxLength(120) namedPlace?: string;
  /** CL1 — who the goods are FOR. The service has always accepted it and this DTO never offered it, so a
   *  load posted through this route recorded no receiver at all. That was harmless while only the sender
   *  could claim; it stops being harmless the moment a term can put the loss on the receiver, because the
   *  party with standing then has no way to be recognised. */
  @IsOptional() @IsString() buyerMobile?: string;
  /** FP7 — CMR box 13 at posting: instructions for the door, a contact to dial, a delivery window. */
  @IsOptional() @IsString() @MaxLength(500) instructions?: string;
  @IsOptional() @IsString() @MaxLength(80) contactName?: string;
  @IsOptional() @IsString() @MaxLength(32) contactPhone?: string;
  @IsOptional() @IsString() @MaxLength(80) deliveryWindow?: string;
  /** CA6 — the country at each end, where the poster knows it; the rules of crossing are only asked of a known country. */
  @IsOptional() @IsString() pickupCountry?: string;
  @IsOptional() @IsString() destCountry?: string;
  @ValidateNested() @Type(() => GeoDto) pickupLocation!: GeoDto;
  @IsString() pickupLabel!: string;
  @IsString() destLabel!: string;
  @IsOptional() @ValidateNested() @Type(() => GeoDto) destLocation?: GeoDto;
  @IsNumber() @Min(1) weightKg!: number;
  /** FB0b — the load's measurements. Optional: loose bulk genuinely has none (a tipper-load of sand has a
   *  weight and no shape), and a bulletin freight may be posted before anyone has measured it. Supplied, they
   *  are STORED — until FB0b they were read to classify the cargo and then discarded, which is why nothing
   *  downstream could answer "does this fit a flatbed rather than a box body". */
  @IsOptional() @ValidateNested() @Type(() => DimensionsDto) dimensionsCm?: DimensionsDto;
  /** Can it be split into two smaller loads? A divisible 30 t is two ordinary trips; an indivisible 30 t is a
   *  low-loader and a permit. */
  @IsOptional() @IsBoolean() indivisible?: boolean;
  /** The minter's own body pick — ADVISORY. Recorded and shown, never used to match: a wrong pick would
   *  silently exclude the operator who could have taken the load. */
  @IsOptional() @IsIn(TRUCK_SUBTYPES) bodyHint?: string;
  /** FB5 — how the goods are PACKED, which decides the body and what has to lift it. Omitted falls back to
   *  the DEPLOYMENT's default (sacks here, loose in a European deployment), never to a network-wide guess. */
  @IsOptional() @IsIn(PACKAGING) @ApiPropertyOptional({ enum: PACKAGING }) packaging?: Packaging;
  /** How many packages the load is: each gets a label, and an SSCC under the shipper's GS1 prefix when it has one. */
  @IsOptional() @IsInt() @Min(1) @Max(500) packages?: number;
  /** Bodies the SHIPPER rules out (theft risk, an insurer's wording, a customer's requirement). A stated
   *  preference, not a physical constraint, and the board presents it as one. */
  @IsOptional() @IsArray() @IsIn([...TRUCK_SUBTYPES], { each: true }) @ApiPropertyOptional({ enum: TRUCK_SUBTYPES, isArray: true }) excludedBodies?: string[];
  /** FB0c — 'negotiate' posts the load for a price to be agreed BEFORE anyone commits: drivers send their
   *  number, the poster accepts one, and only that acceptance claims it. Absent = 'instant', the behaviour
   *  every load has had until now. A negotiate load is deliberately kept out of the push offers and nudges,
   *  which exist to be answered with a single Claim tap. */
  @IsOptional() @IsIn(['instant', 'negotiate']) @ApiPropertyOptional({ enum: ['instant', 'negotiate'] }) commitMode?: 'instant' | 'negotiate';
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
  /** B4 — an expeditor posting it for one of its clients, as their agent. A business sign-in only. */
  @IsOptional() @IsString() forClientId?: string;
  /**
   * P1 — order it under a standing contract: it goes to that fleet's queue and onto no market. A business sign-in, on a
   * contract it has linked. `deliverOn` is then required — the day it must arrive, today or later.
   */
  @IsOptional() @IsString() contractId?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'A delivery day is YYYY-MM-DD' }) deliverOn?: string;
  /** P1b — the shipper's own number for an order under a contract. Used once per contract. */
  @IsOptional() @IsString() @MaxLength(60) orderRef?: string;
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
  /** CL1 — the trade term the parties agreed, and the place it names. Selected from the eleven, never invented. */
  @IsOptional() @IsIn(INCOTERM_CODES as string[]) @ApiPropertyOptional({ enum: INCOTERM_CODES }) incoterm?: string;
  @IsOptional() @IsString() @MaxLength(120) namedPlace?: string;
  /** FP7 — CMR box 13 at the counter: instructions for the door, a contact to dial, a delivery window. */
  @IsOptional() @IsString() @MaxLength(500) instructions?: string;
  @IsOptional() @IsString() @MaxLength(80) contactName?: string;
  @IsOptional() @IsString() @MaxLength(32) contactPhone?: string;
  @IsOptional() @IsString() @MaxLength(80) deliveryWindow?: string;
  @IsNumber() @Min(0.01) budgetCap!: number; // the cash cap the customer prepays → the freight's maxSpend ceiling
  /** FB0c/FB2b — 'negotiate' posts the load for drivers to name a price the counter then accepts, instead of
   *  the first fit truck taking it at the computed rate. The cash cap still binds either way: a price above
   *  what the customer agreed cannot be accepted, whoever named it. */
  @IsOptional() @IsIn(['instant', 'negotiate']) @ApiPropertyOptional({ enum: ['instant', 'negotiate'] }) commitMode?: 'instant' | 'negotiate';
  @IsOptional() @Matches(SCHEDULED_PICKUP_RE, { message: SCHEDULED_PICKUP_MSG }) scheduledPickupAt?: string; // absent = ship now; present = planned
  @IsOptional() @IsBoolean() allowEarlyClaim?: boolean; // planned only: may a driver reserve it before the date (default true)
  /** FB2c — can the load be split into two smaller ones? The counter is the one place someone is standing in
   *  front of the thing, so it is the one place this can honestly be answered — and it is the fact that flips
   *  a heavy load from an open deck to a low-loader, which no measurement implies. */
  @IsOptional() @IsBoolean() indivisible?: boolean;
  /** FB2c — what the shop THINKS the load needs. ADVISORY by decision: recorded, shown and counted, never
   *  matched on, because a clerk cannot reliably tell a skeletal from a flatbed and a binding wrong pick
   *  would exclude the one operator who could have carried it. */
  @IsOptional() @IsIn(TRUCK_SUBTYPES) bodyHint?: string;
  /** FB5 — how the goods are PACKED, which decides the body and what has to lift it. Omitted falls back to
   *  the DEPLOYMENT's default (sacks here, loose in a European deployment), never to a network-wide guess. */
  @IsOptional() @IsIn(PACKAGING) @ApiPropertyOptional({ enum: PACKAGING }) packaging?: Packaging;
  /** FB2d — bodies the SHIPPER rules out. At a counter the walk-in customer IS the shipper, so this is their
   *  call to make and the clerk's job only to record it. A PREFERENCE, not a limit of any vehicle: the board
   *  shows it as the shipper's choice, and it binds a claim only because the driver was told first. */
  @IsOptional() @IsArray() @IsIn([...TRUCK_SUBTYPES], { each: true }) @ApiPropertyOptional({ enum: TRUCK_SUBTYPES, isArray: true }) excludedBodies?: string[];
}

/** S32b — a driver advancing a claimed freight (pickup/deliver). driverDid is the claimer, verified against
 *  the freight's claimedBy so only the driver who claimed it may advance it.
 *  S33 — plus the safety gate: `confirmed` are the checklist item keys the driver ticked (load at pickup,
 *  unload at delivery) and `securementPhotoId` the uploaded mediaId of the secured load (pickup only). */
/**
 * FB1 — the open board's query. Note what is NOT here: no minEarn, no maxWeight, no body filter. Every one of
 * those would REMOVE a row, and the board's whole purpose is that a load you cannot take still appears, marked
 * with why. Narrowing happens on the client, over a complete answer.
 */
/** FP5 — the fleet's dispatch view: which driver on shift to judge the market against, and how far out. */
export class FleetDispatchQueryDto {
  @IsOptional() @IsString() driver?: string;
  @IsOptional() @IsNumber() @Type(() => Number) @Min(1) radiusKm?: number;
}

/** FP5 — put this load on this driver. Both must be the fleet's own. */
export class FleetAssignDto {
  @IsString() freightId!: string;
  @IsString() driverDid!: string;
}

export class FreightBoardQueryDto {
  @IsNumber() @Type(() => Number) @Min(-90) @Max(90) lat!: number;
  @IsNumber() @Type(() => Number) @Min(-180) @Max(180) lng!: number;
  /** The OPERATOR's own reach, in km. Omit for the whole market — there is no platform clamp here: 15 km is
   *  right for a lock-screen interruption and wrong for a haulier asking "is it worth 80 km empty?". */
  @IsOptional() @IsNumber() @Type(() => Number) @Min(1) radiusKm?: number;
  /** Whose vehicle to judge against. A driver is pinned to their own; only an operator may name another. */
  @IsOptional() @IsString() driverDid?: string;
}

/**
 * FB3b — the PUBLIC market's query. Anyone, anywhere, about anywhere.
 *
 * The same two knobs as the board and no third: a point and the caller's own reach. There is deliberately no
 * `driverDid` — this endpoint judges nothing against anybody, which is exactly what lets it be public.
 */
export class MarketQueryDto {
  @IsNumber() @Type(() => Number) @Min(-90) @Max(90) lat!: number;
  @IsNumber() @Type(() => Number) @Min(-180) @Max(180) lng!: number;
  /** How far the caller cares to look, in km. Omit for the whole market. */
  @IsOptional() @IsNumber() @Type(() => Number) @Min(1) radiusKm?: number;
}

/**
 * FB4 — the market series query. Where, how far around it, and over what period.
 *
 * The point is OPTIONAL here, unlike on the market board: "how much flatbed work is there on this network"
 * is a real question with no natural centre, and forcing a caller to name a city to ask it would make the
 * whole-network answer unreachable.
 */
export class MarketSeriesQueryDto {
  @IsOptional() @IsNumber() @Type(() => Number) @Min(-90) @Max(90) lat?: number;
  @IsOptional() @IsNumber() @Type(() => Number) @Min(-180) @Max(180) lng?: number;
  @IsOptional() @IsNumber() @Type(() => Number) @Min(1) radiusKm?: number;
  /** Window start, ISO. Defaults to twelve months back — the "yearly km" the series is asked for in. */
  @IsOptional() @IsDateString() since?: string;
  /** Window end, ISO. Defaults to now. */
  @IsOptional() @IsDateString() until?: string;
}

/** When goods are loaded at one of a company's places: what is not sent stays, and null clears it. */
export class SiteLoadingDto {
  /** Day by day ({ mon: { open: '06:00', close: '18:00' }, sun: null }). `null` here: any hour. */
  @IsOptional() @IsObject() hours?: Record<string, { open: string; close: string } | null> | null;
  /** How many trucks load at once. `null` here: not counted. */
  @ApiPropertyOptional({ type: Number, nullable: true }) @IsOptional() @IsInt() @Min(1) @Max(50) bays?: number | null;
}

/** Save a place this company will choose again — a port it collects from, or somewhere it delivers. */
export class DeclareSiteDto {
  @IsOptional() @IsString() entityId?: string;
  /*
   * READ FROM SITE_KINDS, never restated. A literal here is a second copy of a rule that lives in the
   * service, and a second copy drifts: adding 'clearance' to the kinds left this decorator refusing it,
   * with a message naming two kinds while the service knew three. Third time a DTO decorator carrying a
   * duplicate of a rule has bitten in this project — the box's tare sentence and the road leg's
   * destination label were the others.
   */
  @IsIn([...SITE_KINDS]) kind!: SiteKind;
  @IsString() @MaxLength(80) name!: string;
  /** A dropped pin. Exactly one of this and `address` is needed; a pin wins where both arrive. */
  @IsOptional() @ValidateNested() @Type(() => GeoDto) location?: GeoDto;
  /** An address to resolve. Refused where we cannot place it, rather than guessed at. */
  @IsOptional() @IsString() @MaxLength(200) address?: string;
  @IsOptional() @IsString() by?: string;
}

export class SitesQueryDto {
  @IsOptional() @IsString() entityId?: string;
  @IsOptional() @IsIn([...SITE_KINDS]) kind?: SiteKind;
}

/** Who carried on one lane. The lane is named by its two ENDS, exactly as the series names it. */
export class LaneCarriersQueryDto {
  @IsString() @MaxLength(80) from!: string;
  @IsString() @MaxLength(80) to!: string;
  @IsOptional() @IsDateString() since?: string;
  @IsOptional() @IsDateString() until?: string;
}

/** FB0c — a driver's price for a load posted 'negotiate'. It reserves nothing; the poster's acceptance is
 *  what claims the load. */
export class ProposeFreightDto {
  @IsOptional() @IsString() driverDid?: string; // operator-override only; a driver is pinned to their token
  /** Where the driver is proposing FROM. Required, not optional: the accepted haul records this as its real
   *  deadhead, and defaulting an unknown empty run to zero would flatter every negotiated job in the market
   *  series — the one thing FB0a exists to prevent. */
  @IsDefined() @ValidateNested() @Type(() => GeoDto) from!: GeoDto;
  /** The DRIVER's earning being asked for (not the shipper's all-in charge). */
  @IsNumber() @Min(0.01) price!: number;
  /** The case for the number, in the driver's own words. */
  @IsOptional() @IsString() note?: string;
}

/** FB0c — a driver withdrawing their own proposal. */
export class WithdrawProposalDto {
  @IsOptional() @IsString() driverDid?: string; // operator-override only
}

/** Round 40 — the auditor's address, as one member of staff asks for it. */
export class AnchorAuditorDto {
  @IsString() @MaxLength(200) address!: string;
}

/** Round 40 — a second member of staff approves the change, or declines it with the reason. */
export class AnchorAuditorDecisionDto {
  @IsBoolean() approve!: boolean;
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

/** Round 40 — an auditor's copy read out: the link number and its fingerprint. */
export class AnchorCopyCheckDto {
  @IsNumber() height!: number;
  @IsString() @MaxLength(80) txId!: string;
}

/** Round 40 — one point of the 7-point inspection, looked at and photographed: the photo a driver uploaded as `inspection`. */
export class InspectionPointDto {
  @IsString() @MaxLength(32) point!: string;
  @IsString() @MaxLength(80) photoRef!: string;
}

export class FreightActionDto {
  @IsOptional() @IsString() driverDid?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) confirmed?: string[];
  @IsOptional() @IsString() securementPhotoId?: string;
  /** FP3 — at pickup: the carrier's reservations about the goods as handed over (box 18). */
  @IsOptional() @IsString() @MaxLength(500) reservations?: string;
  /** FP3 — at delivery: who received the goods, the photo of them as put down, and what the receiver said (box 24). */
  @IsOptional() @IsString() @MaxLength(120) receiverName?: string;
  @IsOptional() @IsString() podPhotoId?: string;
  @IsOptional() @IsString() @MaxLength(500) remarks?: string;
  /** Round 15 — at pickup: each seal's number as read off the door, with its close-up. */
  @IsOptional() @IsArray() @ArrayMaxSize(MAX_SEALS) @ValidateNested({ each: true }) @Type(() => SealReadDto) seals?: SealReadDto[];
  /** Round 15 — at delivery, with the receiver: the seals as the note says, or not. */
  @IsOptional() @IsIn(SEALS_AT_DELIVERY) sealsAtDelivery?: SealsAtDelivery;
  /** Round 22 — when the driver did it, by the phone's clock: a pickup or delivery kept on the phone with no signal. */
  @IsOptional() @IsDateString() observedAt?: string;
  /** Round 40 — at pickup of a container or closed body leaving for a border: the seven points, each with its photograph. */
  @IsOptional() @IsArray() @ArrayMaxSize(7) @ValidateNested({ each: true }) @Type(() => InspectionPointDto) inspection?: InspectionPointDto[];
}

/** FP3b — the driver stood at the door and could not hand over. */
export class FreightDeliveryFailedDto {
  @IsOptional() @IsString() driverDid?: string;
  @IsIn(['absent', 'refused', 'unreachable']) outcome!: 'absent' | 'refused' | 'unreachable';
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

/** FP3b — the sender's claim against a delivered load. */
export class OpenFreightClaimDto {
  @IsIn(['damaged', 'short', 'not_received']) kind!: 'damaged' | 'short' | 'not_received';
  @IsString() @MaxLength(1000) description!: string;
  @IsOptional() @IsString() photoRef?: string;
}

/** FP3 — the sender withdraws a load before taking over. The reason goes on the note. */
export class CancelFreightDto {
  @IsString() @MaxLength(500) reason!: string;
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
  /** Round 24 — when the driver read it, by the phone's clock: a reading taken with no signal waits on the phone. */
  @IsOptional() @IsDateString() observedAt?: string;
}

/**
 * A driver reporting the road, one tap from the cab.
 *
 * Short on purpose, because of WHERE it is filled in. A long form is not something anybody completes at a
 * junction with a truck behind them, so everything here is either a tap (`kind`), already known to the
 * phone (`at`), or one number off a sign (`value`). `note` is never required.
 *
 * There is no `by`: who reported it comes from the verified token, never from the body. A hazard map whose
 * attribution can be self-asserted is a hazard map anybody can poison anonymously.
 */
export class ReportConstraintDto {
  @IsIn(CONSTRAINT_KINDS) kind!: ConstraintKind;
  @ValidateNested() @Type(() => GeoDto) at!: GeoDto;
  /** Metres for a height, kilograms for a limit. Required for the kinds that have something to measure —
   *  the service refuses those without it, because an unmeasured limit cannot be checked against a load. */
  @IsOptional() @IsNumber() @Min(0.01) value?: number;
  @IsOptional() @IsString() @MaxLength(200) note?: string;
  /**
   * A media id of the thing itself — the bridge, the washout, the sign.
   *
   * OPTIONAL, and that is the design rather than laziness: a driver at a washout at night who cannot
   * safely stop must still be able to warn everybody, and a photograph as a gate would suppress reports
   * exactly where they matter most. A report with no photo warns identically; the picture is what an
   * OPERATOR later clears or keeps the hazard on.
   */
  @IsOptional() @IsString() photoRef?: string;
  /**
   * When the person made this report, by their phone's clock. Sent by the apps every time: a report made with no signal
   * waits on the phone and arrives later, and is dated by this (never in the future, at most a week back).
   */
  @IsOptional() @IsDateString() observedAt?: string;
}

/** A later passer-by saying it is not there any more, with their own words and their own photograph. */
export class RefuteConstraintDto {
  @IsOptional() @IsString() @MaxLength(200) note?: string;
  /** A photo of the road now clear — the strongest thing anybody can offer for the dangerous direction. */
  @IsOptional() @IsString() photoRef?: string;
  /**
   * When the person made this report, by their phone's clock. Sent by the apps every time: a report made with no signal
   * waits on the phone and arrives later, and is dated by this (never in the future, at most a week back).
   */
  @IsOptional() @IsDateString() observedAt?: string;
}

/** A later passer-by saying it IS still there. Same shape: agreement is evidence too. */
export class ConfirmConstraintDto {
  @IsOptional() @IsString() @MaxLength(200) note?: string;
  @IsOptional() @IsString() photoRef?: string;
  /**
   * When the person made this report, by their phone's clock. Sent by the apps every time: a report made with no signal
   * waits on the phone and arrives later, and is dated by this (never in the future, at most a week back).
   */
  @IsOptional() @IsDateString() observedAt?: string;
}

/**
 * An operator clearing a constraint — the only thing that stops one warning.
 *
 * The reason is REQUIRED and it is kept. A hazard removed with no recorded justification cannot be told
 * apart later from somebody deleting an inconvenient bridge.
 */
export class ClearConstraintDto {
  @IsString() @MaxLength(300) reason!: string;
  /** An operator may name the human who made the call; otherwise the token speaks for itself. */
  @IsOptional() @IsString() by?: string;
}

/** What is around here — the driver's map. A point, and how far they care to look. */
export class ConstraintsNearQueryDto {
  @IsNumber() @Type(() => Number) @Min(-90) @Max(90) lat!: number;
  @IsNumber() @Type(() => Number) @Min(-180) @Max(180) lng!: number;
  @IsOptional() @IsNumber() @Type(() => Number) @Min(1) radiusKm?: number;
}

/** What sits on the line between two places — the corridor a driver is about to run. */
export class ConstraintsRouteQueryDto {
  @IsNumber() @Type(() => Number) @Min(-90) @Max(90) fromLat!: number;
  @IsNumber() @Type(() => Number) @Min(-180) @Max(180) fromLng!: number;
  @IsNumber() @Type(() => Number) @Min(-90) @Max(90) toLat!: number;
  @IsNumber() @Type(() => Number) @Min(-180) @Max(180) toLng!: number;
}
