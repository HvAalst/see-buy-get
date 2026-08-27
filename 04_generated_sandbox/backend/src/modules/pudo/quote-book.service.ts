import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { GlosError } from '../../foundation/http/glos-error';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { QUOTE_TTL_MIN } from './pudo.config';
import type { ShipmentQuote } from './routing.service';
import type { ApiKeyMode } from './pudo.types';

/**
 * A price, held.
 *
 * Until now a quote was a calculation and nothing more: the buyer saw one number on a product page, and
 * the merchant's server computed a fresh one when it committed. In between, everything the price rests on
 * is free to move — a shop's own advertised rate, a sister's margin, the carrier range, an exchange rate.
 * So a buyer could be told 32.13 and the store charged 34.80, and neither of them did anything wrong.
 *
 * A held quote closes that. The price is written down with a name on it, and redeeming the name mints the
 * shipment at THAT price rather than today's.
 *
 * Three rules, and each is a boundary on the promise:
 *
 *  - **We hold the PRICE, not the world.** A held quote survives the route getting dearer — that is the
 *    whole point — but not the route becoming impossible. A shop that has stopped taking parcels cannot be
 *    honoured into, and refusing is kinder than minting a shipment nobody can collect.
 *  - **One name, one shipment.** A promise made for one parcel is not a licence to mint ten at a stale
 *    price. Retrying a dropped request is what `Idempotency-Key` is for, and it needs no help from here.
 *  - **It belongs to whoever asked for it.** An anonymous quote gets no name at all: we cannot promise a
 *    price to somebody we cannot recognise later, and it is the honest reason a key is worth having.
 */

export interface HeldQuote {
  quoteId: string;
  vendorId: string;
  mode: ApiKeyMode;
  /** Everything the mint needs to be honoured at this price, stored whole rather than recomputed. */
  quote: ShipmentQuote;
  /** The endpoints and parcel as they were resolved, so a redemption cannot quietly change the shipment. */
  fromPointId: string;
  toPointId: string;
  size: string;
  weightKg: number;
  dimensionsCm?: { l: number; w: number; h: number };
  createdAt: string;
  expiresAt: string;
  redeemedAt?: string;
  redeemedAs?: string;
}

@Injectable()
export class QuoteBookService {
  // Durable: a price promised to a buyer must survive us restarting between their click and the checkout.
  private readonly held = new PersistentMap<string, HeldQuote>('pudo-held-quotes');

  /**
   * Write a price down under a name.
   *
   * `expiresAt` is the EARLIER of the ordinary window and any FX expiry the quote already carries: a
   * converted price cannot be honoured for longer than the rate behind it was good for, and quietly
   * extending it would move the exchange risk from the buyer, who chose to ship across a border, onto the
   * sister that has to hand a foreign shop exactly what it asked for.
   */
  hold(input: { vendorId: string; mode: ApiKeyMode; quote: ShipmentQuote; fromPointId: string; toPointId: string; size: string; weightKg: number; dimensionsCm?: { l: number; w: number; h: number } }): HeldQuote {
    const now = Date.now();
    const ordinary = now + QUOTE_TTL_MIN * 60_000;
    const fx = input.quote.fx ? new Date(input.quote.fx.expiresAt).getTime() : undefined;
    const expires = fx && Number.isFinite(fx) ? Math.min(ordinary, fx) : ordinary;
    const record: HeldQuote = {
      quoteId: `qt_${randomBytes(9).toString('hex')}`,
      vendorId: input.vendorId,
      mode: input.mode,
      quote: input.quote,
      fromPointId: input.fromPointId,
      toPointId: input.toPointId,
      size: input.size,
      weightKg: input.weightKg,
      dimensionsCm: input.dimensionsCm,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(expires).toISOString(),
    };
    this.held.set(record.quoteId, record);
    return record;
  }

  /**
   * Claim a held price, or say exactly why it cannot be claimed.
   *
   * Every refusal here is a different thing for the caller to do, which is why they are different codes:
   * an unknown name is a bug in their code, an expired one means re-quote, a spent one means they are
   * reusing a promise, and a wrong owner or mode means they crossed two worlds.
   */
  require(quoteId: string, vendorId: string, mode: ApiKeyMode): HeldQuote {
    const record = this.held.get(quoteId?.trim());
    if (!record) throw new GlosError('NOT_FOUND', `No such quote: ${quoteId} — ask for a new one`);
    // Same refusal for a stranger's quote as for one that never existed. Telling somebody that an id they
    // guessed belongs to a real merchant is a fact they have not earned.
    if (record.vendorId !== vendorId) throw new GlosError('NOT_FOUND', `No such quote: ${quoteId} — ask for a new one`);
    if (record.mode !== mode) {
      throw new GlosError('INVALID_STATE', `That quote was made with a ${record.mode} key and cannot be used with a ${mode} one`);
    }
    if (record.redeemedAt) {
      throw new GlosError('QUOTE_SPENT', `Quote ${quoteId} has already been used for shipment ${record.redeemedAs} — ask for a new one, or send an Idempotency-Key to retry safely`, {
        shipmentId: record.redeemedAs,
      });
    }
    if (new Date(record.expiresAt).getTime() <= Date.now()) {
      throw new GlosError('WINDOW_EXPIRED', `Quote ${quoteId} expired at ${record.expiresAt} — ask for a new one`);
    }
    return record;
  }

  /** Spend the name. Called only once the shipment actually exists — a failed mint leaves the price held. */
  markRedeemed(quoteId: string, shipmentId: string): void {
    const record = this.held.get(quoteId);
    if (!record) return;
    record.redeemedAt = new Date().toISOString();
    record.redeemedAs = shipmentId;
    this.held.set(quoteId, record);
  }

  /** For the tests and an operator: what is being held right now. */
  get(quoteId: string): HeldQuote | undefined {
    return this.held.get(quoteId);
  }
}
