import { Injectable, OnModuleInit, Optional } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { IntrospectionResult } from '../../foundation/auth/auth.types';
import { zip, ZipEntry } from '../../foundation/archive/zip';
import { GlosError } from '../../foundation/http/glos-error';
import { maskAddress, MailService } from '../../foundation/mail/mail.service';
import { appUrl } from '../../foundation/mail/mail.templates';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { isFor } from './addressed-to';
import { AgentService } from './agent.service';
import {
  DAMAGE_REPORT_STATEMENT,
  DamageReportBody,
  DamageReportHolder,
  DamageReportLinkRow,
  DamageReportLinkView,
  DamageReportPhoto,
  DamageReportRow,
  DamageReportView,
  ReportLinkState,
} from './damage-report.types';
import { LINK_DAYS, LINK_MAX_LIVE, LINK_MAX_OPENS } from './document-link.service';
import { DriverService } from './driver.service';
import { FleetManagerService } from './fleet-manager.service';
import { MdpService } from './mdp.service';
import { MediaService } from './media.service';
import { canonicalJson } from './note-archive.types';
import { custodyAt, parcelCurrency, ParcelService } from './parcel.service';
import { PersonService } from './person.service';
import { CustodyKind, Parcel } from './pudo.types';
import { VendorService } from './vendor.service';

const DAY_MS = 86_400_000;

/** What is kept of a link to a report. NEVER THE KEY: only its fingerprint, so that reading this store opens nothing. */
interface DamageReportLink {
  linkId: string;
  tokenHash: string;
  parcelId: string;
  /** Who made it: the receiver's account, or the store. That party alone sees it and may cancel it. */
  forDid: string;
  createdAt: string;
  expiresAt: string;
  opened: number;
  lastOpenedAt?: string;
  cancelledAt?: string;
}

/** Who is reading, and what that lets them do. Only whoever the report is FOR may make a link to it. */
type ReadingAs = 'staff' | 'receiver' | 'store' | 'shop';

/**
 * THE DAMAGE CLAIM REPORT (damage-report.types.ts says why it exists).
 *
 * MADE ONCE, in the act of reporting: ParcelService calls this before anything else can happen to the parcel, so
 * the report holds the record exactly as it stood then — and it is kept with a fingerprint and never rebuilt. A
 * problem reported before this existed has its report made the first time it is asked for, from what the record
 * dates no later than the report.
 *
 * WHO READS IT. The receiver, whose goods they are; the store, on its own order; the shop that reported it at its
 * counter; and staff. NOT the sender of a parcel between two people: what the receiver wrote and photographed has
 * always been the receiver's to show them (ParcelService.toConsumerView), and a link is how they do.
 *
 * A LINK is the same key a consignment note's link is (document-link.service.ts), held to the same limits: it cannot
 * be guessed, it stops, it opens exactly this report, every opening is counted, and whoever made it can cancel it.
 * NOT STAFF: a link made by staff would be a way in that nobody on the parcel made, could see, or could cancel.
 */
@Injectable()
export class DamageReportService implements OnModuleInit {
  private readonly reports = new PersistentMap<string, DamageReportView>('pudo-damage-reports');
  private readonly links = new PersistentMap<string, DamageReportLink>('pudo-damage-report-links');

  constructor(
    private readonly parcels: ParcelService,
    private readonly agents: AgentService,
    private readonly media: MediaService,
    // Optional so a spec that builds this by hand names only what it exercises; app.boot.spec catches one missing from the module.
    @Optional() private readonly vendors?: VendorService,
    @Optional() private readonly persons?: PersonService,
    @Optional() private readonly drivers?: DriverService,
    @Optional() private readonly managers?: FleetManagerService,
    @Optional() private readonly mdps?: MdpService,
    @Optional() private readonly mail?: MailService,
  ) {}

  onModuleInit(): void {
    // The moment a problem is reported, at a counter or from somebody's own app.
    this.parcels.registerProblemReported((parcelId) => void this.ensure(parcelId));
  }

  /* ------------------------------------------------------------------ the report -- */

