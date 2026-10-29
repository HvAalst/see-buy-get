import { GlosError } from '../../foundation/http/glos-error';
import { checkFbl, FBL_BOXES } from '../../foundation/carriage-law/fbl';
import { normaliseContainerNo, parseContainerNo } from './container-box';
import type { FblDto, FblMatch, FblVerification, FblView, HeldFbl } from './fbl-note.types';

/**
 * HOLDING A FORWARDER'S BILL, and reading it back with what it means (the user, 2026-10-28: "if we optimize for FBL, we must
 * know and report for our users"). Shared by an export and an import. Refused before anything is written.
 */
export function holdFbl(dto: FblDto, ctx: { document?: { documentId: string; title: string }; by: string; byEntityId: string; now: number }): HeldFbl {
  const number = dto.number?.trim();
  if (!number || number.length < 3) throw new GlosError('FIELD_REQUIRED', 'Give the bill’s number, as printed', { field: 'number' });
  const issuer = dto.issuer?.name?.trim();
  if (!issuer) throw new GlosError('FIELD_REQUIRED', 'Give the forwarder that issued it, as printed', { field: 'issuer' });
  if (dto.issuedOn > new Date(ctx.now).toISOString().slice(0, 10)) throw new GlosError('VALIDATION_FAILED', 'A bill is issued on a day that has come: give the day printed on it', { field: 'issuedOn' });
  // A paper bill is held as its copy; an electronic one may be held by its number alone, which FIATA's page checks.
  if (!dto.electronic && !ctx.document) throw new GlosError('FIELD_REQUIRED', 'Attach a copy of the bill from your papers — a copy, which is never the original', { field: 'documentId' });
  if (dto.form === 'fwb' && dto.originals) throw new GlosError('VALIDATION_FAILED', 'A waybill has no originals to surrender: it is not negotiable', { field: 'originals' });
  const text = (v?: string) => v?.trim() || undefined;
  const seals = (dto.seals ?? []).map((s) => s.trim()).filter(Boolean);
  return {
    form: dto.form,
    number: number.slice(0, 60),
    issuer: { name: issuer.slice(0, 120), country: dto.issuer.country.trim().toUpperCase() },
    issuedOn: dto.issuedOn,
    electronic: dto.electronic,
    seaLeg: dto.seaLeg,
    printed: FBL_BOXES.filter((b) => dto.printed.includes(b)),
    ...(ctx.document ? { documentId: ctx.document.documentId, documentTitle: ctx.document.title } : {}),
    ...(dto.containerNo?.trim() ? { containerNo: normaliseContainerNo(dto.containerNo) } : {}),
    ...(seals.length ? { seals } : {}),
    ...(dto.packages != null ? { packages: dto.packages } : {}),
    ...(dto.grossWeightKg != null ? { grossWeightKg: dto.grossWeightKg } : {}),
    ...(text(dto.portOfLoading) ? { portOfLoading: text(dto.portOfLoading)! } : {}),
    ...(text(dto.portOfDischarge) ? { portOfDischarge: text(dto.portOfDischarge)! } : {}),
    ...(text(dto.consignedTo) ? { consignedTo: text(dto.consignedTo)! } : {}),
    ...(dto.originals ? { originals: dto.originals } : {}),
    recordedAt: new Date(ctx.now).toISOString(),
    recordedBy: ctx.by,
    recordedByEntityId: ctx.byEntityId,
  };
}

/** What the holder saw on FIATA's page for an electronic bill, with the page's result attached. Their word, never ours. */
export function verifyFbl(b: HeldFbl, input: { registered: boolean; fiataId?: string; issuerShown?: string }, proof: { documentId: string; title: string }, by: string, byEntityId: string, now: number): HeldFbl {
  if (!b.electronic) throw new GlosError('INVALID_STATE', 'A paper bill has no record on FIATA’s page: its serial number is with the association whose emblem it carries');
  const verification: FblVerification = {
    registered: input.registered,
    ...(input.fiataId?.trim() ? { fiataId: input.fiataId.trim().slice(0, 80) } : {}),
    ...(input.issuerShown?.trim() ? { issuerShown: input.issuerShown.trim().slice(0, 160) } : {}),
    proofDocumentId: proof.documentId,
    proofTitle: proof.title,
    by,
    byEntityId,
    at: new Date(now).toISOString(),
  };
  return { ...b, verification };
}

const loose = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * A held bill with what it means, and what it says of the goods against our own record — the box, its seals, the packages
 * and their weight, the port. Derived on read. "Agrees" proves nothing about genuineness: a forged bill can copy all of it.
 */
export function fblView(b: HeldFbl, ours: { containerNo?: string; seals?: string[]; packages?: number; grossWeightKg?: number; port?: { label: string; value?: string } ; countries: string[] }, replaced: number): FblView {
  const check = checkFbl({ form: b.form, printed: b.printed, seaLeg: b.seaLeg, issuerCountry: b.issuer.country, countries: ours.countries, electronic: b.electronic });
  const matches: FblMatch[] = [];
  if (b.containerNo) {
    const p = parseContainerNo(b.containerNo);
    if (!p.ok) matches.push({ field: 'containerNo', printed: b.containerNo, ours: ours.containerNo ?? '', agrees: false, why: p.why! });
    else if (ours.containerNo) matches.push({ field: 'containerNo', printed: p.containerNo, ours: ours.containerNo, agrees: p.containerNo === ours.containerNo });
  }
  if (b.seals?.length && ours.seals?.length) {
    const norm = (s: string) => s.replace(/\s+/g, '').toUpperCase();
    const a = new Set(b.seals.map(norm));
    const o = new Set(ours.seals.map(norm));
    matches.push({ field: 'seals', printed: b.seals.join(', '), ours: ours.seals.join(', '), agrees: a.size === o.size && [...a].every((s) => o.has(s)) });
  }
  if (b.packages != null && ours.packages != null) matches.push({ field: 'packages', printed: String(b.packages), ours: String(ours.packages), agrees: b.packages === ours.packages });
  if (b.grossWeightKg != null && ours.grossWeightKg != null) {
    const tolerance = Math.max(10, ours.grossWeightKg * 0.01);
    matches.push({ field: 'grossWeight', printed: `${b.grossWeightKg} kg`, ours: `${ours.grossWeightKg} kg`, agrees: Math.abs(b.grossWeightKg - ours.grossWeightKg) <= tolerance });
  }
  const printedPort = ours.port?.label === 'loading' ? b.portOfLoading : b.portOfDischarge;
  if (printedPort && ours.port?.value) {
    const p = loose(printedPort);
    const o = loose(ours.port.value);
    matches.push({ field: 'port', printed: printedPort, ours: ours.port.value, agrees: p.includes(o) || o.includes(p) });
  }
  const verified = !b.electronic ? 'paper' : !b.verification ? 'not_checked' : b.verification.registered ? 'registered' : 'not_registered';
  return { ...b, check, matches, verified, replaced };
}
