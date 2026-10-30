/**
 * THE PAGE NAME A NAME GIVES, as the server makes it (`HandleService.stem` and `issue`, backend/src/foundation/handle):
 * lower case, accents dropped, anything else one hyphen, at most 30 long; a name that reads like one of our own pages
 * takes the country's code. Shown while somebody signing up types their name (the owner, 2026-10-30). The server
 * decides, once staff have approved them, and adds the country's code where the name is already taken — which this
 * cannot know, so the words beside it say so.
 */

const MAX = 30;

/** Letters no decomposition turns into plain ones — the server's list. */
const PLAIN: Record<string, string> = { ß: 'ss', æ: 'ae', œ: 'oe', ø: 'o', ł: 'l', đ: 'd', ð: 'd', þ: 'th', ı: 'i' };

/** Names that read like one of our own pages — the server's list. */
const SHY = new Set(['admin', 'api', 'app', 'agent', 'driver', 'mdp', 'vendor', 'fleet', 'tower', 'home', 'genesis', 'send', 'login', 'signin', 'signup', 'support', 'help', 'about', 'legal', 'privacy', 'terms', 'seebuyget', 'sbg', 'glos', 'official', 'verified', 'staff', 'security', 'billing', 'payments']);

/** The url-safe stem of a name: `Kilima Logistics Ltd` → `kilima-logistics-ltd`, `Citroën Garage` → `citroen-garage`. */
export function pageStem(name: string): string {
  return (name || '')
    .toLowerCase()
    .replace(/[ßæœøłđðþı]/g, (c) => PLAIN[c] ?? c)
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX)
    .replace(/-+$/g, '');
}

/** The page name this name would be given in this country if nobody holds it first; empty while nothing survives. */
export function pageNameFor(name: string, country: string): string {
  const stem = pageStem(name);
  if (!stem) return '';
  return SHY.has(stem) ? `${stem}-${(country || '').toLowerCase() || 'x'}` : stem;
}