  /** The report on this parcel's reported problem — or nothing, where no problem was ever reported on it. */
  ensure(parcelId: string): DamageReportView | undefined {
    const kept = this.reports.get(parcelId);
    if (kept) return kept;
    let parcel: Parcel;
    try {
      parcel = this.parcels.get(parcelId);
    } catch {
      return undefined;
    }
    if (!parcel.dispute) return undefined;
    const body = this.bodyOf(parcel);
    const report: DamageReportView = { parcelId, madeAt: parcel.dispute.raisedAt, sha256: fingerprintOf(body), body };
    this.reports.set(parcelId, report);
    void this.handToInsurer(report, parcel);
    return report;
  }

  /**
   * TO THE INSURER THE STORE NAMES — by a link, in an email, the moment the report is made.
   *
   * The user, 2026-10-12: the report goes "to an insurer of the claimants choice, to the claimant themselves or one
   * set by the vendor according to their shipping policy"; and 2026-10-13, that sending it is "indeed only emailing a
   * link" ([[rule-files-by-link-not-attachment]]: the file stays here, the email carries a key that opens it, and the
   * store sees the link on the report and can stop it). The link is made FOR THE STORE: it is one of the store's
   * handful, counted against it, and reads the report as the store does. The store itself is not emailed: it has the
   * report in its own app, and its systems are told by the callback they already get.
   *
   * Never a reason the report could not be made: an address that will not take mail is the outbox's business.
   */
  private async handToInsurer(report: DamageReportView, parcel: Parcel): Promise<void> {
    if (!parcel.vendorId || !this.mail) return;
    const store = attempt(() => this.vendors?.get(parcel.vendorId!));
    const insurer = store?.shippingPolicy?.insurer;
    if (!store || !insurer?.email) return;
    const now = Date.now();
    const made = this.issueLink(parcel.parcelId, store.did, now);
    const sent = await this.mail.send('damage-report', { address: insurer.email, name: insurer.name }, {
      number: report.body.number,
      parcelId: parcel.parcelId,
      ...(report.body.parcel.orderNumber ? { orderNumber: report.body.parcel.orderNumber } : {}),
      store: store.name,
      insurer: insurer.name,
      reportedAt: report.body.problem.reportedAt,
      by: report.body.problem.origin === 'counter' ? 'shop' : 'receiver',
      problem: report.body.problem.reason,
      from: report.body.parcel.from,
      to: report.body.parcel.to,
      url: made.url,
      until: made.link.expiresAt,
    });
    if (!sent) return;
    const kept = this.reports.get(parcel.parcelId);
    if (kept) this.reports.set(parcel.parcelId, { ...kept, insurer: { insurer: insurer.name, sentTo: maskAddress(insurer.email), at: new Date(now).toISOString() } });
  }

  /** The report, for whoever may read it. A stranger is told nothing — not even that there is one. */
  read(parcelId: string, actor: IntrospectionResult | undefined): DamageReportView {
    return this.reading(parcelId, actor).report;
  }

  /**
   * THE REPORTS ON A STORE'S OWN ORDERS, newest first — for the store, signed in as itself, and for staff. Another
   * store is told the store does not exist: that it does is not theirs to learn here.
   */
  listForStore(vendorId: string, actor: IntrospectionResult | undefined, now: number = Date.now()): DamageReportRow[] {
    const store = attempt(() => this.vendors?.get(vendorId));
    if (!store || !actor || (actor.role !== 'operator' && actor.did !== store.did)) throw new GlosError('NOT_FOUND', 'No such store');
    return this.list(now, vendorId);
  }

  /** Every problem reported, newest first — what staff read. They decide nothing here; this is the record of what was handed over. */
  list(now: number = Date.now(), vendorId?: string): DamageReportRow[] {
    const rows: DamageReportRow[] = [];
    for (const parcel of this.parcels.list()) {
      if (!parcel.dispute || (vendorId !== undefined && parcel.vendorId !== vendorId)) continue;
      const report = this.ensure(parcel.parcelId);
      if (!report) continue;
      const links = [...this.links.values()].filter((l) => l.parcelId === parcel.parcelId);
      rows.push({
        parcelId: report.parcelId,
        number: report.body.number,
        madeAt: report.madeAt,
        origin: report.body.problem.origin,
        reason: report.body.problem.reason,
        from: report.body.parcel.from,
        to: report.body.parcel.to,
        ...(report.body.parcel.store ? { store: report.body.parcel.store } : {}),
        ...(report.body.problem.heldBy ? { heldBy: report.body.problem.heldBy.name } : {}),
        links: links.filter((l) => this.stateOf(l, now) === 'ready').length,
        opened: links.reduce((sum, l) => sum + l.opened, 0),
        ...(report.insurer ? { insurer: report.insurer } : {}),
      });
    }
    return rows.sort((a, b) => (a.madeAt < b.madeAt ? 1 : -1));
  }

