import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { GlosError } from '../../foundation/http/glos-error';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { decodeDocument } from '../../foundation/media/decode-document';
import { MAX_DOCUMENT_BYTES } from '../../foundation/entity/company-documents.service';
import { Quote, QuoteParty, QuoteSubject, QuoteSubjectKind } from './quote.types';

/** Who is acting on a quotation, as the caller established it. */
export interface QuoteActor {
  name: string;
  entityId?: string;
  did?: string;
}

/**
 * QUOTATIONS FOR ANYONE — kept, never collected. See quote.types.ts for the user's words and why.
 *
 * THE RULES IT HOLDS:
 *  1. Only the issuer quotes, re-quotes and changes the figure — and not once it is paid.
 *  2. Only the payer agrees to the figure.
 *  3. Either party confirms it paid, or back to open, always by name and with whatever reference they give. The
 *     history keeps every turn, so "who said this was paid, and when" stays answerable after a correction.
 *  4. Either party may attach the proforma invoice. It is kept as handed over, fingerprinted, and readable by the two
 *     parties alone.
 *
 * It does not know what an import or a load is. The caller resolves who the parties are from its own record and hands
 * them in; this compares an actor against them and nothing else.
 */
@Injectable()
export class QuoteService {
  private readonly quotes = new PersistentMap<string, Quote>('quotes');
  /** The proforma bytes apart from the record, so listing quotations never carries a file. */
  private readonly files = new PersistentMap<string, string>('quote-files');

  /** The quotation on a piece of work, if there is one. One per subject: a re-quote changes it and says so. */
  forSubject(kind: QuoteSubjectKind, id: string): Quote | undefined {
    return [...this.quotes.values()].find((q) => q.subject.kind === kind && q.subject.id === id);
  }

  get(quoteId: string): Quote {
    const q = this.quotes.get(quoteId);
    if (!q) throw new GlosError('NOT_FOUND', 'No such quotation');
    return q;
  }

