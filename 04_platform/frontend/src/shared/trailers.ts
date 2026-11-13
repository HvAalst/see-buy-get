import type { SbgClient, SbgError } from '../lib/sbg';
import type { MessageKey, Translate } from './i18n';

/**
 * 2026-11-13 — TRAILERS (the owner: "consider a trailer for VANs especially — movers use vans and trailers in cities"; plan D1–D5,
 * "build as recommended"; backend trailer-rules.ts): what a courier or a fleet keeps, what it carries (its maximum less its own
 * weight), and the calls the Driver and Fleet apps make. Whether a pairing may be driven is the server's to say, in its words.
 */
export const TOWING_KINDS = ['B96', 'BE', 'E'] as const;
export type TowingKind = (typeof TOWING_KINDS)[number];

export interface TrailerView {
  trailerId: string;
  plate: string;
  maxKg: number;
  emptyKg: number;
  braked: boolean;
  closed: boolean;
  volumeM3?: number;
  ramp: boolean;
  payloadKg: number;
  ownerDriverDid?: string;
  managerDid?: string;
}

/** A trailer on a shift: a kept one, or one hired for the day. */
export interface HitchedTrailer {
  trailerId?: string;
  hired?: true;
  plate: string;
  maxKg: number;
  emptyKg: number;
  payloadKg: number;
  braked: boolean;
  closed: boolean;
  volumeM3?: number;
  ramp: boolean;
  maxKmh?: number;
  hitchedAt: string;
}

export interface TrailerForm {
  plate: string;
  maxKg: string;
  emptyKg: string;
  braked: boolean;
  closed: boolean;
  litres: string;
  ramp: boolean;
  registrationRef: string;
}

export const EMPTY_TRAILER: TrailerForm = { plate: '', maxKg: '', emptyKg: '', braked: false, closed: true, litres: '', ramp: false, registrationRef: '' };

export interface TrailerBody {
  plate: string;
  maxKg: number;
  emptyKg: number;
  braked: boolean;
  closed: boolean;
  litres?: number;
  ramp: boolean;
  registrationRef?: string;
}

const num = (v: string) => Number(String(v ?? '').replace(',', '.'));

/** What is sent, or the first thing still to say. Whether its registration card is asked is the server's (its country's rule). */
export function trailerBody(f: TrailerForm): { body: TrailerBody } | { error: MessageKey } {
  if (f.plate.trim().length < 2) return { error: 'trailer.errPlate' };
  const maxKg = Math.round(num(f.maxKg));
  const emptyKg = Math.round(num(f.emptyKg));
  if (!(maxKg >= 100 && maxKg <= 3500)) return { error: 'trailer.errMax' };
  if (!(emptyKg >= 20 && emptyKg < maxKg)) return { error: 'trailer.errEmpty' };
  const litres = f.litres.trim() ? Math.round(num(f.litres)) : undefined;
  if (litres != null && !(litres > 0 && litres <= 60_000)) return { error: 'trailer.errLitres' };
  return { body: { plate: f.plate.trim().toUpperCase(), maxKg, emptyKg, braked: f.braked, closed: f.closed, ...(litres != null ? { litres } : {}), ramp: f.ramp, ...(f.registrationRef ? { registrationRef: f.registrationRef } : {}) } };
}

/** One line for a trailer: its plate, what it carries, closed or open, braked or not, its ramps. */
export function trailerLine(t: Pick<TrailerView, 'plate' | 'payloadKg' | 'closed' | 'braked' | 'ramp' | 'volumeM3'>, tr: Translate): string {
  return [
    t.plate,
    tr('trailer.carries', { kg: t.payloadKg }),
    ...(t.volumeM3 != null ? [tr('trailer.litres', { litres: Math.round(t.volumeM3 * 1000) })] : []),
    tr(t.closed ? 'trailer.closed' : 'trailer.open'),
    tr(t.braked ? 'trailer.braked' : 'trailer.unbraked'),
    ...(t.ramp ? [tr('trailer.withRamp')] : []),
  ].join(' · ');
}

type Answer<T = unknown> = Promise<{ data?: T; error?: SbgError | null }>;

/** The calls: a courier's or a fleet's trailers, hitching on a shift, what a licence covers and what a vehicle may tow. */
export function trailerApi(sbg: SbgClient) {
  const send = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, params: Record<string, string> = {}, body?: unknown): Answer =>
    sbg.request((c) => (c as unknown as Record<string, (p: string, o: unknown) => Promise<unknown>>)[method](path as never, { params: { path: params }, ...(body !== undefined ? { body } : {}) }) as never) as Answer;
  return {
    list: () => send('GET', '/v1/sbg/trailers') as Answer<TrailerView[]>,
    add: (body: TrailerBody) => send('POST', '/v1/sbg/trailers', {}, body) as Answer<TrailerView>,
    remove: (trailerId: string) => send('DELETE', '/v1/sbg/trailers/{id}', { id: trailerId }),
    hitch: (did: string, body: { trailerId?: string; hire?: TrailerBody }) => send('POST', '/v1/sbg/fleet/drivers/{did}/hitch', { did }, body),
    unhitch: (did: string) => send('POST', '/v1/sbg/fleet/drivers/{did}/unhitch', { did }, {}),
    setTowing: (did: string, kinds: string[]) => send('PATCH', '/v1/sbg/fleet/drivers/{did}/towing', { did }, { kinds }),
    setTowLimits: (vehicleId: string, body: { brakedKg: number; unbrakedKg: number; grossKg?: number | null }) => send('PATCH', '/v1/sbg/vehicles/{id}/towing', { id: vehicleId }, body),
    setRateWithTrailer: (vehicleId: string, price: number, withTrailer: number | null) => send('PATCH', '/v1/sbg/vehicles/{id}/pricing', { id: vehicleId }, { price, withTrailer }),
  };
}
