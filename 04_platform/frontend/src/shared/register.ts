/**
 * Pure helpers for the reusable register (searchable/filterable/paginated/multi-select list) shared by
 * every shipment/bookkeeping surface (R1). No DOM, no fetch — unit-tested. The register UI components
 * (SearchInput / Pager / SelectionBar / Chip) build on these; the server query contract is R0's Page<T>.
 */

/** "21–40 of 143" (1-indexed, human), or "None" when empty. Clamps a past-the-end page sensibly. */
export function pageLabel(offset: number, limit: number, total: number): string {
  if (total <= 0) return 'None';
  const start = Math.min(Math.max(0, offset), total - 1) + 1; // clamped so start never exceeds total
  const end = Math.min(offset + limit, total);
  return `${start}–${end} of ${total}`;
}

export function hasPrevPage(offset: number): boolean {
  return offset > 0;
}

export function hasNextPage(offset: number, limit: number, total: number): boolean {
  return offset + limit < total;
}

/** Toggle an id in an immutable selection set (returns a NEW set). */
export function toggleId(selected: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** All / none over the currently-visible ids: if every visible id is already selected, clear them; else add them. */
export function toggleAll(selected: ReadonlySet<string>, visibleIds: string[]): Set<string> {
  const next = new Set(selected);
  const allOn = visibleIds.length > 0 && visibleIds.every((id) => next.has(id));
  for (const id of visibleIds) {
    if (allOn) next.delete(id);
    else next.add(id);
  }
  return next;
}
