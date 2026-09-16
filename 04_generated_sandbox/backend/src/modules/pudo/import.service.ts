import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { GlosError } from '../../foundation/http/glos-error';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { EntityService } from '../../foundation/entity/entity.service';
import { CompanyDocument, CompanyDocumentService } from '../../foundation/entity/company-documents.service';
import {
  BorderPaperObservation,
  DocumentGrant,
  ImportConsignment,
  ImportDetail,
  ImportRow,
  KnownPaper,
  RequiredPaper,
  RequiredPaperView,
} from './import.types';

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

  constructor(
    private readonly entities: EntityService,
    private readonly documents: CompanyDocumentService,
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
    },
    by: string,
    now = Date.now(),
  ): ImportConsignment {
    const importer = this.entities.get(input.importerEntityId);
    const goodsDescription = input.goodsDescription?.trim();
    if (!goodsDescription) throw new GlosError('FIELD_REQUIRED', 'Say what is in the container — an agent cannot tell you which papers you need without it');
    const destPort = input.destPort?.trim();
    if (!destPort) throw new GlosError('FIELD_REQUIRED', 'Say where it is cleared — the papers a border asks for are that border’s, not the country’s');
    const originCountry = country(input.originCountry, 'where it is coming from');
    const destCountry = country(input.destCountry, 'where it is going');
    const etaAt = date(input.etaAt, 'An expected arrival');

    const consignment: ImportConsignment = {
      importId: `imp_${randomBytes(8).toString('hex')}`,
      code: this.nextCode(),
      status: 'open',
      importerEntityId: importer.entityId,
      goodsDescription,
      ...(input.containerNo?.trim() ? { containerNo: input.containerNo.trim().toUpperCase() } : {}),
      originCountry,
      destCountry,
      destPort,
      ...(input.carrierRef?.trim() ? { carrierRef: input.carrierRef.trim() } : {}),
      // `manual` is the only source anything writes. See the class comment on the carrier seam.
      ...(etaAt ? { etaAt, etaSource: 'manual' as const } : {}),
      required: [],
      createdAt: new Date(now).toISOString(),
      createdBy: by,
    };
    this.imports.set(consignment.importId, consignment);
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
    };
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

  /* ------------------------------------------------------------------ private -- */

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

function date(value: string | undefined, what: string): string | undefined {
  const v = value?.trim();
  if (!v) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) throw new GlosError('VALIDATION_FAILED', `${what} must be a date written YYYY-MM-DD`);
  return v;
}
