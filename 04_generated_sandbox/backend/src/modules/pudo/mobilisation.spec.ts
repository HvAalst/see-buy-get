import { mobilisationOf, waitedHours, MOBILISATION_MEASURED } from './mobilisation';
import { MOBILISATION_MIN_LOADS, TIGHT_WAIT_H } from './pudo.config';
import { Freight } from './dispatch.types';

/**
 * CL4 — the mobilisation record, tested against the four ways it could flatter somebody.
 *
 * §10's gate, written out: an agent with three loads shows three loads and no score; a hand-back after a
 * claim reduces the count; an agent who delivered while trucks were scarce is distinguishable from one who
 * only worked easy weeks; and what a party sees about themselves is what a shipper sees, field for field.
 *
 * This is a record somebody's livelihood is judged on, so every case here asks whether the number could be
 * made to say something kinder than the truth.
 */

const T0 = Date.parse('2026-06-01T00:00:00.000Z');
const HOUR = 3_600_000;
const at = (h: number) => new Date(T0 + h * HOUR).toISOString();

const NBO = { lat: -1.286, lng: 36.817 };
const MSA = { lat: -4.043, lng: 39.668 };

let seq = 0;
function load(over: Partial<Freight> = {}): Freight {
  seq += 1;
  return {
    freightId: `f-${seq}`,
    code: `FRT-${seq}`,
    description: 'Load',
    pickupLocation: NBO,
    pickupLabel: 'Nairobi',
    destLabel: 'Mombasa',
    destLocation: MSA,
    weightKg: 4000,
    fragile: false,
    packaging: 'palletised',
    cargoClass: 'P4',
    natureCode: 'GEN',
    requiredCapabilities: [],
    requiredEquipment: [],
    equipmentGaps: [],
    status: 'claimed',
    createdAt: at(0),
    claimedAt: at(1),
    claimedBy: 'did:drv:a',
    ...over,
  } as Freight;
}

/** Enough kept-and-delivered loads to lift a record off the thin floor. */
const thickRecord = (n = MOBILISATION_MIN_LOADS) =>
  Array.from({ length: n }, (_, i) => load({ createdAt: at(i * 10), claimedAt: at(i * 10 + 1), deliveredAt: at(i * 10 + 5) }));

