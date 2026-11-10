import { createHash } from 'crypto';
import { Injectable, Optional } from '@nestjs/common';
import { catalogueEntry } from '../../foundation/countries/catalogue';
import { GlosError } from '../../foundation/http/glos-error';
import { qrSvgGroup } from '../../foundation/label/qr';
import { LedgerService } from '../../foundation/ledger/ledger.service';
import { appUrl } from '../../foundation/mail/mail.templates';
import { PersistentMap } from '../../foundation/store/persistent-map';
import {
  MANIFEST_HS_DIGITS,
  MANIFEST_PAIRS,
  MANIFEST_POST,
  REFERENCE_NAMES,
  TRADER_TAX_NUMBER,
  type BorderManifestStatus,
  type ManifestDocument,
  type ManifestGap,
  type ManifestPair,
  type ManifestReferences,
  type ManifestVersionRow,
} from './border-manifest.types';
import { CommercialInvoiceService } from './commercial-invoice.service';
import type { Freight } from './dispatch.types';
import { canonicalJson, type ProofAnswer } from './note-archive.types';

/** The vehicle and the driver who take the goods over, as the manifest prints them. */
export interface ManifestCarrier {
  vehicle?: { plate: string; vehicleClass: string; registrationCountry?: string; trailerPlate?: string; yellowCard?: { number: string; expiresAt?: string } };
  crew?: { name: string; licenceNumber?: string; passport?: { number: string; country: string; expiresAt: string } };
}

/** What the load's own records add: its carrier, its seals, where it has been. Given by dispatch (useFacts). */
export interface ManifestFacts {
  carrier?: ManifestCarrier;
  seals: string[];
  events: Array<{ at: string; words: string }>;
}

interface StoredVersion {
  seq: number;
  at: string;
  reason: string;
  fingerprint: string;
  doc: ManifestDocument;
}

const DAY_MS = 86_400_000;
const lapsed = (date: string | undefined, now: number) => !date || Date.parse(`${date.slice(0, 10)}T23:59:59Z`) < now;
const countryName = (code: string | undefined) => (code ? (catalogueEntry(code)?.name ?? code) : '');

/** The number a manifest is known by: the load's own code. */
export const manifestNumber = (f: Pick<Freight, 'code'>) => `MAN-${f.code}`;

export function manifestFingerprint(doc: ManifestDocument): string {
  return createHash('sha256').update(canonicalJson(doc)).digest('hex');
}

@Injectable()
export class BorderManifestService {
  private readonly refs = new PersistentMap<string, ManifestReferences>('pudo-manifest-refs');
  private readonly versions = new PersistentMap<string, StoredVersion[]>('pudo-manifest-versions');
  private readonly proofs = new PersistentMap<string, { freightId: string; number: string; seq: number; at: string; reason: string }>('pudo-manifest-proofs');
  private facts?: (freightId: string) => { freight: Freight; facts: ManifestFacts } | undefined;

  constructor(
    private readonly invoices: CommercialInvoiceService,
    @Optional() private readonly ledger?: LedgerService,
  ) {}

  /** Dispatch says how to read a load's carrier, seals and steps (it builds this service's facts; this never reaches back). */
  useFacts(read: (freightId: string) => { freight: Freight; facts: ManifestFacts } | undefined): void {
    this.facts = read;
  }

  /** Kenya → Ethiopia or Ethiopia → Kenya; nothing for any other load. */
  pairOf(f: Pick<Freight, 'pickupCountry' | 'destCountry'>): ManifestPair | undefined {
    const key = `${(f.pickupCountry ?? '').toUpperCase()}>${(f.destCountry ?? '').toUpperCase()}`;
    return (MANIFEST_PAIRS as readonly string[]).includes(key) ? (key as ManifestPair) : undefined;
  }

  referencesOf(freightId: string): ManifestReferences {
    return this.refs.get(freightId) ?? {};
  }

