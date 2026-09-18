import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { GlosError } from '../../foundation/http/glos-error';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { EntityService } from '../../foundation/entity/entity.service';
import { CompanyDocument, CompanyDocumentService } from '../../foundation/entity/company-documents.service';
import { PresenceService } from '../../foundation/presence/presence.service';
import { BooksService } from '../../foundation/books/books.service';
import { ACCOUNT_CODES } from '../../foundation/books/books.types';
import { DispatchService } from './dispatch.service';
import { ContainerBoxService } from './container-box.service';
import { BoxEnding, FreeDayKind } from './container-box';
import type { BoxView } from './container-box.service';
import type { GeoPoint } from './pudo.types';
import {
  BorderPaperObservation,
  CLEARANCE_SPECIALISMS,
  CONSIGNMENT_MODES,
  CUSTOMS_HOLD_KINDS,
  ClearanceOffer,
  ClearanceSpecialism,
  ConsignmentMode,
  CustomsHold,
  CustomsHoldKind,
  DocumentGrant,
  FeeState,
  HOLD_STANCES,
  HoldStance,
  ImportConsignment,
  ImportDetail,
  ImportFee,
  ImportRow,
  KnownPaper,
  MoneyHere,
  RequiredPaper,
  RequiredPaperView,
} from './import.types';
import { AgentRecord, agentRecordOf, isClearingAgent } from './agent-record';
import { containerType, heightUnstated, outOfGauge } from './container-type';
import { CARGO_NATURES, type CargoNature } from './cargo.types';

/**
 * CL2a — THE IMPORTER'S PAPERS, AND THE AGENT WHO CLEARS THEM.
 *
 * The user's own statement of the requirement is the scope: *share the documents digitally, grant access,
 * pay the agent, get the containers.* This service is the first three words of it — sharing and granting.
 * Paying the agent and minting the road leg from the port are CL2b, deliberately cut off here so that the
 * piece which answers the two weeks can ship without waiting on money.
 *
 * WHERE THIS STARTS AND STOPS
 *
 *  - It starts when the container is ONBOARDED and the shipping documents exist. At that moment arrival is
 *    certain, and the papers can be assembled during the voyage. That is the whole lever: the two weeks the
 *    user's first container sat at customs were two weeks nobody used while the ship was moving.
 *  - OCEAN CARRIAGE IS NOT OUR BUSINESS. We model no vessel, no schedule, no port of loading, and no port
 *    as an entity — `destPort` is a label a person types. There is no rate, no booking and no tracking of
 *    the sea leg anywhere in this file.
 *  - THE CARRIER SEAM IS NOT WIRED. `carrierRef`, `etaAt` and `etaSource` exist on the consignment so that
 *    a global carrier (Maersk and the like) could push arrival data by webhook later, and `etaSource` can
 *    then say `carrier_webhook` instead of `manual`. NOTHING FILLS THEM AUTOMATICALLY TODAY and there is no
 *    inbound route that does. It is written down here, and in the documentation, for the same reason the
 *    shipping API's callbacks section says its callbacks are queued and not delivered in a sandbox: an
 *    endpoint that never fires should be learned about in the documentation and not in production.
 *  - The road leg is minted from the port of destination, by a person, on the freight machinery that
 *    already exists. CL2b. Nothing here mints anything.
 *
 * THE LINE WE KEEP, from §10 of the design note: no tariff classification and no duty calculation, here or
 * anywhere downstream. "You will need a permit from the Ministry of Agriculture" is a list of papers, and we
 * carry it. "This chair attracts duty at X%" is regulated advice whose penalty lands on the importer, and we
 * never say it. The whole model below is lists of papers and who may read them; there is nowhere a rate
 * could even be stored.
 *
 * NO PRESENCE GATE IN THIS SLICE, on purpose. Recording a container and sharing papers commits the network
 * to nothing and moves no money, so there is nothing for presence to floor. The moment money appears —
 * paying the agent, in CL2b — it must be gated, because where we only match we cannot be the one who bills;
 * and that screen must say so at the start rather than fail at the end.
 */
@Injectable()
export class ImportService {
  private readonly imports = new PersistentMap<string, ImportConsignment>('import-consignments');
  /** Every grant ever made, live and revoked. Revoked ones are KEPT — see `DocumentGrant`. */
  private readonly grants = new PersistentMap<string, DocumentGrant>('document-grants');
  /** What agents have actually been asked for, per border. First-hand by construction. */
  private readonly observations = new PersistentMap<string, BorderPaperObservation>('border-paper-observations');
  /** CL6 — what each agent SAYS they clear, keyed by company. Their claim, never our finding. */
  private readonly offers = new PersistentMap<string, ClearanceOffer>('clearance-offers');

  constructor(
    private readonly entities: EntityService,
    private readonly documents: CompanyDocumentService,
    private readonly presence: PresenceService,
    private readonly books: BooksService,
    private readonly dispatch: DispatchService,
    private readonly boxes: ContainerBoxService,
  ) {}

  /* ------------------------------------------------------------ the container -- */

  /**
   * Record a container that is on its way. The importer is a company; the goods are theirs.
   *
   * Countries are NOT checked against our own catalogue here, and that is deliberate: the origin is
   * routinely somewhere the network does not operate at all (the user's first container came from the
   * Netherlands), and refusing to record it would be refusing the only piece of the job that has to happen
   * before we are involved.
   */
  register(
    input: {
      importerEntityId: string;
      goodsDescription: string;
      originCountry: string;
      destCountry: string;
      destPort: string;
      containerNo?: string;
      carrierRef?: string;
      etaAt?: string;
      /** How the goods arrived. A LABEL — see CONSIGNMENT_MODES. Omitted means sea, which is what every
       *  consignment recorded before this field existed was. */
      mode?: string;
    },
    by: string,
    now = Date.now(),
  ): ImportConsignment {
    const importer = this.entities.get(input.importerEntityId);
    const goodsDescription = input.goodsDescription?.trim();
    if (!goodsDescription) throw new GlosError('FIELD_REQUIRED', 'Say what is in it — an agent cannot tell you which papers you need without knowing what the goods are');
    const destPort = input.destPort?.trim();
    if (!destPort) throw new GlosError('FIELD_REQUIRED', 'Say where it is cleared — the papers a border asks for are that border’s, not the country’s');
    const originCountry = country(input.originCountry, 'where it is coming from');
    const destCountry = country(input.destCountry, 'where it is going');
    const etaAt = date(input.etaAt, 'An expected arrival');
    /*
     * Y0 — THE CHECK DIGIT, and the cheapest honest win in the epic.
     *
     * A container number carries a mod-11 check digit precisely so that a mistyped one is detectable, and
     * until now this field was free text we shouted and stored. A wrong number is a box nobody can trace,
     * a clock nobody can stop and a dispute nobody can settle — and it is silent, because every wrong
     * number still looks exactly like a container number.
     *
     * THE ARITHMETIC ONLY. Whether the box exists, and whose it is, is the line's business and not ours.
     */
    const containerNo = input.containerNo?.trim() ? ContainerBoxService.validate(input.containerNo) : undefined;

    const consignment: ImportConsignment = {
      importId: `imp_${randomBytes(8).toString('hex')}`,
      code: this.nextCode(),
      status: 'open',
      importerEntityId: importer.entityId,
      goodsDescription,
      ...(containerNo ? { containerNo } : {}),
      originCountry,
      destCountry,
      destPort,
      ...(input.carrierRef?.trim() ? { carrierRef: input.carrierRef.trim() } : {}),
      ...(input.mode && (CONSIGNMENT_MODES as readonly string[]).includes(input.mode) ? { mode: input.mode as ConsignmentMode } : {}),
      // `manual` is the only source anything writes. See the class comment on the carrier seam.
      ...(etaAt ? { etaAt, etaSource: 'manual' as const } : {}),
      required: [],
      createdAt: new Date(now).toISOString(),
      createdBy: by,
    };
    this.imports.set(consignment.importId, consignment);
    // THE BOX IS DERIVED FROM ITS NUMBER, the first time anybody names one — no registry, no onboarding
    // form, nothing to keep in step. Exactly as being a clearing agent is derived from being appointed.
    if (containerNo) {
      this.boxes.see(containerNo, { importId: consignment.importId, importCode: consignment.code, importerEntityId: importer.entityId }, now);
    }
    return consignment;
  }

  /* -------------------------------------------------------------- appointment -- */