describe('CL4 — mobilisation, measured', () => {
  describe('rule 1: hand-backs net off', () => {
    it('counts a load taken and given back as BOTH taken and given back', () => {
      // Claiming quickly and handing back later is the behaviour the measure exists to catch, so the claim
      // is not erased — it is counted, and then netted out of everything downstream.
      const m = mobilisationOf([load({ claimedBy: undefined, handBacks: [{ driverDid: 'did:drv:a', reason: 'rest due', at: at(2) }] })], ['did:drv:a']);
      expect(m).toMatchObject({ claimed: 1, handedBack: 1, kept: 0, delivered: 0 });
    });

    it('reduces the kept count when a hand-back follows a claim', () => {
      const kept = thickRecord();
      const given = load({ claimedBy: undefined, handBacks: [{ driverDid: 'did:drv:a', reason: 'broke down', at: at(3) }] });
      const m = mobilisationOf([...kept, given], ['did:drv:a']);
      expect(m.claimed).toBe(MOBILISATION_MIN_LOADS + 1);
      expect(m.handedBack).toBe(1);
      expect(m.kept).toBe(MOBILISATION_MIN_LOADS);
      // …and the rate is computed on what they KEPT, not on what they touched.
      expect(m.keptRate).toBe(Math.round((MOBILISATION_MIN_LOADS / (MOBILISATION_MIN_LOADS + 1)) * 100) / 100);
    });

    it('does not count one load twice when somebody handed it back and then took it again', () => {
      // They hold it now. The hand-back is history, and counting both would make one load into two facts.
      const m = mobilisationOf([load({ claimedBy: 'did:drv:a', handBacks: [{ driverDid: 'did:drv:a', reason: 'changed mind', at: at(2) }], deliveredAt: at(6) })], ['did:drv:a']);
      expect(m).toMatchObject({ claimed: 1, handedBack: 0, kept: 1, delivered: 1 });
    });

    it('ignores a hand-back by somebody else entirely', () => {
      const m = mobilisationOf([load({ claimedBy: 'did:drv:a', handBacks: [{ driverDid: 'did:drv:other', reason: 'not mine', at: at(2) }] })], ['did:drv:a']);
      expect(m).toMatchObject({ claimed: 1, handedBack: 0, kept: 1 });
    });
  });

  describe('rule 2: a thin record shows as thin', () => {
    it('shows three loads as three loads, and NO average', () => {
      // The gate, verbatim. Not hidden, because hiding is a polish; not averaged, because five stars from
      // three loads is the same untruth wearing the opposite sign.
      const three = [0, 1, 2].map((i) => load({ createdAt: at(i * 10), claimedAt: at(i * 10 + 1), deliveredAt: at(i * 10 + 4) }));
      const m = mobilisationOf(three, ['did:drv:a']);
      expect(m).toMatchObject({ claimed: 3, kept: 3, delivered: 3, thin: true });
      expect(m.keptRate).toBeNull();
      expect(m.deliveredRate).toBeNull();
      // …and the screen is told what a rate would need, so it can say so without knowing the config.
      expect(m.ratesNeed).toBe(MOBILISATION_MIN_LOADS);
    });

    it('rates a record the moment there are enough loads to rate, and not before', () => {
      const under = mobilisationOf(thickRecord(MOBILISATION_MIN_LOADS - 1), ['did:drv:a']);
      expect(under.thin).toBe(true);
      expect(under.deliveredRate).toBeNull();

      const atFloor = mobilisationOf(thickRecord(MOBILISATION_MIN_LOADS), ['did:drv:a']);
      expect(atFloor.thin).toBe(false);
      expect(atFloor.deliveredRate).toBe(1);
    });

    it('never divides by zero, however empty the record', () => {
      const m = mobilisationOf([], ['did:drv:a']);
      expect(m).toMatchObject({ claimed: 0, kept: 0, delivered: 0, keptRate: null, deliveredRate: null, thin: true });
      expect(m.lanes).toEqual([]);
    });
  });

  describe('rule 3: what happened, including the bad', () => {
    it('separates a load still running from one that failed', () => {
      // In flight is neither a success nor a failure, and folding it into either would be a lie in one
      // direction or the other.
      const m = mobilisationOf(
        [load({ deliveredAt: at(5) }), load({ createdAt: at(20), claimedAt: at(21) })],
        ['did:drv:a'],
      );
      expect(m).toMatchObject({ claimed: 2, kept: 2, delivered: 1, inFlight: 1 });
    });

    it('publishes the hand-backs rather than dropping them', () => {
      const m = mobilisationOf(
        [...thickRecord(), load({ claimedBy: undefined, handBacks: [{ driverDid: 'did:drv:a', reason: 'no reason given', at: at(2) }] })],
        ['did:drv:a'],
      );
      expect(m.handedBack).toBe(1);
      // A record that can only flatter protects nobody from somebody genuinely unreliable.
      expect(m.deliveredRate).not.toBeNull();
    });
  });

  describe('rule 4: per lane and per commodity class', () => {
    it('splits the record by lane, busiest first', () => {
      const ELD = { lat: 0.5143, lng: 35.2698 };
      const m = mobilisationOf(
        [
          load({ deliveredAt: at(5) }),
          load({ createdAt: at(10), claimedAt: at(11), deliveredAt: at(15) }),
          load({ destLocation: ELD, destLabel: 'Eldoret', createdAt: at(20), claimedAt: at(21) }),
        ],
        ['did:drv:a'],
      );
      expect(m.lanes.map((l) => [l.key, l.claimed])).toEqual([
        ['Nairobi → Mombasa', 2],
        ['Nairobi → Eldoret', 1],
      ]);
    });

    it('splits it by commodity class too, because dry goods are not perishables', () => {
      const m = mobilisationOf(
        [load({ deliveredAt: at(5) }), load({ cargoClass: 'P1', createdAt: at(10), claimedAt: at(11) })],
        ['did:drv:a'],
      );
      expect(m.classes.map((c) => c.key).sort()).toEqual(['P1', 'P4']);
    });

    it('names a lane end it cannot place as unknown rather than guessing', () => {
      const nowhere = { lat: -40, lng: -120 };
      const m = mobilisationOf([load({ pickupLocation: nowhere, destLocation: nowhere })], ['did:drv:a']);
      expect(m.lanes[0].key).toBe('unknown → unknown');
    });
  });

  describe('the question the measure exists for: scarcity', () => {
    it('distinguishes somebody who took a load nobody else would from somebody who worked easy weeks', () => {
      // The gate: "an agent who delivered while a corridor was tight is distinguishable from one who only
      // worked easy weeks." A load nobody touched for two days was a load trucks were scarce for.
      const easy = thickRecord();
      const hard = load({ createdAt: at(100), claimedAt: at(100 + TIGHT_WAIT_H + 1), deliveredAt: at(100 + TIGHT_WAIT_H + 10) });
      const m = mobilisationOf([...easy, hard], ['did:drv:a']);
      expect(m.tightKept).toBe(1);
      expect(m.tightDelivered).toBe(1);
      // The easy loads were claimed within the hour and are not scarcity work.
      expect(m.claimed).toBe(MOBILISATION_MIN_LOADS + 1);
    });

    it('does not credit scarcity to a load they took and gave back', () => {
      const hard = load({ claimedBy: undefined, createdAt: at(0), claimedAt: at(TIGHT_WAIT_H + 1), handBacks: [{ driverDid: 'did:drv:a', reason: 'could not do it', at: at(TIGHT_WAIT_H + 2) }] });
      const m = mobilisationOf([hard], ['did:drv:a']);
      expect(m).toMatchObject({ claimed: 1, handedBack: 1, tightKept: 0, tightDelivered: 0 });
    });

    it('reads a broken clock as unknown rather than as a long wait', () => {
      expect(waitedHours({ createdAt: at(5), claimedAt: at(1) })).toBeNull();
      expect(waitedHours({ createdAt: at(0), claimedAt: undefined })).toBeNull();
      expect(waitedHours({ createdAt: at(0), claimedAt: at(3) })).toBe(3);
    });
  });

  describe('a fleet mobilises through the drivers it fields', () => {
    it('counts the loads any of its drivers took, once each', () => {
      const m = mobilisationOf(
        [load({ claimedBy: 'did:drv:a', deliveredAt: at(5) }), load({ claimedBy: 'did:drv:b', createdAt: at(10), claimedAt: at(11), deliveredAt: at(15) }), load({ claimedBy: 'did:drv:stranger', createdAt: at(20), claimedAt: at(21) })],
        ['did:drv:a', 'did:drv:b'],
      );
      expect(m).toMatchObject({ claimed: 2, delivered: 2 });
    });
  });

  describe('what it says about itself', () => {
    it('states what was measured, and what was NOT', () => {
      // This measure's failure mode is being read as a general endorsement, and the only defence is saying
      // so beside the figure rather than in a footnote.
      expect(MOBILISATION_MEASURED).toMatch(/find and move trucks/i);
      expect(MOBILISATION_MEASURED).toMatch(/did not measure/i);
      expect(MOBILISATION_MEASURED).toMatch(/not a character reference/i);
    });

    it('carries no blended score anywhere — blending is what makes bribery look like competence', () => {
      const m = mobilisationOf(thickRecord(), ['did:drv:a']);
      expect(Object.keys(m)).not.toContain('score');
      expect(Object.keys(m)).not.toContain('rating');
      expect(Object.keys(m)).not.toContain('stars');
    });
  });
});
