import { Injectable } from '@nestjs/common';
import { GlosError } from '../../foundation/http/glos-error';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { catalogueEntry } from '../../foundation/countries/catalogue';
import { CABOTAGE_RULES, type BorderAdvice, type BorderCrossingPoint, type BorderRefusal, type BorderRule, type CabotageRule } from './border-rules.types';

/**
 * CA6 — the rules of crossing a border, per direction, and the three questions dispatch asks of them:
 * may this vehicle carry a load INSIDE that country (cabotage), may this load cross at all (a crossing's limits),
 * and what does a driver taking it need to know (crossings, hours, permits, regional insurance).
 */
@Injectable()
export class BorderRuleService {
  private readonly rules = new PersistentMap<string, BorderRule>('border-rules');

  /** Record — or replace — the rule for one direction. Named, like every decision about where the network runs. */
  set(
    input: {
      from: string;
      to: string;
      crossings?: Array<Partial<BorderCrossingPoint>>;
      permits?: string[];
      regionalInsurance?: string[];
      maxWeightKg?: number;
      maxLengthM?: number;
      maxHeightM?: number;
      cabotage?: string;
      note?: string;
    },
    by?: string,
  ): BorderRule {
    const who = by?.trim();
    if (!who) throw new GlosError('FIELD_REQUIRED', 'Say who is recording this rule');
    const from = catalogueEntry(input.from);
    const to = catalogueEntry(input.to);
    if (!from) throw new GlosError('INVALID_INPUT', `${(input.from ?? '').toUpperCase()} is not a country in the catalogue`);
    if (!to) throw new GlosError('INVALID_INPUT', `${(input.to ?? '').toUpperCase()} is not a country in the catalogue`);
    if (from.code === to.code) throw new GlosError('INVALID_INPUT', 'A border rule is between two different countries');
    const cabotage = (input.cabotage ?? 'forbidden') as CabotageRule;
    if (!CABOTAGE_RULES.includes(cabotage)) throw new GlosError('VALIDATION_FAILED', 'Cabotage is either allowed or forbidden');
    const crossings = (input.crossings ?? []).map((c, i) => {
      const name = c.name?.trim();
      if (!name) throw new GlosError('VALIDATION_FAILED', `Crossing ${i + 1} needs its name`);
      return { name, ...(c.hours?.trim() ? { hours: c.hours.trim() } : {}), ...(c.note?.trim() ? { note: c.note.trim() } : {}) };
    });
    const words = (list?: string[]) => [...new Set((list ?? []).map((s) => (s ?? '').trim()).filter(Boolean))];
    const limit = (value: number | undefined, what: string) => {
      if (value == null) return undefined;
      if (!Number.isFinite(value) || value <= 0) throw new GlosError('VALIDATION_FAILED', `${what} must be above zero`);
      return value;
    };
    const maxWeightKg = limit(input.maxWeightKg, 'The weight limit');
    const maxLengthM = limit(input.maxLengthM, 'The length limit');
    const maxHeightM = limit(input.maxHeightM, 'The height limit');
    const rule: BorderRule = {
      from: from.code,
      to: to.code,
      crossings,
      permits: words(input.permits),
      regionalInsurance: words(input.regionalInsurance),
      ...(maxWeightKg ? { maxWeightKg } : {}),
      ...(maxLengthM ? { maxLengthM } : {}),
      ...(maxHeightM ? { maxHeightM } : {}),
      cabotage,
      ...(input.note?.trim() ? { note: input.note.trim() } : {}),
      setBy: who,
      setAt: new Date().toISOString(),
    };
    this.rules.set(`${rule.from}>${rule.to}`, rule);
    return rule;
  }

  list(): BorderRule[] {
    return [...this.rules.values()].sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
  }

  ruleFor(from?: string, to?: string): BorderRule | undefined {
    if (!from || !to) return undefined;
    return this.rules.get(`${from.toUpperCase()}>${to.toUpperCase()}`);
  }

  /** May a vehicle registered in one country carry a load that starts and ends inside another? Only where a rule says so. */
  cabotageAllowed(vehicleCountry: string, hostCountry: string): boolean {
    if (vehicleCountry.toUpperCase() === hostCountry.toUpperCase()) return true;
    return this.ruleFor(vehicleCountry, hostCountry)?.cabotage === 'allowed';
  }

  /** What a haul from one country into another must know and carry. Says so plainly where nothing is recorded. */
  adviceFor(from: string, to: string): BorderAdvice {
    const rule = this.ruleFor(from, to);
    return {
      from: from.toUpperCase(),
      to: to.toUpperCase(),
      recorded: Boolean(rule),
      crossings: rule?.crossings ?? [],
      permits: rule?.permits ?? [],
      regionalInsurance: rule?.regionalInsurance ?? [],
      ...(rule?.maxWeightKg ? { maxWeightKg: rule.maxWeightKg } : {}),
      ...(rule?.maxLengthM ? { maxLengthM: rule.maxLengthM } : {}),
      ...(rule?.maxHeightM ? { maxHeightM: rule.maxHeightM } : {}),
      ...(rule?.note ? { note: rule.note } : {}),
    };
  }

  /**
   * Why the law does not let this vehicle carry this load. Empty means it may.
   *
   * Only asked where the countries are KNOWN: a bulletin load posted as two pins has no country at either end,
   * and inventing one would refuse loads on a guess.
   */
  refusalsFor(load: { pickupCountry?: string; destCountry?: string; weightKg: number }, vehicleCountry?: string): BorderRefusal[] {
    const out: BorderRefusal[] = [];
    const pickup = load.pickupCountry?.toUpperCase();
    const dest = load.destCountry?.toUpperCase();
    const vehicle = vehicleCountry?.toUpperCase();
    const name = (code: string) => catalogueEntry(code)?.name ?? code;
    if (pickup && dest && pickup === dest && vehicle && vehicle !== pickup && !this.cabotageAllowed(vehicle, pickup)) {
      const rule = this.ruleFor(vehicle, pickup);
      out.push({
        code: 'CABOTAGE_NOT_PERMITTED',
        message: rule
          ? `A vehicle registered in ${name(vehicle)} may not carry a load inside ${name(pickup)} — cabotage is not permitted there`
          : `A vehicle registered in ${name(vehicle)} may not carry a load inside ${name(pickup)} — no rule allows it`,
      });
    }
    if (pickup && dest && pickup !== dest) {
      const rule = this.ruleFor(pickup, dest);
      if (rule?.maxWeightKg && load.weightKg > rule.maxWeightKg) {
        out.push({ code: 'OVER_BORDER_WEIGHT_LIMIT', message: `The crossing into ${name(dest)} allows at most ${rule.maxWeightKg} kg — this load is ${load.weightKg} kg` });
      }
    }
    return out;
  }
}
