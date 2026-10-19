import type { Result, SbgClient } from '../../lib/sbg';
import type { MessageKey, Translate } from '../../shared/i18n';
import type { CompanyKey, CompanyKeyIssued } from '../../shared/companyKeys';

/*
 * A FLEET'S OWN SYSTEM, TOLD OF ITS WORK (backend fleet-hook.types.ts; the user, round 11: the events recommended; the
 * money of a load only where we pay the fleet; where its vehicles are is the fleet's own choice, and the driver is told;
 * any manager sets it up, under their own name). What its system hears, and what became of each message.
 */

export interface SystemMessage {
  id: string;
  event: string;
  at: string;
  state: 'pending' | 'delivered' | 'failed';
  attempts: number;
  nextTryAt: string;
  deliveredAt?: string;
  lastError?: string;
  resent?: number;
  /** The exact body that was signed and sent: what this app shows about it. */
  body: string;
}

export interface PositionsView {
  everyMin: number;
  setAt: string;
  setBy: string;
  delivered: number;
  notDelivered: number;
  lastDeliveredAt?: string;
  lastError?: string;
  lastErrorAt?: string;
}

export interface SystemView {
  url?: string;
  setAt?: string;
  setBy?: string;
  hasSecret: boolean;
  secretTurnedAt?: string;
  secretTurnedBy?: string;
  /** Only in the answer that made it. */
  secret?: string;
  events: string[];
  /** Absent while positions are off. */
  positions?: PositionsView;
  messages: SystemMessage[];
}

/** How often a vehicle's position may be sent, in minutes: the fleet's choice among these, or off. */
export const POSITION_EVERY = [1, 5, 15] as const;

export function systemApi(sbg: SbgClient, did: string) {
  const path = { did };
  return {
    view: (): Promise<Result<SystemView>> => sbg.request((c) => c.GET('/v1/sbg/fleet/managers/{did}/system', { params: { path } })) as never,
    setAddress: (url: string): Promise<Result<SystemView>> => sbg.request((c) => c.PUT('/v1/sbg/fleet/managers/{did}/system', { params: { path }, body: { url } })) as never,
    turnSecret: (): Promise<Result<SystemView>> => sbg.request((c) => c.POST('/v1/sbg/fleet/managers/{did}/system/secret', { params: { path } })) as never,
    setPositions: (everyMin: 0 | (typeof POSITION_EVERY)[number]): Promise<Result<SystemView>> => sbg.request((c) => c.PUT('/v1/sbg/fleet/managers/{did}/system/positions', { params: { path }, body: { everyMin } })) as never,
    test: (): Promise<Result<SystemMessage>> => sbg.request((c) => c.POST('/v1/sbg/fleet/managers/{did}/system/test', { params: { path } })) as never,
    resend: (messageId: string): Promise<Result<SystemMessage>> =>
      sbg.request((c) => c.POST('/v1/sbg/fleet/managers/{did}/system/messages/{messageId}/resend', { params: { path: { did, messageId } } })) as never,
    // Round 12 — its keys, for its own system to send orders in, read its plan and take loads: any manager's.
    keys: (): Promise<Result<{ items: CompanyKey[] }>> => sbg.request((c) => c.GET('/v1/sbg/fleet/managers/{did}/keys', { params: { path } })) as never,
    issueKey: (mode: 'live' | 'test', label?: string): Promise<Result<CompanyKeyIssued>> =>
      sbg.request((c) => c.POST('/v1/sbg/fleet/managers/{did}/keys', { params: { path }, body: { mode, ...(label ? { label } : {}) } })) as never,
    revokeKey: (keyId: string): Promise<Result<CompanyKey>> => sbg.request((c) => c.POST('/v1/sbg/fleet/managers/{did}/keys/{keyId}/revoke', { params: { path: { did, keyId } } })) as never,
  };
}