  /**
   * WHAT THE MANIFEST STILL LACKS, and whose it is to give. The shipper's: its invoice written here (its lines are the
   * goods), both parties' tax numbers as their countries write them, every HS code to eight digits, the export side's
   * number — and, from Kenya, the eTIMS invoice number its export entry carries; the import side's number may follow
   * until the post. The carrier's, once one is known: where the vehicle is registered, its COMESA Yellow Card in date,
   * and the driver's passport in date.
   */
  gaps(f: Freight, carrier?: ManifestCarrier, now: number = Date.now()): ManifestGap[] {
    const pair = this.pairOf(f);
    if (!pair) return [];
    const out: ManifestGap[] = [];
    const add = (key: string, who: 'shipper' | 'carrier', words: string, blocking = true) => out.push({ key, who, blocking, words });
    const invoice = this.invoices.current(f.freightId);
    if (!invoice) {
      add('invoice', 'shipper', 'Its commercial invoice, written and signed here: its lines are the goods on the manifest (a paper invoice of your own is not enough at Moyale)');
    } else {
      for (const [side, party] of [['consignor', invoice.exporter], ['consignee', invoice.importer]] as const) {
        const rule = TRADER_TAX_NUMBER[party.country?.toUpperCase()];
        const who = side === 'consignor' ? 'sender' : 'receiver';
        if (!rule) add(`${side}_country`, 'shipper', `The ${who}’s country on the invoice: Kenya or Ethiopia`);
        else if (!party.taxNo || !rule.pattern.test(party.taxNo.replace(/\s/g, '').toUpperCase())) add(`${side}_tax`, 'shipper', `The ${who}’s ${rule.name} on the invoice, written as ${rule.example}`);
      }
      const short = invoice.lines.filter((l) => l.hsCode.replace(/\D/g, '').length < MANIFEST_HS_DIGITS).length;
      if (short) add('hs_codes', 'shipper', `Every line’s HS code to ${MANIFEST_HS_DIGITS} digits, as both tariffs classify: ${short} line${short === 1 ? ' has' : 's have'} fewer`);
    }
    const refs = this.referencesOf(f.freightId);
    const names = REFERENCE_NAMES[pair];
    if (!refs.exportEntry) add('export_entry', 'shipper', `The ${names.exportEntry} number, from you or your clearing agent`);
    if (pair === 'KE>ET' && !refs.etimsInvoice) add('etims_invoice', 'shipper', 'The eTIMS invoice number your Kenyan export entry carries (the zero-rated invoice for these goods)');
    if (!refs.importDeclaration) add('import_declaration', 'shipper', `The ${names.importDeclaration} number, once it is lodged — before the goods reach the post`, false);
    if (carrier) {
      const v = carrier.vehicle;
      if (!v) add('vehicle', 'carrier', 'The vehicle taking the goods over: the driver starts a shift on it');
      else {
        if (!v.registrationCountry) add('vehicle_country', 'carrier', `Where vehicle ${v.plate} is registered, in its papers`);
        if (!v.yellowCard?.number) add('yellow_card', 'carrier', `Vehicle ${v.plate}’s COMESA Yellow Card, its number and expiry, in its papers`);
        else if (lapsed(v.yellowCard.expiresAt, now)) add('yellow_card', 'carrier', `Vehicle ${v.plate}’s COMESA Yellow Card has run out: its renewed number and expiry, in its papers`);
      }
      const c = carrier.crew;
      if (!c?.passport) add('passport', 'carrier', `${c?.name ?? 'The driver'}’s passport, recorded by their fleet office or the network`);
      else if (lapsed(c.passport.expiresAt, now)) add('passport', 'carrier', `${c.name}’s passport has run out: the new one, recorded by their fleet office or the network`);
    }
    return out;
  }

  /** The pickup gate: every gap that holds the goods, in one sentence — or nothing. Asked before anything is written. */
  pickupRefusal(f: Freight, carrier: ManifestCarrier, now: number = Date.now()): string | undefined {
    const holding = this.gaps(f, carrier, now).filter((g) => g.blocking);
    if (!holding.length) return undefined;
    return `This load crosses at Moyale between ${countryName(f.pickupCountry)} and ${countryName(f.destCountry)}, and its border manifest is not complete: ${holding.map((g) => g.words).join('; ')}. The goods are not taken over until it is.`;
  }

