import type { Translate } from '../../shared/i18n';
import { LEGAL_FORM_LABEL, expiryTone, readinessCounts, documentBlocker, type CompanyRecord, type CompanyRecordView, type ExpiringItem, type ListSection } from './company';
import { CAPABILITY_LABEL, countryNameOf, type CatalogueCountry, type PresenceProposalRow, type PresenceRow } from './presence';
import { amountsFormOf, amountsInForce, counterParcelMath, type EntityPricing, type EntityRow } from './money';
import type { MarketDay, PriceVsStack, TimeToClaim } from './market';
import type { EntityAdminRow, RateImpactView } from './useTowerApp';

/**
 * WHAT EACH FOLDED SECTION SAYS WHILE IT IS SHUT, AND WHETHER IT OPENS ITSELF.
 *
 * The long configuration screens — a company's record, the market, the rates, where we operate, the companies — fold
 * each section into its headline (ConsoleFold). The headline's second line is the section's STATE, derived here per
 * section: a fact that changes, so somebody can decide without opening it whether there is anything in it for them.
 * And a section opens itself only when something in it is waiting on the reader — an item of the switch-on checklist
 * still to do, a paper running out or waiting for a second person, a warning. Everything else arrives shut.
 *
 * Queues and Papers are not folded anywhere: they are work waiting on a person, and folding work hides it.
 */
export interface Fold {
  hint: string;
  open: boolean;
}

/* -------------------------------------------------------- a company's record -- */

/** The parts of a company's record, each a fold. */
export type RecordPart = 'legal' | 'addresses' | ListSection | 'obligations' | 'documents';

/**
 * WHERE AN ITEM OF THE SWITCH-ON CHECKLIST IS PUT RIGHT. The checklist is the server's (company-readiness.service);
 * its keys name what each item is about. A licence, a policy or a country's registration that is on record but not yet
 * met is missing its verified PAPER, unless the licence itself has lapsed or the registration has no number — so the
 * fold that opens is the one where the missing thing is entered. An item this screen has no part for opens none.
 */
export function partOfItem(key: string, record: CompanyRecord, today: string): RecordPart | null {
  if (key === 'legal_name' || key === 'legal_form' || key === 'registration_number') return 'legal';
  if (key === 'registered_address') return 'addresses';
  if (key === 'signing_authority') return 'representatives';
  if (key === 'beneficial_owners') return 'beneficialOwners';
  if (key === 'tax_registration') return 'taxRegistrations';
  if (key === 'bank_account') return 'bankAccounts';
  if (key.startsWith('doc:')) return 'documents';
  const [kind, ...rest] = key.split(':');
  const ref = rest.join(':');
  if (kind === 'licence') {
    const licence = record.licences.find((l) => l.number === ref);
    return !licence || licence.expiresAt < today ? 'licences' : 'documents';
  }
  if (kind === 'insurance') {
    const policy = record.insurance.find((p) => p.policyNumber === ref);
    return !policy || policy.expiresAt < today ? 'insurance' : 'documents';
  }
  if (kind === 'obligation') return record.obligations.some((o) => o.key === ref && o.reference) ? 'documents' : 'obligations';
  return null;
}

/** The parts with something on the switch-on checklist still to do. Once a company is on, the checklist is not asked again. */
export function partsStillToDo(view: Pick<CompanyRecordView, 'keeper' | 'readiness' | 'record'>, today: string): Set<RecordPart> {
  if (view.keeper === 'company' || !view.readiness || view.readiness.ready) return new Set();
  const parts = view.readiness.items.filter((i) => !i.met).map((i) => partOfItem(i.key, view.record, today));
  return new Set(parts.filter((p): p is RecordPart => p !== null));
}

