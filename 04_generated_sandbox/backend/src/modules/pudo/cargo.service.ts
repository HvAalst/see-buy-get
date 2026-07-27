import { Injectable } from '@nestjs/common';
import {
  CARGO_CLASSES,
  CargoClass,
  CargoLane,
  CargoNature,
  COMPAT_MATRIX,
  Compatibility,
  Equipment,
  NATURE_CAPABILITY,
  VehicleCapability,
} from './cargo.types';

const CLASS_ORDER: CargoClass[] = CARGO_CLASSES.map((c) => c.cargoClass);

/**
 * CargoService (S30) — the stateless brain of cargo classification + compatibility. It turns a load's
 * weight/dimensions into a CargoClass (which lane it may travel), and it answers the question no code in the
 * platform could ask before: may two cargoes ride the SAME vehicle? The incompatibility matrix is what keeps
 * cement dust off the fresh produce and LPG off the blankets. Pure lookups over cargo.types — no state.
 */
@Injectable()
export class CargoService {
  /**
   * Classify a load by weight AND dimensions — the higher of the two bands wins, so a light-but-oversized
   * load (e.g. a bulky empty crate) is still treated as oversized. Missing dimensions fall back to the pure
   * weight band. A load beyond every bound is P6.
   */
  classify(input: { kg: number; dimsCm?: [number, number, number] }): CargoClass {
    const byWeight = CARGO_CLASSES.find((c) => input.kg <= c.maxKg) ?? CARGO_CLASSES[CARGO_CLASSES.length - 1];
    if (!input.dimsCm) return byWeight.cargoClass;
    const desc = [...input.dimsCm].sort((a, b) => b - a);
    const byDims =
      CARGO_CLASSES.find((c) => {
        const lim = [...c.maxCm].sort((a, b) => b - a);
        return desc.every((d, i) => d <= lim[i]);
      }) ?? CARGO_CLASSES[CARGO_CLASSES.length - 1];
    return this.higher(byWeight.cargoClass, byDims.cargoClass);
  }

  /** The higher (heavier/larger) of two classes. */
  higher(a: CargoClass, b: CargoClass): CargoClass {
    return CLASS_ORDER.indexOf(a) >= CLASS_ORDER.indexOf(b) ? a : b;
  }

  /** The handling lane a class is eligible for (pudo | mdp | dedicated). */
  laneFor(cargoClass: CargoClass): CargoLane {
    return this.spec(cargoClass).lane;
  }

  /** True when a class can NEVER enter the PUDO/MDP pipeline (a tote or chaos shelf) — it needs dedicated
   *  transport. This is the gate that keeps palletised/oversized freight out of the parcel network. */
  dedicatedRequired(cargoClass: CargoClass): boolean {
    return this.spec(cargoClass).lane === 'dedicated';
  }

  /** Equipment that can handle a class — a vehicle/site must have AT LEAST ONE (any-of). */
  requiredEquipment(cargoClass: CargoClass): Equipment[] {
    return this.spec(cargoClass).equipment;
  }

  /** The vehicle capability a cargo nature requires (FOP → cold chain, HAZ-* → hazmat), or null. */
  requiredCapability(nature: CargoNature): VehicleCapability | null {
    return NATURE_CAPABILITY[nature] ?? null;
  }

  /** The pairwise matrix verdict for two cargo natures (symmetric). */
  check(a: CargoNature, b: CargoNature): Compatibility {
    return COMPAT_MATRIX[a][b];
  }

  /**
   * May two cargo natures ride the SAME vehicle, at PARCEL granularity? Each parcel is its own sealed,
   * labelled package, so the SEGREGATE requirement ("separate sealed containers, no direct contact") is
   * already met by them being distinct parcels — only a strictly INCOMPATIBLE pair (e.g. cement dust +
   * fresh produce) is refused. Loose-bulk mixing surfaces (a shared tote, an open truck bed) tighten this
   * later; on a parcel manifest, distinct packages are the containers.
   */
  canShareVehicle(a: CargoNature, b: CargoNature): boolean {
    return this.check(a, b) !== 'INCOMPATIBLE';
  }

  private spec(cargoClass: CargoClass) {
    const found = CARGO_CLASSES.find((c) => c.cargoClass === cargoClass);
    if (!found) throw new Error(`Unknown cargo class: ${cargoClass}`);
    return found;
  }
}
