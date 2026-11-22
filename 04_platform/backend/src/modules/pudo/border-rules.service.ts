import { Injectable } from '@nestjs/common';
import { GlosError } from '../../foundation/http/glos-error';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { catalogueEntry } from '../../foundation/countries/catalogue';
import { unionBetween } from '../../foundation/countries/customs-union';
import { CABOTAGE_RULES, type BorderAdvice, type BorderCrossingPoint, type BorderRefusal, type BorderRule, type CabotageRule } from './border-rules.types';

/**
 * CA6 — the rules of crossing a border, per direction, and the three questions dispatch asks of them:
 * may this vehicle carry a load INSIDE that country (cabotage), may this load cross at all (a crossing's limits),
 * and what does a driver taking it need to know (crossings, hours, permits, regional insurance).
 */
/** 2026-11-22 — the EU count (BG-4): loads inside within this many days of a load into the country being unloaded, at most this many. */
export const EU_CABOTAGE_DAYS = 7;
export const EU_CABOTAGE_LOADS = 3;
/** …then this many days without loads inside that country, counted from the last one's delivery. */
export const EU_CABOTAGE_PAUSE_DAYS = 4;
const DAY_MS = 86_400_000;

/** One of the vehicle's own loads, as the EU count reads it. */
export interface CabotageLoad {
  pickupCountry?: string;
  destCountry?: string;
  status: string;
  /** When it was taken on: claimed, or taken over. */
  startedAt?: string;
  deliveredAt?: string;
}

/**
 * 2026-11-22 — WHETHER THE EU COUNT LETS THIS VEHICLE CARRY ONE MORE LOAD INSIDE `host` NOW (the owner's BG-4; Regulation (EC)
 * No 1072/2009 art. 8): only after a load from another country into `host` was unloaded, within seven days of that unloading,
 * three loads inside at most; and four days without loads inside after the last of an earlier round. Said in words, or nothing
 * when it may. Its own loads only, as dispatch gives them (taken over in it, or claimed by its driver).
 */
export function euCabotageRefusal(host: string, loads: CabotageLoad[], now: number): string | undefined {
  const H = host.toUpperCase();
  const name = catalogueEntry(H)?.name ?? H;
  const live = loads.filter((l) => l.status !== 'cancelled' && l.status !== 'refused');
  const at = (iso?: string) => (iso ? Date.parse(iso) : NaN);
  // The latest load from another country into this one, unloaded by now.
  const into = live
    .filter((l) => l.destCountry?.toUpperCase() === H && l.pickupCountry && l.pickupCountry.toUpperCase() !== H && at(l.deliveredAt) <= now)
    .map((l) => at(l.deliveredAt))
    .sort((a, b) => b - a)[0];
  if (into == null || Number.isNaN(into)) return `Under the EU rule a vehicle from another country carries loads inside ${name} only after a load into ${name} is unloaded, and this one has none`;
  const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const closes = into + EU_CABOTAGE_DAYS * DAY_MS;
  if (now > closes) return `Under the EU rule loads inside ${name} are carried within ${EU_CABOTAGE_DAYS} days of the load into it being unloaded, and those ended on ${day(closes)}`;
  const inside = (l: CabotageLoad) => l.pickupCountry?.toUpperCase() === H && l.destCountry?.toUpperCase() === H;
  const thisRound = live.filter((l) => inside(l) && at(l.startedAt) >= into);
  if (thisRound.length >= EU_CABOTAGE_LOADS) return `Under the EU rule a vehicle carries at most ${EU_CABOTAGE_LOADS} loads inside ${name} after a load into it, and this one has carried ${thisRound.length}`;
  // An earlier round: four days without loads inside after its last delivery, whatever came into the country since.
  const lastEarlier = live
    .filter((l) => inside(l) && at(l.startedAt) < into && !Number.isNaN(at(l.deliveredAt ?? l.startedAt)))
    .map((l) => at(l.deliveredAt ?? l.startedAt))
    .sort((a, b) => b - a)[0];
  if (lastEarlier != null) {
    const pauseEnds = lastEarlier + EU_CABOTAGE_PAUSE_DAYS * DAY_MS;
    if (now < pauseEnds) return `Under the EU rule a vehicle waits ${EU_CABOTAGE_PAUSE_DAYS} days after its last load inside ${name} before another, until ${day(pauseEnds)}`;
  }
  return undefined;
}

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
    if (!CABOTAGE_RULES.includes(cabotage)) throw new GlosError('VALIDATION_FAILED', 'Loads inside are allowed, not allowed, or counted the EU way');
    if (cabotage === 'eu' && !unionBetween(from.code, to.code)) throw new GlosError('VALIDATION_FAILED', `The EU count is for two EU countries: ${from.name} and ${to.name} are not`, { field: 'cabotage' });
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

  /** May a vehicle registered in one country carry a load that starts and ends inside another? Only where a rule says so — and,
   *  under the EU count, only while its count allows (`refusalsFor` asks that, with the vehicle's own loads). */
  cabotageAllowed(vehicleCountry: string, hostCountry: string): boolean {
    if (vehicleCountry.toUpperCase() === hostCountry.toUpperCase()) return true;
    const rule = this.ruleFor(vehicleCountry, hostCountry)?.cabotage;
    return rule === 'allowed' || rule === 'eu';
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
  refusalsFor(load: { pickupCountry?: string; destCountry?: string; weightKg: number }, vehicleCountry?: string, vehicleLoads: () => CabotageLoad[] = () => [], now: number = Date.now()): BorderRefusal[] {
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
    // 2026-11-22 — the EU count (BG-4): asked only where the rule is it, with this vehicle's own loads.
    if (pickup && dest && pickup === dest && vehicle && vehicle !== pickup && this.ruleFor(vehicle, pickup)?.cabotage === 'eu') {
      const why = euCabotageRefusal(pickup, vehicleLoads(), now);
      if (why) out.push({ code: 'CABOTAGE_NOT_PERMITTED', message: why });
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