  /**
   * Appoint a clearing agent, which is what creates the two grants.
   *
   * The importer's decision alone: these are their papers. And an appointment is the ANSWER to the shared
   * login, not a softer version of one — the agent reads what these grants reach and nothing else, under
   * their own company's sign-in, with their own name on every tick.
   *
   * Replacing an agent is two acts, not one. A silent swap would move a live grant from one company to
   * another in a single call, and the importer would never be shown the moment where the first agent
   * stopped being able to read their invoices.
   */
  appoint(importId: string, agentEntityId: string, actorEntityId: string, by: string, now = Date.now()): ImportDetail {
    const consignment = this.requireImport(importId);
    this.requireImporter(consignment, actorEntityId);
    const agent = this.entities.get(agentEntityId);
    if (agent.entityId === consignment.importerEntityId) {
      throw new GlosError('VALIDATION_FAILED', 'You already hold your own papers — appointing yourself grants nothing');
    }
    if (consignment.agentEntityId) {
      const current = this.entities.find(consignment.agentEntityId)?.name ?? consignment.agentEntityId;
      throw new GlosError('INVALID_STATE', `${current} is already appointed on ${consignment.code}. Revoke that appointment first — an agent losing access is a moment you should see happen`);
    }
    const at = new Date(now).toISOString();
    for (const scope of ['company', 'consignment'] as const) {
      // ONE standing grant per agent, however many containers they clear. A second identical grant would
      // make "who can read our company papers" a list that answers the same question twice, and it would
      // make withdrawing that access a question of how many copies happen to exist.
      if (scope === 'company' && this.liveGrants(consignment.importerEntityId, agent.entityId, consignment.importId).some((g) => g.scope === 'company')) continue;
      const grant: DocumentGrant = {
        grantId: `grn_${randomBytes(8).toString('hex')}`,
        scope,
        ownerEntityId: consignment.importerEntityId,
        readerEntityId: agent.entityId,
        ...(scope === 'consignment' ? { importId: consignment.importId } : {}),
        grantedBy: by,
        grantedAt: at,
      };
      this.grants.set(grant.grantId, grant);
    }
    Object.assign(consignment, { status: 'appointed', agentEntityId: agent.entityId, appointedAt: at, appointedBy: by });
    this.imports.set(consignment.importId, consignment);
    /*
     * Y1 — WHO OWES THE RETURN, and it is the user's own answer: the agent who booked the box.
     *
     * DERIVED from this appointment rather than typed anywhere, which means it cannot drift from who is
     * actually clearing the container, and a replaced agent replaces the obligation in the same act. The
     * importer still sees the clock, because the charge lands on them — but a clock with nobody's name on
     * it is a number that annoys everybody and moves nobody.
     */
    if (consignment.containerNo) {
      this.boxes.see(consignment.containerNo, { importId: consignment.importId, owedByEntityId: agent.entityId, owedByName: agent.name }, now);
    }
    return this.detail(consignment.importId, actorEntityId);
  }

  /**
   * End the appointment. Immediate, and visible to both sides — the grants are marked revoked, never deleted.
   *
   * The agent's published list SURVIVES. It is knowledge the importer paid for in time and hassle: what this
   * border asks for does not stop being true because the appointment ended, and deleting it would put the
   * importer back where they started with the next agent. Their papers, however, are gone from that agent's
   * reach on the same call.
   */
  revoke(importId: string, actorEntityId: string, by: string, reason?: string, now = Date.now()): ImportDetail {
    const consignment = this.requireImport(importId);
    this.requireImporter(consignment, actorEntityId);
    if (!consignment.agentEntityId) throw new GlosError('INVALID_STATE', `No agent is appointed on ${consignment.code}`);
    const at = new Date(now).toISOString();
    /**
     * A STANDING GRANT IS NOT THIS CONTAINER'S TO WITHDRAW while the same agent is still clearing another.
     *
     * The company papers are shared with the agent, not with the container, so revoking here would reach
     * across and cut their access to a consignment nobody touched — and it would do it silently, which is
     * the worst version. Only the LAST appointment takes the company papers back. The per-consignment
     * grant always goes, because that one really does belong to this container alone.
     */
    const stillClearing = [...this.imports.values()].some(
      (c) => c.importId !== consignment.importId && c.importerEntityId === consignment.importerEntityId && c.agentEntityId === consignment.agentEntityId,
    );
    for (const grant of this.liveGrants(consignment.importerEntityId, consignment.agentEntityId, consignment.importId)) {
      if (grant.scope === 'company' && stillClearing) continue;
      Object.assign(grant, { revokedBy: by, revokedAt: at, ...(reason?.trim() ? { revokedReason: reason.trim() } : {}) });
      this.grants.set(grant.grantId, grant);
    }
    Object.assign(consignment, { status: 'open' });
    delete consignment.agentEntityId;
    delete consignment.appointedAt;
    delete consignment.appointedBy;
    this.imports.set(consignment.importId, consignment);
    return this.detail(consignment.importId, actorEntityId);
  }

  /* ------------------------------------------------------------ the required list -- */

  /**
   * The agent publishes what they will need. The one screen the whole slice exists for.
   *
   * Republishing REPLACES the list but carries forward what the importer already did against a key that
   * survives. Wiping a supplied paper because the agent added a line underneath it would teach an agent not
   * to correct their own list, which is the opposite of what this is for.
   *
   * Publishing is also what records the border observation — see `BorderPaperObservation`. Only a key that
   * is NEW to this consignment is observed, so an agent tidying their wording does not inflate the count of
   * how many times a border has asked for something.
   */
  publishRequired(
    importId: string,
    agentEntityId: string,
    items: Array<{ key?: string; label?: string; copies?: number; note?: string }>,
    by: string,
    now = Date.now(),
  ): ImportDetail {
    const consignment = this.requireImport(importId);
    this.requireAgent(consignment, agentEntityId);
    if (!Array.isArray(items) || items.length === 0) {
      throw new GlosError('FIELD_REQUIRED', 'Publish at least one paper — an empty list tells the importer nothing');
    }
    const at = new Date(now).toISOString();
    const previous = new Map(consignment.required.map((r) => [r.key, r]));
    const next: RequiredPaper[] = [];
    const seen = new Set<string>();
    for (const item of items) {
      const label = item.label?.trim();
      if (!label) throw new GlosError('FIELD_REQUIRED', 'Every paper on the list needs a name the importer will recognise');
      const key = slug(item.key ?? label);
      if (!key) throw new GlosError('VALIDATION_FAILED', `That paper’s name gives nothing to file it under: ${label}`);
      if (seen.has(key)) throw new GlosError('VALIDATION_FAILED', `${label} is on the list twice`);
      seen.add(key);
      if (item.copies != null && (!Number.isInteger(item.copies) || item.copies < 1 || item.copies > 50)) {
        throw new GlosError('VALIDATION_FAILED', `How many copies of ${label}? A whole number between 1 and 50`);
      }
      const kept = previous.get(key);
      next.push({
        key,
        label,
        ...(item.copies != null ? { copies: item.copies } : {}),
        ...(item.note?.trim() ? { note: item.note.trim() } : {}),
        addedBy: kept?.addedBy ?? by,
        addedAt: kept?.addedAt ?? at,
        // Only what the IMPORTER did, and the decision that followed it, carries across a republish. The
        // agent's own wording is authoritative every time they publish — which is what makes republishing
        // without a copy count really drop the copy count, rather than leaving yesterday's number in place.
        ...(kept?.documentId ? { documentId: kept.documentId, suppliedAt: kept.suppliedAt, suppliedBy: kept.suppliedBy } : {}),
        ...(kept?.acceptedAt ? { acceptedAt: kept.acceptedAt, acceptedBy: kept.acceptedBy } : {}),
        ...(kept?.rejectedAt ? { rejectedAt: kept.rejectedAt, rejectedBy: kept.rejectedBy, rejectionReason: kept.rejectionReason } : {}),
      });
      if (!kept) this.observe(consignment, key, label, agentEntityId, at);
    }
    consignment.required = next;
    this.imports.set(consignment.importId, consignment);
    return this.detail(consignment.importId, agentEntityId);
  }

  /**
   * The importer attaches one of their OWN papers to a line.
   *
   * It must be a document this company already holds, which is what keeps the register the one place a
   * paper lives: there is no upload here, so a file cannot reach an agent without also being fingerprinted,
   * versioned and verifiable like every other paper the company owns.
   *
   * Supplying always clears an earlier decision. A paper that was rejected and has been replaced needs a
   * fresh look, and carrying the old rejection forward would show the importer a refusal of a document
   * nobody had read.
   */
  supply(importId: string, actorEntityId: string, key: string, documentId: string, by: string, now = Date.now()): ImportDetail {
    const consignment = this.requireImport(importId);
    this.requireImporter(consignment, actorEntityId);
    const line = this.requireLine(consignment, key);
    const document = this.documents.list(consignment.importerEntityId).find((d) => d.documentId === documentId);
    if (!document) throw new GlosError('NOT_FOUND', 'No such paper among this company’s documents');
    if (document.status === 'superseded') {
      throw new GlosError('INVALID_STATE', `That version of ${document.title} has been replaced — attach the current one`);
    }
    if (document.status === 'rejected') {
      throw new GlosError('INVALID_STATE', `${document.title} was rejected on your own record${document.rejectionReason ? `: ${document.rejectionReason}` : ''}`);
    }
    Object.assign(line, { documentId: document.documentId, suppliedAt: new Date(now).toISOString(), suppliedBy: by });
    delete line.acceptedAt;
    delete line.acceptedBy;
    delete line.rejectedAt;
    delete line.rejectedBy;
    delete line.rejectionReason;
    this.imports.set(consignment.importId, consignment);
    return this.detail(consignment.importId, actorEntityId);
  }

  /**
   * The agent ticks one off — and this is where an expiry is caught.
   *
   * A licence that lapsed between being uploaded and being relied on is exactly the failure this refuses:
   * the importer hears it here, from their own agent's screen, and not from a counter clerk with the
   * container already on the quay.
   */
  accept(importId: string, agentEntityId: string, key: string, by: string, now = Date.now()): ImportDetail {
    const consignment = this.requireImport(importId);
    this.requireAgent(consignment, agentEntityId);
    const line = this.requireLine(consignment, key);
    const document = this.documentOf(consignment, line);
    if (!document) throw new GlosError('INVALID_STATE', `Nothing has been supplied for ${line.label} yet`);
    if (document.status === 'superseded') {
      throw new GlosError('INVALID_STATE', `${document.title} has been replaced since it was attached — ask the importer to attach the current version`);
    }
    if (expired(document, now)) {
      throw new GlosError('INVALID_STATE', `${document.title} expired on ${document.expiresAt} — it cannot be relied on at the border`);
    }
    Object.assign(line, { acceptedAt: new Date(now).toISOString(), acceptedBy: by });
    delete line.rejectedAt;
    delete line.rejectedBy;
    delete line.rejectionReason;
    this.imports.set(consignment.importId, consignment);
    return this.detail(consignment.importId, agentEntityId);
  }