  status(f: Freight, opts: { mayWrite: boolean; withheld?: boolean; now?: number }): BorderManifestStatus {
    const pair = this.pairOf(f);
    if (!pair) return { required: false, complete: true, missing: [], versions: 0, mayWrite: false };
    const facts = this.facts?.(f.freightId)?.facts;
    const missing = this.gaps(f, facts?.carrier, opts.now ?? Date.now());
    const complete = !missing.some((g) => g.blocking);
    const versions = this.versions.get(f.freightId) ?? [];
    if (opts.withheld) return { required: true, pair, post: MANIFEST_POST, complete, missing: [], versions: versions.length, mayWrite: false, withheld: true };
    return {
      required: true,
      pair,
      post: MANIFEST_POST,
      complete,
      missing,
      references: this.referencesOf(f.freightId),
      referenceNames: REFERENCE_NAMES[pair],
      versions: versions.length,
      ...(versions.length ? { fingerprint: versions[versions.length - 1].fingerprint } : {}),
      mayWrite: opts.mayWrite,
    };
  }

  /**
   * The shipper or its clearing agent gives the numbers its customs systems issued. Given after the goods were taken over,
   * a new copy is frozen with them; the copies before stay as they were.
   */
  setReferences(f: Freight, by: string, input: { exportEntry?: string; importDeclaration?: string; etimsInvoice?: string }, now: number = Date.now()): ManifestReferences {
    const pair = this.pairOf(f);
    if (!pair) throw new GlosError('NOT_IN_THIS_COUNTRY', 'Only a load between Kenya and Ethiopia has a border manifest');
    if (f.status === 'delivered' || f.status === 'cancelled') throw new GlosError('INVALID_STATE', `Load ${f.code} is ${f.status}: its manifest is closed`);
    if (input.etimsInvoice?.trim() && pair !== 'KE>ET') throw new GlosError('INVALID_INPUT', 'An eTIMS invoice number is for goods leaving Kenya', { field: 'etimsInvoice' });
    const at = new Date(now).toISOString();
    const next: ManifestReferences = { ...this.referencesOf(f.freightId) };
    const changed: string[] = [];
    for (const key of ['exportEntry', 'importDeclaration', 'etimsInvoice'] as const) {
      if (input[key] === undefined) continue;
      const value = input[key]!.trim().toUpperCase();
      if ((next[key]?.number ?? '') === value) continue;
      if (value) next[key] = { number: value, by, at };
      else delete next[key];
      changed.push(key);
    }
    this.refs.set(f.freightId, next);
    if (changed.length && f.pickedUpAt) this.freeze(f.freightId, 'Customs numbers added by the sender', now);
    return next;
  }

  /** The manifest as it reads now, from the load's records and the shipper's invoice. */
  build(f: Freight, facts: ManifestFacts, reason: string, version: number, now: number = Date.now()): ManifestDocument {
    const pair = this.pairOf(f)!;
    const invoice = this.invoices.current(f.freightId);
    const refs = this.referencesOf(f.freightId);
    const party = (p: { name: string; address?: string; country: string; taxNo?: string } | undefined, fallback: string, country: string | undefined) => {
      const c = (p?.country ?? country ?? '').toUpperCase();
      const rule = TRADER_TAX_NUMBER[c];
      return { name: p?.name ?? fallback, ...(p?.address ? { address: p.address } : {}), country: c, ...(rule ? { taxName: rule.name } : {}), ...(p?.taxNo ? { taxNo: p.taxNo.replace(/\s/g, '').toUpperCase() } : {}) };
    };
    return {
      number: manifestNumber(f),
      version,
      pair,
      post: MANIFEST_POST,
      regime: 'commercial',
      frozenAt: new Date(now).toISOString(),
      reason,
      load: { freightId: f.freightId, code: f.code, description: f.description, ...(f.packages ? { packages: f.packages } : {}), grossKg: f.weightKg, from: f.pickupLabel, to: f.destLabel },
      consignor: party(invoice?.exporter, 'Not recorded', f.pickupCountry),
      consignee: party(invoice?.importer, f.consignee?.name ?? 'Not recorded', f.destCountry),
      goods: (invoice?.lines ?? []).map((l) => ({ description: l.description, hsCode: l.hsCode, quantity: l.quantity, netKg: l.netKg, unitValue: l.unitValue, lineValue: l.lineValue, originCountry: l.originCountry })),
      ...(invoice ? { currency: invoice.currency, totalValue: invoice.totalValue, invoice: { number: invoice.number, issuedOn: invoice.issuedOn, fingerprint: invoice.fingerprint } } : {}),
      ...(invoice?.incoterm ? { incoterm: invoice.incoterm } : {}),
      ...(invoice?.namedPlace ? { namedPlace: invoice.namedPlace } : {}),
      references: { ...(refs.exportEntry ? { exportEntry: refs.exportEntry.number } : {}), ...(refs.importDeclaration ? { importDeclaration: refs.importDeclaration.number } : {}), ...(refs.etimsInvoice ? { etimsInvoice: refs.etimsInvoice.number } : {}) },
      ...(facts.carrier?.vehicle ? { vehicle: facts.carrier.vehicle } : {}),
      ...(facts.carrier?.crew ? { crew: facts.carrier.crew } : {}),
      seals: facts.seals,
      events: facts.events,
    };
  }

