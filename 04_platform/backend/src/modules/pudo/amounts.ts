import { DEFAULT_PRICE_PER_KM, HANDOVER_FEE, HOLDING_FEE_PER_DAY, LABOUR_FEE, MDP_SORT_FEE, RELEASE_FEE, SHELVING_FEE, TOTE_LOAD_FEE, TRADE_CREDIT_PARCELS, WHOLESALE } from './pudo.config';
import { VEHICLE_SPEC } from './fleet.config';
import { AMOUNT_KEYS, isAmountKey, type AmountKey } from './amount-keys';

/**
 * WHAT A PARCEL COSTS AND WHAT EACH STEP PAYS — a list per country's company, in that company's own money.
 *
 * These were ten constants in `pudo.config.ts`: 1.60 to a shop's float for a parcel, 0.40 for taking one in, 0.50 for
 * handing a batch to the bus, and so on — every one a figure at the scale of a dollar, stamped as Kenyan shillings,
 * and changeable only by a developer. They decide what a real top-up buys and they are on every screen of every app.
 *
 * Now each company keeps its own list, set where its rates and tax are set (the console's Rates screen), and the
 * constants are only what a company STARTS from: nothing changes for anybody until somebody sets a figure.
 *
 * WHOSE LIST. Always the company of whoever does the step: a shop is charged and paid by the company that contracts
 * it, a hub by its own, a driver by the one that settles them. A parcel that crosses a border is shelved at the rate of
 * the country it is shelved in, in that country's money — the amount is a wage for work done there, not a share of a
 * price set somewhere else.
 *
 * AND WHAT THE ROAD STARTS FROM (the user, 2026-10-25: "each countries rate and individually the individuals can
 * overrule with their own rate"). A rate per kilometre and a truck's loading fee: the public market prices a load at
 * the rates of the company of the country it is picked up in, in its money, and a vehicle whose owner names no rate
 * of its own starts from them (smaller classes from their share of the truck's fee). Its owner's own rate overrules.
 *
 * WHEN. The figure in force when the step is done. Two things are kept on the parcel instead, because they are taken
 * BACK later and must come back as they went: what the shop was charged at the counter and what it was paid for the
 * take-in (a parcel cancelled after a price change refunds the old price, not the new). And the daily holding charge
 * is fixed when a parcel's free time ends, so the days already owed are not re-priced by a later change.
 *
 * TWO THINGS ARE NOT ON THE LIST, deliberately:
 *  - the float below which a shop cannot scan. It IS the price of one parcel — a second figure that has to be kept
 *    equal to the first is a figure somebody will forget (a price of 160 beside a lock of 1.60 lets a shop start a
 *    parcel it cannot pay for);
 *  - the trade-credit line, which is a number of PARCELS (TRADE_CREDIT_PARCELS) and so follows the price by itself.
 */
export { AMOUNT_KEYS, isAmountKey, type AmountKey };
export type Amounts = Record<AmountKey, number>;

/** What a company starts from: today's figures. */
export const DEFAULT_AMOUNTS: Amounts = {
  wholesale: WHOLESALE,
  labourFee: LABOUR_FEE,
  handoverFee: HANDOVER_FEE,
  shelvingFee: SHELVING_FEE,
  releaseFee: RELEASE_FEE,
  toteLoadFee: TOTE_LOAD_FEE,
  mdpSortFee: MDP_SORT_FEE,
  holdingFeePerDay: HOLDING_FEE_PER_DAY,
  freightPerKm: DEFAULT_PRICE_PER_KM,
  freightBaseFee: VEHICLE_SPEC.truck.defaultBaseFee,
};

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** A company's list: its own figure where it has set one, the starting figure where it has not. A rate per kilometre
 *  keeps a third decimal, as a vehicle's own does: in a money whose unit is large, a kilometre costs less than a cent. */
export function resolveAmounts(own?: Partial<Record<string, number>>): Amounts {
  const out = { ...DEFAULT_AMOUNTS };
  for (const key of AMOUNT_KEYS) {
    const set = own?.[key];
    if (typeof set === 'number' && Number.isFinite(set) && set >= 0) out[key] = key === 'freightPerKm' ? Math.round(set * 1000) / 1000 : round2(set);
  }
  return out;
}

/** The float a shop needs to take the next parcel in: the price of one. */
export function lockThresholdOf(amounts: Pick<Amounts, 'wholesale'>): number {
  return amounts.wholesale;
}

/** How far a shop may go on credit: a number of parcels, at this company's price. */
export function creditLimitOf(amounts: Pick<Amounts, 'wholesale'>): number {
  return round2(TRADE_CREDIT_PARCELS * amounts.wholesale);
}

/** A change to a list, as one readable line for the record: only the figures named. */
export function amountsLine(amounts: Partial<Record<AmountKey, number | undefined>>, keys: AmountKey[], currency?: string): string {
  const words: Record<AmountKey, string> = {
    wholesale: 'parcel price',
    labourFee: 'take-in pay',
    handoverFee: 'hand-over pay',
    shelvingFee: 'shelving pay',
    releaseFee: 'release pay',
    toteLoadFee: 'bag-loading pay',
    mdpSortFee: 'sorting pay',
    holdingFeePerDay: 'holding per day',
    freightPerKm: 'freight per km',
    freightBaseFee: 'truck loading fee',
  };
  const said = keys.map((k) => `${words[k]} ${amounts[k] ?? '—'}`).join(', ');
  return currency ? `${said} (${currency})` : said;
}