  /** Send one back, always with a reason — the same bargain a rejected company document makes. */
  reject(importId: string, agentEntityId: string, key: string, by: string, reason?: string, now = Date.now()): ImportDetail {
    const consignment = this.requireImport(importId);
    this.requireAgent(consignment, agentEntityId);
    const line = this.requireLine(consignment, key);
    if (!line.documentId) throw new GlosError('INVALID_STATE', `Nothing has been supplied for ${line.label} yet`);
    if (!reason?.trim()) throw new GlosError('FIELD_REQUIRED', 'Say why — an importer cannot fix a paper that came back with no reason');
    Object.assign(line, { rejectedAt: new Date(now).toISOString(), rejectedBy: by, rejectionReason: reason.trim() });
    delete line.acceptedAt;
    delete line.acceptedBy;
    this.imports.set(consignment.importId, consignment);
    return this.detail(consignment.importId, agentEntityId);
  }

  /* ------------------------------------------------------------------ reading -- */

  /** The consignments this company is a party to — theirs as importer, and the ones shared with them. */
  list(readerEntityId: string, opts: { all?: boolean } = {}): ImportRow[] {
    return [...this.imports.values()]
      .filter((c) => opts.all || c.importerEntityId === readerEntityId || c.agentEntityId === readerEntityId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((c) => this.rowOf(c, readerEntityId));
  }

  /** One consignment, holding only what this reader is allowed to see of it. */
  detail(importId: string, readerEntityId: string, opts: { all?: boolean } = {}): ImportDetail {
    const consignment = this.requireImport(importId);
    const side = this.sideOf(consignment, readerEntityId);
    if (side === 'onlooker' && !opts.all) {
      // Someone else's container is as absent as one that never existed — never FORBIDDEN, which would
      // confirm to a stranger that a container with this id is on the system.
      throw new GlosError('NOT_FOUND', 'No such consignment');
    }
    const visible = this.visibleDocuments(consignment, readerEntityId, opts);
    const byId = new Map(visible.map((d) => [d.documentId, d]));
    const spec = containerType(consignment.containerType);
    return {
      ...this.rowOf(consignment, readerEntityId),
      required: consignment.required.map((line) => {
        const document = line.documentId ? byId.get(line.documentId) : undefined;
        return {
          ...line,
          ...(document ? { document } : {}),
          stale: Boolean(document?.supersededBy),
          expired: Boolean(document && expired(document, Date.now())),
          state: stateOf(line),
        } satisfies RequiredPaperView;
      }),
      documents: visible,
      grants: this.grantsOn(consignment),
      ...(consignment.fee ? { fee: consignment.fee } : {}),
      // Said at the START, on every read, rather than discovered when somebody tries to pay.
      money: this.moneyHereFor(consignment),
      ...(consignment.roadFreightId ? { roadFreightId: consignment.roadFreightId } : {}),
      // Shown to BOTH parties, always. A hold recorded by the agent that the importer could not see would
      // be a claim made about them behind their back, and the dispute it invites could never be made.
      customsHolds: consignment.customsHolds ?? [],
      // Said from the moment the container is recorded, not discovered by whoever tries to mint a leg.
      cargoGaps: this.cargoGaps(consignment),
      ...(spec
        ? {
            containerFacts: {
              code: spec.code,
              label: spec.label,
              lengthM: spec.lengthM,
              ...(spec.lengthFt != null ? { lengthFt: spec.lengthFt } : {}),
              ...(spec.heightM != null ? { heightM: spec.heightM } : {}),
              ...(spec.widthM != null ? { widthM: spec.widthM } : {}),
              palletWide: spec.palletWide,
              group: spec.group,
              kind: spec.kind,
              openTop: spec.openTop,
              needsPower: spec.needsPower,
              bodies: spec.bodies,
              equipment: spec.equipment,
              outOfGauge: outOfGauge(spec, consignment.cargoHeightM),
              // The standard itself declines to say, for four size codes. Said out loud so a screen can
              // ask for a measurement rather than showing a blank where a height should be.
              heightUnstated: heightUnstated(spec),
            },
          }
        : {}),
      // Y0/Y1 — the box itself, and the clock. Absent until a number has been recorded, because the box
      // IS its number: there is no entity to derive before somebody names one.
      ...(consignment.containerNo ? { box: this.boxes.viewOf(consignment.containerNo, Date.now(), { importId: consignment.importId }) } : {}),
    };
  }

  /* ------------------------------------------- Y0 + Y1: the box, and its clock -- */

  /**
   * WHEN IT LANDED — recorded by a person, because nothing here watches a vessel berth.
   *
   * Demurrage cannot be derived the way detention can: the out-gate is our own road leg's pickup, but an
   * arrival is somebody else's event. Approximating it from the ETA was the tempting shortcut and it
   * would have been an invented number with a real consequence — so the arrival is stated, with a name
   * against it, and until somebody states one the demurrage clock says in words that it is not running.
   */
  recordBoxArrival(importId: string, actorEntityId: string, at: string, by: string, now = Date.now()): ImportDetail {
    const consignment = this.requireImport(importId);
    this.requireBoxParty(consignment, actorEntityId);
    const containerNo = this.requireBox(consignment);
    this.boxes.recordArrival(containerNo, at, by, { importId }, now);
    return this.detail(consignment.importId, actorEntityId);
  }

  /**
   * THE FREE DAYS — the importer's own claim, from a contract we have never seen.
   *
   * The importer's alone, and that is not an access decision but a truth one: the agreement is between
   * them and the line, so nobody else is in a position to state it. Carried and attributed the way an
   * agent's advertisement is, kept rather than overwritten, and the countdown that uses it says whose
   * number it is on every screen that shows it.
   */
  claimBoxFreeDays(importId: string, actorEntityId: string, kind: FreeDayKind, days: number, by: string, now = Date.now()): ImportDetail {
    const consignment = this.requireImport(importId);
    this.requireImporter(consignment, actorEntityId);
    const containerNo = this.requireBox(consignment);
    this.boxes.claimFreeDays(containerNo, kind, days, { entityId: consignment.importerEntityId, by }, { importId }, now);
    return this.detail(consignment.importId, actorEntityId);
  }

  /**
   * HOW THE SPELL ENDED, and the user's correction is the whole reason this takes a kind.
   *
   *   > "In the real world containers are demanded objects and are very often sold in the market and are
   *   > never returned."
   *
   * So `bought` is not an exotic case to be handled later; it is the ordinary market and it must stop the
   * clock cleanly, because a box that was sold on is not late and telling somebody it is would be the
   * false alarm that teaches them to ignore the true one.
   *
   * EITHER PARTY MAY RECORD IT, and usually the agent will: they booked the box, they owe the return, and
   * they are the one standing at the depot gate. The importer can too, because the charge lands on them.
   */
  endBox(
    importId: string,
    actorEntityId: string,
    kind: BoxEnding,
    input: { at?: string; where?: string; note?: string },
    by: string,
    now = Date.now(),
  ): ImportDetail {
    const consignment = this.requireImport(importId);
    this.requireBoxParty(consignment, actorEntityId);
    const containerNo = this.requireBox(consignment);
    this.boxes.end(containerNo, kind, input, by, { importId }, now);
    return this.detail(consignment.importId, actorEntityId);
  }

  /**
   * Y2 — THE LEG HOME, POSTED TO THE SAME BOARD AS ANY OTHER LOAD.
   *
   * The piece with the most value and the least new machinery. A laden leg inland implies a leg back to a
   * depot, we modelled the first and not the second, and so no driver was ever offered it: the agent
   * arranged it out of band, and the freight board — whose whole subject is repositioning — was blind to
   * what is a large share of real container haulage.
   *
   * AND IT IS VERY OFTEN NOT EMPTY, which is the user's correction and the thing that makes this a freight
   * slice rather than an admin one:
   *
   *   > "They are also used to carry freight to the direction of the port to keep cargo secured — theft,
   *   > rain or whatever."
   *
   * A box is a dry, lockable, weatherproof body, so cargo goes portward inside it whenever there is cargo
   * going that way. That answers the no-revenue trap with a MARKET instead of a subsidy — and the empty
   * case is published AS empty rather than dressed up, because a driver who finds out at the quay that
   * there was nothing to carry is a driver who stops taking container work.
   *
   * THE WEIGHT IS THE BOX'S OWN TARE on an empty run, and it is refused if nobody states it: a 20ft box is
   * two and a half tonnes of steel, so "empty" is not "light", and the figure is painted on the door of
   * the thing the person is standing next to.
   *
   * Priced exactly like any other leg, by distance against the claiming vehicle's own profile. That is the
   * whole answer to "a return leg with no revenue must still pay the driver": it has revenue, from whoever
   * owes the return, and the driver is paid what the board says.
   */
  mintReturnLeg(
    importId: string,
    actorEntityId: string,
    input: { depotLabel: string; depotLocation?: GeoPoint; fromLabel?: string; fromLocation?: GeoPoint; weightKg: number; cargo?: string },
    by: string,
    now = Date.now(),
  ): ImportDetail {
    const consignment = this.requireImport(importId);
    this.requireBoxParty(consignment, actorEntityId);
    const containerNo = this.requireBox(consignment);

    const depotLabel = input.depotLabel?.trim();
    if (!depotLabel) throw new GlosError('FIELD_REQUIRED', 'Say which depot it goes back to — the line nominates it, and a leg with no destination cannot be offered to anybody');
    if (!(input.weightKg > 0)) {
      throw new GlosError(
        'FIELD_REQUIRED',
        'Say what the truck will be carrying, in kilos. An empty container is not a light one — a 20ft box is around 2,200 kg of steel, and its tare is painted on the door.',
      );
    }

    const box = this.boxes.viewOf(containerNo, now, { importId });
    if (box?.ending) {
      throw new GlosError('INVALID_STATE', `${containerNo} is already recorded as ${box.ending} — a box that has gone back, or been bought, has no leg home to post`);
    }
    if (box?.returnLegCode) {
      throw new GlosError('CONFLICT', `${containerNo} already has a leg home (${box.returnLegCode}) — a second one would send two trucks for one box`);
    }

    /*
     * WHERE IT STARTS FROM is derived from the laden leg wherever we have one: the box goes home from
     * wherever it was stripped, which is where that leg ended. Typed only when we do not know — a person
     * re-typing a place the system already holds is a place the two can disagree about.
     */
    let fromLabel = input.fromLabel?.trim();
    let fromLocation = input.fromLocation;
    if (!fromLocation && consignment.roadFreightId) {
      try {
        const laden = this.dispatch.requireFreightPublic(consignment.roadFreightId);
        fromLocation = laden.destLocation ?? fromLocation;
        fromLabel = fromLabel || laden.destLabel;
      } catch {
        /* the leg is gone; fall through to asking */
      }
    }
    if (!fromLocation) {
      throw new GlosError('FIELD_REQUIRED', 'Say where the box is now. It is taken from the laden leg when there is one — there is none here, or it never had a destination pin.');
    }

    const empty = !input.cargo?.trim();
    const spec = containerType(consignment.containerType);
    const importer = this.entities.get(actorEntityId);

    const freight = this.dispatch.registerFreight(
      {
        description: empty
          ? `${containerNo} — empty box back to ${depotLabel}`
          : `${containerNo} — ${input.cargo!.trim()}, portward to ${depotLabel}`,
        pickupLocation: fromLocation,
        pickupLabel: fromLabel || consignment.destPort,
        destLabel: depotLabel,
        ...(input.depotLocation ? { destLocation: input.depotLocation } : {}),
        weightKg: input.weightKg,
        // The two facts that make this leg what it is, on the leg itself, so the BOARD can say so.
        containerNo,
        ...(empty ? { emptyRun: true } : {}),
        // Everything the box implies for the road is unchanged by whether there is anything in it: the
        // same gear lifts it, the same bodies carry it, and it is the same height under the same bridge.
        ...(spec ? { bodyHint: spec.bodies[0], packaging: 'piece' as const } : {}),
        ...(spec ? { originEquipment: spec.equipment, destEquipment: spec.equipment } : {}),
        ...(spec ? { heightM: spec.openTop ? consignment.cargoHeightM : (spec.heightM ?? consignment.cargoHeightM) } : {}),
        ...(spec ? { indivisible: true } : {}),
        pickupCountry: consignment.destCountry,
        destCountry: consignment.destCountry,
        postedByDid: importer.did,
        externalOrderId: `${consignment.code}-RET`,
      },
      now,
    );

    this.boxes.see(containerNo, { importId, returnFreightId: freight.freightId, returnDepot: depotLabel }, now);
    return this.detail(consignment.importId, actorEntityId);
  }

  /** Every box, with its clock. Operator-only at the route: it spans companies by construction. */
  boxesOut(now = Date.now()): BoxView[] {
    return this.boxes.list(now);
  }

  private requireBox(consignment: ImportConsignment): string {
    if (!consignment.containerNo) {
      throw new GlosError('INVALID_STATE', `${consignment.code} has no container number yet — the box IS its number, so there is nothing to keep a clock on until one is recorded`);
    }
    return consignment.containerNo;
  }

  /**
   * Who may touch the box's record: the importer, the appointed agent, or network staff.
   *
   * Wider than the papers, deliberately. The agent owes the return and the importer pays for it being
   * late, so a rule that let only one of them record a gate or an ending would leave the other watching a
   * clock they cannot correct. Network staff act BY NAMING a party, exactly as they do on a customs hold,
   * so the record says which company the act was for and whose hand it was.
   */
  private requireBoxParty(consignment: ImportConsignment, actorEntityId: string): void {
    if (actorEntityId === consignment.importerEntityId) return;
    if (consignment.agentEntityId && actorEntityId === consignment.agentEntityId) return;
    throw new GlosError('FORBIDDEN', 'Only the importer or the appointed agent can record what happened to the box');
  }

  /* ------------------------------------------------------- what the state did -- */

  /**
   * CL4 — record that the state did something to this container.
   *
   * EITHER PARTY MAY RECORD ONE, and it will usually be the agent, who is the one standing at the counter.
   * That makes it a self-serving field by construction — "it was not my fault" with nothing behind it —
   * which is exactly why it is built like the road map's disputes: attributed, visible to the other party
   * the moment it is written, answerable beside rather than instead, and never erased.
   *
   * It changes NO figure on the agent's record. §6 is explicit that what the state controls is recorded,
   * shown and labelled as not the agent's doing, and never blended — a system that discounted an agent's
   * own response times by the holds they reported would have built the excuse field this design refuses.
   */
  recordCustomsHold(
    importId: string,
    actorEntityId: string,
    input: { kind: CustomsHoldKind; at?: string; note?: string },
    by: string,
    now = Date.now(),
  ): ImportDetail {
    const consignment = this.requireImport(importId);
    const side = this.sideOf(consignment, actorEntityId);
    if (side === 'onlooker') throw new GlosError('NOT_FOUND', 'No such consignment');
    if (!CUSTOMS_HOLD_KINDS.includes(input.kind)) throw new GlosError('INVALID_INPUT', 'That is not one of the things the state does to a container');
    const at = input.at?.trim() || new Date(now).toISOString();
    if (!Number.isFinite(Date.parse(at))) throw new GlosError('INVALID_INPUT', 'Give the date it happened');
    const hold: CustomsHold = {
      holdId: `hld_${randomBytes(6).toString('hex')}`,
      kind: input.kind,
      at,
      recordedBy: actorEntityId,
      recordedAt: new Date(now).toISOString(),
      accounts: [{ by, at: new Date(now).toISOString(), stance: 'happened', ...(input.note?.trim() ? { note: input.note.trim() } : {}) }],
    };
    consignment.customsHolds = [...(consignment.customsHolds ?? []), hold];
    this.imports.set(consignment.importId, consignment);
    return this.detail(consignment.importId, actorEntityId);
  }

  /**
   * The other party's account of the same hold.
   *
   * NOT A DELETION, and that is the whole shape: the original account stays, this one is added, and the
   * record carries a disagreement that a reader resolves rather than one the system resolved for them.
   * One account per party per hold — somebody who says the same thing twice has not become two witnesses,
   * and changing their mind replaces what they said rather than adding to it.
   */
  answerCustomsHold(importId: string, actorEntityId: string, holdId: string, stance: HoldStance, note: string | undefined, by: string, now = Date.now()): ImportDetail {
    const consignment = this.requireImport(importId);
    const side = this.sideOf(consignment, actorEntityId);
    if (side === 'onlooker') throw new GlosError('NOT_FOUND', 'No such consignment');
    const hold = (consignment.customsHolds ?? []).find((h) => h.holdId === holdId);
    if (!hold) throw new GlosError('NOT_FOUND', 'No such hold on this consignment');
    if (!HOLD_STANCES.includes(stance)) throw new GlosError('INVALID_INPUT', 'Either it happened as described, or it is disputed');
    if (stance === 'disputed' && !note?.trim()) {
      throw new GlosError('FIELD_REQUIRED', 'Say what you say happened instead — a dispute with no words cannot be weighed by anybody');
    }
    const entry = { by, at: new Date(now).toISOString(), stance, ...(note?.trim() ? { note: note.trim() } : {}) };
    const existing = hold.accounts.findIndex((a) => a.by === by);
    if (existing >= 0) hold.accounts[existing] = entry;
    else hold.accounts.push(entry);
    this.imports.set(consignment.importId, consignment);
    return this.detail(consignment.importId, actorEntityId);
  }

  /** It ended. Recorded by either party, and only once: a release date that moves is not a record. */
  releaseCustomsHold(importId: string, actorEntityId: string, holdId: string, at: string | undefined, now = Date.now()): ImportDetail {
    const consignment = this.requireImport(importId);
    if (this.sideOf(consignment, actorEntityId) === 'onlooker') throw new GlosError('NOT_FOUND', 'No such consignment');
    const hold = (consignment.customsHolds ?? []).find((h) => h.holdId === holdId);
    if (!hold) throw new GlosError('NOT_FOUND', 'No such hold on this consignment');
    if (hold.releasedAt) throw new GlosError('INVALID_STATE', 'That hold is already recorded as released');
    const when = at?.trim() || new Date(now).toISOString();
    if (!Number.isFinite(Date.parse(when))) throw new GlosError('INVALID_INPUT', 'Give the date it was released');
    if (Date.parse(when) < Date.parse(hold.at)) throw new GlosError('INVALID_INPUT', 'A hold cannot be released before it began');
    hold.releasedAt = when;
    this.imports.set(consignment.importId, consignment);
    return this.detail(consignment.importId, actorEntityId);
  }

  /**
   * ONE AGENT'S RECORD, over every container they were appointed on.
   *
   * Read straight off the consignments, so the figures can be reproduced from the containers in front of
   * you. No store of its own, nothing cached: a record kept beside the facts is a record that can
   * disagree with them.
   */
  agentRecord(entityId: string, now = Date.now()): AgentRecord {
    return agentRecordOf([...this.imports.values()], entityId, now);
  }

  /** Has this company ever been appointed to clear a container? What makes them an agent at all. */
  isAgent(entityId: string): boolean {
    return isClearingAgent([...this.imports.values()], entityId);
  }

  /* ------------------------------------- what kind of box, and what is in it -- */

  /**
   * SAY WHAT THE BOX IS AND WHAT IS IN IT. The importer's, because the goods are theirs.
   *
   * Everything about the BOX is derived from the code (height, roof, bodies, lifting gear), and everything
   * about the GOODS is declared, because no code distinguishes a tank of edible oil from a tank of gas
   * oil and reading it out of a description would be us classifying goods — the regulated advice this
   * epic refuses to give about duty, wearing a different hat.
   *
   * A tank declaration and a dangerous-goods declaration are separate acts on purpose. One says what the
   * box last held and that it was cleaned; the other says what it is about to hold and how it is
   * regulated. A food movement needs the first and a fuel movement the second, and a system that folded
   * them into one field would ask everybody for both.
   */
  declareCargo(
    importId: string,
    actorEntityId: string,
    input: {
      /** Usually typed later than the booking: the number arrives with the bill of lading. */
      containerNo?: string;
      /** The date on the CSC safety-approval plate. Carried, and nothing stated about it. */
      cscPlateDate?: string;
      containerType?: string;
      natureCode?: string;
      cargoHeightM?: number;
      tank?: { lastCargoes: string[]; cleanedAt?: string; certificateDocumentId?: string };
      dangerous?: { unNumber: string; imdgClass: string; properShippingName?: string };
    },
    by: string,
    now = Date.now(),
  ): ImportDetail {
    const consignment = this.requireImport(importId);
    this.requireImporter(consignment, actorEntityId);

    const cscPlateDate = date(input.cscPlateDate, 'A CSC plate date');
    if (input.containerNo !== undefined) {
      // The number usually arrives with the bill of lading, days after the container was booked, so it is
      // settable here — and checked by the same arithmetic as at registration rather than a softer copy.
      consignment.containerNo = ContainerBoxService.validate(input.containerNo);
    }
    if (input.containerType !== undefined) {
      const spec = containerType(input.containerType);
      if (!spec) {
        // NOT "unlisted" — invalid. Every ISO 6346 code resolves from the three tables, so a code that
        // does not is a typo (45GI for 45G1) or not a container code at all, and carrying it as a label
        // would lose the height, the body and the bridge check in silence.
        throw new GlosError('INVALID_INPUT', `${input.containerType} is not an ISO 6346 code. It is four characters: length, height, then the type — 45G1, 22U1, 22T4. Check what is printed on the box.`);
      }
      consignment.containerType = spec.code;
    }
    if (input.natureCode !== undefined) {
      if (!(CARGO_NATURES as readonly string[]).includes(input.natureCode)) throw new GlosError('INVALID_INPUT', 'Pick what the goods are from the list');
      consignment.natureCode = input.natureCode;
    }
    if (input.cargoHeightM !== undefined) {
      if (!(input.cargoHeightM > 0) || input.cargoHeightM > 10) throw new GlosError('INVALID_INPUT', 'Give how tall the cargo stands, in metres');
      consignment.cargoHeightM = Math.round(input.cargoHeightM * 100) / 100;
    }
    if (input.tank) {
      const lastCargoes = input.tank.lastCargoes.map((c) => c.trim()).filter(Boolean);
      if (!lastCargoes.length) {
        throw new GlosError('FIELD_REQUIRED', 'Say what the tank last carried — that, and the cleaning certificate, is the only thing that makes a tank fit for food');
      }
      // The certificate is one of the importer's OWN documents, exactly as a required paper is. A file
      // uploaded into this declaration would be a second document register nobody verifies.
      if (input.tank.certificateDocumentId && !this.documents.list(consignment.importerEntityId).some((d) => d.documentId === input.tank!.certificateDocumentId)) {
        throw new GlosError('NOT_FOUND', 'That certificate is not one of your own documents — put it on your register first, so it carries a fingerprint and an expiry like every other paper');
      }
      consignment.tank = {
        lastCargoes,
        ...(input.tank.cleanedAt?.trim() ? { cleanedAt: input.tank.cleanedAt.trim() } : {}),
        ...(input.tank.certificateDocumentId ? { certificateDocumentId: input.tank.certificateDocumentId } : {}),
        declaredBy: by,
        declaredAt: new Date(now).toISOString(),
      };
    }
    if (input.dangerous) {
      const unNumber = input.dangerous.unNumber?.trim().toUpperCase().replace(/^UN\s*/, 'UN');
      if (!/^UN\d{4}$/.test(unNumber ?? '')) throw new GlosError('INVALID_INPUT', 'A UN number looks like UN1202 — four digits. We check the shape and never the choice: what it is, is yours to declare.');
      const imdgClass = input.dangerous.imdgClass?.trim();
      if (!imdgClass) throw new GlosError('FIELD_REQUIRED', 'Say the class — it decides the placards, the driver’s certificate and which roads are closed to it');
      consignment.dangerous = {
        unNumber,
        imdgClass,
        ...(input.dangerous.properShippingName?.trim() ? { properShippingName: input.dangerous.properShippingName.trim() } : {}),
        declaredBy: by,
        declaredAt: new Date(now).toISOString(),
      };
    }
    this.imports.set(consignment.importId, consignment);
    /*
     * Everything the declaration just taught us about the BOX, handed to the box.
     *
     * The type code and the CSC plate date belong to the container and not to this consignment — the same
     * box comes back next month under a different one, and a record owned by one of them loses what we
     * knew. So the consignment keeps what was declared about the CARGO, and the box keeps what is true of
     * the box.
     */
    if (consignment.containerNo) {
      const agent = consignment.agentEntityId ? this.entities.find(consignment.agentEntityId) : undefined;
      this.boxes.see(
        consignment.containerNo,
        {
          importId: consignment.importId,
          importCode: consignment.code,
          importerEntityId: consignment.importerEntityId,
          ...(consignment.containerType ? { typeCode: consignment.containerType } : {}),
          ...(cscPlateDate ? { cscPlateDate } : {}),
          ...(agent ? { owedByEntityId: agent.entityId, owedByName: agent.name } : {}),
        },
        now,
      );
    }
    return this.detail(consignment.importId, actorEntityId);
  }

  /**
   * THE BOX, whichever way we know it — the catalogue, or its owner's own measurements.
   *
   * One resolver, so nothing downstream has to know which path a box came in by. What every reader IS
   * told is the `basis`, because a catalogued height and a declared one are not equally checkable and
   * pretending otherwise is the sort of quiet equivalence this codebase keeps refusing.
   */
  /**
   * WHAT IS STILL MISSING BEFORE THIS CAN GO ON A TRUCK — derived, every read, never stored.
   *
   * Two combinations must not be minted blind, and both are the question that produced this slice:
   *
   *  - A TANK carrying FOOD with no tank declaration. A tank that last held crude can never carry food,
   *    and the difference is not visible in the code, the description or the weight. Minting it anyway
   *    puts a food load on a box nobody has said anything about.
   *  - HAZARDOUS goods with no UN number. The number decides the placards on the truck, the certificate
   *    the driver must hold and which roads are closed — so a load offered without one would be offered
   *    to vehicles that cannot lawfully take it, and the driver would find out at a checkpoint.
   *
   * Returned as a LIST OF SENTENCES rather than a boolean, because a refusal that cannot say what is
   * missing is a refusal somebody has to guess their way out of.
   */
  cargoGaps(consignment: ImportConsignment): string[] {
    const spec = containerType(consignment.containerType);
    const nature = consignment.natureCode;
    const gaps: string[] = [];

    if (spec?.kind === 'tank' && (nature === 'FOD' || nature === 'FOP') && !consignment.tank) {
      gaps.push('This is a tank carrying food, and nobody has said what it last held. A tank that carried fuel can never carry food — record the last cargoes and the cleaning certificate.');
    }
    if (nature?.startsWith('HAZ') && !consignment.dangerous) {
      gaps.push('These goods are declared hazardous and there is no UN number. The number decides the placards, the driver’s certificate and which roads are closed to the load — it cannot go on a truck without one.');
    }
    /*
     * A CODE THAT DOES NOT STATE ITS OWN HEIGHT. Four size codes are open ranges — 'taller than 2896 mm'
     * — and the standard declines to be more specific. So we ask for a measurement rather than inventing
     * one, because a box that is "more than 2.9 m" tall is exactly the box a 4.2 m bridge is about.
     */
    if (spec && heightUnstated(spec) && !spec.openTop && consignment.cargoHeightM == null) {
      gaps.push('This code says only that the box is taller than 2.896 m, not how tall. Measure it and say so, or no bridge on the route can be checked against it.');
    }
    // An open box tells you the height of the floor the cargo sits on, not the height of the movement.
    if (spec?.openTop && consignment.cargoHeightM == null) {
      gaps.push('This box has no roof, so its own height says nothing about how tall the load stands. Say how tall the cargo is, or no bridge on the route can be checked against it.');
    }
    return gaps;
  }

  /* --------------------------------------- what an agent says they clear -- */

  /**
   * CL6 — AN AGENT'S OWN ADVERTISEMENT. The one asserted thing in this design, and deliberately so.
   *
   * Identity and record stay derived, because that is what stops squatting and stops a record that can
   * only flatter. What somebody OFFERS cannot be derived at all: nobody but the agent knows they clear
   * livestock at Mombasa, and waiting to observe it would list every agent as doing nothing until they
   * had already been hired for it — the chicken-and-egg the directory exists to end.
   *
   * Theirs to write and theirs to change. We keep the date, because a claim made two years ago and never
   * revisited is weaker than one made last week, and a reader is entitled to tell them apart.
   */
  setOffer(entityId: string, input: { specialisms: string[]; places?: string[]; words?: string }, by: string, now = Date.now()): ClearanceOffer {
    this.entities.get(entityId); // a company that does not exist cannot advertise
    const specialisms = [...new Set(input.specialisms ?? [])].filter((s): s is ClearanceSpecialism => (CLEARANCE_SPECIALISMS as readonly string[]).includes(s));
    if (!specialisms.length) {
      throw new GlosError('FIELD_REQUIRED', 'Say at least one thing you clear — an entry in the directory that names nothing helps nobody find you');
    }
    // Labels, trimmed and de-duplicated. We run no ports, so there is nothing to validate them against.
    const places = [...new Set((input.places ?? []).map((p) => p.trim()).filter(Boolean))].slice(0, 20);
    const offer: ClearanceOffer = {
      specialisms,
      places,
      ...(input.words?.trim() ? { words: input.words.trim().slice(0, 600) } : {}),
      saidAt: new Date(now).toISOString(),
      saidBy: by,
    };
    this.offers.set(entityId, offer);
    return offer;
  }

  offerOf(entityId: string): ClearanceOffer | undefined {
    return this.offers.get(entityId);
  }

  /**
   * THE FINDER — and finding an agent is market dynamics, which is why it exists at all.
   *
   * §6a refused a ranked DIRECTORY and that refusal holds in full: this answers with a list of PAGES and
   * imposes no ordering that could be read as a judgement. Alphabetical, said out loud in `basis`, so
   * that advertising more cannot move anybody up the list.
   *
   * WHAT STOPS IT BEING GAMED is not a gate on the claim — we do not check claims, and an agent who
   * claims everything will appear in every list. It is that every result carries the claim NEXT TO the
   * record, so a claim with nothing behind it and a claim with forty consignments behind it are visibly
   * different things. Claiming more gets you seen; it does not get you credited.
   *
   * A company with no advertisement at all still appears when the record answers the question — somebody
   * who has been appointed on eleven consignments at Djibouti is an agent at Djibouti whether or not they
   * have got round to filling in a form.
   */
  findAgents(q: { specialism?: string; place?: string; country?: string } = {}): Array<{ entityId: string; name: string; country?: string; offer?: ClearanceOffer; appointed: number; cleared: number; thin: boolean }> {
    const all = [...this.imports.values()];
    const wanted = q.specialism?.trim();
    const place = q.place?.trim().toLowerCase();
    const country = q.country?.trim().toUpperCase();

    // Every company that either advertises clearance work, or has actually been appointed on a consignment.
    const candidates = new Set<string>([...this.offers.keys(), ...all.filter((c) => c.agentEntityId && c.appointedAt).map((c) => c.agentEntityId!)]);

    const rows = [...candidates].flatMap((entityId) => {
      let entity;
      try {
        entity = this.entities.get(entityId);
      } catch {
        return []; // a company that has since been removed is not a result
      }
      if (country && (entity.jurisdiction ?? '').toUpperCase() !== country) return [];

      const offer = this.offers.get(entityId);
      const record = agentRecordOf(all, entityId);

      // A specialism matches what they SAY. The record cannot answer it: our modes are how goods
      // arrived, not what the goods were, and 'sea' tells nobody whether they handle livestock.
      if (wanted && !(offer?.specialisms ?? []).includes(wanted as ClearanceSpecialism)) return [];
      // A place matches EITHER what they say OR where we have seen them work, because an agent who has
      // cleared eleven consignments at a port plainly works there whatever their form says.
      if (place) {
        const said = (offer?.places ?? []).some((p) => p.toLowerCase().includes(place));
        const seen = record.ports.some((p) => p.key.toLowerCase().includes(place));
        if (!said && !seen) return [];
      }
      return [
        {
          entityId,
          name: entity.name,
          ...(entity.jurisdiction ? { country: entity.jurisdiction } : {}),
          ...(offer ? { offer } : {}),
          appointed: record.appointed,
          cleared: record.cleared,
          thin: record.thin,
        },
      ];
    });

    // ALPHABETICAL, and nothing else. Ordering by appointments would be the league table §6 refuses,
    // and ordering by "relevance" would be the same table with a name that hides it.
    return rows.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * May this company read this paper, and which one is it?
   *
   * The whole access rule, in one place, so the file route and the screens cannot disagree about it. A
   * company always reads its own; anybody else needs a live grant, and a `company`-scope grant reaches only
   * papers with no `relatesTo` while a `consignment`-scope one reaches only this container's.
   */
  readableDocument(importId: string, readerEntityId: string, documentId: string): { entityId: string; documentId: string } {
    const consignment = this.requireImport(importId);
    const document = this.visibleDocuments(consignment, readerEntityId).find((d) => d.documentId === documentId);
    if (!document) throw new GlosError('NOT_FOUND', 'No such document on this consignment, or it is not shared with you');
    return { entityId: document.entityId, documentId: document.documentId };
  }

  /**
   * WHAT AGENTS HAVE BEEN ASKED FOR AT THIS PORT — the foreknowledge, made into a list.
   *
   * Said as counts and dates, never as a requirement and never as a percentage. "Four agents have been asked
   * for this here, most recently in September" is a fact about what happened. "This is required" would be a
   * claim about a regulation we do not read and cannot keep current.
   */
  knownPapers(countryCode: string, port?: string): KnownPaper[] {
    const c = (countryCode ?? '').trim().toUpperCase();
    const p = (port ?? '').trim().toLowerCase();
    const rows = new Map<string, { label: string; agents: Set<string>; imports: Set<string>; first: string; last: string }>();
    for (const o of this.observations.values()) {
      if (o.country !== c) continue;
      if (p && o.port.toLowerCase() !== p) continue;
      const row = rows.get(o.key) ?? { label: o.label, agents: new Set<string>(), imports: new Set<string>(), first: o.at, last: o.at };
      row.agents.add(o.byEntityId);
      row.imports.add(o.importId);
      if (o.at < row.first) row.first = o.at;
      if (o.at > row.last) {
        row.last = o.at;
        row.label = o.label; // the most recent wording wins — an agent's current words, not their first
      }
      rows.set(o.key, row);
    }
    return [...rows.entries()]
      .map(([key, r]) => ({ key, label: r.label, agents: r.agents.size, times: r.imports.size, firstAskedAt: r.first, lastAskedAt: r.last }))
      .sort((a, b) => b.agents - a.agents || b.times - a.times || b.lastAskedAt.localeCompare(a.lastAskedAt));
  }

  /** How many lines are waiting on this company across everything it is a party to. The console's badge. */
  outstandingFor(readerEntityId: string): number {
    return this.list(readerEntityId).reduce((n, row) => n + row.waitingOnYou, 0);
  }

  /* --------------------------------------------- CL2b: paying the agent -- */

  /**
   * The agent names their price. Their decision alone, and it is a QUOTE rather than a charge.
   *
   * Allowed even where we cannot handle the money, on purpose: what the two parties agree between them is
   * theirs to agree. What changes is only who carries it — `money.why` on the view has already said, before
   * anybody typed a figure, whether we can be the one who bills it.
   */
  quoteFee(importId: string, agentEntityId: string, amount: number, note: string | undefined, by: string, now = Date.now()): ImportDetail {
    const consignment = this.requireImport(importId);
    this.requireAgent(consignment, agentEntityId);
    if (consignment.fee?.paidAt) throw new GlosError('INVALID_STATE', `The fee on ${consignment.code} has already been paid — re-quoting it now would change a figure money has already moved against`);
    const value = money(amount);
    if (!(value > 0)) throw new GlosError('VALIDATION_FAILED', 'A fee needs an amount above zero');
    const currency = this.currencyFor(consignment);
    const fee: ImportFee = {
      amount: value,
      currency,
      quotedBy: by,
      quotedAt: new Date(now).toISOString(),
      ...(note?.trim() ? { note: note.trim() } : {}),
      ...(this.collectingSisterFor(consignment) ? { collectingEntityId: this.collectingSisterFor(consignment)!.entityId } : {}),
    };
    // A re-quote drops the importer's earlier agreement rather than carrying it: they agreed to a number,
    // and this is a different number. Nobody is held to a price they did not see.
    consignment.fee = fee;
    this.imports.set(consignment.importId, consignment);
    return this.detail(consignment.importId, agentEntityId);
  }

  /** The importer agrees the figure. Nothing moves — agreeing is not paying. */
  acceptFee(importId: string, actorEntityId: string, by: string, now = Date.now()): ImportDetail {
    const consignment = this.requireImport(importId);
    this.requireImporter(consignment, actorEntityId);
    const fee = consignment.fee;
    if (!fee) throw new GlosError('INVALID_STATE', `No fee has been quoted on ${consignment.code} yet`);
    if (fee.paidAt) throw new GlosError('INVALID_STATE', 'That fee has already been paid');
    Object.assign(fee, { acceptedBy: by, acceptedAt: new Date(now).toISOString() });
    this.imports.set(consignment.importId, consignment);
    return this.detail(consignment.importId, actorEntityId);
  }

  /**
   * MONEY ARRIVED. Recorded by network staff against a reference, and never by the importer pressing a button.
   *
   * Rule 5 of the money model: money is created only by an OBSERVED EXTERNAL EVENT with a reference somebody
   * can point at afterwards. An importer asserting "I paid" is not that event, and a button that mints cash on
   * a claim is the exact shape the whole books rewrite exists to remove.
   *
   * The posting is two lines and deliberately has no third: cash in, and the same amount owed to the agent.
   * **Not one line of revenue**, because the network earns nothing from an appointment — a condition written
   * into §10 before any of this was built. The agent is then paid by the ordinary payout run, which settles
   * only when a rail says it settled, and which will refuse to send it to a country we cannot pay into yet.
   */
  recordFeeReceipt(importId: string, reference: string, by: string, amount?: number, now = Date.now()): ImportDetail {
    const consignment = this.requireImport(importId);
    const fee = consignment.fee;
    if (!fee) throw new GlosError('INVALID_STATE', `No fee has been quoted on ${consignment.code} yet`);
    if (!fee.acceptedAt) throw new GlosError('INVALID_STATE', `${consignment.code}'s fee has not been agreed by the importer yet`);
    if (fee.paidAt) throw new GlosError('CONFLICT', `That fee was already received on ${fee.paidAt.slice(0, 10)} against ${fee.reference}`);
    if (!reference?.trim()) throw new GlosError('FIELD_REQUIRED', 'A receipt needs the reference the money arrived under — money is never created here on somebody saying so');
    if (!consignment.agentEntityId) throw new GlosError('INVALID_STATE', 'No agent is appointed, so there is nobody this could be owed to');
    // Refused HERE with the country's own sentence — but the screen has been saying it since the page opened.
    this.presence.require(consignment.destCountry, 'merchantOfRecord');
    const sister = this.entities.requireForJurisdiction(consignment.destCountry);
    const agent = this.entities.get(consignment.agentEntityId);
    const received = money(amount ?? fee.amount);
    if (!(received > 0)) throw new GlosError('VALIDATION_FAILED', 'A receipt needs an amount above zero');

    const entry = this.books.post({
      entityId: sister.entityId,
      kind: 'clearance-fee',
      ref: consignment.code,
      memo: `Clearance fee for ${consignment.code}, owed to ${agent.name}`,
      lines: [
        { code: ACCOUNT_CODES.CASH_CUSTODY, amount: received },
        // Owed onward in full. The agent's DID is the counterparty, which is what the payout run draws down.
        { code: ACCOUNT_CODES.PAYABLE_PROVIDER, counterparty: agent.did, amount: -received },
      ],
    });
    Object.assign(fee, {
      amount: received,
      currency: sister.currency ?? fee.currency,
      collectingEntityId: sister.entityId,
      paidAt: new Date(now).toISOString(),
      recordedBy: by,
      reference: reference.trim(),
      entryId: entry.entryId,
    });
    this.imports.set(consignment.importId, consignment);
    return this.detail(consignment.importId, '', { all: true });
  }

  /* ------------------------------------- CL2b: the road leg from the port -- */

  /**
   * Mint the road shipment from the port of destination, on the freight machinery that already exists.
   *
   * A PERSON does this. We model no vessel and no arrival, so nothing here can know the box is on the quay —
   * and inventing an arrival event we cannot observe would be the same lie as minting money on a button.
   *
   * It posts with the importer as the poster and **no `shipperDid`**, which is what the consolidation lot
   * already does: the load stays unpaid on our books and the haulage is settled off-platform. Billing the
   * road leg through the network is a different decision from billing the agent's fee, and it is not this
   * slice's to take.
   */
  mintRoadLeg(
    importId: string,
    actorEntityId: string,
    input: { pickupLocation: GeoPoint; pickupLabel?: string; destLabel: string; destLocation?: GeoPoint; weightKg: number },
    by: string,
    now = Date.now(),
  ): ImportDetail {
    const consignment = this.requireImport(importId);
    this.requireImporter(consignment, actorEntityId);
    if (consignment.roadFreightId) {
      throw new GlosError('CONFLICT', `${consignment.code} already has a road leg (${consignment.roadFreightCode}) — a second one would send two trucks for one container`);
    }
    if (!(input.weightKg > 0)) throw new GlosError('VALIDATION_FAILED', 'Say what the load weighs');
    if (!input.destLabel?.trim()) throw new GlosError('FIELD_REQUIRED', 'Say where the container is going');

    /*
     * WHAT MUST BE KNOWN BEFORE A TRUCK IS OFFERED THIS — the gate the question exposed.
     *
     * Until now every container minted the same generic load: an open top, a 40ft high-cube, a food tank
     * and a crude tank produced identical legs, and whatever truck was nearest got offered all four. Two
     * of those combinations cannot be offered to anybody honestly, so they are refused HERE, with the
     * sentence saying which fact is missing rather than a validation code somebody has to interpret.
     *
     * Refused at minting rather than at declaration, deliberately: a container can be recorded the day it
     * is booked, long before anybody knows what will be in it. The moment it needs a truck is the moment
     * the facts have to exist.
     */
    const gaps = this.cargoGaps(consignment);
    if (gaps.length) throw new GlosError('INVALID_STATE', gaps.join(' '));

    const importer = this.entities.get(consignment.importerEntityId);
    const spec = containerType(consignment.containerType);

    const freight = this.dispatch.registerFreight(
      {
        description: `${consignment.code} — ${consignment.goodsDescription}${spec ? ` (${spec.label})` : ''}`,
        pickupLocation: input.pickupLocation,
        pickupLabel: input.pickupLabel?.trim() || consignment.destPort,
        destLabel: input.destLabel.trim(),
        destLocation: input.destLocation,
        weightKg: input.weightKg,
        /*
         * THE FACTS THE BOX AND THE DECLARATION CARRY, handed over instead of dropped.
         *
         * Before this the freight machinery was given a description and a weight, so it derived a body
         * from nothing, asked for no equipment, required no capability, and told the bridge map nothing.
         * Every one of these already existed on the freight side and simply was never passed.
         *
         * `natureCode` is the importer's declaration, so a fuel tank asks for a hazmat-certified vehicle
         * and a reefer for cold chain. `bodyHint` is advisory by design, which is exactly right for a
         * container: the code says which bodies CAN carry it, and the board still derives its own answer.
         * `heightM` is the one the hazard map has been waiting for since it was built.
         */
        ...(consignment.natureCode ? { natureCode: consignment.natureCode as CargoNature } : {}),
        ...(spec ? { bodyHint: spec.bodies[0], packaging: 'piece' as const } : {}),
        ...(spec ? { originEquipment: spec.equipment, destEquipment: spec.equipment } : {}),
        /*
         * How tall it stands. Three cases, and the third is one the tests found:
         *
         *  - a closed box states its own height, and that is the answer;
         *  - AN OPEN TOP's own height is the FLOOR its cargo sits on, so the declared cargo height wins;
         *  - A CODE THAT STATES NO HEIGHT ("taller than 2896 mm") falls back to the measured figure too —
         *    dropping it would have thrown away the one number somebody went and measured, leaving the
         *    bridge map with nothing after they had done exactly what it asked.
         *
         * `cargoGaps` has already refused every combination that would leave this undefined.
         */
        ...(spec ? { heightM: spec.openTop ? consignment.cargoHeightM : (spec.heightM ?? consignment.cargoHeightM) } : {}),
        // A box that cannot be split, which is what makes it a permit conversation rather than two trips.
        ...(spec ? { indivisible: true } : {}),
        // Both ends are inside the destination country: this is the leg from the quay inland, and the sea
        // leg that got it there is not ours and is not modelled.
        pickupCountry: consignment.destCountry,
        destCountry: consignment.destCountry,
        postedByDid: importer.did,
        // No shipperDid, deliberately — see the note above.
        externalOrderId: consignment.code,
      },
      now,
    );
    Object.assign(consignment, {
      roadFreightId: freight.freightId,
      roadFreightCode: freight.code,
      roadMintedAt: new Date(now).toISOString(),
      roadMintedBy: by,
    });
    this.imports.set(consignment.importId, consignment);
    /*
     * Y1 — THE LEG WE MINT IS WHAT STARTS THE CLOCK, and now that is true in code rather than in prose.
     *
     * The box is told which leg carries it, and the out-gate is then DERIVED from that leg's pickup. Not a
     * field anybody types: a container whose truck has not turned up has not left the terminal, however
     * long ago the paperwork was done, and a typed gate date would have been wrong in exactly the cases
     * that matter.
     */
    if (consignment.containerNo) {
      this.boxes.see(consignment.containerNo, { importId: consignment.importId, roadFreightId: freight.freightId }, now);
    }
    return this.detail(consignment.importId, actorEntityId);
  }

  /* ------------------------------------------------------------------ private -- */

  /**
   * Whether the money can run here, and if not, why — in words a person can act on.
   *
   * Two different countries are asked two different questions: we bill where the PAYER is, because collection
   * follows the payer, and we pay out where the AGENT is. Neither answer is a refusal on its own; both are
   * things somebody should know before they start rather than after they have agreed a price.
   */
  private moneyHereFor(consignment: ImportConsignment): MoneyHere {
    const sister = this.collectingSisterFor(consignment);
    const agent = consignment.agentEntityId ? this.entities.find(consignment.agentEntityId) : undefined;
    const canBill = Boolean(sister) && this.presence.can(consignment.destCountry, 'merchantOfRecord');
    const canPayOut = Boolean(agent) && this.presence.can(agent?.jurisdiction, 'payouts');
    const why = !canBill
      ? `We cannot bill in ${consignment.destCountry} yet, so the agent's fee is settled directly between you and them. Everything else on this screen still works — the papers, the grants and the list are ours to hold either way.`
      : agent && !canPayOut
        ? `${agent.name} is in ${agent.jurisdiction}, where we cannot pay out yet. We can receive their fee, and it will sit on our books as owed to them until money may leave to that country.`
        : undefined;
    return {
      canBill,
      canPayOut,
      ...(why ? { why } : {}),
      ...(sister?.currency ? { currency: sister.currency } : {}),
      ...(sister ? { collectingEntityId: sister.entityId } : {}),
    };
  }

  /** Collection follows the PAYER, and the payer is the importer — so the sister where the goods land. */
  private collectingSisterFor(consignment: ImportConsignment) {
    return this.entities.forJurisdiction(consignment.destCountry);
  }

  private currencyFor(consignment: ImportConsignment): string {
    return this.collectingSisterFor(consignment)?.currency ?? '';
  }

  private rowOf(consignment: ImportConsignment, readerEntityId: string): ImportRow {
    const youAre = this.sideOf(consignment, readerEntityId);
    const states = consignment.required.map(stateOf);
    return {
      importId: consignment.importId,
      code: consignment.code,
      status: consignment.status,
      goodsDescription: consignment.goodsDescription,
      ...(consignment.containerNo ? { containerNo: consignment.containerNo } : {}),
      originCountry: consignment.originCountry,
      destCountry: consignment.destCountry,
      destPort: consignment.destPort,
      ...(consignment.etaAt ? { etaAt: consignment.etaAt } : {}),
      importerEntityId: consignment.importerEntityId,
      ...(this.nameOf(consignment.importerEntityId) ? { importerName: this.nameOf(consignment.importerEntityId) } : {}),
      ...(consignment.agentEntityId ? { agentEntityId: consignment.agentEntityId } : {}),
      ...(consignment.agentEntityId && this.nameOf(consignment.agentEntityId) ? { agentName: this.nameOf(consignment.agentEntityId) } : {}),
      youAre,
      accepted: states.filter((s) => s === 'accepted').length,
      asked: states.length,
      // The importer supplies and re-supplies; the agent ticks off. An operator is owed nothing by either.
      waitingOnYou:
        youAre === 'importer'
          ? states.filter((s) => s === 'waiting' || s === 'rejected').length
          : youAre === 'agent'
            ? states.filter((s) => s === 'supplied').length
            : 0,
      feeState: feeStateOf(consignment.fee),
      ...(consignment.roadFreightCode ? { roadFreightCode: consignment.roadFreightCode } : {}),
      createdAt: consignment.createdAt,
    };
  }

  private visibleDocuments(consignment: ImportConsignment, readerEntityId: string, opts: { all?: boolean } = {}): CompanyDocument[] {
    const owned = this.documents.list(consignment.importerEntityId);
    // Their own papers, always. An operator reading the network's shoulder sees them too — the same reach
    // `requireReach` already gives staff over every company record, not a new privilege invented here.
    if (opts.all || readerEntityId === consignment.importerEntityId) return owned;
    const live = this.liveGrants(consignment.importerEntityId, readerEntityId, consignment.importId);
    if (!live.length) return [];
    const company = live.some((g) => g.scope === 'company');
    const perConsignment = live.some((g) => g.scope === 'consignment');
    return owned.filter((d) => (d.relatesTo ? perConsignment && sameRef(d.relatesTo, consignment.code) : company));
  }

  private grantsOn(consignment: ImportConsignment): DocumentGrant[] {
    return [...this.grants.values()]
      .filter((g) => g.ownerEntityId === consignment.importerEntityId && (!g.importId || g.importId === consignment.importId))
      .sort((a, b) => b.grantedAt.localeCompare(a.grantedAt));
  }

  private liveGrants(ownerEntityId: string, readerEntityId: string, importId: string): DocumentGrant[] {
    return [...this.grants.values()].filter(
      (g) => !g.revokedAt && g.ownerEntityId === ownerEntityId && g.readerEntityId === readerEntityId && (g.scope === 'company' || g.importId === importId),
    );
  }

  private observe(consignment: ImportConsignment, key: string, label: string, byEntityId: string, at: string): void {
    const observation: BorderPaperObservation = {
      observationId: `obs_${randomBytes(8).toString('hex')}`,
      country: consignment.destCountry,
      port: consignment.destPort,
      key,
      label,
      byEntityId,
      at,
      importId: consignment.importId,
    };
    this.observations.set(observation.observationId, observation);
  }

  private documentOf(consignment: ImportConsignment, line: RequiredPaper): CompanyDocument | undefined {
    if (!line.documentId) return undefined;
    return this.documents.list(consignment.importerEntityId).find((d) => d.documentId === line.documentId);
  }

  private sideOf(consignment: ImportConsignment, readerEntityId: string): 'importer' | 'agent' | 'onlooker' {
    if (readerEntityId === consignment.importerEntityId) return 'importer';
    if (readerEntityId && readerEntityId === consignment.agentEntityId) return 'agent';
    return 'onlooker';
  }

  private requireImport(importId: string): ImportConsignment {
    const consignment = this.imports.get(importId);
    if (!consignment) throw new GlosError('NOT_FOUND', 'No such consignment');
    return consignment;
  }

  private requireImporter(consignment: ImportConsignment, actorEntityId: string): void {
    if (actorEntityId !== consignment.importerEntityId) {
      throw new GlosError('FORBIDDEN', 'The goods are the importer’s, and so is this decision');
    }
  }

  private requireAgent(consignment: ImportConsignment, actorEntityId: string): void {
    if (!consignment.agentEntityId || actorEntityId !== consignment.agentEntityId) {
      throw new GlosError('FORBIDDEN', `Only the agent appointed on ${consignment.code} can do that`);
    }
  }

  private requireLine(consignment: ImportConsignment, key: string): RequiredPaper {
    const line = consignment.required.find((r) => r.key === slug(key));
    if (!line) throw new GlosError('NOT_FOUND', `${consignment.code} has no paper on its list called that`);
    return line;
  }

  private nameOf(entityId: string): string | undefined {
    return this.entities.find(entityId)?.name;
  }

  /** IMP-001, and derived from what is stored rather than a counter, because a counter forgets on restart. */
  private nextCode(): string {
    const highest = [...this.imports.values()].reduce((n, c) => Math.max(n, Number(c.code.slice(4)) || 0), 0);
    return `IMP-${String(highest + 1).padStart(3, '0')}`;
  }
}

/* -------------------------------------------------------------------- helpers -- */

/** `waiting` nobody has supplied it · `supplied` waiting on the agent · `accepted` · `rejected`. */
function stateOf(line: RequiredPaper): 'waiting' | 'supplied' | 'accepted' | 'rejected' {
  if (line.acceptedAt) return 'accepted';
  if (line.rejectedAt) return 'rejected';
  return line.documentId ? 'supplied' : 'waiting';
}

/** Expiry is a DATE, and a paper is good through the whole of the day it expires on. */
function expired(document: CompanyDocument, now: number): boolean {
  return Boolean(document.expiresAt) && document.expiresAt! < new Date(now).toISOString().slice(0, 10);
}

function sameRef(a: string, b: string): boolean {
  return a.trim().toUpperCase() === b.trim().toUpperCase();
}

/** A filing key from an agent's own words: lower case, words joined by underscores. */
function slug(value: string): string {
  return (value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
}

function country(value: string, which: string): string {
  const code = (value ?? '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) throw new GlosError('VALIDATION_FAILED', `Say ${which} as a two-letter country code`);
  return code;
}

/**
 * How far the agent's fee has got. DERIVED on every read, never stored beside the record.
 *
 * A stored "paid" flag is a flag that can disagree with the journal entry that moved the money, and when
 * those two disagree the flag is always the one people believe.
 */
function feeStateOf(fee?: ImportFee): FeeState {
  if (!fee) return 'none';
  if (fee.paidAt) return 'paid';
  return fee.acceptedAt ? 'accepted' : 'quoted';
}

/** Money to two places. The books convert to minor units at their own boundary; this stops 0.1 + 0.2 arriving. */
function money(amount: number): number {
  return Number.isFinite(amount) ? Math.round(amount * 100) / 100 : 0;
}

function date(value: string | undefined, what: string): string | undefined {
  const v = value?.trim();
  if (!v) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) throw new GlosError('VALIDATION_FAILED', `${what} must be a date written YYYY-MM-DD`);
  return v;
}
