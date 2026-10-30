import { formatDate, type MessageKey } from '../../shared/i18n';
import type { ParticipantRow } from './screens/ParticipantPicker';

/**
 * A FIRM TO CHOOSE, FROM THE LOGISTICS DIRECTORY (the user, 2026-10-30: "when a business appoints a clearing agent or
 * looks for a carrier, let it pick from the directory"): the entry the public page shows, with the id an appointment or
 * an ask names. Read from `GET /v1/sbg/directory/choose`.
 */
export interface DirectoryChoice {
  id: string;
  handle: string;
  name: string;
  kinds: Array<'forwarder' | 'clearing_agent' | 'depot' | 'haulier'>;
  country: string;
  since: string;
  words?: string;
  says?: { clears: string[]; places: string[] };
  seen: { appointed?: number; cleared?: number; delivered?: number; arranged?: number };
  checks: Array<{ paper: string; what: string; at: string }>;
  contact?: { phone?: string; email?: string; website?: string; address?: string; hours?: string };
  /** A haulier this business asked for a contract: when. */
  askedAt?: string;
}

type T = (key: MessageKey, params?: Record<string, string | number>) => string;

/** The papers our staff checked, in a few words: how many, and the last day. */
export function checkedLine(checks: DirectoryChoice['checks'], t: T): string | undefined {
  if (!checks.length) return undefined;
  const last = [...checks].map((c) => c.at).sort().reverse()[0];
  return t('tower.pick.checked', { papers: checks.length, date: formatDate(last) });
}

/** A clearing agent as a row of the picker: its line, what it says it clears and where, what we saw, what staff checked. */
export function agentRow(a: DirectoryChoice, t: T, seen: { seen: MessageKey; fresh: MessageKey }): ParticipantRow {
  const clearsIds = a.says?.clears ?? [];
  const clears = clearsIds.map((s) => t(`home.agents.spec.${s}` as MessageKey));
  const says = [clears.join(', '), (a.says?.places ?? []).join(', ')].filter(Boolean).join(' · ');
  return {
    id: a.id,
    name: a.name,
    handle: a.handle,
    country: a.country,
    ...(a.words ? { words: a.words } : {}),
    ...(says ? { says } : {}),
    seen: a.seen.appointed ? t(seen.seen, { appointed: a.seen.appointed, cleared: a.seen.cleared ?? 0 }) : t(seen.fresh),
    ...(checkedLine(a.checks, t) ? { checked: checkedLine(a.checks, t) } : {}),
    ...(a.contact?.phone ? { phone: a.contact.phone } : {}),
    // What it says it clears, as buttons to narrow the list by; and where it works, its country and its line to search.
    ...(clearsIds.length ? { facets: clearsIds.map((s, i) => ({ key: s, label: clears[i] })) } : {}),
    find: [...(a.says?.places ?? []), a.country, a.words ?? '', says].join(' '),
  };
}
