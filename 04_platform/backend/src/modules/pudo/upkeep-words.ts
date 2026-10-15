/** How a vehicle's upkeep says days and kilometres — in refusals, notices and on every screen alike. */

/** "17 Oct 2026": the way papers already say a day. */
export function dayWords(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? day : `${d.getUTCDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "135,000": km the way the readings say them. */
export function kmWords(km: number): string {
  return km.toLocaleString('en-GB');
}
