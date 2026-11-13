import type { MessageKey, Translate } from './i18n';

/**
 * 2026-11-13 — A SHOP'S OR A HUB'S TOOLS (the owner: "shop and hub tools"; plan T1–T5): its handling equipment, its scale, a
 * label printer, CCTV — and what they let it take, as the server works it out (backend site-tools.ts). Shared by the Shop app
 * and the Hub app, which say their own; the Send app reads what a shop's card says.
 */
export type SiteEquipment = 'HTR' | 'PLT' | 'FLT' | 'RMP';
export const SITE_EQUIPMENT: Array<{ key: SiteEquipment; label: MessageKey }> = [
  { key: 'HTR', label: 'tools.htr' },
  { key: 'PLT', label: 'tools.plt' },
  { key: 'FLT', label: 'tools.flt' },
  { key: 'RMP', label: 'tools.rmp' },
];

export interface SiteScale {
  maxKg: number;
  approved: boolean;
  stampedUntil?: string;
  certificateRef?: string;
}

export interface SiteToolsView {
  equipment: SiteEquipment[];
  tools?: { scale?: SiteScale; labelPrinter: boolean; cctv: boolean; forkliftLicence?: string; setBy: string; setAt: string; history: Array<{ at: string; by: string; said: string }> };
  limits: { maxKg: number; by: 'scale' | 'hands' | 'network'; pallets: boolean; weighs: boolean; printsLabels: boolean };
  stamp: { state: 'ok' | 'due' | 'lapsed' | 'not_approved' | 'none'; stampedUntil?: string; daysLeft?: number };
  stampCountry: boolean;
}

/** The sheet's form: what the site says, as typed. */
export interface ToolsForm {
  equipment: SiteEquipment[];
  forkliftLicence: string;
  hasScale: boolean;
  scaleMaxKg: string;
  approved: boolean;
  stampedUntil: string;
  certificateRef: string;
  labelPrinter: boolean;
  cctv: boolean;
}

export function toolsForm(view: SiteToolsView | null): ToolsForm {
  const t = view?.tools;
  return {
    equipment: [...(view?.equipment ?? [])],
    forkliftLicence: t?.forkliftLicence ?? '',
    hasScale: Boolean(t?.scale),
    scaleMaxKg: t?.scale ? String(t.scale.maxKg) : '',
    approved: Boolean(t?.scale?.approved),
    stampedUntil: t?.scale?.stampedUntil ?? '',
    certificateRef: t?.scale?.certificateRef ?? '',
    labelPrinter: Boolean(t?.labelPrinter),
    cctv: Boolean(t?.cctv),
  };
}

export interface ToolsBody {
  equipment: SiteEquipment[];
  scale: { maxKg: number; approved: boolean; stampedUntil?: string; certificateRef?: string } | null;
  labelPrinter: boolean;
  cctv: boolean;
  forkliftLicence?: string;
}

/** What is sent, or the first thing still to say — a stamping country asks the stamp's date and certificate of an approved scale. */
export function toolsBody(f: ToolsForm, stampCountry: boolean): { body: ToolsBody } | { error: MessageKey } {
  if (f.equipment.includes('FLT') && !f.forkliftLicence.trim()) return { error: 'tools.errLicence' };
  let scale: ToolsBody['scale'] = null;
  if (f.hasScale) {
    const maxKg = Number(f.scaleMaxKg.replace(',', '.'));
    if (!(maxKg > 0) || maxKg > 3000) return { error: 'tools.errMax' };
    scale = { maxKg, approved: f.approved };
    if (f.approved && stampCountry) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(f.stampedUntil) || !f.certificateRef) return { error: 'tools.errStamp' };
      scale.stampedUntil = f.stampedUntil;
      scale.certificateRef = f.certificateRef;
    }
  }
  return { body: { equipment: f.equipment, scale, labelPrinter: f.labelPrinter, cctv: f.cctv, ...(f.equipment.includes('FLT') ? { forkliftLicence: f.forkliftLicence.trim() } : {}) } };
}

/** What its tools let it take, in sentences: the heaviest parcel and why, pallets, whether its weights count. */
export function limitsLines(v: SiteToolsView['limits'], t: Translate, networkMax = 30): string[] {
  const kg = String(v.maxKg);
  return [
    v.by === 'hands' ? t('tools.limitHands', { kg, max: networkMax }) : v.by === 'scale' ? t('tools.limitScale', { kg }) : t('tools.limitNetwork', { kg }),
    t(v.pallets ? 'tools.pallets' : 'tools.noPallets'),
    t(v.weighs ? 'tools.weighs' : 'tools.guide'),
  ];
}

/** Where its scale's stamp stands, said only when it asks something of the site. */
export function stampLine(s: SiteToolsView['stamp'], t: Translate, day: (iso: string) => string): string | null {
  if (s.state === 'due') return t('tools.stampDue', { n: s.daysLeft ?? 1 });
  if (s.state === 'lapsed') return t('tools.stampLapsed', { date: day(s.stampedUntil ?? '') });
  return null;
}
