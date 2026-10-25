import { Body, Controller, Get, Optional, Param, Post } from '@nestjs/common';
import { AgreementService } from '../../foundation/documents/agreement.service';
import { Actor } from '../../foundation/auth/actor.decorator';
import type { IntrospectionResult } from '../../foundation/auth/auth.types';
import { Roles } from '../../foundation/auth/scopes.decorator';
import { GlosError } from '../../foundation/http/glos-error';
import { hashPhone } from '../../foundation/identity/phone';
import { MailService } from '../../foundation/mail/mail.service';
import { FleetManagerService } from './fleet-manager.service';
import { FleetSignupView } from './fleet.types';
import { FleetSignupDto, FleetSignupPapersDto } from './fleet-signup.types';
import { MediaService } from './media.service';
import type { MediaKind } from './media.types';
import { PersonService } from './person.service';

/** How many sign-ups one person may have waiting for SeeBuyGet at once: enough for somebody with two companies. */
export const MAX_WAITING_SIGNUPS = 3;

/** The four papers, in the order they are asked for, each with the kind of picture it is kept as. */
const PAPERS: Array<[keyof FleetSignupPapersDto, MediaKind]> = [
  ['businessRegCertRef', 'kyc_registration'],
  ['operatorLicenceRef', 'kyc_licence'],
  ['ownerIdRef', 'kyc_id'],
  ['proofOfAddressRef', 'kyc_address'],
];

/**
 * A FLEET SIGNS ITSELF UP (the user, 2026-10-23: "the fleet app register is impossible. It gives a help page while it
 * should give a clear sign up form that can be checked by sbg staff").
 *
 * A shop, a courier, a hub and a store joined on the front page; a fleet could only write to us and wait for a member of
 * staff to type it into the console. Now the person who runs it fills in what staff would have typed, with the four
 * papers, signed in as themselves — the same phone and PIN they will open the Fleet app with. The record is the one the
 * console makes, waiting where the console already looks (`fleet/managers/setting-up`): any one member of staff may
 * approve papers the fleet sent itself (the two-person rule is about staff entering papers, and nobody on staff did),
 * staff record the bond, and the fleet is active.
 *
 * Every refusal comes before anything is written: the person, the number, the papers, then the record's own checks.
 */
@Controller('sbg')
export class FleetSignupController {
  constructor(
    private readonly managers: FleetManagerService,
    private readonly persons: PersonService,
    private readonly media: MediaService,
    @Optional() private readonly mail?: MailService,
    // 2026-10-25 — the person signing the fleet up has agreed to what counts now, or agrees with this sign-up.
    @Optional() private readonly agreements?: AgreementService,
  ) {}

  /** Sign a fleet up: the record, the person as its first manager, and its papers — with SeeBuyGet to check. */
  @Roles('consumer')
  @Post('fleet/signups')
  signUp(@Body() dto: FleetSignupDto, @Actor() actor: IntrospectionResult): FleetSignupView {
    const person = this.persons.requireByDid(personOf(actor));
    // The Fleet app opens with a phone and a PIN, so a fleet nobody can sign in to is not signed up.
    if (!person.pinHash) throw new GlosError('INVALID_STATE', 'Choose your PIN first: it is how you open the Fleet app');
    if (!dto.phone?.trim() || hashPhone(dto.phone) !== person.phoneHash) {
      throw new GlosError('FORBIDDEN', 'Sign a fleet up with the phone number you signed in with', { field: 'phone' });
    }
    if (!dto.contactEmail?.includes('@')) throw new GlosError('EMAIL_INVALID', 'Give an email address for the company: we write to it when your papers have been checked', { field: 'contactEmail' });
    this.agreements?.assertFor(actor, dto.agreement, 'fleet/signups', dto.jurisdiction);
    const waiting = this.signupsOf(person.roles).filter((s) => s.status === 'DRAFT' || s.status === 'KYC_PENDING');
    if (waiting.length >= MAX_WAITING_SIGNUPS) {
      throw new GlosError('INVALID_STATE', `You already have ${waiting.length} fleets waiting for SeeBuyGet. Wait for one to be checked before signing up another.`);
    }
    // Each paper a photograph of its own, taken by this person and attached to nothing yet.
    this.assertPapers(dto.papers, person.personDid);

    // The record refuses for its own reasons — a number missing, a country not reached, a company already here — before it writes.
    const manager = this.managers.register(
      {
        companyName: dto.companyName.trim(),
        jurisdiction: dto.jurisdiction.trim().toUpperCase(),
        ...(dto.tradingName?.trim() ? { tradingName: dto.tradingName.trim() } : {}),
        contactPhone: dto.phone.trim(),
        contactEmail: dto.contactEmail.trim(),
        ownerFullName: dto.ownerFullName.trim(),
        ownerNationalId: dto.ownerNationalId.trim(),
        ...(dto.depotAddress?.trim() ? { depotAddress: dto.depotAddress.trim() } : {}),
        ...(dto.location ? { location: { lat: dto.location.lat, lng: dto.location.lng } } : {}),
        requirements: dto.requirements,
      },
      { signedUp: true },
    );
    this.persons.attachRole(dto.phone.trim(), 'fleet_manager', manager.did, manager.did);
    this.sendPapers(manager.did, dto.papers, person.personDid);
    if (manager.contactEmail) {
      void this.mail?.send('fleet-signup', { address: manager.contactEmail, name: manager.companyName }, { company: manager.companyName, stage: 'received', when: new Date().toISOString() });
    }
    return this.signupsOf(this.persons.requireByDid(person.personDid).roles).find((s) => s.did === manager.did)!;
  }