const EVENT_WORDS: Record<string, MessageKey> = {
  'order.received': 'fleet.system.event.orderReceived',
  'order.changed': 'fleet.system.event.orderChanged',
  'order.removed': 'fleet.system.event.orderRemoved',
  'order.cancelled': 'fleet.system.event.orderCancelled',
  'load.assigned': 'fleet.system.event.assigned',
  'load.taken': 'fleet.system.event.taken',
  'load.handed_back': 'fleet.system.event.handedBack',
  'load.picked_up': 'fleet.system.event.pickedUp',
  'load.delivery_failed': 'fleet.system.event.deliveryFailed',
  'load.delivered': 'fleet.system.event.delivered',
  'load.cancelled': 'fleet.system.event.loadCancelled',
  'load.claim_opened': 'fleet.system.event.claimOpened',
  'load.claim_decided': 'fleet.system.event.claimDecided',
  'vehicle.broke_down': 'fleet.system.event.brokeDown',
  'vehicle.breakdown_ended': 'fleet.system.event.breakdownEnded',
  'vehicle.loads_moved': 'fleet.system.event.loadsMoved',
  'vehicle.position': 'fleet.system.event.position',
  'run.booked': 'fleet.system.event.runBooked',
  'run.booking_cancelled': 'fleet.system.event.bookingCancelled',
  'run.cancelled': 'fleet.system.event.runCancelled',
  'plan.accepted': 'fleet.system.event.planAccepted',
  test: 'fleet.system.event.test',
};

/** "An order came in" — or the event's own name for one this screen has no words for yet. */
export function eventWords(event: string, t: Translate): string {
  return EVENT_WORDS[event] ? t(EVENT_WORDS[event]) : event;
}

/** What a message is about, read from the body that was sent: an order's or a load's code, a vehicle's plate, a run, a day. */
export function subjectOf(m: SystemMessage): string | undefined {
  let data: Record<string, Record<string, unknown> | undefined> | undefined;
  try {
    data = (JSON.parse(m.body) as { data?: Record<string, Record<string, unknown> | undefined> }).data;
  } catch {
    return undefined;
  }
  const said = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
  return said(data?.order?.code) ?? said(data?.load?.code) ?? said(data?.handBack?.code) ?? said(data?.breakdown?.plate) ?? said(data?.run?.lineName) ?? said(data?.plan?.day);
}

/** What became of it, in words: arrived; being sent; tried again by itself, how often and when; given up — and why. */
export function messageLine(m: SystemMessage, t: Translate): { text: string; warn: boolean } {
  const when = (iso?: string) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '');
  const why = m.lastError ? ` ${t('fleet.system.msg.why', { why: m.lastError.replace(/\.+$/, '') })}` : '';
  if (m.state === 'delivered') return { text: t('fleet.system.msg.arrived', { when: when(m.deliveredAt) }), warn: false };
  if (m.state === 'failed') return { text: t('fleet.system.msg.gaveUp', { count: m.attempts }) + why, warn: true };
  if (!m.attempts) return { text: t('fleet.system.msg.sending'), warn: false };
  return { text: t('fleet.system.msg.retrying', { count: m.attempts, next: when(m.nextTryAt) }) + why, warn: true };
}

/** Where its vehicles are, as the office reads it: off, or how often, who turned it on, and how the sending goes. */
export function positionsLines(p: PositionsView | undefined, t: Translate): Array<{ text: string; warn: boolean }> {
  if (!p) return [{ text: t('fleet.system.pos.off'), warn: false }];
  const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  const lines = [
    { text: t('fleet.system.pos.on', { n: p.everyMin, name: p.setBy, when: when(p.setAt) }), warn: false },
    { text: t('fleet.system.pos.counts', { delivered: p.delivered, notDelivered: p.notDelivered }) + (p.lastDeliveredAt ? ` ${t('fleet.system.pos.last', { when: when(p.lastDeliveredAt) })}` : ''), warn: false },
  ];
  // Only while it is the latest word: a failure older than the last arrival is history, not news.
  if (p.lastError && p.lastErrorAt && (!p.lastDeliveredAt || p.lastErrorAt > p.lastDeliveredAt)) lines.push({ text: t('fleet.system.pos.lastError', { why: p.lastError.replace(/\.+$/, '') }), warn: true });
  return lines;
}

/** The dashboard's one line: not set up, or where it goes and how many have not arrived. */
export function systemSummary(view: SystemView | null, t: Translate): { text: string; warn: boolean } {
  if (!view?.url) return { text: t('fleet.system.cardOff'), warn: false };
  const stuck = view.messages.filter((m) => m.state === 'failed' || (m.state === 'pending' && m.attempts > 0)).length;
  return stuck ? { text: t('fleet.system.cardStuck', { n: stuck }), warn: true } : { text: t('fleet.system.cardOn', { url: view.url }), warn: false };
}