  /** The file, for somebody signed in who may read the report. */
  file(parcelId: string, actor: IntrospectionResult | undefined): { filename: string; bytes: Buffer } {
    return this.bundle(this.reading(parcelId, actor).report);
  }

  /* ------------------------------------------------------------------ links -- */

  /**
   * WHOEVER THE REPORT IS FOR MAKES A LINK, TO PASS ON — to an insurer, to the sender, to anybody they choose. That
   * choice is theirs and is why nothing here sends the report to anyone: the claimant hands it over.
   * The address is handed back ONCE. The key is not kept, so it cannot be shown again.
   */
  makeLink(parcelId: string, actor: IntrospectionResult | undefined, now: number = Date.now()): { url: string; link: DamageReportLinkRow } {
    const reading = this.reading(parcelId, actor);
    if (reading.as === 'staff') throw new GlosError('FORBIDDEN', 'A link is made by whoever the report is for. Staff read the report itself.');
    if (reading.as === 'shop') throw new GlosError('FORBIDDEN', 'A link is made by whoever the report is for: the receiver, or the store whose order it is.');
    return this.issueLink(parcelId, reading.forDid!, now);
  }

  /** The key, made and handed back ONCE — in the address and nowhere else, ever again. */
  private issueLink(parcelId: string, forDid: string, now: number): { url: string; link: DamageReportLinkRow } {
    if (this.live(parcelId, forDid, now) >= LINK_MAX_LIVE) throw new GlosError('INVALID_STATE', `This report already has ${LINK_MAX_LIVE} links that work. Cancel one to make another.`, { field: 'parcelId' });
    const token = randomBytes(32).toString('base64url');
    const link: DamageReportLink = {
      linkId: `drl_${randomBytes(8).toString('hex')}`,
      tokenHash: hashOf(token),
      parcelId,
      forDid,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + LINK_DAYS * DAY_MS).toISOString(),
      opened: 0,
    };
    this.links.set(link.tokenHash, link);
    return { url: reportLinkUrl(token), link: this.row(link, now) };
  }

  /** The links the caller made on this report. Staff see them all, as they see the report. */
  linksFor(parcelId: string, actor: IntrospectionResult | undefined, now: number = Date.now()): DamageReportLinkRow[] {
    const reading = this.reading(parcelId, actor);
    return [...this.links.values()]
      .filter((l) => l.parcelId === parcelId && (reading.as === 'staff' || l.forDid === reading.forDid))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .map((l) => this.row(l, now));
  }

  /** Cancel a link: from now on it opens nothing, whoever holds it. Twice is the same as once. */
  cancelLink(parcelId: string, linkId: string, actor: IntrospectionResult | undefined, now: number = Date.now()): DamageReportLinkRow {
    const reading = this.reading(parcelId, actor);
    const link = [...this.links.values()].find((l) => l.linkId === linkId && l.parcelId === parcelId);
    // Somebody else's link is answered as one that does not exist: that it exists is theirs to know.
    if (!link || (reading.as !== 'staff' && link.forDid !== reading.forDid)) throw new GlosError('NOT_FOUND', 'No such link on this report');
    const cancelled: DamageReportLink = link.cancelledAt ? link : { ...link, cancelledAt: new Date(now).toISOString() };
    this.links.set(link.tokenHash, cancelled);
    return this.row(cancelled, now);
  }

  /** What this link is — said before the file is taken, and said plainly when it no longer opens. */
  look(token: string, now: number = Date.now()): DamageReportLinkView {
    const link = this.find(token);
    const state = this.stateOf(link, now);
    const report = state === 'ready' ? this.ensure(link.parcelId) : undefined;
    if (!report) return { state: state === 'ready' ? 'cancelled' : state, expiresAt: link.expiresAt };
    return {
      state,
      expiresAt: link.expiresAt,
      number: report.body.number,
      parcelId: report.parcelId,
      from: report.body.parcel.from,
      to: report.body.parcel.to,
      reportedAt: report.body.problem.reportedAt,
      sha256: report.sha256,
      opensLeft: LINK_MAX_OPENS - link.opened,
    };
  }

  /** Hand the file over, and count it. A link that no longer opens says which way it stopped. */
  fetch(token: string, now: number = Date.now()): { filename: string; bytes: Buffer } {
    const link = this.find(token);
    const state = this.stateOf(link, now);
    if (state !== 'ready') throw new GlosError('INVALID_STATE', STOPPED[state], { field: 'token', state });
    const report = this.ensure(link.parcelId);
    if (!report) throw new GlosError('NOT_FOUND', 'The report this link opened is no longer kept');
    const file = this.bundle(report);
    // Counted once the file exists: an opening that failed to build is not an opening.
    this.links.set(link.tokenHash, { ...link, opened: link.opened + 1, lastOpenedAt: new Date(now).toISOString() });
    return file;
  }

  /* ------------------------------------------------------------------ who is reading -- */

  private reading(parcelId: string, actor: IntrospectionResult | undefined): { report: DamageReportView; as: ReadingAs; forDid?: string } {
    const none = () => new GlosError('NOT_FOUND', 'No damage claim report on such a parcel');
    if (!actor) throw none();
    let parcel: Parcel;
    try {
      parcel = this.parcels.get(parcelId);
    } catch {
      throw none();
    }
    const report = this.ensure(parcelId);
    if (actor.role === 'operator') {
      if (!report) throw none();
      return { report, as: 'staff' };
    }
    const did = actor.did;
    if (!did || !report) throw none();
    const person = this.persons?.findByDid(did);
    if (person) {
      if (isFor(this.parcels.receiverOf(parcel), person)) return { report, as: 'receiver', forDid: person.personDid };
      // The sender IS on the parcel, so they are told why rather than told nothing.
      if (isFor(this.parcels.senderOf(parcel), person)) {
        throw new GlosError('FORBIDDEN', 'The damage claim report was made for the receiver, who holds what was written and photographed. Ask them to pass it on to you.');
      }
      throw none();
    }
    if (parcel.vendorId && this.storeDid(parcel.vendorId) === did) return { report, as: 'store', forDid: did };
    if (parcel.dispute?.origin === 'counter' && parcel.dispute.raisedBy === did) return { report, as: 'shop' };
    throw none();
  }

  private storeDid(vendorId: string): string | undefined {
    try {
      return this.vendors?.get(vendorId).did;
    } catch {
      return undefined;
    }
  }

  /* ------------------------------------------------------------------ what it says -- */

  private bodyOf(p: Parcel): DamageReportBody {
    const case_ = p.dispute!;
    const at = case_.raisedAt;
    // Once it is handed over it is in nobody's hands that the network answers for — said as that, never worked out
    // from two times that may be the same instant.
    const held = case_.fromStatus === 'Delivered' ? undefined : custodyAt(p, at);
    const origin = p.originAgentDid ? this.agents.find(p.originAgentDid)?.shopName : undefined;
    const dest = p.destAgentDid ? this.agents.find(p.destAgentDid)?.shopName : undefined;
    const store = p.vendorId ? this.storeName(p.vendorId) : undefined;
    const firstHands = p.custody?.[0]?.holderKind;

    // Nothing later than the report goes in: the hands it was in then are still "open", whatever happened since.
    const custody = (p.custody ?? [])
      .filter((leg) => leg.from <= at)
      .map((leg) => ({ holder: this.holder(leg.holderKind, leg.holderId, p), from: leg.from, ...(leg.to && leg.to <= at ? { to: leg.to } : {}), ...(leg.note ? { note: leg.note } : {}) }));
    // The steps up to and including the one that records the report itself.
    const events: DamageReportBody['events'] = [];
    for (const scan of p.scans) {
      events.push({ at: scan.at, status: scan.status, note: scan.note ?? '', ...(scan.anchorTxId ? { fingerprint: scan.anchorTxId } : {}) });
      if (scan.status === 'Disputed' && scan.at >= at) break;
    }

    const problemPhoto = case_.origin === 'buyer' ? p.buyerDisputePhotoRef : p.disputePhotoRef;
    // A parcel reported while it was still on the shelf had not been handed over: a photograph of the hand-over, or
    // one the receiver took afterwards, is later than the report — as is any picture dated after it.
    const handedOver = case_.fromStatus === 'Delivered';
    const photographs = (
      [
        ['contents', p.contentPhotoRef],
        ['drop_off', p.dropoffPhotoRef],
        ['handed_over', handedOver ? p.deliveredPhotoRef : undefined],
        ['received', handedOver ? p.buyerPodPhotoRef : undefined],
        ['problem', problemPhoto],
      ] as Array<[string, string | undefined]>
    )
      .filter((x): x is [string, string] => Boolean(x[1]))
      .map(([what, reference]) => this.photo(what, reference))
      .filter((photo) => photo.what === 'problem' || !photo.takenAt || photo.takenAt <= at);

    const terms = this.termsOf(p);
    return {
      number: `DCR-${p.parcelId}`,
      statement: DAMAGE_REPORT_STATEMENT,
      parcel: {
        parcelId: p.parcelId,
        ...(p.did ? { shipmentId: p.did } : {}),
        through: p.vendorId ? 'store' : firstHands === 'sender' ? 'app' : 'counter',
        ...(store ? { store } : {}),
        ...(p.externalOrderId ? { orderNumber: p.externalOrderId } : {}),
        madeAt: p.acceptedAt ?? p.scans[0]?.at ?? at,
        from: [origin, p.originZone].filter(Boolean).join(', '),
        to: [dest, p.destZone].filter(Boolean).join(', '),
        size: p.size,
        fragile: Boolean(p.fragile),
        ...(p.items?.length ? { contents: p.items.map((i) => (i.qty > 1 ? `${i.qty} × ${i.name}` : i.name)) } : {}),
        ...(p.declaredValue ? { declaredValue: p.declaredValue } : {}),
        currency: terms.currency,
      },
      terms,
      problem: {
        origin: case_.origin,
        reportedAt: at,
        reason: (case_.origin === 'buyer' ? (p.buyerDisputeReason ?? case_.reason) : case_.reason) ?? '',
        parcelWas: case_.fromStatus === 'Delivered' ? 'handed over to the receiver' : case_.fromStatus === 'Ready_For_Pickup' ? 'on the shelf of the collection shop, not yet handed over' : case_.fromStatus,
        ...(held ? { heldBy: this.holder(held.holderKind, held.holderId, p) } : {}),
        ...(case_.origin === 'counter' ? { shop: this.agents.find(case_.raisedBy)?.shopName ?? 'The collection shop' } : {}),
      },
      custody,
      events,
      photographs,
    };
  }

  /** The terms the parcel travelled under, as they were stamped on it when it was made — not today's. */
  private termsOf(p: Parcel): DamageReportBody['terms'] {
    let company: string | undefined;
    let promise: string = p.takeInPromise ?? (p.collectingEntityId || p.sellerEntityId ? 'ours' : 'none');
    let currency = parcelCurrency(p);
    try {
      const said = this.parcels.intakeTermsFor(p);
      promise = said.promise;
      company = said.answeredBy;
      if (!p.currency) currency = said.currency;
    } catch {
      /* a parcel that was never taken in at a counter: what is on the parcel itself stands */
    }
    return { promise, ...(company ? { company } : {}), coverLimit: p.coverLimit ?? 0, currency };
  }

  /**
   * Who held it, named as who the network CONTRACTS with. A shop by its trading name; a fleet's driver by the fleet's
   * company, never by their own name; somebody who rides for themselves by the name they ride under, because they
   * are the party. Where the record names nobody we can look up, the kind of hands is still said.
   */
  private holder(kind: CustodyKind, id: string, p: Parcel): DamageReportHolder {
    switch (kind) {
      case 'shop':
        return { kind, name: this.agents.find(id)?.shopName ?? 'A collection shop' };
      case 'hub':
        return { kind, name: attempt(() => this.mdps?.require(id).name) ?? 'A sorting hub' };
      case 'driver':
        return { kind, name: this.carrierName(id) };
      case 'sender':
        return { kind, name: (p.vendorId === id ? this.storeName(id) : undefined) ?? 'The sender' };
      default:
        return { kind, name: 'The receiver' };
    }
  }

  private carrierName(driverDid: string): string {
    return (
      attempt(() => {
        const driver = this.drivers?.get(driverDid);
        if (!driver) return undefined;
        return driver.managerDid ? this.managers?.get(driver.managerDid).companyName : driver.displayName;
      }) ?? 'The carrier'
    );
  }

  private storeName(vendorId: string): string | undefined {
    return attempt(() => this.vendors?.get(vendorId).name);
  }

  private photo(what: string, reference: string): DamageReportPhoto {
    const ref = attempt(() => this.media.get(reference));
    return { what, reference, ...(ref ? { mediaId: reference, takenAt: ref.createdAt, ...(ref.sha256 ? { sha256: ref.sha256 } : {}) } : {}) };
  }

  /* ------------------------------------------------------------------ the file -- */

  /**
   * One file somebody can keep: the report to read or print, the same facts for a machine, and the photographs.
   * `report.json` holds exactly the bytes the fingerprint was taken over, so anybody can check it.
   */
  private bundle(report: DamageReportView): { filename: string; bytes: Buffer } {
    const entries: ZipEntry[] = [];
    const files = new Map<string, string>();
    const missing = new Map<string, string>();
    for (const photo of report.body.photographs) {
      if (!photo.mediaId) continue;
      try {
        const { bytes, contentType } = this.media.blob(photo.mediaId);
        const name = `photographs/${photo.what}-${photo.mediaId}.${extensionFor(contentType)}`;
        entries.push({ name, bytes, ...(photo.takenAt ? { at: new Date(photo.takenAt) } : {}) });
        files.set(photo.mediaId, name);
      } catch {
        // A reader must be able to tell "no photograph was taken" from "one was taken and is no longer kept".
        missing.set(photo.mediaId, 'Kept until its keeping time ended, then deleted');
      }
    }
    entries.unshift(
      { name: 'damage-claim-report.html', bytes: Buffer.from(reportHtml(report, files, missing), 'utf8'), at: new Date(report.madeAt) },
      { name: 'report.json', bytes: Buffer.from(canonicalJson(report.body), 'utf8'), at: new Date(report.madeAt) },
      { name: 'README.txt', bytes: Buffer.from(readme(report), 'utf8') },
    );
    return { filename: `damage-claim-report-${safe(report.parcelId)}.zip`, bytes: zip(entries) };
  }

  /* ------------------------------------------------------------------ internals -- */

  private live(parcelId: string, forDid: string, now: number): number {
    return [...this.links.values()].filter((l) => l.parcelId === parcelId && l.forDid === forDid && this.stateOf(l, now) === 'ready').length;
  }

  private row(l: DamageReportLink, now: number): DamageReportLinkRow {
    return {
      linkId: l.linkId,
      state: this.stateOf(l, now),
      createdAt: l.createdAt,
      expiresAt: l.expiresAt,
      opened: l.opened,
      ...(l.lastOpenedAt ? { lastOpenedAt: l.lastOpenedAt } : {}),
      ...(l.cancelledAt ? { cancelledAt: l.cancelledAt } : {}),
    };
  }

  /** A key that is not one of ours — or is nothing like one — is not found. There is nothing to tell it apart by. */
  private find(token: string): DamageReportLink {
    const link = typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token) ? this.links.get(hashOf(token)) : undefined;
    if (!link) throw new GlosError('NOT_FOUND', 'This is not a link we made');
    return link;
  }

  /** What was DONE to it comes first, then the clock and the count. */
  private stateOf(link: DamageReportLink, now: number): ReportLinkState {
    if (link.cancelledAt) return 'cancelled';
    if (now >= Date.parse(link.expiresAt)) return 'expired';
    if (link.opened >= LINK_MAX_OPENS) return 'used_up';
    return 'ready';
  }
}

