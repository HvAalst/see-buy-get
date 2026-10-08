/*
 * ASKING STAFF TO MOVE AN ACCOUNT — what somebody who is locked out is told, at each point.
 *
 * The person this is for has no number, no PIN and no inbox they can read, so nothing we send reaches them. What
 * they hold is a REFERENCE; everything they learn, they learn by coming back with it. So each state says where the
 * request stands AND what to do next, in words that do not need a second screen to make sense of.
 */

export type MoveState = 'asked' | 'checked' | 'moved' | 'refused' | 'stopped' | 'lapsed';

export interface MoveSupport {
  company: string;
  contactName?: string;
  phone?: string;
  phoneAlt?: string;
  email?: string;
  hours?: string;
}

export interface MoveAsked {
  reference: string;
  lapsesAt: string;
  support?: MoveSupport;
}

export interface MoveStatus {
  state: MoveState;
  askedAt: string;
  lapsesAt?: string;
  decidedAt?: string;
  reason?: string;
  support?: MoveSupport;
}

type Say = (key: string, vars?: Record<string, string | number>) => string;
const day = (iso?: string) => (iso ? new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '');

export interface MoveSays {
  tone: 'info' | 'ok' | 'warn';
  icon: 'clock' | 'check' | 'warning' | 'info';
  title: string;
  /** Each a sentence of its own. */
  lines: string[];
  /** The request is over and another may be made. */
  canAskAgain: boolean;
}

/**
 * What became of it. Waiting says who it waits on and until when; moved says how to get in; refused says why, in
 * staff's own words; stopped and lapsed say what that means and what is still open to them.
 */
export function moveStatusSays(status: MoveStatus, t: (key: never, vars?: Record<string, string | number>) => string): MoveSays {
  const say = t as Say;
  const until = day(status.lapsesAt);
  if (status.state === 'asked') return { tone: 'info', icon: 'clock', title: say('account.move.state.asked'), lines: [say('account.move.state.askedDetail', { date: until })], canAskAgain: false };
  if (status.state === 'checked') return { tone: 'info', icon: 'clock', title: say('account.move.state.checked'), lines: [say('account.move.state.checkedDetail', { date: until })], canAskAgain: false };
  if (status.state === 'moved') return { tone: 'ok', icon: 'check', title: say('account.move.state.moved'), lines: [say('account.move.state.movedDetail')], canAskAgain: false };
  if (status.state === 'refused') {
    return { tone: 'warn', icon: 'warning', title: say('account.move.state.refused'), lines: [...(status.reason ? [say('account.move.state.refusedWhy', { reason: status.reason })] : []), say('account.move.state.again')], canAskAgain: true };
  }
  if (status.state === 'stopped') return { tone: 'warn', icon: 'warning', title: say('account.move.state.stopped'), lines: [say('account.move.state.stoppedDetail')], canAskAgain: true };
  return { tone: 'info', icon: 'info', title: say('account.move.state.lapsed'), lines: [say('account.move.state.lapsedDetail'), say('account.move.state.again')], canAskAgain: true };
}

/** Who to speak to, as lines — or that there is nobody written down for that country. */
export function supportLines(support: MoveSupport | undefined, t: (key: never, vars?: Record<string, string | number>) => string): string[] {
  const say = t as Say;
  if (!support) return [say('account.move.noSupport')];
  return [
    say('account.move.support', { company: support.company }) + (support.contactName ? ` — ${support.contactName}` : ''),
    ...(support.phone ? [say('account.move.supportPhone', { phone: [support.phone, support.phoneAlt].filter(Boolean).join(' / ') })] : []),
    ...(support.email ? [say('account.move.supportEmail', { email: support.email })] : []),
    ...(support.hours ? [support.hours] : []),
  ];
}

/** Could this be a reference at all? Eight letters and digits, however they were typed. Spares a round trip, decides nothing. */
export function looksLikeReference(typed: string): boolean {
  return (typed ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^MV/, '').length === 8;
}