  /**
   * FREEZE A COPY: at pickup, at the post, cleared, delivered, and when a number is added after pickup. Each copy is
   * fingerprinted, anchored in the chain and given a proof row, so the public check page answers for it; nothing in an
   * earlier copy is ever rewritten.
   */
  freeze(freightId: string, reason: string, now: number = Date.now()): StoredVersion | undefined {
    const read = this.facts?.(freightId);
    if (!read || !this.pairOf(read.freight)) return undefined;
    const list = this.versions.get(freightId) ?? [];
    const doc = this.build(read.freight, read.facts, reason, list.length + 1, now);
    const fingerprint = manifestFingerprint(doc);
    const version: StoredVersion = { seq: doc.version, at: doc.frozenAt, reason, fingerprint, doc };
    this.versions.set(freightId, [...list, version]);
    this.proofs.set(fingerprint, { freightId, number: doc.number, seq: doc.version, at: doc.frozenAt, reason });
    this.ledger?.anchor({ m: doc.number, v: doc.version, sha256: fingerprint });
    return version;
  }

  /** The latest frozen copy — or, before pickup, the manifest as it would read now (not frozen, so no fingerprint). */
  current(freightId: string): { doc: ManifestDocument; fingerprint?: string } | undefined {
    const list = this.versions.get(freightId) ?? [];
    if (list.length) return { doc: list[list.length - 1].doc, fingerprint: list[list.length - 1].fingerprint };
    const read = this.facts?.(freightId);
    if (!read || !this.pairOf(read.freight)) return undefined;
    return { doc: this.build(read.freight, read.facts, 'Not yet taken over: a preview, not frozen', 0) };
  }

  versionRows(freightId: string): ManifestVersionRow[] {
    return (this.versions.get(freightId) ?? []).map(({ seq, at, reason, fingerprint }) => ({ seq, at, reason, fingerprint }));
  }

  /** The public check page, for a manifest's fingerprint: which copy, when, and that it is unaltered — nothing of what it says. */
  verify(sha256: string): ProofAnswer | undefined {
    const proof = this.proofs.get(sha256.trim().toLowerCase());
    if (!proof) return undefined;
    return {
      known: true,
      number: proof.number,
      seq: proof.seq,
      at: proof.at,
      says: `This is copy ${proof.seq} of border manifest ${proof.number}, as it stood on ${proof.at.slice(0, 10)} — ${proof.reason.toLowerCase()}. It was issued by the SeeBuyGet network and has not been altered since.`,
    };
  }

  /** The manifest as a printable page: English values, each label in English and Amharic, a QR code to the check page. */
  htmlFor(doc: ManifestDocument, fingerprint?: string): string {
    return manifestPage(doc, fingerprint);
  }

  /** For tests: drop the stored copies. */
  forgetForTest(): void {
    for (const k of [...this.versions.keys()]) this.versions.delete(k);
  }
}

/* ------------------------------------------------------------------------------------------------ the page -- */

const esc = (s: string | number | undefined) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** A label in English with its Amharic beneath: the federal working language, read at the post and the checkpoints. */
const L = (en: string, am: string) => `${esc(en)}<span class="am" lang="am">${esc(am)}</span>`;

const money = (n: number | undefined, currency?: string) => (n === undefined ? '' : `${n.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${currency ? ` ${currency}` : ''}`);

