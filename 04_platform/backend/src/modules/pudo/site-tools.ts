import { GlosError } from '../../foundation/http/glos-error';
import type { Equipment } from './cargo.types';
import { MAX_PARCEL_KG } from './pudo.config';
import { PAPER_DUE_DAYS, paperDay, paperLapsesAt } from './papers';

/**
 * 2026-11-13 — THE TOOLS A SHOP OR A HUB HAS (the owner: "shop and hub tools … a good one too"; plan T1–T5, "build as
 * recommended"). Its scale (the most it weighs; approved for trade, or in Kenya stamped by the county inspector with the date
 * the stamp runs to and a photo of the certificate), a label printer, CCTV, and its handling equipment — a sack barrow, a
 * pallet jack, a forklift (with its operator's licence), a ramp or loading dock. Said by the site in its own app; staff read
 * it; every change is kept. What they decide:
 *  - a weight taken on a scale that counts is "weighed" and sets the price; otherwise the sender's is "declared" (T2);
 *  - the heaviest parcel a site takes is the lowest of its scale's maximum, the network's cap and what its people can move —
 *    by hand alone, 23 kg; with a sack barrow, a pallet jack or a forklift, the network's cap (T3);
 *  - pallets only where there is a pallet jack with a ramp or dock, or a forklift (T3);
 *  - "Prints labels" on its card (T4); a stamp is reminded 30 days before it runs out and on the day (T5).
 * No safe: SeeBuyGet never handles a business's cash.
 */
export const SITE_EQUIPMENT = ['HTR', 'PLT', 'FLT', 'RMP'] as const satisfies readonly Equipment[];
export type SiteEquipment = (typeof SITE_EQUIPMENT)[number];

/** What one person moves by hand alone (the heaviest parcel the big Dutch networks take over a counter). */
export const BY_HAND_KG = 23;
/** A scale's maximum, as a site may say it: a kitchen scale's few kilos to a floor scale under a pallet. */
export const SCALE_MAX_KG = 3000;
/** The countries where a scale used for trade carries an inspector's stamp with a date (Kenya, Weights and Measures Act, Cap 513). */
export const STAMPED_SCALE_COUNTRIES: ReadonlySet<string> = new Set(['KE']);
/** How many changes a site's tools keep in their history. */
const HISTORY = 50;

export interface SiteScale {
  /** The most it weighs, in kg. */
  maxKg: number;
  /** Approved for trade, as the site says — in a stamping country, only with the stamp recorded below. */
  approved: boolean;
  /** Where a stamp is the law: the day it runs to (YYYY-MM-DD) and the certificate's photo. */
  stampedUntil?: string;
  certificateRef?: string;
}

export interface SiteTools {
  scale?: SiteScale;
  labelPrinter: boolean;
  cctv: boolean;
  /** The forklift operator's licence number (Kenya: category G), where a forklift is said. */
  forkliftLicence?: string;
  setBy: string;
  setAt: string;
  /** Every change, newest first: when, who, and what changed in words. */
  history: Array<{ at: string; by: string; said: string }>;
}

export interface SiteToolsInput {
  equipment: string[];
  scale?: { maxKg: number; approved: boolean; stampedUntil?: string; certificateRef?: string } | null;
  labelPrinter: boolean;
  cctv: boolean;
  forkliftLicence?: string;
}

const WORDS: Record<SiteEquipment, string> = { HTR: 'a sack barrow', PLT: 'a pallet jack', FLT: 'a forklift', RMP: 'a ramp or loading dock' };

/**
 * The tools as they will be kept, and the equipment list (handling by hand first): refused, field by field, before anything is
 * written. `adoptCertificate` takes the stamp's photo as the site's own (the media guard) and says whether it could.
 */
