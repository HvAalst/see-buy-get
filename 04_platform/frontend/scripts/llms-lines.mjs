/**
 * 2026-11-18 — A TOWN IN llms.txt, WITH WHAT IT COSTS FROM THERE (the owner: example prices per country, "yes"): the town's
 * page, then a small parcel's lowest price within the town and to its busiest towns, as the page itself shows them.
 */
const money = (amount, currency) => {
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency, ...(Number.isInteger(amount) ? { maximumFractionDigits: 0 } : {}) }).format(amount).replace(/ /g, ' ');
  } catch {
    return `${currency} ${amount}`;
  }
};

/** `- [Nairobi](…/towns/nairobi/): a small parcel within Nairobi from KES 150, to Mombasa from KES 300, …` — or just the link. */
export function townLine(name, url, prices, most = 4) {
  const link = `- [${name}](${url})`;
  const rows = (prices?.to ?? []).filter((r) => typeof r.from?.S === 'number').slice(0, most);
  if (!rows.length || !prices.currency) return link;
  const parts = rows.map((r) => `${r.slug === prices.slug ? `within ${name}` : `to ${r.town}`} from ${money(r.from.S, prices.currency)}`);
  return `${link}: a small parcel ${parts.join(', ')}`;
}
