import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { GlosError } from '../../foundation/http/glos-error';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { catalogueEntry } from '../../foundation/countries/catalogue';
import { BusinessClient } from './business-client.types';

/** Enough for a real forwarder's book; a ceiling, not a target. */
export const MAX_CLIENTS = 2000;

/**
 * B4 — AN EXPEDITOR'S CLIENTS: their own address book, theirs alone.
 *
 * Every read and write is scoped to the business that keeps it. Another business asking for a client id that is not
 * in its own book is told there is no such client — the same answer as for one that never existed.
 */
@Injectable()
export class BusinessClientService {
  private readonly clients = new PersistentMap<string, BusinessClient>('business-clients');

  list(entityId: string, opts: { archived?: boolean } = {}): BusinessClient[] {
    return [...this.clients.values()]
      .filter((c) => c.entityId === entityId && (opts.archived ? true : !c.archivedAt))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** A client of THIS business that is still in use — what a booking for a client must name. */
  require(entityId: string, clientId: string): BusinessClient {
    const c = this.clients.get(clientId);
    if (!c || c.entityId !== entityId) throw new GlosError('NOT_FOUND', 'No such client in your book', { field: 'forClientId' });
    if (c.archivedAt) throw new GlosError('INVALID_STATE', `${c.name} is archived — bring them back before sending for them`, { field: 'forClientId' });
    return c;
  }

  add(entityId: string, input: Partial<Pick<BusinessClient, 'name' | 'country' | 'address' | 'contactName' | 'contactPhone' | 'contactEmail'>>, by: string, now = Date.now()): BusinessClient {
    const name = input.name?.trim();
    if (!name) throw new GlosError('FIELD_REQUIRED', 'Give the client’s name — it goes on the consignment note as the sender', { field: 'name' });
    const country = this.country(input.country);
    if (this.list(entityId).some((c) => c.name.toLowerCase() === name.toLowerCase() && (c.country ?? '') === (country ?? ''))) {
      throw new GlosError('CONFLICT', `${name} is already in your book`, { field: 'name' });
    }
    if (this.list(entityId, { archived: true }).length >= MAX_CLIENTS) throw new GlosError('INVALID_STATE', `A book holds ${MAX_CLIENTS} clients`);
    const client: BusinessClient = {
      clientId: `cli_${randomBytes(8).toString('hex')}`,
      entityId,
      name: name.slice(0, 120),
      ...(country ? { country } : {}),
      ...this.contact(input),
      createdBy: by,
      createdAt: new Date(now).toISOString(),
    };
    this.clients.set(client.clientId, client);
    return client;
  }

  update(entityId: string, clientId: string, patch: Partial<Pick<BusinessClient, 'name' | 'country' | 'address' | 'contactName' | 'contactPhone' | 'contactEmail'>>): BusinessClient {
    const c = this.clients.get(clientId);
    if (!c || c.entityId !== entityId) throw new GlosError('NOT_FOUND', 'No such client in your book');
    if (patch.name !== undefined) {
      const name = patch.name.trim();
      if (!name) throw new GlosError('FIELD_REQUIRED', 'A client needs a name', { field: 'name' });
      c.name = name.slice(0, 120);
    }
    if (patch.country !== undefined) {
      const country = this.country(patch.country);
      if (country) c.country = country;
      else delete c.country;
    }
    const contact = this.contact({ ...c, ...patch });
    for (const k of ['address', 'contactName', 'contactPhone', 'contactEmail'] as const) {
      if (contact[k]) c[k] = contact[k];
      else delete c[k];
    }
    this.clients.set(c.clientId, c);
    return c;
  }

  /** Archived, not deleted: what was sent for them keeps naming them. Bringing them back is the same call undone. */
  setArchived(entityId: string, clientId: string, archived: boolean, by: string, now = Date.now()): BusinessClient {
    const c = this.clients.get(clientId);
    if (!c || c.entityId !== entityId) throw new GlosError('NOT_FOUND', 'No such client in your book');
    if (archived) Object.assign(c, { archivedAt: new Date(now).toISOString(), archivedBy: by });
    else {
      delete c.archivedAt;
      delete c.archivedBy;
    }
    this.clients.set(c.clientId, c);
    return c;
  }

  private country(raw?: string): string | undefined {
    const code = raw?.trim().toUpperCase();
    if (!code) return undefined;
    if (!catalogueEntry(code)) throw new GlosError('INVALID_INPUT', `${code} is not a country in the catalogue`, { field: 'country' });
    return code;
  }

  private contact(input: Partial<BusinessClient>): Pick<BusinessClient, 'address' | 'contactName' | 'contactPhone' | 'contactEmail'> {
    const clip = (v: string | undefined, n: number) => (v?.trim() ? v.trim().slice(0, n) : undefined);
    const email = clip(input.contactEmail, 120);
    if (email && !email.includes('@')) throw new GlosError('EMAIL_INVALID', 'That email address does not look right', { field: 'contactEmail' });
    return {
      ...(clip(input.address, 200) ? { address: clip(input.address, 200) } : {}),
      ...(clip(input.contactName, 80) ? { contactName: clip(input.contactName, 80) } : {}),
      ...(clip(input.contactPhone, 32) ? { contactPhone: clip(input.contactPhone, 32) } : {}),
      ...(email ? { contactEmail: email } : {}),
    };
  }
}
