import type { MessageKey, Translate } from './i18n';

/** Who has a parcel or a load now, as the server says it (NowWithView, plan R1). */
export interface NowWith {
  kind: 'sender' | 'shop' | 'hub' | 'carrier';
  name?: string;
  vehicle?: string;
  since: string;
  /** A load: false while a driver has taken it but not yet picked it up. */
  pickedUp?: boolean;
}

const VEHICLES: Record<string, MessageKey> = {
  bike: 'nowWith.vehicle.bike',
  motorcycle: 'nowWith.vehicle.motorcycle',
  tuktuk: 'nowWith.vehicle.tuktuk',
  car: 'nowWith.vehicle.car',
  van: 'nowWith.vehicle.van',
  bus: 'nowWith.vehicle.bus',
  truck: 'nowWith.vehicle.truck',
};

/**
 * 2026-11-15 — "Now with …", in words (the owner: "the receiver should see which driver or hub has his parcel at the moment
 * it is passed on"). A shop or a hub by its name; on the road the company carrying it and the kind of vehicle; a load a
 * driver has taken but not picked up, said so. Never a phone: the server sends none.
 */
export function nowWithLine(n: NowWith, t: Translate): string {
  const vehicle = n.vehicle ? t(VEHICLES[n.vehicle] ?? 'nowWith.vehicle.generic') : undefined;
  switch (n.kind) {
    case 'sender':
      return t('nowWith.sender');
    case 'shop':
      return n.name ? t('nowWith.shop', { name: n.name }) : t('nowWith.shopUnnamed');
    case 'hub':
      return n.name ? t('nowWith.hub', { name: n.name }) : t('nowWith.hubUnnamed');
    default:
      if (n.pickedUp === false) {
        if (!n.name) return t('nowWith.takenUnnamed');
        return vehicle ? t('nowWith.taken', { name: n.name, vehicle }) : t('nowWith.takenNoVehicle', { name: n.name });
      }
      if (!n.name) return t('nowWith.carrierUnnamed');
      return vehicle ? t('nowWith.carrier', { name: n.name, vehicle }) : t('nowWith.carrierNoVehicle', { name: n.name });
  }
}

/** "since 14:05" — today on this phone's clock; another day with its date. */
export function nowWithSince(n: NowWith, t: Translate, now: Date = new Date()): string {
  const at = new Date(n.since);
  if (Number.isNaN(at.getTime())) return '';
  const sameDay = at.toDateString() === now.toDateString();
  const time = sameDay ? at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : at.toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  return t('nowWith.since', { time });
}