export function buildSiteTools(
  input: SiteToolsInput,
  ctx: { country?: string; before?: SiteTools; beforeEquipment?: readonly Equipment[]; by: string; now: number; adoptCertificate: (ref: string) => boolean },
): { tools: SiteTools; equipment: Equipment[] } {
  const asked = [...new Set(input.equipment ?? [])].filter((e) => e !== 'MAN');
  const unknown = asked.find((e) => !(SITE_EQUIPMENT as readonly string[]).includes(e));
  if (unknown) throw new GlosError('INVALID_INPUT', `A shop or hub says a sack barrow, a pallet jack, a forklift or a ramp — not ${unknown}`, { field: 'equipment' });
  const equipment = asked as SiteEquipment[];
  const forkliftLicence = input.forkliftLicence?.trim().slice(0, 40) || undefined;
  if (equipment.includes('FLT') && !forkliftLicence) throw new GlosError('FIELD_REQUIRED', 'A forklift needs its operator’s licence number', { field: 'forkliftLicence' });
  let scale: SiteScale | undefined;
  if (input.scale) {
    const maxKg = Math.round(Number(input.scale.maxKg) * 10) / 10;
    if (!Number.isFinite(maxKg) || maxKg <= 0 || maxKg > SCALE_MAX_KG) throw new GlosError('INVALID_INPUT', `The most the scale weighs is more than nothing and at most ${SCALE_MAX_KG} kg`, { field: 'scale.maxKg' });
    scale = { maxKg, approved: Boolean(input.scale.approved) };
    if (scale.approved && ctx.country && STAMPED_SCALE_COUNTRIES.has(ctx.country)) {
      const until = input.scale.stampedUntil?.trim() ?? '';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(until) || Number.isNaN(Date.parse(`${until}T00:00:00Z`))) throw new GlosError('FIELD_REQUIRED', 'Say the day the inspector’s stamp runs to', { field: 'scale.stampedUntil' });
      if (paperLapsesAt(until) <= ctx.now) throw new GlosError('INVALID_INPUT', 'That stamp has run out: have the scale stamped again, then record the new date', { field: 'scale.stampedUntil' });
      const ref = input.scale.certificateRef?.trim() ?? '';
      // The same photo again is kept as it is; a new one is taken as the site's own.
      const same = ref && ref === ctx.before?.scale?.certificateRef;
      if (!ref || (!same && !ctx.adoptCertificate(ref))) throw new GlosError('PHOTO_REQUIRED', 'A photo of the stamp certificate', { field: 'scale.certificateRef' });
      scale.stampedUntil = until;
      scale.certificateRef = ref;
    }
  }
  const at = new Date(ctx.now).toISOString();
  const next: Omit<SiteTools, 'history'> = { ...(scale ? { scale } : {}), labelPrinter: Boolean(input.labelPrinter), cctv: Boolean(input.cctv), ...(equipment.includes('FLT') ? { forkliftLicence } : {}), setBy: ctx.by, setAt: at };
  const said = toolsChange(ctx.before, ctx.beforeEquipment, next, equipment);
  const history = [...(said ? [{ at, by: ctx.by, said }] : []), ...(ctx.before?.history ?? [])].slice(0, HISTORY);
  return { tools: { ...next, history }, equipment: ['MAN', ...equipment] };
}

/** What changed, in words, for the history ("a pallet jack added; scale up to 30 kg, approved"). Empty when nothing did. */
export function toolsChange(before: Omit<SiteTools, 'history'> | undefined, beforeEquipment: readonly Equipment[] | undefined, after: Omit<SiteTools, 'history'>, afterEquipment: readonly SiteEquipment[]): string {
  const out: string[] = [];
  const had = new Set((beforeEquipment ?? []).filter((e) => e !== 'MAN'));
  for (const e of afterEquipment) if (!had.has(e)) out.push(`${WORDS[e]} added`);
  for (const e of had) if (!afterEquipment.includes(e as SiteEquipment)) out.push(`${WORDS[e as SiteEquipment] ?? e} taken off`);
  const scaleWords = (s?: SiteScale) => (s ? `up to ${s.maxKg} kg${s.approved ? (s.stampedUntil ? `, stamped to ${s.stampedUntil}` : ', approved') : ', not approved'}` : 'none');
  if (scaleWords(before?.scale) !== scaleWords(after.scale)) out.push(`scale ${scaleWords(after.scale)}`);
  if (Boolean(before?.labelPrinter) !== after.labelPrinter) out.push(after.labelPrinter ? 'label printer added' : 'label printer taken off');
  if (Boolean(before?.cctv) !== after.cctv) out.push(after.cctv ? 'cameras added' : 'cameras taken off');
  if ((before?.forkliftLicence ?? '') !== (after.forkliftLicence ?? '') && after.forkliftLicence) out.push(`forklift licence ${after.forkliftLicence}`);
  return out.join('; ');
}

/** Where the scale stands: its weight counts (ok), its stamp runs out soon (due), has run out (lapsed), or it does not count. */
export interface ScaleStanding {
  state: 'ok' | 'due' | 'lapsed' | 'not_approved' | 'none';
  stampedUntil?: string;
  daysLeft?: number;
}