  /** The fleets this person signed up, and where each stands — read back on the front page after the PIN. */
  @Roles('consumer')
  @Get('fleet/signups/mine')
  mine(@Actor() actor: IntrospectionResult): { items: FleetSignupView[] } {
    return { items: this.signupsOf(this.persons.requireByDid(personOf(actor)).roles) };
  }

  /** Papers that came back, sent again — by a manager of that fleet, and only while they are back with the fleet. */
  @Roles('consumer')
  @Post('fleet/signups/:did/papers')
  sendAgain(@Param('did') did: string, @Body() dto: FleetSignupPapersDto, @Actor() actor: IntrospectionResult): FleetSignupView {
    const person = this.persons.requireByDid(personOf(actor));
    const own = this.signupsOf(person.roles).find((s) => s.did === did);
    if (!own) throw new GlosError('NOT_FOUND', 'No fleet of yours has signed up with that id');
    if (own.status !== 'DRAFT') throw new GlosError('INVALID_STATE', own.status === 'KYC_PENDING' ? 'Your papers are with SeeBuyGet already' : 'Your papers have been checked already');
    this.assertPapers(dto, person.personDid, did);
    this.sendPapers(did, dto, person.personDid);
    return this.signupsOf(person.roles).find((s) => s.did === did)!;
  }

  /** The fleets behind this person's manager roles that signed themselves up. */
  private signupsOf(roles: Array<{ role: string; entityDid: string; status: string }>): FleetSignupView[] {
    return this.managers.signupsOf(roles.filter((r) => r.role === 'fleet_manager' && r.status === 'active').map((r) => r.entityDid));
  }

  private assertPapers(papers: FleetSignupPapersDto, owner: string, fleetDid?: string): void {
    const refs = PAPERS.map(([key]) => papers?.[key]?.trim() ?? '');
    if (refs.some((ref) => !ref)) throw new GlosError('KYC_INCOMPLETE', 'Send all four papers: the certificate of registration, the operator’s licence, the owner’s ID and a proof of address');
    if (new Set(refs).size !== refs.length) throw new GlosError('PHOTO_REQUIRED', 'Each paper is a photograph of its own: take each one');
    const link = fleetDid ? { type: 'fleet' as const, id: fleetDid } : undefined;
    if (refs.some((ref) => !this.media.mayAdopt(ref, owner, link))) throw new GlosError('PHOTO_REQUIRED', 'That picture could not be attached — take the photograph again');
  }

  /** The papers, attached to the fleet and put on record as the fleet's own — no member of staff entered them. */
  private sendPapers(did: string, papers: FleetSignupPapersDto, owner: string): void {
    for (const [key, kind] of PAPERS) this.media.adopt(papers[key].trim(), owner, { type: 'fleet', id: did }, kind);
    this.managers.submitKyc(did, {
      businessRegCertRef: papers.businessRegCertRef.trim(),
      operatorLicenceRef: papers.operatorLicenceRef.trim(),
      ownerIdRef: papers.ownerIdRef.trim(),
      proofOfAddressRef: papers.proofOfAddressRef.trim(),
    });
  }
}

function personOf(actor: IntrospectionResult): string {
  const did = actor?.personDid ?? actor?.did;
  if (!did) throw new GlosError('FORBIDDEN', 'Sign in first');
  return did;
}