/** The checklist itself: how much of it is done — and it opens while anything on it is still to do. */
export function readinessFold(view: Pick<CompanyRecordView, 'keeper' | 'readiness'>, t: Translate): Fold {
  if (view.keeper === 'company') return { hint: t('tower.company.fold.keepsOwn'), open: false };
  if (view.readiness?.ready) return { hint: t('tower.company.fold.ready'), open: false };
  const { met, total } = readinessCounts(view.readiness);
  return { hint: t('tower.company.fold.readyCount', { met, total }), open: true };
}

/** Licences and policies running out — the company's own, or every company's. Opens when one has lapsed or has two weeks left. */
export function runningOutFold(items: Array<Pick<ExpiringItem, 'lapsed' | 'daysLeft'>>, t: Translate): Fold {
  if (!items.length) return { hint: t('tower.companies.fold.nothingLapses'), open: false };
  const lapsed = items.filter((i) => i.lapsed).length;
  const coming = items.filter((i) => !i.lapsed);
  const first = coming.length ? Math.max(0, Math.min(...coming.map((i) => i.daysLeft))) : 0;
  const parts = [lapsed ? t('tower.companies.fold.lapsed', { n: lapsed }) : '', coming.length ? t('tower.companies.fold.runningOut', { n: coming.length, days: first }) : ''];
  return { hint: parts.filter(Boolean).join(' · '), open: items.some((i) => expiryTone(i) !== 'quiet') };
}

/** Legal: the name, the form and the number — what a reader would check it against. */
export function legalHint(record: CompanyRecord, t: Translate): string {
  const form = record.legalForm && record.legalForm in LEGAL_FORM_LABEL ? t(LEGAL_FORM_LABEL[record.legalForm as keyof typeof LEGAL_FORM_LABEL]) : '';
  const parts = [record.legalName || record.tradingName || '', form, record.registrationNumber ?? ''].filter((p) => p.trim());
  return parts.length ? parts.join(' · ') : t('tower.company.fold.nothing');
}

/** Addresses: in which town it is registered, and where it operates if that is somewhere else. */
export function addressesHint(record: CompanyRecord, t: Translate): string {
  const registered = record.registeredAddress?.city?.trim();
  const operating = record.operatingAddress?.city?.trim();
  if (registered && operating) return operating === registered ? t('tower.company.fold.addrSame', { city: registered }) : t('tower.company.fold.addrBoth', { registered, operating });
  if (registered) return t('tower.company.fold.addrRegistered', { city: registered });
  if (operating) return t('tower.company.fold.addrOperating', { city: operating });
  return t('tower.company.fold.addrNone');
}

/** One of the record's lists: how many, in its own words — and what is wrong with them where something is. */
export function listHint(section: ListSection, record: CompanyRecord, today: string, t: Translate): string {
  switch (section) {
    case 'representatives': {
      const n = record.representatives.length;
      return n ? t('tower.company.fold.sign', { n, s: record.representatives.filter((r) => r.signing !== 'none').length }) : t('tower.company.fold.signNone');
    }
    case 'beneficialOwners':
      return record.beneficialOwners.length ? t('tower.company.fold.owners', { n: record.beneficialOwners.length }) : t('tower.company.fold.ownersNone');
    case 'taxRegistrations':
      return record.taxRegistrations.length ? t('tower.company.fold.tax', { n: record.taxRegistrations.length }) : t('tower.company.fold.taxNone');
    case 'bankAccounts': {
      const n = record.bankAccounts.length;
      const currencies = [...new Set(record.bankAccounts.map((b) => b.currency).filter(Boolean))].join(', ');
      return n ? t('tower.company.fold.bank', { n, currencies }) : t('tower.company.fold.bankNone');
    }
    case 'licences':
    case 'insurance': {
      const items: Array<{ expiresAt: string }> = record[section];
      if (!items.length) return t(section === 'licences' ? 'tower.company.fold.licencesNone' : 'tower.company.fold.insuranceNone');
      const lapsed = items.filter((i) => i.expiresAt < today).length;
      const count = t(section === 'licences' ? 'tower.company.fold.licences' : 'tower.company.fold.insurance', { n: items.length });
      return lapsed ? `${count} · ${t('tower.company.fold.lapsedOf', { n: lapsed })}` : count;
    }
  }
}

