import { useT } from '../i18n';
import { cash } from '../money';
import { topUpCost, type TopUpTerms } from '../topup-fee';

/**
 * WHAT THIS TOP-UP WILL COST, ON THE SHEET, BEFORE ANYBODY PAYS.
 *
 * Shared by the shop and the store because it is one rule and one sentence; only the name of the thing
 * that goes up differs — a shop calls it a float, a store calls it a balance — so that one label is
 * passed in and everything else is the same words in both apps.
 *
 * FOUR STATES, AND THE FIRST ONE IS THE MOST IMPORTANT.
 *
 * No rule: NOTHING IS RENDERED. Where no fee was ever decided there is nothing to disclose, and a line
 * announcing that topping up is free would invent a charge in the reader's mind in order to waive it.
 *
 * A rule but no amount yet: the standing terms, so a shopkeeper deciding how much to put in can see the
 * threshold while they decide, which is the only moment the threshold can change what they do.
 *
 * Below the threshold: the charge, and WHAT ACTUALLY LANDS. The gross is credited and the fee posted as
 * its own line, so "500 in, 20 charged" is two facts they can check against the register afterwards —
 * but the sum of them is what they came here for, and leaving them to do it is how a fee starts feeling
 * like a deduction. Then what would have made it free, because the fee exists to make the cheaper
 * behaviour visible, and a threshold nobody is shown cannot do that.
 *
 * At or above it: one line saying it costs nothing. Short on purpose — free is not news that needs a
 * table.
 */
export function TopUpCostNote({ terms, amount, risesBy }: { terms: TopUpTerms | null | undefined; amount: number; risesBy: string }) {
  const t = useT();
  if (!terms) return null;

  // In the money the terms are set in: the company's that holds this float.
  const n = (v: number) => cash(v, terms.currency);
  const cost = topUpCost(terms, amount);

  if (!cost) return <p class="hint">{t('common.topUpFee.terms', { charge: n(terms.charge), freeAbove: n(terms.freeAbove) })}</p>;
  if (cost.free) return <p class="hint">{t('common.topUpFee.free', { freeAbove: n(terms.freeAbove) })}</p>;

  return (
    <div class="topupcost">
      {/* Quiet, because it is a breakdown of the amount typed directly above rather than a second thing
          being charged. The figure that is not a breakdown of anything is the one below it. */}
      <div class="kv kv--quiet">
        <span>{t('common.topUpFee.charged')}</span>
        <b>{n(cost.fee)}</b>
      </div>
      <div class="kv">
        <span>{risesBy}</span>
        <b>{n(cost.lands)}</b>
      </div>
      <p class="hint">{t('common.topUpFee.nudge', { more: n(cost.shortBy), freeAbove: n(terms.freeAbove) })}</p>
    </div>
  );
}
