import { describe, expect, it } from 'vitest';
import { t } from '../i18n'; // English is the base catalog, so the real `t` yields the English literals
import { agentWorkLine } from '../../apps/agent/logic';
import { driverWorkLine } from '../../apps/driver/logic';
import { vendorWorkLine } from '../../apps/vendor/logic';
import { fleetWorkLine } from '../../apps/fleet/logic';
import { sendWorkLine } from '../../apps/genesis/logic';

/**
 * The top bar's LIVE line, in every app that has one.
 *
 * It used to hold who you are — the shop's name, the driver's name, the company — which is fixed for
 * the whole session, so the bar's one moving slot was spent on the one thing that never moved. These
 * tests pin what replaced it: what is on this person's plate, right now.
 *
 * The rule they exist to protect is that the line reports COMMITTED state and never an incoming
 * event. A header that changes because an offer just landed pulls a driver's eyes off the road and
 * competes with the nudge, which this product deliberately restrains to one pop-up and one decision.
 */
describe('the top bar’s live line', () => {
  describe('agent — the two piles a counter has to clear', () => {
    it('counts what is waiting to go out and what a customer is coming for', () => {
      const parcels = [
        { status: 'At_PUDO' },
        { status: 'At_PUDO' },
        { status: 'Ready_For_Pickup' },
        { status: 'Delivered' }, // gone — it is nobody's work any more
      ];
      expect(agentWorkLine({ openState: 'open' }, parcels, t)).toBe('2 to hand over · 1 to collect');
    });

    it('calls out the pile that is NOT moving', () => {
      // "3 to collect" and "3 to collect, 2 waiting too long" ask a shopkeeper to do different things.
      // An overdue parcel is this counter's own capacity sitting on a shelf, not somebody else's problem
      // reported for information.
      const parcels = [
        { status: 'Ready_For_Pickup' },
        { status: 'Ready_For_Pickup', overdue: true },
        { status: 'Ready_For_Pickup', overdue: true },
      ];
      expect(agentWorkLine({ openState: 'open' }, parcels, t)).toBe('3 to collect · 2 waiting too long');
    });

    it('says nothing about overdue when nothing is', () => {
      expect(agentWorkLine({ openState: 'open' }, [{ status: 'Ready_For_Pickup' }], t)).toBe('1 to collect');
    });

    it('drops a pile that is empty rather than printing a zero', () => {
      expect(agentWorkLine({ openState: 'open' }, [{ status: 'At_PUDO' }], t)).toBe('1 to hand over');
    });

    it('says so when the counter is clear — a blank line reads as "not loaded yet"', () => {
      expect(agentWorkLine({ openState: 'open' }, [], t)).toBe('Nothing waiting');
    });

    it('a CLOSED shop says only that', () => {
      // The one state that overrides the work: a closed shop still holding parcels is the problem,
      // and burying it behind two counts would be reporting the symptom over the cause.
      expect(agentWorkLine({ openState: 'closed' }, [{ status: 'At_PUDO' }], t)).toBe('Closed — not taking parcels');
    });

    it('shows nothing at all before the shop has loaded', () => {
      expect(agentWorkLine(null, [], t)).toBeUndefined();
    });
  });

  describe('driver — committed state only', () => {
    it('leads with the road they declared, and the room that is left', () => {
      expect(driverWorkLine({ active: true }, { toLabel: 'Kisumu' }, 3, t)).toBe('To Kisumu · 3 bags free');
    });

    it('says on shift when no road has been declared', () => {
      expect(driverWorkLine({ active: true }, null, 2, t)).toBe('On shift · 2 bags free');
    });

    it('off shift is the whole line — nothing else is true yet', () => {
      expect(driverWorkLine({ active: false }, { toLabel: 'Kisumu' }, 3, t)).toBe('Off shift');
      expect(driverWorkLine(null, null, null, t)).toBe('Off shift');
    });

    it('stays silent about capacity it does not know', () => {
      // A vehicle whose hold is not measured in bags must not be described as having none: "0 bags
      // free" reads as FULL, which is the opposite of "we never received a figure".
      expect(driverWorkLine({ active: true }, { toLabel: 'Nakuru' }, null, t)).toBe('To Nakuru');
    });

    it('reports a full hold honestly', () => {
      expect(driverWorkLine({ active: true }, null, 0, t)).toBe('On shift · 0 bags free');
    });
  });

  describe('vendor — unpaid first, because unpaid is what blocks', () => {
    it('leads with unpaid, then what is moving', () => {
      expect(vendorWorkLine({ unpaid: 2, active: 5 }, t)).toBe('2 unpaid · 5 in flight');
    });

    it('drops either half when it is zero', () => {
      expect(vendorWorkLine({ unpaid: 0, active: 5 }, t)).toBe('5 in flight');
      expect(vendorWorkLine({ unpaid: 2, active: 0 }, t)).toBe('2 unpaid');
    });

    it('says nothing is outstanding rather than going blank', () => {
      expect(vendorWorkLine({ unpaid: 0, active: 0 }, t)).toBe('Nothing outstanding');
      expect(vendorWorkLine(null, t)).toBeUndefined();
    });
  });

  describe('fleet — the same figure as the dashboard tile', () => {
    it('reports vehicles out, and drivers when any are on shift', () => {
      expect(fleetWorkLine({ vehicles: { total: 6, active: 4 }, drivers: { onShift: 3 } }, t)).toBe('4 of 6 vehicles out · 3 on shift');
    });

    it('drops the driver half when nobody is on shift', () => {
      expect(fleetWorkLine({ vehicles: { total: 6, active: 0 }, drivers: { onShift: 0 } }, t)).toBe('0 of 6 vehicles out');
    });

    it('a fleet with no vehicles is being SET UP, and is told that instead', () => {
      // "0 of 0 out" is noise on the one screen whose real message is "add a vehicle".
      expect(fleetWorkLine({ vehicles: { total: 0, active: 0 }, drivers: {} }, t)).toBe('No vehicles yet');
      expect(fleetWorkLine(null, t)).toBeUndefined();
    });
  });

  describe('send — the parcel actually in play', () => {
    it('leads with ready to collect, the only line that asks you to go somewhere', () => {
      const parcels = { sent: [{ status: 'On_Bus' }], received: [{ status: 'Ready_For_Pickup' }] };
      expect(sendWorkLine(parcels, t)).toBe('A parcel is ready to collect');
    });

    it('counts several, in both directions', () => {
      const parcels = { sent: [{ status: 'Ready_For_Pickup' }], received: [{ status: 'Ready_For_Pickup' }] };
      expect(sendWorkLine(parcels, t)).toBe('2 parcels ready to collect');
    });

    it('falls back to what is merely moving', () => {
      expect(sendWorkLine({ sent: [{ status: 'On_Bus' }], received: [] }, t)).toBe('A parcel is on its way');
      expect(sendWorkLine({ sent: [{ status: 'At_MDP' }, { status: 'At_PUDO' }], received: [] }, t)).toBe('2 parcels on their way');
    });

    it('says NOTHING when there is nothing — no tagline, no filler', () => {
      // What it replaced was a slogan that read identically to a person with nothing in play and to a
      // person whose parcel had been sitting at a shop for two days.
      expect(sendWorkLine({ sent: [{ status: 'Delivered' }], received: [] }, t)).toBeUndefined();
      expect(sendWorkLine(null, t)).toBeUndefined();
    });
  });
});