/** What the country requires: how many of its registrations have a number. */
export function obligationsHint(view: Pick<CompanyRecordView, 'obligations' | 'record'>, t: Translate): string {
  const total = view.obligations.length;
  if (!total) return t('tower.company.fold.obligationsNone');
  const done = view.obligations.filter((o) => view.record.obligations.some((r) => r.key === o.key && r.reference?.trim())).length;
  return t('tower.company.fold.obligations', { done, total });
}

/**
 * THE PAPERS — and the one part of the record that holds work. A paper waiting for a second person is staff's to
 * verify (never the person who put it on record), and a paper somebody reported is the company's to answer: either
 * opens the fold for whoever it waits on, and so does a paper the switch-on checklist still needs.
 */
export function documentsFold(
  view: Pick<CompanyRecordView, 'documents' | 'reports'>,
  reader: { company: boolean; canVerify: boolean; who?: string; named?: boolean },
  toDo: Set<RecordPart>,
  t: Translate,
): Fold {
  const current = view.documents.filter((d) => d.status !== 'superseded');
  const awaiting = view.documents.filter((d) => d.status === 'awaiting_verification');
  const mine = reader.canVerify ? awaiting.filter((d) => documentBlocker(d, reader.who, reader.named) === null).length : 0;
  const reported = (view.reports ?? []).filter((c) => c.state === 'open');
  const unanswered = reported.filter((c) => !c.answer).length;
  const parts = [
    current.length ? t('tower.company.fold.papers', { n: current.length }) : t('tower.company.fold.nothing'),
    awaiting.length ? t('tower.company.fold.awaiting', { n: awaiting.length }) : '',
    reported.length ? t('tower.company.fold.reported', { n: reported.length }) : '',
  ];
  return { hint: parts.filter(Boolean).join(' · '), open: mine > 0 || (reader.company && unanswered > 0) || toDo.has('documents') };
}

/** What a lapsed paper switched off: the capabilities, by name. A fact still standing, so it always arrives open. */
export function lapsesFold(view: Pick<CompanyRecordView, 'lapses'>, t: Translate): Fold {
  const caps = [...new Set(view.lapses.map((l) => l.capability))].map((c) => t(CAPABILITY_LABEL[c]));
  return { hint: caps.length ? t('tower.company.fold.switchedOff', { list: caps.join(', ') }) : '', open: view.lapses.length > 0 };
}

/** A history: how long it is, and when it last moved. */
export function changesHint(changes: Array<{ at: string }>, when: (iso: string) => string, t: Translate): string {
  if (!changes.length) return t('tower.changes.fold.none');
  const last = changes.reduce((a, b) => (b.at > a.at ? b : a));
  return t('tower.changes.foldCount', { n: changes.length, when: when(last.at) });
}

/* --------------------------------------------------------------- the companies -- */

/** Create a company: how many drafts are already waiting to be switched on. */
export function createCompanyHint(entities: Array<Pick<EntityRow, 'kind' | 'status'>>, t: Translate): string {
  const drafts = entities.filter((e) => e.kind !== 'group' && e.status === 'draft').length;
  return drafts ? t('tower.companies.fold.drafts', { n: drafts }) : t('tower.companies.fold.noDrafts');
}

/* ------------------------------------------------------------------- the rates -- */

/**
 * What a parcel costs and what each step pays: how many of the figures this company set itself — and it opens when
 * the figures in force pay out more for a parcel than the parcel brings in, the one thing on it that is a warning.
 */
export function amountsFold(pricing: Pick<EntityPricing, 'amounts'>, t: Translate): Fold {
  const own = pricing.amounts.filter((r) => r.own).length;
  const { over } = counterParcelMath(amountsInForce(amountsFormOf(pricing), pricing));
  return { hint: own ? t('tower.amounts.ownCount', { n: own, of: pricing.amounts.length }) : t('tower.amounts.noneOwn'), open: over };
}

