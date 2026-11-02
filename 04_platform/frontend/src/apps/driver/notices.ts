import type { Translate } from '../../shared/i18n';
import type { InboxItem } from '../../shared/push';
import type { NoticeAct } from '../../shared/ui/NotificationBell';

/**
 * 2026-11-02 — A DRIVER'S NOTICES THAT ARE ANSWERED IN "YOUR FLEET" (the owner: "yes, just to keep drivers' safety in
 * mind, we must reduce the tapping, so that's why it should open").
 *
 * Every other notice a driver gets names its screen on its link (the load, the board, the offer, home, earnings); these
 * are answered in a sheet behind the account menu, which has no address, so the Driver app opens it itself on a tap:
 *   - a fleet's offer of a place (not the offer taken back: nothing is left to answer);
 *   - leaving a fleet, or being taken off one — where the next step is, riding alone or another fleet;
 *   - a day on the fleet's roster, put on or taken off — the days are listed there;
 *   - an ask to ride alone that was not approved — asked again there.
 * The sheet asks nothing typed of a driver at the wheel: an offer is a yes or a no.
 */
export function fleetSheetFor(item: InboxItem): 'offer' | 'fleet' | null {
  const d = item.data ?? {};
  if (item.kind === 'fleet_offer') return typeof d.fleetDid === 'string' ? 'offer' : null;
  if (item.kind === 'roster_changed' && typeof d.fleetDid === 'string') return 'fleet';
  if (item.kind === 'driver_roster') return 'fleet';
  if (item.kind === 'papers_checked' && d.about === 'ride_alone' && d.approved === false) return 'fleet';
  return null;
}

/** The Driver app's own act on such a notice: the fleet sheet, said as what the driver sees there. */
export function driverNoticeAct(t: Translate, openFleet: () => void): NoticeAct {
  return (item) => {
    const sheet = fleetSheetFor(item);
    if (!sheet) return null;
    return { label: t(sheet === 'offer' ? 'driver.home.offerSee' : 'driver.fleet.row'), run: openFleet };
  };
}