export function manifestPage(d: ManifestDocument, fingerprint?: string): string {
  const check = fingerprint ? `${appUrl('home')}?note=${fingerprint}` : '';
  const qr = check ? `<svg viewBox="0 0 120 120" width="120" height="120" aria-label="Check this copy">${qrSvgGroup(check, 0, 0, 120)}</svg>` : '';
  const party = (p: ManifestDocument['consignor']) =>
    `<b>${esc(p.name)}</b>${p.address ? `<br>${esc(p.address)}` : ''}<br>${esc(countryName(p.country))}${p.taxNo ? `<br>${esc(p.taxName ?? 'Tax no.')} ${esc(p.taxNo)}` : `<br><span class="gap">${esc(p.taxName ?? 'Tax number')}: not given</span>`}`;
  const row = (label: string, value: string) => `<tr><th>${label}</th><td>${value}</td></tr>`;
  const goods = d.goods.length
    ? d.goods.map((g, i) => `<tr><td>${i + 1}</td><td>${esc(g.description)}</td><td class="n">${esc(g.hsCode)}</td><td class="n">${esc(g.quantity)}</td><td class="n">${esc(g.netKg)}</td><td class="n">${money(g.unitValue)}</td><td class="n">${money(g.lineValue)}</td><td>${esc(g.originCountry)}</td></tr>`).join('')
    : `<tr><td colspan="8" class="gap">No goods lines: the commercial invoice is not written here yet</td></tr>`;
  const v = d.vehicle;
  const c = d.crew;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(d.number)} — border manifest</title>