/** The top-up fee as it is charged today, read off the record. */
export function topUpFeeHint(pricing: Pick<EntityPricing, 'topUpFee' | 'currency'>, t: Translate): string {
  const fee = pricing.topUpFee;
  if (!fee) return t('tower.topupfee.fold.none');
  const money = (n: number) => `${n.toLocaleString()} ${pricing.currency ?? ''}`.trim();
  return t('tower.topupfee.fold.on', { charge: money(fee.amount), freeAbove: money(fee.freeAbove) });
}

/** Who can sign in for the company. */
export function adminsHint(rows: EntityAdminRow[] | null, t: Translate): string {
  if (rows === null) return t('tower.admins.loading');
  return rows.length ? t('tower.admins.fold.some', { n: rows.length }) : t('tower.admins.fold.none');
}

/** What each rate did: how many spells there are to compare. */
export function impactHint(impact: Pick<RateImpactView, 'spells'>, t: Translate): string {
  return impact.spells.length ? t('tower.impact.fold', { n: impact.spells.length }) : t('tower.impact.emptyTitle');
}

/* ------------------------------------------------------------------ the market -- */

/** How long loads wait — opens when the server says waits are lengthening. */
export function waitFold(wait: TimeToClaim | undefined, t: Translate): Fold {
  if (wait?.medianHours == null) return { hint: t('tower.market.fold.waitNone'), open: false };
  return { hint: t('tower.market.waitNow', { hours: wait.medianHours }), open: wait.stretching };
}

/** What agreed prices cleared at — withheld on a thin sample, as the section itself withholds it. */
export function priceHint(price: PriceVsStack | undefined, over: number | null, t: Translate): string {
  if (price == null || price.medianRatio == null) return t('tower.market.fold.priceNone');
  if (over == null) return t('tower.market.fold.priceThin', { n: price.loads });
  return t('tower.market.priceRatio', { pct: over });
}

/** Posted against taken: the last seven days, in two numbers. */
export function daysHint(days: Array<Pick<MarketDay, 'postedLoads' | 'claimedLoads'>>, t: Translate): string {
  const week = days.slice(-7);
  const posted = week.reduce((sum, d) => sum + d.postedLoads, 0);
  const taken = week.reduce((sum, d) => sum + d.claimedLoads, 0);
  return posted || taken ? t('tower.market.fold.days', { posted, taken }) : t('tower.market.fold.daysNone');
}

/* ------------------------------------------------------------ where we operate -- */

/** Switch a country on: how many countries are not on the map — and it opens while a country is chosen in its form. */
export function newCountryFold(form: { jurisdiction: string }, rows: Array<Pick<PresenceRow, 'jurisdiction'>>, catalogue: Array<Pick<CatalogueCountry, 'code'>>, t: Translate): Fold {
  const listed = new Set(rows.map((r) => r.jurisdiction));
  const notListed = catalogue.filter((c) => !listed.has(c.code)).length;
  return { hint: catalogue.length ? t('tower.presence.fold.notListed', { n: notListed }) : '', open: Boolean(form.jurisdiction) };
}

/** Recently decided: the latest decision, said as the row under it says it. */
export function decidedHint(decided: PresenceProposalRow[], catalogue: CatalogueCountry[] | null, t: Translate): string {
  if (!decided.length) return '';
  const latest = decided.reduce((a, b) => ((b.decidedAt ?? b.expiresAt) > (a.decidedAt ?? a.expiresAt) ? b : a));
  const outcome =
    latest.status === 'approved'
      ? t('tower.presence.status.approved', { who: latest.decidedBy ?? '' })
      : latest.status === 'declined'
        ? t('tower.presence.status.declined', { who: latest.decidedBy ?? '', reason: latest.reason ?? '' })
        : t('tower.presence.status.expired');
  return t('tower.presence.fold.latest', { country: countryNameOf(latest.jurisdiction, catalogue), outcome });
}
