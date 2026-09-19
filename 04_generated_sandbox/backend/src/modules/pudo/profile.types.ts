import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { HANDLE_KINDS, type HandleKind } from '../../foundation/handle/handle.service';
import { ClearanceOffer, ClearanceRecord } from './import.types';
import { ContactCardView } from './depot.types';
import { GeoPoint } from './pudo.types';

/**
 * What a presence level PROMISES, in the words a stranger reads on a public page.
 *
 * Spelled out rather than left as a word, because the ladder's whole point is that the levels are not
 * degrees of enthusiasm — they are different answers to "can this network hold your money and pay a claim
 * here". A reader who takes `observed` for a soft `established` has been misled by us.
 */
export function presenceSays(level: string): string {
  switch (level) {
    case 'established':
      return 'We have a company in this country: it can take money in, pay out, and answer a claim.';
    case 'partnered':
      return 'We work here through a partner company. What it can settle depends on that partner.';
    case 'matched':
      return 'We match loads here and hold no money. Nothing on this network can pay a claim in this country.';
    default:
      return 'We only observe this country so far. We hold no money here and can settle nothing.';
  }
}

/** What each kind of participant DOES, in plain words rather than a capability list to decode. */
export function profileDoes(kind: string): string {
  switch (kind) {
    case 'shop':
      return 'Takes parcels in and hands them out over a counter.';
    case 'hub':
      return 'Sorts parcels between routes.';
    case 'fleet':
      return 'Runs vehicles and drivers, and takes loads off the market.';
    case 'clearing-agent':
      /*
       * Not one of HANDLE_KINDS, and deliberately not: being a clearing agent is DERIVED from having been
       * appointed, never a kind somebody registers as. This is the sentence that makes an agent findable
       * at all — a page saying only "a company on this network" closes nothing.
       *
       * AND IT DOES NOT SAY "CONTAINERS", which the first version did. The user's correction: agents do
       * not all clear containers — some clear air freight, some vehicles, as their speciality. A
       * container is simply the only consignment this system happens to record, and writing it into a
       * sentence about somebody's business made our limitation look like their job description. What
       * they actually clear is THEIR claim, carried in `offer` and shown as theirs.
       */
      return 'Clears goods through customs for importers, and says what papers each border will ask for.';
    default:
      return 'A company on this network.';
  }
}

/**
 * What the network has checked about this participant, and when.
 *
 * A NAMED class rather than an inline shape, and not for tidiness: the swagger plugin cannot infer an
 * array of anonymous objects and fails the contract emit with a misleading "circular dependency" on the
 * property name. Same family as the CL2b lesson — declared ABOVE its user, because the plugin evaluates
 * the reference when the referring class is defined.
 */
export class ProfileVerification {
  /** What was checked, in words — 'trading licence', not 'kyc_licence'. */
  what: string;
  at: string;
}

/** One lane, or one commodity class, of a mobilisation record. Declared above its user. */
export class ProfileMobilisationSlice {
  key: string;
  claimed: number;
  handedBack: number;
  kept: number;
  delivered: number;
}

/**
 * CL4 — what they did with the loads they took. Counts always; rates only when there are enough.
 *
 * NO BLENDED SCORE, and there must never be one: blending is exactly what makes bribery look like
 * competence, and the half of this that cannot be measured honestly is left unmeasured rather than
 * folded in at a guess.
 */
export class ProfileMobilisation {
  claimed: number;
  handedBack: number;
  kept: number;
  delivered: number;
  /** Neither delivered nor handed back — running. Not a success and not a failure. */
  inFlight: number;
  /** Loads they kept that nobody else would take for two days: scarcity work. */
  tightKept: number;
  tightDelivered: number;
  /** Null while the record is thin — three loads shows three loads and no average. */
  @ApiPropertyOptional()
  keptRate?: number | null;
  @ApiPropertyOptional()
  deliveredRate?: number | null;
  thin: boolean;
  /** How many loads a rate needs, so a screen can say so without knowing the server's config. */
  ratesNeed: number;
  @ApiProperty({ type: [ProfileMobilisationSlice] })
  lanes: ProfileMobilisationSlice[];
  @ApiProperty({ type: [ProfileMobilisationSlice] })
  classes: ProfileMobilisationSlice[];
}

/** How established the network is where they stand, and what that does and does not promise. */
export class ProfilePresence {
  level: string;
  /** The promise spelled out, because a public reader has no other way to know what the word means. */
  says: string;
}

/**
 * WHAT A PUBLIC PROFILE SAYS — `seebuyget.com/@fedex`.
 *
 * The directory, as a page per participant rather than a list. A ranked list would impose an ordering on
 * people whether or not anything went wrong, and while the network is the party appointing clearing agents,
 * publishing that ordering is self-dealing. A page manufactures no loser out of relative position.
 *
 * THE DISCIPLINE OF THIS SHAPE: it states what we KNOW and never what we vouch for. A shop at `observed`
 * presence with no verified papers must not read like an established partner, so the presence level and
 * what it means travel WITH the identity rather than being left for a reader to assume. Every field here
 * is already public somewhere else (the reputation route, the network map) or is a fact about our own
 * standing; nothing on this page is drawn from the identity vault.
 *
 * No performance figure appears until CL4 is built and driven — `measured` is deliberately absent rather
 * than zero, because an empty score reads as a bad one.
 */
export class ProfileView {
  /** The handle, without the '@'. Immutable once issued, and derived from the verified name. */
  handle: string;

  @ApiProperty({ enum: HANDLE_KINDS })
  kind: HandleKind;