export function scaleStanding(tools: SiteTools | undefined, country: string | undefined, now: number): ScaleStanding {
  const scale = tools?.scale;
  if (!scale) return { state: 'none' };
  if (!scale.approved) return { state: 'not_approved' };
  if (!country || !STAMPED_SCALE_COUNTRIES.has(country)) return { state: 'ok' };
  if (!scale.stampedUntil || !scale.certificateRef) return { state: 'not_approved' };
  const lapses = paperLapsesAt(scale.stampedUntil);
  if (lapses <= now) return { state: 'lapsed', stampedUntil: scale.stampedUntil };
  const daysLeft = Math.ceil((lapses - now) / 86_400_000);
  return { state: daysLeft <= PAPER_DUE_DAYS ? 'due' : 'ok', stampedUntil: scale.stampedUntil, daysLeft };
}

/** True where a weight taken at this site is "weighed": its scale is approved, and in a stamping country, stamped and in date. */
export function scaleCounts(tools: SiteTools | undefined, country: string | undefined, now: number): boolean {
  const s = scaleStanding(tools, country, now).state;
  return s === 'ok' || s === 'due';
}

/** What a site may take: its heaviest parcel and why, whether pallets, whether its weights count, whether it prints labels. */
export interface SiteLimits {
  maxKg: number;
  /** What sets the limit: its scale, its people's hands, or the network's cap. */
  by: 'scale' | 'hands' | 'network';
  pallets: boolean;
  weighs: boolean;
  printsLabels: boolean;
}

export function siteLimits(equipment: readonly string[] | undefined, tools: SiteTools | undefined, country: string | undefined, now: number): SiteLimits {
  const eq = new Set(equipment ?? []);
  const hands = eq.has('HTR') || eq.has('PLT') || eq.has('FLT') ? MAX_PARCEL_KG : BY_HAND_KG;
  const scaleMax = tools?.scale?.maxKg ?? Number.POSITIVE_INFINITY;
  const maxKg = Math.min(MAX_PARCEL_KG, hands, scaleMax);
  const by = maxKg === scaleMax && scaleMax < Math.min(MAX_PARCEL_KG, hands) ? 'scale' : maxKg === hands && hands < MAX_PARCEL_KG ? 'hands' : 'network';
  return { maxKg, by, pallets: (eq.has('PLT') && eq.has('RMP')) || eq.has('FLT'), weighs: scaleCounts(tools, country, now), printsLabels: Boolean(tools?.labelPrinter) };
}

/** The view a site and staff read: what it said, and what that lets it take today. */
export function siteToolsView(equipment: readonly Equipment[] | undefined, tools: SiteTools | undefined, country: string | undefined, now: number) {
  return {
    equipment: (equipment ?? []).filter((e): e is SiteEquipment => (SITE_EQUIPMENT as readonly string[]).includes(e)),
    ...(tools ? { tools } : {}),
    limits: siteLimits(equipment, tools, country, now),
    stamp: scaleStanding(tools, country, now),
    stampCountry: Boolean(country && STAMPED_SCALE_COUNTRIES.has(country)),
  };
}

/** What a site is told about its scale's stamp, short because it is read on a lock screen. */
export function stampNotice(s: ScaleStanding): { title: string; body: string } {
  const day = s.stampedUntil ? paperDay(s.stampedUntil) : '';
  if (s.state === 'lapsed') return { title: 'Your scale’s stamp has run out', body: `It ran to ${day}. Until it is stamped again and the new date recorded under Tools, the weights you take are the sender’s word, not a price.` };
  const left = s.daysLeft ?? 1;
  return { title: `Your scale’s stamp runs out in ${left} day${left === 1 ? '' : 's'}`, body: `It runs to ${day}. Have it stamped by the county inspector and record the new date and certificate under Tools: after that day your weights stop setting the price.` };
}

/** What a shop's public card says of its tools (T3, T4): its heaviest parcel, pallets, a scale whose weight counts, labels. */
export function shopCardTools(v: { limits: SiteLimits }): { maxParcelKg: number; takesPallets: boolean; weighs: boolean; printsLabels: boolean } {
  return { maxParcelKg: v.limits.maxKg, takesPallets: v.limits.pallets, weighs: v.limits.weighs, printsLabels: v.limits.printsLabels };
}
