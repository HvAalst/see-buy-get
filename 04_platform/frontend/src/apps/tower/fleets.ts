import type { Translate } from '../../shared/i18n';

/**
 * A FLEET IS SET UP BY STAFF — the console's side of it.
 *
 * A shop, a courier and a hub sign themselves up; a fleet does not. It is registered here, its papers are put on
 * record here, somebody ELSE approves them, its bond is recorded, and only then is it active and has the code its
 * office signs in with. Until this screen there was nowhere to do any of it: the server took all four steps, the
 * seeder made them for the demo fleet, and a live server could have had no fleet at all.
 *
 * Pure decisions only — what the next step is and whose, what a form is still missing — so that they can be tested
 * without a screen.
 */

export type FleetStatus = 'DRAFT' | 'KYC_PENDING' | 'APPROVED' | 'ACTIVE' | 'SUSPENDED';

/** The four papers, in the order they are asked for, each with the kind of picture it is kept as. */
export const FLEET_PAPERS = [
  ['businessRegCertRef', 'kyc_registration'],
  ['operatorLicenceRef', 'kyc_licence'],
  ['ownerIdRef', 'kyc_id'],
  ['proofOfAddressRef', 'kyc_address'],
] as const;
export type FleetPaperKey = (typeof FLEET_PAPERS)[number][0];

export interface FleetSetupRow {
  did: string;
  companyName: string;
  tradingName?: string;
  status: FleetStatus;
  jurisdiction?: string;
  contactPhone: string;
  depotAddress?: string;
  requirements: { businessRegistrationNo: string; transportOperatorLicence: string; taxId: string };
  createdAt: string;
  /** Its papers, once on record — and whether THIS reader put them there. */
  papers?: Record<FleetPaperKey, string> & { submittedAt: string; enteredBy?: string; enteredByMe: boolean };
  /** Why its papers were last sent back. */
  refused?: { reason: string; at: string; by?: string };
  /** The code its office signs in with, once it is active. */
  loginCode?: string;
}

/**
 * WHAT IS NEXT FOR A FLEET, AND WHOSE IT IS.
 *
 * `colleague` is the one that matters: the member of staff who put the papers on record is shown that somebody else
 * approves them, and no button — a button the server will refuse is a way of finding the rule out by being told off.
 */
export type FleetStep = 'papers' | 'approve' | 'colleague' | 'bond' | 'active' | 'suspended';
export function fleetStep(row: Pick<FleetSetupRow, 'status' | 'papers'>): FleetStep {
  if (row.status === 'DRAFT') return 'papers';
  if (row.status === 'KYC_PENDING') return row.papers?.enteredByMe ? 'colleague' : 'approve';
  if (row.status === 'APPROVED') return 'bond';
  if (row.status === 'ACTIVE') return 'active';
  return 'suspended';
}

/** The pictures on record, in the order they were asked for. */
export function papersOf(row: Pick<FleetSetupRow, 'papers'>): string[] {
  return row.papers ? FLEET_PAPERS.map(([key]) => row.papers![key]).filter(Boolean) : [];
}

/** How many fleets are waiting on THIS reader: papers to put on record, a colleague's to look at, a bond to record. */
export function fleetsWaitingOnMe(rows: FleetSetupRow[] | null): number | null {
  if (rows === null) return null;
  return rows.filter((r) => ['papers', 'approve', 'bond'].includes(fleetStep(r))).length;
}

/**
 * THE NUMBER BESIDE THE SCREEN: everything on it that waits on this reader.
 *
 * It used to be the shops alone, from when the screen held nothing else. A fleet whose papers a colleague put on
 * record waits on exactly one kind of person — anybody but that colleague — and a screen that does not count it is
 * a fleet that sits until somebody happens to look. Null only while NONE of the three has been read: a zero says
 * "you are up to date", which is another claim than "we have not looked yet".
 */
export function joiningWaiting(shops: unknown[] | null, drivers: unknown[] | null, fleets: FleetSetupRow[] | null, hubs: unknown[] | null): number | null {
  if (shops === null && drivers === null && fleets === null && hubs === null) return null;
  return (shops?.length ?? 0) + (drivers?.length ?? 0) + (fleetsWaitingOnMe(fleets) ?? 0) + (hubs?.length ?? 0);
}

/* ------------------------------------------------------------------ the form -- */

export interface FleetForm {
  companyName: string;
  jurisdiction: string;
  contactPhone: string;
  ownerFullName: string;
  ownerNationalId: string;
  depotAddress: string;
  businessRegistrationNo: string;
  transportOperatorLicence: string;
  taxId: string;
}
export const EMPTY_FLEET_FORM: FleetForm = { companyName: '', jurisdiction: '', contactPhone: '', ownerFullName: '', ownerNationalId: '', depotAddress: '', businessRegistrationNo: '', transportOperatorLicence: '', taxId: '' };

/** The first thing the form still needs, in the order it is laid out — or null when it can be sent. */
export function fleetFormBlocker(form: FleetForm): keyof FleetForm | null {
  const order: Array<keyof FleetForm> = ['companyName', 'jurisdiction', 'contactPhone', 'ownerFullName', 'ownerNationalId', 'depotAddress', 'businessRegistrationNo', 'transportOperatorLicence', 'taxId'];
  return order.find((key) => !form[key].trim()) ?? null;
}

/** What the server is sent. The owner's name and ID go to the vault there; nothing here keeps them. */
export function fleetBody(form: FleetForm) {
  return {
    companyName: form.companyName.trim(),
    jurisdiction: form.jurisdiction.trim().toUpperCase(),
    contactPhone: form.contactPhone.replace(/\s+/g, ''),
    ownerFullName: form.ownerFullName.trim(),
    ownerNationalId: form.ownerNationalId.trim(),
    depotAddress: form.depotAddress.trim(),
    requirements: { businessRegistrationNo: form.businessRegistrationNo.trim(), transportOperatorLicence: form.transportOperatorLicence.trim(), taxId: form.taxId.trim() },
  };
}

/**
 * The countries a fleet can be registered in: the ones the network is switched on in. Read off the catalogue the
 * console already holds, never typed — the server refuses a country that is not switched on, and a list that offers
 * one is a form that can only be found wrong by sending it.
 */
export function fleetCountries(catalogue: Array<{ code: string; name: string; level: string }> | null): Array<{ code: string; name: string }> {
  return (catalogue ?? []).filter((c) => c.level !== 'observed').map((c) => ({ code: c.code, name: c.name }));
}

/** Round 11 — a fleet's own system, counted for staff. They read it; they send nothing in the fleet's name. */
export interface FleetSystemCounts {
  hasAddress: boolean;
  delivered: number;
  waiting: number;
  givenUp: number;
  /** Whether it sends where its vehicles are. */
  positions: boolean;
  /** Round 12 — its keys that work, by mode. */
  keys?: { live: number; test: number };
}

/** "No system set up", or what became of its messages — whether it is sent where its vehicles are — and its keys. */
export function fleetSystemWords(s: FleetSystemCounts, t: Translate): string {
  const keys = s.keys && s.keys.live + s.keys.test > 0 ? ` ${t('tower.keys.counts', { live: s.keys.live, test: s.keys.test })}` : '';
  if (!s.hasAddress) return t('tower.network.fleets.systemNone') + keys;
  const counts = t('tower.network.fleets.systemCounts', { delivered: s.delivered, waiting: s.waiting, givenUp: s.givenUp });
  return (s.positions ? `${counts} ${t('tower.network.fleets.systemPositions')}` : counts) + keys;
}