  /** The trading name as the record holds it now — which may differ from what the handle came from. */
  name: string;

  /**
   * The name the handle was derived from, present ONLY when it no longer matches `name`.
   *
   * A handle does not follow a rename (that would be a rotted link and a way to inherit somebody else's
   * page), so when the two diverge a reader is entitled to see both rather than wonder why the address
   * says one thing and the heading another.
   */
  @ApiPropertyOptional()
  formerly?: string;

  /** ISO-3166 alpha-2 where they stand. Absent for the group company, which stands nowhere in particular. */
  @ApiPropertyOptional()
  country?: string;

  /** A coarse pin, for the kinds that have a place a customer walks to. Never a street address. */
  @ApiPropertyOptional()
  at?: GeoPoint;

  /** The zone or town, in the words the record uses. */
  @ApiPropertyOptional()
  area?: string;

  /** On the network since. The one number that is honest from day one. */
  since: string;

  /**
   * HOW ESTABLISHED THE NETWORK IS WHERE THEY STAND, and what that does and does not promise.
   *
   * Carried because the page is public and a reader has no other way to know it: `matched` means we hold
   * no money there, and cover is zero by construction where nothing can pay a claim.
   *
   * ABSENT WHEN WE DO NOT KNOW WHICH COUNTRY THEY ARE IN, and that is the whole reason this is optional.
   * The presence service answers `observed` for an unknown jurisdiction, which is correct for the ladder
   * and a lie on a page: it renders as "we only observe this country" about a country nobody named. A
   * fleet with no jurisdiction on its record, and the group company that stands nowhere in particular,
   * both hit that. Found by reading the page rather than the code — the sentence was plausible and wrong.
   */
  @ApiPropertyOptional({ type: ProfilePresence })
  presence?: ProfilePresence;

  /** What this participant does here, in plain words — never a capability list a reader must decode. */
  does: string;

  /**
   * What the network has VERIFIED about them, and when. Empty is a real answer and shows as one.
   *
   * Never a badge and never a score: the list is what staff checked, so a reader can weigh it themselves
   * rather than trusting a tick.
   */
  @ApiProperty({ type: [ProfileVerification] })
  verified: ProfileVerification[];

  /**
   * CL4 — THE MOBILISATION RECORD: whether they find and move trucks.
   *
   * On the PUBLIC page on purpose. An operator-only signal does not remove our influence over who gets
   * appointed, it conceals it: work still gets steered by suggestion, and nobody outside can audit a
   * nudge. The shipper sees it because the shipper is the one choosing, and the party sees exactly the
   * same fields at the same moment — a record handed down is a verdict, one both parties hold is an
   * account.
   *
   * Absent for a kind that does not mobilise anything (a shop, a hub) rather than present and zero. The
   * counts are always real; the RATES are null while the record is thin, because five stars from three
   * loads is the same untruth as hiding them.
   */
  @ApiPropertyOptional({ type: ProfileMobilisation })
  moves?: ProfileMobilisation;

  /**
   * What we measured, and what we did NOT — carried in the payload so no screen can render the figures
   * without the sentence. This measure's failure mode is being read as a general endorsement.
   */
  @ApiPropertyOptional()
  movesMeasured?: string;

  /**
   * CL4 item 1 — THE CLEARANCE RECORD, for a company that has been appointed to clear a container.
   *
   * The same class the agent's own route returns, so their copy and a shipper's view cannot differ: a
   * record handed down is a verdict, one both parties hold is an account.
   *
   * What is NOT in it is the point. There is no border-time figure anywhere, because scoring an agent on
   * elapsed time at a counter systematically advertises whoever pays bribes, and absence of a seizure is
   * not evidence of compliance. `holds` carries what the STATE did, counted apart, labelled, disputable
   * by the other party to that container, and never netted off the agent's own figures.
   *
   * Absent for a company that has never been appointed, rather than present and zero.
   */
  @ApiPropertyOptional({ type: ClearanceRecord })
  clears?: ClearanceRecord;

  @ApiPropertyOptional()
  clearsMeasured?: string;

  /**
   * WHAT THEY SAY THEY CLEAR — their own advertisement, and the only asserted thing on this page.
   *
   * Everything else here is derived from the record, which is what makes the page trustworthy. This is
   * not, and it must be shown as what it is: a dated claim by the company itself, unchecked. It exists
   * because nobody else could know it — an agent who specialises in air freight or vehicles cannot be
   * discovered by observation until somebody has already hired them for it.
   */
  @ApiPropertyOptional({ type: ClearanceOffer })
  offer?: ClearanceOffer;

  /**
   * WHY AN EMPTY RECORD IS NOT A BAD RECORD.
   *
   * We count only the consignments that came through this network, and most of an agent's business never
   * will. Carried in the payload beside the counts, because a reader who takes silence for incompetence
   * has been misled by us about our own coverage.
   */
  @ApiPropertyOptional()
  recordSays?: string;

  /**
   * HOW TO REACH THEM — the company's own entry, written and published by them.
   *
   * Only for a COMPANY, and deliberately not for a shop or a hub: those pages carry a coarse pin and
   * never a street address, which is a consumer-safety choice this must not undo from the side. A yard or
   * a clearing agent publishing its own gate number and opening hours is a different act — it is a
   * business asking to be telephoned, and the directory's whole point is that somebody can.
   *
   * Never verified. The `basis` sentence says so on the page.
   */
  @ApiPropertyOptional({ type: ContactCardView })
  contact?: ContactCardView;
}