<style>
body{font:13px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans Ethiopic",sans-serif;color:#111;margin:16px;max-width:900px}
h1{font-size:18px;margin:0}h2{font-size:13px;margin:18px 0 6px;border-bottom:2px solid #111;padding-bottom:2px;text-transform:uppercase;letter-spacing:.03em}
.am{display:block;font-size:11px;color:#444;font-weight:normal;text-transform:none;letter-spacing:0}
table{border-collapse:collapse;width:100%}th,td{border:1px solid #999;padding:4px 6px;text-align:left;vertical-align:top}th{background:#f2f2f2;width:34%}
.goods th{width:auto}.n{text-align:right;white-space:nowrap}.gap{color:#b00020}.head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}
.fp{font:11px ui-monospace,monospace;word-break:break-all}.two{display:grid;grid-template-columns:1fr 1fr;gap:8px}.box{border:1px solid #999;padding:6px}
footer{margin-top:18px;font-size:11px;color:#444}@media print{body{margin:8mm}}
</style></head><body>
<div class="head"><div><h1>${L('Border manifest — commercial consignment', 'የድንበር ጭነት ዝርዝር — የንግድ ጭነት')}</h1>
<p><b>${esc(d.number)}</b> · ${esc(d.pair === 'KE>ET' ? 'Kenya → Ethiopia' : 'Ethiopia → Kenya')} · ${esc(d.post)}<br>${d.version ? `Copy ${d.version}, frozen ${esc(d.frozenAt.slice(0, 16).replace('T', ' '))} UTC — ${esc(d.reason)}` : `<span class="gap">${esc(d.reason)}</span>`}</p></div>${qr}</div>

<h2>${L('1. Parties', '1. ወገኖች')}</h2>
<div class="two"><div class="box"><div><b>${L('Consignor (exporter)', 'ላኪ')}</b></div>${party(d.consignor)}</div><div class="box"><div><b>${L('Consignee (importer)', 'ተቀባይ')}</b></div>${party(d.consignee)}</div></div>

<h2>${L('2. Goods', '2. ዕቃዎች')}</h2>
<table class="goods"><tr><th>#</th><th>${L('Description', 'መግለጫ')}</th><th>${L('HS code', 'የHS ኮድ')}</th><th>${L('Quantity', 'ብዛት')}</th><th>${L('Net kg', 'የተጣራ ኪግ')}</th><th>${L('Unit value', 'የአንዱ ዋጋ')}</th><th>${L('Value', 'ዋጋ')}</th><th>${L('Origin', 'የተመረተበት')}</th></tr>${goods}</table>
<table>${row(L('Load', 'ጭነት'), `${esc(d.load.code)} — ${esc(d.load.description)}`)}${row(L('Packages', 'ጥቅሎች'), esc(d.load.packages ?? 'Not stated'))}${row(L('Gross weight', 'ጠቅላላ ክብደት'), `${esc(d.load.grossKg)} kg`)}${row(L('Total value', 'ጠቅላላ ዋጋ'), d.totalValue !== undefined ? money(d.totalValue, d.currency) : '<span class="gap">Not stated</span>')}${row(L('Trade term', 'የንግድ ውል'), esc([d.incoterm, d.namedPlace].filter(Boolean).join(' ') || 'Not stated'))}${row(L('From', 'ከ'), esc(d.load.from))}${row(L('To', 'ወደ'), esc(d.load.to))}</table>

<h2>${L('3. Customs and tax', '3. ጉምሩክ እና ግብር')}</h2>
<table>${row(L(d.pair === 'KE>ET' ? 'Kenyan export entry (iCMS)' : 'Ethiopian export declaration (eCMS)', 'የወጪ ንግድ ዲክላራሲዮን'), d.references.exportEntry ? esc(d.references.exportEntry) : '<span class="gap">Not given</span>')}${row(L(d.pair === 'KE>ET' ? 'Ethiopian import declaration (eCMS)' : 'Kenyan import entry (iCMS)', 'የገቢ ንግድ ዲክላራሲዮን'), d.references.importDeclaration ? esc(d.references.importDeclaration) : '<span class="gap">Not given yet</span>')}${d.pair === 'KE>ET' ? row(L('eTIMS invoice (zero-rated export)', 'የeTIMS ደረሰኝ'), d.references.etimsInvoice ? esc(d.references.etimsInvoice) : '<span class="gap">Not given</span>') : ''}${row(L('Commercial invoice', 'የንግድ ደረሰኝ'), d.invoice ? `${esc(d.invoice.number)}, ${esc(d.invoice.issuedOn)}<br><span class="fp">${esc(d.invoice.fingerprint)}</span>` : '<span class="gap">Not written here</span>')}</table>

<h2>${L('4. Vehicle and crew', '4. ተሽከርካሪ እና አሽከርካሪ')}</h2>
<table>${row(L('Plate', 'ታርጋ'), v ? `${esc(v.plate)} (${esc(v.vehicleClass)})` : '<span class="gap">Not yet taken over</span>')}${row(L('Registered in', 'የተመዘገበበት አገር'), v?.registrationCountry ? esc(countryName(v.registrationCountry)) : '<span class="gap">Not given</span>')}${row(L('Trailer plate', 'የተጎታች ታርጋ'), esc(v?.trailerPlate ?? 'None'))}${row(L('COMESA Yellow Card', 'የኮሜሳ ቢጫ ካርድ'), v?.yellowCard ? `${esc(v.yellowCard.number)}${v.yellowCard.expiresAt ? `, until ${esc(v.yellowCard.expiresAt)}` : ''}` : '<span class="gap">Not given</span>')}${row(L('Driver', 'አሽከርካሪ'), c ? esc(c.name) : '<span class="gap">Not yet taken over</span>')}${row(L('Driving licence', 'መንጃ ፈቃድ'), esc(c?.licenceNumber ?? 'Not given'))}${row(L('Passport', 'ፓስፖርት'), c?.passport ? `${esc(c.passport.number)} (${esc(countryName(c.passport.country))}), until ${esc(c.passport.expiresAt)}` : '<span class="gap">Not given</span>')}</table>

<h2>${L('5. Seals', '5. ማኅተሞች')}</h2>
${d.seals.length ? `<ul>${d.seals.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>` : '<p>No seals on this load.</p>'}

<h2>${L('6. Where it has been', '6. ያለፈባቸው ቦታዎች')}</h2>
${d.events.length ? `<table>${d.events.map((x) => row(esc(x.at.slice(0, 16).replace('T', ' ')), esc(x.words))).join('')}</table>` : '<p>Not yet taken over.</p>'}

<footer>Issued by the SeeBuyGet network from its records of this load and the sender’s own commercial invoice. This is the carrier’s transport document: the customs declarations are the declarant’s own, lodged in each country’s system, and their numbers are given above.${fingerprint ? `<br><span class="fp">${esc(fingerprint)}</span><br>Check this copy: ${esc(check)}` : '<br>A preview: frozen and fingerprinted when the goods are taken over.'}</footer>
</body></html>`;
}

/** How many days a Yellow Card or passport still runs, for a screen to warn ahead. */
export function daysLeft(date: string | undefined, now: number = Date.now()): number | undefined {
  return date ? Math.floor((Date.parse(`${date.slice(0, 10)}T23:59:59Z`) - now) / DAY_MS) : undefined;
}
