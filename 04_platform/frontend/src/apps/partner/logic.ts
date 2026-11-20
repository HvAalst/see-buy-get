import type { Membership } from './api';

/**
 * 2026-11-20 — THE PARTNER APP'S SECTIONS (the payments plan, 3c): what the partner owes — in all and every step, newest
 * first — and what it owes each hand. Both top-level, so Back from either is home.
 */
export type Section = 'home' | 'hands';

/** A phone's width, under which the door's card is the whole screen (partner.css). */
export const PHONE_MAX = 560;

/**
 * WHICH PARTNER OPENS BY ITSELF: none while an invitation waits to be answered; the one opened last, if the person is still
 * in it; the only one, if there is one. Otherwise the list.
 */
export function openOnArrival(items: Membership[], last: string | null): string | null {
  if (items.some((m) => m.state === 'invited')) return null;
  const joined = items.filter((m) => m.state === 'joined');
  if (last && joined.some((m) => m.entityId === last)) return last;
  return joined.length === 1 ? joined[0].entityId : null;
}

export function phoneReady(phone: string): boolean {
  return phone.replace(/\D/g, '').length >= 9;
}

export function digitsReady(value: string, length: number): boolean {
  return new RegExp(`^\\d{${length}}$`).test(value);
}
