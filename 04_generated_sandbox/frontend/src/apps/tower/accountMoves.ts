import type { MessageKey, Translate } from '../../shared/i18n';

/*
 * TWO MEMBERS OF STAFF MOVE AN ACCOUNT — what the console says about a request, and what its reader may do with it.
 *
 * The user, 2026-10-01: "2 seebuyget staff can move an account." It is for somebody with no number, no PIN and no
 * inbox they can read — and it is exactly what somebody after another person's account would ask for. So the screen
 * leads with what there is to CHECK the asker against, and with whatever speaks against them, before any button.
 */

export type MoveState = 'asked' | 'checked' | 'moved' | 'refused' | 'stopped' | 'lapsed';

export interface MoveAccount {
  since: string;
  hasPin: boolean;
  email?: string;
  roles: Array<{ role: string; name: string; with?: string }>;
  nationalIdOnRecord: boolean;
  pinUsedSince?: string;
  numberChangedAt?: string;
}

export interface MoveRow {
  moveId: string;
  reference: string;
  state: MoveState;
  askedAt: string;
  lapsesAt: string;
  oldEnds: string;
  newEnds: string;
  namesAccount: boolean;
  nationalId?: 'matches' | 'differs' | 'none_on_record';
  note?: string;
  checkedBy?: string;
  checkedAt?: string;
  checkedWhat?: string;
  decidedBy?: string;
  decidedAt?: string;
  reason?: string;
  stoppedBy?: 'holder' | 'pin';
  checkedByYou?: boolean;
  account?: MoveAccount;
}

export const MOVE_LABEL: Record<MoveState, MessageKey> = {
  asked: 'tower.moves.state.asked',
  checked: 'tower.moves.state.checked',
  moved: 'tower.moves.state.moved',
  refused: 'tower.moves.state.refused',
  stopped: 'tower.moves.state.stopped',
  lapsed: 'tower.moves.state.lapsed',
};

/** Waiting on a first look is the loudest; stopped from the account itself is the one to read twice. */
export const MOVE_TONE: Record<MoveState, 'warn' | 'info' | 'ok' | 'quiet' | 'danger'> = { asked: 'warn', checked: 'info', moved: 'ok', refused: 'quiet', stopped: 'danger', lapsed: 'quiet' };

export const isOpen = (row: Pick<MoveRow, 'state'>): boolean => row.state === 'asked' || row.state === 'checked';

/** How many wait on a member of staff. Null while unread: "none waiting" and "we have not looked" are different claims. */
export function movesWaiting(rows: MoveRow[] | null): number | null {
  return rows === null ? null : rows.filter(isOpen).length;
}

/**
 * WHAT THE READER MAY DO NEXT. `check` — say what was checked · `approve` — the second step, and the account moves ·
 * `other` — the reader checked it, so the approval is somebody else's · `refuse` — it names no account: there is
 * nothing to move · `over` — decided, stopped or lapsed.
 *
 * "The reader checked it" is the server's word where the sign-in names somebody (`checkedByYou`), and the name where
 * a sandbox's shared key is in use. The server refuses the same person twice either way; this only spares the click.
 */
export type MoveStep = 'check' | 'approve' | 'other' | 'refuse' | 'over';

export function moveStep(row: MoveRow, me?: string): MoveStep {
  if (row.state === 'asked') return row.namesAccount ? 'check' : 'refuse';
  if (row.state === 'checked') return row.checkedByYou || (Boolean(me) && row.checkedBy === me) ? 'other' : 'approve';
  return 'over';
}

/** The line under a request in the list: the two numbers by their last digits, and when it was asked. */
export function moveSub(row: MoveRow, t: Translate): string {
  const base = t('tower.moves.rowSub', { from: row.oldEnds, to: row.newEnds, when: row.askedAt.slice(0, 10) });
  if (row.state === 'checked' && row.checkedBy) return `${base} · ${t('tower.moves.rowChecked', { who: row.checkedBy })}`;
  if (row.state === 'asked' && !row.namesAccount) return `${base} · ${t('tower.moves.rowNoAccount')}`;
  return base;
}

/** What the asker typed as their national ID came to. Only the answer was ever kept. */
export function idWords(row: MoveRow, t: Translate): string {
  return t(row.nationalId ? `tower.moves.id.${row.nationalId}` : 'tower.moves.id.not_given');
}

/**
 * WHAT SPEAKS AGAINST MOVING IT — said before the buttons, loudest first. Nothing when nothing does.
 *
 * The PIN having been used since is the one that ends it: the asker said they had lost it. An ID that differs, or an
 * account with nothing on record to check anybody against, are for the member of staff to weigh.
 *
 * ONLY WHILE THERE IS STILL SOMETHING TO DECIDE. On a request that is over they are not warnings any more — and one
 * of them would be wrong: "its number was already changed" is, on a moved request, the move itself.
 */
export function moveWarnings(row: MoveRow, t: Translate, when: (iso: string) => string): Array<{ tone: 'danger' | 'warn'; text: string }> {
  const a = row.account;
  if (!a || !isOpen(row)) return [];
  return [
    ...(a.pinUsedSince ? [{ tone: 'danger' as const, text: t('tower.moves.warn.pinUsed', { when: when(a.pinUsedSince) }) }] : []),
    ...(row.nationalId === 'differs' ? [{ tone: 'danger' as const, text: t('tower.moves.warn.idDiffers') }] : []),
    ...(a.numberChangedAt ? [{ tone: 'warn' as const, text: t('tower.moves.warn.numberChanged', { when: when(a.numberChangedAt) }) }] : []),
    ...(!a.nationalIdOnRecord ? [{ tone: 'warn' as const, text: t('tower.moves.warn.nothingToCheck') }] : []),
    ...(a.email ? [{ tone: 'warn' as const, text: t('tower.moves.warn.hasEmail', { email: a.email }) }] : []),
  ];
}

/** Who is on the account, as lines: a driver and their fleet, a shop — or that it only sends and collects. */
export function roleLines(account: MoveAccount, t: Translate): string[] {
  if (!account.roles.length) return [t('tower.moves.role.none')];
  return account.roles.map((r) => (r.role === 'driver' ? (r.with ? t('tower.moves.role.driverWith', { name: r.name, fleet: r.with }) : t('tower.moves.role.driver', { name: r.name })) : t('tower.moves.role.shop', { name: r.name })));
}

/** How it ended, in one line — who decided, or that the account itself stopped it and how. */
export function endedWords(row: MoveRow, t: Translate, when: (iso: string) => string): string {
  const at = row.decidedAt ? when(row.decidedAt) : '';
  if (row.state === 'moved') return t('tower.moves.ended.moved', { who: row.decidedBy ?? '', when: at });
  if (row.state === 'refused') return t('tower.moves.ended.refused', { who: row.decidedBy ?? '', when: at });
  if (row.state === 'stopped') return t(row.stoppedBy === 'pin' ? 'tower.moves.ended.stoppedPin' : 'tower.moves.ended.stoppedHolder', { when: at });
  if (row.state === 'lapsed') return t('tower.moves.ended.lapsed', { when: at });
  return '';
}