  /**
   * Quote, or re-quote, a piece of work. Called by the issuer. A re-quote of an agreed figure drops the agreement:
   * the payer agreed to a number, not to whatever number comes next.
   */
  quote(
    input: { subject: QuoteSubject; issuer: QuoteParty; payer: QuoteParty; amount: number; currency: string; note?: string; reference?: string; agreed?: boolean },
    by: string,
    now = Date.now(),
  ): Quote {
    const amount = Math.round(Number(input.amount) * 100) / 100;
    if (!(amount > 0)) throw new GlosError('VALIDATION_FAILED', 'A quotation needs an amount above zero', { field: 'amount' });
    const currency = (input.currency ?? '').trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) throw new GlosError('VALIDATION_FAILED', 'Say the currency as its three letters — ETB, KES, USD', { field: 'currency' });
    const at = new Date(now).toISOString();
    const note = input.note?.trim() || undefined;
    const reference = input.reference?.trim().slice(0, 60) || undefined;
    const existing = this.forSubject(input.subject.kind, input.subject.id);
    if (existing) {
      if (existing.status === 'paid') throw new GlosError('INVALID_STATE', 'This has been confirmed paid — set it back to open before changing the figure');
      Object.assign(existing, { amount, currency, note, reference, issuer: input.issuer, payer: input.payer });
      if (!input.agreed) {
        delete existing.agreedAt;
        delete existing.agreedBy;
      }
      existing.history.push({ at, by, what: 'requoted', note: `${amount} ${currency}` });
      this.quotes.set(existing.quoteId, existing);
      return existing;
    }
    const q: Quote = {
      quoteId: `quo_${randomBytes(8).toString('hex')}`,
      subject: input.subject,
      issuer: input.issuer,
      payer: input.payer,
      amount,
      currency,
      ...(note ? { note } : {}),
      ...(reference ? { reference } : {}),
      ...(input.agreed ? { agreedAt: at, agreedBy: by } : {}),
      status: 'open',
      history: [{ at, by, what: 'quoted', note: `${amount} ${currency}` }],
      createdAt: at,
      createdBy: by,
    };
    this.quotes.set(q.quoteId, q);
    return q;
  }

  /** The payer agrees to the figure. Agreeing is not paying. */
  agree(quoteId: string, actor: QuoteActor, now = Date.now()): Quote {
    const q = this.get(quoteId);
    if (this.sideOf(q, actor) !== 'payer') throw new GlosError('FORBIDDEN', `Only ${q.payer.name} can agree to this figure`);
    if (q.status === 'paid') throw new GlosError('INVALID_STATE', 'This has already been confirmed paid');
    const at = new Date(now).toISOString();
    Object.assign(q, { agreedAt: at, agreedBy: actor.name });
    q.history.push({ at, by: actor.name, what: 'agreed' });
    this.quotes.set(q.quoteId, q);
    return q;
  }

  /**
   * PAID, OR BACK TO OPEN — confirmed by a party to it, by name. Nothing moves anywhere: this is somebody saying so,
   * and the record says who.
   */
  setStatus(quoteId: string, status: 'open' | 'paid', actor: QuoteActor, paidReference?: string, now = Date.now()): Quote {
    const q = this.get(quoteId);
    if (!this.sideOf(q, actor)) throw new GlosError('NOT_FOUND', 'No such quotation');
    if (q.status === status) throw new GlosError('CONFLICT', status === 'paid' ? `Already confirmed paid by ${q.paidBy} on ${q.paidAt?.slice(0, 10)}` : 'It is already open');
    const at = new Date(now).toISOString();
    const reference = paidReference?.trim().slice(0, 80) || undefined;
    if (status === 'paid') {
      Object.assign(q, { status, paidAt: at, paidBy: actor.name, ...(reference ? { paidReference: reference } : {}) });
    } else {
      q.status = 'open';
      delete q.paidAt;
      delete q.paidBy;
      delete q.paidReference;
    }
    q.history.push({ at, by: actor.name, what: status, ...(reference ? { note: reference } : {}) });
    this.quotes.set(q.quoteId, q);
    return q;
  }

  /** Attach the proforma invoice — kept as handed over. A newer one replaces it, and the history says so. */
  attachProforma(quoteId: string, actor: QuoteActor, file: { dataUrl: string; fileName?: string }, now = Date.now()): Quote {
    const q = this.get(quoteId);
    if (!this.sideOf(q, actor)) throw new GlosError('NOT_FOUND', 'No such quotation');
    const { contentType, bytes } = decodeDocument(file.dataUrl, MAX_DOCUMENT_BYTES);
    const at = new Date(now).toISOString();
    const fingerprint = createHash('sha256').update(bytes).digest('hex');
    const fileName = (file.fileName?.trim() || `proforma-${q.subject.code ?? q.subject.id}`).slice(0, 120);
    q.proforma = { fileName, contentType, size: bytes.length, fingerprint, addedBy: actor.name, addedAt: at };
    this.files.set(q.quoteId, bytes.toString('base64'));
    q.history.push({ at, by: actor.name, what: 'proforma', note: fileName });
    this.quotes.set(q.quoteId, q);
    return q;
  }

  /** The proforma's bytes, for a party to the quotation alone. */
  proformaFile(quoteId: string, actor: QuoteActor): { bytes: Buffer; contentType: string; fileName: string; fingerprint: string } {
    const q = this.get(quoteId);
    const raw = this.sideOf(q, actor) ? this.files.get(q.quoteId) : undefined;
    if (!q.proforma || !raw) throw new GlosError('NOT_FOUND', 'No proforma on this quotation');
    return { bytes: Buffer.from(raw, 'base64'), contentType: q.proforma.contentType, fileName: q.proforma.fileName, fingerprint: q.proforma.fingerprint };
  }

  /** Which side of a quotation somebody is on. Staff read over the shoulder and are neither. */
  sideOf(q: Quote, actor: QuoteActor | undefined): 'issuer' | 'payer' | null {
    if (!actor) return null;
    const is = (p: QuoteParty) => (p.entityId != null && p.entityId === actor.entityId) || (p.did != null && p.did === actor.did);
    if (is(q.issuer)) return 'issuer';
    if (is(q.payer)) return 'payer';
    return null;
  }
}
