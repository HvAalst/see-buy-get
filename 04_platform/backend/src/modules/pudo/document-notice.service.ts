import { Injectable, Logger, Optional } from '@nestjs/common';
import { catalogueEntry } from '../../foundation/countries/catalogue';
import { DocumentsService } from '../../foundation/documents/documents.service';
import { AgreementService } from '../../foundation/documents/agreement.service';
import { documentKey, documentPath, type DocumentVersion } from '../../foundation/documents/documents.types';
import { EntityService } from '../../foundation/entity/entity.service';
import { AgentService } from './agent.service';
import { CountryNoticeService } from './country-notice.service';
import { DriverService } from './driver.service';
import { FleetManagerService } from './fleet-manager.service';
import { MdpService } from './mdp.service';
import { NotificationService } from './notification.service';
import { PersonService } from './person.service';
import { VendorService } from './vendor.service';

/**
 * A NEW VERSION OF WHAT PEOPLE AGREED TO, TOLD IN THE BELL (the user, 2026-10-25: "privacy text needs to stay true, but it
 * needs a notification in the bell for the users that the terms of use are updated").
 *
 * Every published version of the terms of use, the data notice or the cookie statement is told to everybody it concerns,
 * in the bell of the app they use: everybody with an account for the general text, everybody in the country for a
 * country's own. Said is what changed — the note its writer left for exactly these readers — and whether they will be
 * asked to agree to it, or have nothing to do. Never a text message, and never an email: the bell is where it is read.
 */
@Injectable()
export class DocumentNoticeService {
  private readonly logger = new Logger(DocumentNoticeService.name);

  constructor(
    documents: DocumentsService,
    private readonly notifications: NotificationService,
    private readonly agents: AgentService,
    private readonly mdps: MdpService,
    private readonly vendors: VendorService,
    private readonly managers: FleetManagerService,
    private readonly drivers: DriverService,
    private readonly persons: PersonService,
    private readonly entities: EntityService,
    @Optional() private readonly agreements?: AgreementService,
    @Optional() private readonly countries?: CountryNoticeService,
  ) {
    documents.whenPublished((version) => {
      void this.tellPublished(version).catch((err) => this.logger.warn(`telling a new ${version.kind} version failed: ${(err as Error).message}`));
    });
  }

  /**
   * Whose bell it rings: every shop, hub, store, fleet, courier, business and person for the general text; for a
   * country's own, those registered there and the people who agreed to that country's documents. Each once.
   */
  recipients(country?: string): string[] {
    const dids = new Set<string>();
    if (country) {
      const code = catalogueEntry(country)?.code ?? country;
      for (const r of this.countries?.recipientsIn(code) ?? []) dids.add(r.did);
      for (const e of this.entities.list()) if (e.kind === 'business' && e.jurisdiction === code) dids.add(e.did);
      for (const did of this.agreements?.personsIn(code) ?? []) dids.add(did);
    } else {
      for (const a of this.agents.list()) dids.add(a.did);
      for (const m of this.mdps.list()) dids.add(m.did);
      for (const v of this.vendors.list()) dids.add(v.did);
      for (const m of this.managers.list()) dids.add(m.did);
      for (const d of this.drivers.list()) dids.add(d.did);
      for (const e of this.entities.list()) if (e.kind === 'business') dids.add(e.did);
      for (const person of this.persons.everyone()) dids.add(person.personDid);
    }
    return [...dids].filter(Boolean);
  }

  /** Tell everybody a published version concerns. Returns how many were told. */
  async tellPublished(version: DocumentVersion): Promise<number> {
    if (version.status !== 'published' || !version.number) return 0;
    const where = version.country ? catalogueEntry(version.country)?.name ?? version.country : undefined;
    const title = where && !version.title.includes(where) ? `${version.title} for ${where}: a new version` : `${version.title}: a new version`;
    const body = `${version.changeNote.replace(/\s*$/, '')}${/[.!?]$/.test(version.changeNote.trim()) ? '' : '.'} ${
      version.askAgain ? 'You are asked to agree to it the next time you open the app.' : 'Nothing to do: it is there to read.'
    }`;
    const key = documentKey(version.kind, version.country);
    let told = 0;
    for (const did of this.recipients(version.country)) {
      try {
        // One per line on a phone: a newer version replaces an older one's notice there; the inbox keeps them all.
        await this.notifications.notify(did, { kind: 'terms_updated', title, body, link: documentPath(version.kind, version.country), tag: `document:${key}`, data: { key, number: version.number, askAgain: version.askAgain } });
        told += 1;
      } catch (err) {
        this.logger.warn(`a new ${key} version not told to ${did}: ${(err as Error).message}`);
      }
    }
    return told;
  }
}