const STOPPED: Record<Exclude<ReportLinkState, 'ready'>, string> = {
  cancelled: 'This link was cancelled',
  expired: 'This link has stopped working: its time is up',
  used_up: 'This link has been opened as often as one link can be',
};

/** The report's own fingerprint: SHA-256 over what it says, keys sorted, so two builders of the same facts agree. */
export function fingerprintOf(body: DamageReportBody): string {
  return createHash('sha256').update(canonicalJson(body)).digest('hex');
}

function hashOf(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** The address somebody is handed. The key is after the `#`: a browser keeps that part to itself, and the front door reads it there. */
export function reportLinkUrl(token: string): string {
  return `${appUrl('home')}#report=${token}`;
}

function attempt<T>(read: () => T | undefined): T | undefined {
  try {
    return read();
  } catch {
    return undefined;
  }
}

function safe(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 80) || 'parcel';
}

function extensionFor(contentType: string): string {
  if (/png/.test(contentType)) return 'png';
  if (/webp/.test(contentType)) return 'webp';
  if (/pdf/.test(contentType)) return 'pdf';
  return 'jpg';
}

const PHOTO_WORDS: Record<string, string> = {
  contents: 'The contents, when the parcel was made',
  drop_off: 'The parcel at the counter, when it was handed in',
  handed_over: 'The parcel at the counter, when it was handed to the receiver',
  received: 'The receiver’s own photograph of what they received',
  problem: 'The problem, as it was reported',
};
const HANDS_WORDS: Record<CustodyKind, string> = { sender: 'Sender', shop: 'Shop', driver: 'Carrier', hub: 'Sorting hub', receiver: 'Receiver' };
const THROUGH_WORDS: Record<string, string> = { store: 'A store’s order', counter: 'Handed in at a shop’s counter', app: 'Sent from the sender’s own phone' };

