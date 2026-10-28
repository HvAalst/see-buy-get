import { GlosError } from '../../foundation/http/glos-error';
import { checkRailNote, RAIL_PARTICULARS, RAILWAYS, railwayOf } from '../../foundation/carriage-law/rail';
import { normaliseContainerNo, parseContainerNo } from './container-box';
import type { HeldRailNote, RailNoteDto, RailNoteMatch, RailNoteView, RailwayRow } from './rail-note.types';

/**
 * HOLDING A RAILWAY'S NOTE, and reading it back with its check (the user, 2026-10-28: "for now we hold the note but we
 * should be able to see whether it is valid" — and "reduce mistakes and delays … where road and rail comes together").
 * Shared by an export and an import: whichever the box travels on, the note is the railway's, held the same way.
 */
export function railwayRows(): RailwayRow[] {
  return RAILWAYS.map((r) => ({ key: r.key, name: r.name, countries: r.countries, conditions: r.conditions, particularsChecked: Boolean(r.particulars) }));
}

/** What its holder gives, made a held note — or refused, before anything is written. */
export function holdRailNote(dto: RailNoteDto, ctx: { document?: { documentId: string; title: string }; by: string; byEntityId: string; now: number }): HeldRailNote {
  const known = railwayOf(dto.railway);
  if (!known && dto.railway !== 'other') throw new GlosError('NOT_FOUND', 'No such railway: pick one, or Other with its name', { field: 'railway' });
  const railwayName = known?.name ?? dto.railwayName?.trim();
  if (!railwayName) throw new GlosError('FIELD_REQUIRED', 'Give the railway’s name', { field: 'railwayName' });
  const station = (s: { name: string; country: string }, which: string) => {
    const name = s?.name?.trim();
    if (!name) throw new GlosError('FIELD_REQUIRED', `Name the station ${which}`, { field: which === 'it left from' ? 'from' : 'to' });
    return { name: name.slice(0, 80), country: s.country.trim().toUpperCase() };
  };
  const from = station(dto.from, 'it left from');
  const to = station(dto.to, 'it goes to');
  if (dto.madeOutOn > new Date(ctx.now).toISOString().slice(0, 10)) throw new GlosError('VALIDATION_FAILED', 'A note is made out on a day that has come: give the day printed on it', { field: 'madeOutOn' });
  const number = dto.noteNumber?.trim();
  const reference = dto.electronic?.reference?.trim();
  // Something nobody can find again is not held: the copy, its number, or its reference in the railway's system.
  if (!ctx.document && !number && !reference) throw new GlosError('FIELD_REQUIRED', 'Attach the railway’s note, or give its number', { field: 'noteNumber' });
  const seals = (dto.seals ?? []).map((s) => s.trim()).filter(Boolean);
  const containerNo = dto.containerNo?.trim() ? normaliseContainerNo(dto.containerNo) : undefined;
  return {
    railway: known ? known.key : 'other',
    railwayName: railwayName.slice(0, 80),
    from,
    to,
    ...(number ? { noteNumber: number.slice(0, 60) } : {}),
    madeOutOn: dto.madeOutOn,
    load: dto.load,
    ...(dto.dangerous ? { dangerous: true } : {}),
    printed: RAIL_PARTICULARS.filter((p) => dto.printed.includes(p)),
    ...(dto.electronic ? { electronic: { ...(reference ? { reference: reference.slice(0, 80) } : {}), ...(dto.electronic.printoutLine !== undefined ? { printoutLine: dto.electronic.printoutLine } : {}) } } : {}),
    ...(ctx.document ? { documentId: ctx.document.documentId, documentTitle: ctx.document.title } : {}),
    // As printed — never corrected to ours: a difference is exactly what the holder needs to see.
    ...(containerNo ? { containerNo } : {}),
    ...(seals.length ? { seals } : {}),
    recordedAt: new Date(ctx.now).toISOString(),
    recordedBy: ctx.by,
    recordedByEntityId: ctx.byEntityId,
  };
}

/**
 * A held note with its check, and what it says of the box against our own record of it — the box's number and its seals,
 * where road and rail meet. Derived on read: the law it is checked against is the catalogue's, with the day it was read.
 */
export function railNoteView(n: HeldRailNote, ours: { containerNo?: string; seals?: string[] }, replaced: number): RailNoteView {
  const check = checkRailNote({
    from: n.from.country,
    to: n.to.country,
    madeOutOn: n.madeOutOn,
    ...(n.railway !== 'other' ? { railway: n.railway } : {}),
    load: n.load,
    ...(n.dangerous ? { dangerous: true } : {}),
    printed: n.printed,
    ...(n.electronic ? { electronic: n.electronic } : {}),
  });
  const matches: RailNoteMatch[] = [];
  if (n.containerNo) {
    const p = parseContainerNo(n.containerNo);
    if (!p.ok) matches.push({ field: 'containerNo', printed: n.containerNo, ...(ours.containerNo ? { ours: ours.containerNo } : {}), agrees: false, why: p.why! });
    else if (ours.containerNo) matches.push({ field: 'containerNo', printed: p.containerNo, ours: ours.containerNo, agrees: p.containerNo === ours.containerNo });
  }
  if (n.seals?.length && ours.seals?.length) {
    const norm = (s: string) => s.replace(/\s+/g, '').toUpperCase();
    const printed = new Set(n.seals.map(norm));
    const own = new Set(ours.seals.map(norm));
    matches.push({ field: 'seals', printed: n.seals.join(', '), ours: ours.seals.join(', '), agrees: printed.size === own.size && [...printed].every((s) => own.has(s)) });
  }
  return { ...n, check, matches, replaced };
}