function esc(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** A moment, written so that nobody has to know a time zone to read it: the day, the time, and that it is UTC. */
function when(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)} UTC`;
}

/** What the company pays itself, in a sentence — the terms the parcel travelled under. */
export function termsSentence(terms: DamageReportBody['terms']): string {
  if (terms.promise === 'theirs') return 'Carried under the carrier’s own promise. No company of the network answers for these goods.';
  if (terms.promise !== 'ours') return 'No company of the network answers for these goods.';
  const who = terms.company ?? 'The company that carried it';
  return terms.coverLimit > 0
    ? `${who} states that it pays up to ${terms.coverLimit.toFixed(2)} ${terms.currency} from its own books on a parcel like this one.`
    : `${who} has stated no cover: it pays nothing from its own books. A claim is for the claimant’s insurer, the store’s, or whoever answers by law.`;
}

function reportHtml(report: DamageReportView, files: Map<string, string>, missing: Map<string, string>): string {
  const b = report.body;
  const row = (label: string, value: unknown) => (value === undefined || value === '' ? '' : `<tr><th>${esc(label)}</th><td>${esc(value)}</td></tr>`);
  const photos = b.photographs
    .map((p) => {
      const file = p.mediaId ? files.get(p.mediaId) : undefined;
      const said = file
        ? `<a href="${esc(file)}"><img src="${esc(file)}" alt="${esc(PHOTO_WORDS[p.what] ?? p.what)}"></a>`
        : `<p class="none">${esc(p.mediaId ? (missing.get(p.mediaId) ?? 'Not available') : `Recorded by reference only: ${p.reference}`)}</p>`;
      return `<figure>${said}<figcaption>${esc(PHOTO_WORDS[p.what] ?? p.what)}${p.takenAt ? ` · ${esc(when(p.takenAt))}` : ''}${p.sha256 ? `<br><code>${esc(p.sha256)}</code>` : ''}</figcaption></figure>`;
    })
    .join('\n');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Damage claim report ${esc(b.number)}</title>
<style>
body{font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111;max-width:820px;margin:24px auto;padding:0 16px}
h1{font-size:24px;margin:0 0 4px}h2{font-size:17px;margin:28px 0 8px;border-bottom:1px solid #ccc;padding-bottom:4px}
.statement{background:#f4f4f6;border-left:4px solid #555;padding:12px 14px;margin:16px 0}
table{border-collapse:collapse;width:100%}th,td{text-align:left;vertical-align:top;padding:5px 8px;border-bottom:1px solid #eee}
th{width:34%;font-weight:600}code{font-size:12px;word-break:break-all}
figure{margin:12px 0}img{max-width:100%;max-height:520px;border:1px solid #ccc}.none{color:#555;font-style:italic}
.fp{font-size:13px;color:#333}@media print{body{margin:0}}
</style></head><body>
<h1>Damage claim report</h1>
<p>${esc(b.number)} · made ${esc(when(report.madeAt))}</p>
<p class="statement">${esc(b.statement)}</p>

<h2>The problem that was reported</h2>
<table>
${row('Reported by', b.problem.origin === 'counter' ? `${b.problem.shop ?? 'The collection shop'}, at its counter` : 'The receiver, from their own app')}
${row('When', when(b.problem.reportedAt))}
${row('In their words', b.problem.reason)}
${row('The parcel was', b.problem.parcelWas)}
${row('In whose hands', b.problem.heldBy ? `${HANDS_WORDS[b.problem.heldBy.kind]}: ${b.problem.heldBy.name}` : 'Nobody’s within the network: it had been handed over')}
</table>

<h2>The parcel, as it was made</h2>
<table>
${row('Parcel', b.parcel.parcelId)}
${row('Shipment identity', b.parcel.shipmentId)}
${row('How it came in', THROUGH_WORDS[b.parcel.through] ?? b.parcel.through)}
${row('Store', b.parcel.store)}
${row('The store’s order number', b.parcel.orderNumber)}
${row('Made', when(b.parcel.madeAt))}
${row('From', b.parcel.from)}
${row('To', b.parcel.to)}
${row('Size', b.parcel.size + (b.parcel.fragile ? ', marked fragile' : ''))}
${row('Contents, as stated', b.parcel.contents?.join('; '))}
${row('Value stated', b.parcel.declaredValue !== undefined ? `${b.parcel.declaredValue.toFixed(2)} ${b.parcel.currency}` : undefined)}
</table>

<h2>The terms it travelled under</h2>
<p>${esc(termsSentence(b.terms))}</p>

<h2>Who held it, and when</h2>
<table>
<tr><th>In whose hands</th><td><b>From</b> — <b>until</b></td></tr>
${b.custody.map((leg) => `<tr><th>${esc(HANDS_WORDS[leg.holder.kind])}: ${esc(leg.holder.name)}</th><td>${leg.holder.kind === 'receiver' ? `handed over to them ${esc(when(leg.from))}` : `${esc(when(leg.from))} — ${leg.to ? esc(when(leg.to)) : 'still, when the problem was reported'}`}${leg.note ? `<br>${esc(leg.note)}` : ''}</td></tr>`).join('\n')}
</table>

<h2>Every recorded step, with its fingerprint</h2>
<table>
${b.events.map((e) => `<tr><th>${esc(when(e.at))}</th><td>${esc(e.status === 'Disputed' ? 'Problem reported' : e.status.replace(/_/g, ' '))}${e.note ? ` — ${esc(e.note)}` : ''}${e.fingerprint ? `<br><code>${esc(e.fingerprint)}</code>` : ''}</td></tr>`).join('\n')}
</table>

<h2>Photographs</h2>
${photos || '<p class="none">No photograph belongs to this parcel.</p>'}

<h2>The fingerprint of this report</h2>
<p class="fp"><code>${esc(report.sha256)}</code><br>SHA-256 over <code>report.json</code>, which is in the same file as this page. Two copies with the same fingerprint say the same thing.</p>
</body></html>
`;
}

function readme(report: DamageReportView): string {
  return [
    `DAMAGE CLAIM REPORT ${report.body.number}`,
    '',
    DAMAGE_REPORT_STATEMENT,
    '',
    'WHAT IS IN THIS FILE',
    '  damage-claim-report.html   The report, to read or to print.',
    '  report.json                The same facts for a machine. The fingerprint is taken over exactly these bytes.',
    '  photographs/               Every photograph that belongs to the parcel and is still kept.',
    '',
    'THE FINGERPRINT',
    `  ${report.sha256}`,
    '  It is the SHA-256 of report.json. Anybody can work it out again from that file; if it comes out the same,',
    '  the report is as it was made. Two people holding this report can compare the fingerprint instead of the pages.',
    '',
    `The report was made ${when(report.madeAt)}, from the record as it stood at that moment. Nothing that happened to the`,
    'parcel afterwards is in it.',
    '',
  ].join('\n');
}
