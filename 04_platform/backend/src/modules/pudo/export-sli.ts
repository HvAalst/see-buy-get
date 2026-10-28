import { createHash } from 'crypto';
import { catalogueEntry } from '../../foundation/countries/catalogue';
import { cleanHsCode, hsDisplay } from './commercial-invoice.service';
import { MAX_SLI_LINES, type BlRelease, type SliDraft, type SliDraftDto, type SliParty, type SliPartyDto } from './export-sli.types';

/**
 * THE SHIPPER'S LETTER OF INSTRUCTION — its rules and its page. The shapes are in export-sli.types.ts (where the API
 * contract reads them); what the form needs before signing, and the page drawn from it, are here.
 */

/* ------------------------------------------------------------------- the rules -- */

/** The export's own facts a signed version was drawn from, as one fingerprint — the papers enclosed left out, as they come in later. */
export function sliBasis(f: SliFacts): string {
  const { papers: _papers, ...facts } = f;
  return createHash('sha256').update(JSON.stringify(facts), 'utf8').digest('hex');
}

const trimmed = (s?: string, max = 300) => (s?.trim() ? s.trim().slice(0, max) : undefined);

/** The form, cleaned: empty fields gone, numbers rounded, an HS code kept only where it is one. */
export function cleanDraft(input: SliDraftDto, by: string, now: number): SliDraft {
  const party = (p?: SliPartyDto): SliParty | undefined =>
    p && (p.name?.trim() || p.address?.trim()) ? { name: trimmed(p.name, 120) ?? '', address: trimmed(p.address) ?? '', ...(trimmed(p.contact, 120) ? { contact: trimmed(p.contact, 120) } : {}) } : undefined;
  const round = (n: number | undefined, dp: number) => (n == null || !Number.isFinite(n) ? undefined : Math.round(n * 10 ** dp) / 10 ** dp);
  const consignee = party(input.consignee);
  const notify = party(input.notify);
  const lines = (input.lines ?? []).slice(0, MAX_SLI_LINES).map((l) => {
    const hs = cleanHsCode(l.hsCode);
    const net = round(l.netKg, 1);
    const m3 = round(l.volumeM3, 2);
    return {
      ...(trimmed(l.marks, 120) ? { marks: trimmed(l.marks, 120) } : {}),
      packages: Math.round(Number(l.packages)),
      packageKind: trimmed(l.packageKind, 40) ?? '',
      description: trimmed(l.description) ?? '',
      ...(hs ? { hsCode: hs } : {}),
      grossKg: round(l.grossKg, 1) ?? 0,
      ...(net != null ? { netKg: net } : {}),
      ...(m3 != null ? { volumeM3: m3 } : {}),
    };
  });
  const dangerous = input.dangerous && (input.dangerous.unNumber?.trim() || input.dangerous.hazardClass?.trim())
    ? {
        unNumber: input.dangerous.unNumber.trim().toUpperCase().replace(/^(\d{4})$/, 'UN$1').replace(/^UN\s+/, 'UN'),
        hazardClass: input.dangerous.hazardClass.trim(),
        ...(trimmed(input.dangerous.properShippingName, 120) ? { properShippingName: trimmed(input.dangerous.properShippingName, 120) } : {}),
        ...(trimmed(input.dangerous.packingGroup, 4) ? { packingGroup: trimmed(input.dangerous.packingGroup, 4)!.toUpperCase() } : {}),
      }
    : undefined;
  return {
    ...(trimmed(input.shipperContact, 160) ? { shipperContact: trimmed(input.shipperContact, 160) } : {}),
    consigneeKind: input.consigneeKind,
    ...(consignee ? { consignee } : {}),
    ...(trimmed(input.orderOfBank, 120) ? { orderOfBank: trimmed(input.orderOfBank, 120) } : {}),
    ...(input.notifySameAsConsignee ? { notifySameAsConsignee: true } : {}),
    ...(notify && !input.notifySameAsConsignee ? { notify } : {}),
    ...(trimmed(input.dischargePort, 80) ? { dischargePort: trimmed(input.dischargePort, 80) } : {}),
    ...(trimmed(input.placeOfDelivery, 80) ? { placeOfDelivery: trimmed(input.placeOfDelivery, 80) } : {}),
    ...(input.incoterm ? { incoterm: input.incoterm } : {}),
    ...(trimmed(input.incotermPlace, 80) ? { incotermPlace: trimmed(input.incotermPlace, 80) } : {}),
    ...(input.freight ? { freight: input.freight } : {}),
    ...(input.blRelease ? { blRelease: input.blRelease } : {}),
    ...(input.blRelease === 'originals' ? { originals: input.originals ?? 3 } : {}),
    ...(input.copies != null ? { copies: input.copies } : {}),
    lines,
    ...(dangerous ? { dangerous } : {}),
    ...(trimmed(input.letterOfCredit, 60) ? { letterOfCredit: trimmed(input.letterOfCredit, 60) } : {}),
    ...(trimmed(input.instructions, 1000) ? { instructions: trimmed(input.instructions, 1000) } : {}),
    savedAt: new Date(now).toISOString(),
    savedBy: by,
  };
}

/** What signing still needs, in words — the forwarder cannot draft a bill of lading without any of it. */
export function sliGaps(d: SliDraft | undefined, ctx: { hazardous: boolean; containerNo?: string }): string[] {
  if (!d) return ['Fill in the form'];
  const out: string[] = [];
  if (d.consigneeKind === 'named' && !(d.consignee?.name && d.consignee.address)) out.push('The consignee’s name and address');
  if (d.consigneeKind === 'to_order_of_bank' && !d.orderOfBank) out.push('The bank the bill is made out to the order of');
  if (d.consigneeKind !== 'named' && !d.notifySameAsConsignee && !(d.notify?.name && d.notify.address)) out.push('Who is notified on arrival — a bill made out to order names nobody else');
  if (d.consigneeKind === 'named' && !d.notifySameAsConsignee && !(d.notify?.name && d.notify.address)) out.push('Who is notified on arrival (or “the same as the consignee”)');
  if (!d.dischargePort) out.push('The port of discharge');
  if (!d.freight) out.push('Freight prepaid or collect');
  if (!d.blRelease) out.push('How the bill of lading is released');
  if (!d.lines.length) out.push('The goods: at least one line');
  d.lines.forEach((l, i) => {
    if (!(l.packages > 0 && l.packageKind && l.description && l.grossKg > 0)) out.push(`Goods line ${i + 1}: packages, their kind, the description and the gross weight`);
  });
  if (ctx.hazardous && !(d.dangerous && /^UN\d{4}$/.test(d.dangerous.unNumber) && d.dangerous.hazardClass)) out.push('The dangerous goods’ UN number and class');
  if (!ctx.containerNo) out.push('The box’s number, on the export');
  return out;
}

export interface SliFacts {
  code: string;
  shipper: { name: string; address?: string; registrationNo?: string; taxNo?: string; country: string };
  forwarder: string;
  bookedWith: string;
  booking: string;
  vessel?: string;
  voyage?: string;
  loadingPort: string;
  terminal: string;
  originCountry: string;
  destCountry: string;
  docsCutoffAt?: string;
  container: { type?: string; number?: string; seals: string[] };
  vgm?: { kg: number; method: number; signatory: string };
  papers: string[];
}

const esc = (s: string) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const countryName = (code: string) => catalogueEntry(code)?.name ?? code;
const utc = (iso: string) => `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
const RELEASE_WORDS: Record<BlRelease, string> = { originals: 'Original bills of lading', sea_waybill: 'Sea waybill', telex_release: 'Telex release (surrendered at origin)' };

/**
 * THE LETTER ITSELF — one printable page, drawn from the export's own facts and the exporter's form. Signed, these bytes
 * are kept exactly as they are; a draft is marked a draft in its title and on the page.
 */
export function sliHtml(f: SliFacts, d: SliDraft, sign: { version: number; signedBy: string; signedAt: string } | 'draft'): string {
  const row = (k: string, v: string) => `<tr><th>${esc(k)}</th><td>${v}</td></tr>`;
  const party = (p?: SliParty) => (p ? `<b>${esc(p.name)}</b><br>${esc(p.address).replace(/\r?\n/g, '<br>')}${p.contact ? `<br>${esc(p.contact)}` : ''}` : '—');
  const consignee =
    d.consigneeKind === 'to_order' ? '<b>To order</b> (of the shipper)' : d.consigneeKind === 'to_order_of_bank' ? `<b>To the order of ${esc(d.orderOfBank ?? '—')}</b>` : party(d.consignee);
  const notify = d.notifySameAsConsignee ? 'The same as the consignee' : party(d.notify);
  const totals = d.lines.reduce((t, l) => ({ packages: t.packages + l.packages, gross: t.gross + l.grossKg, net: t.net + (l.netKg ?? 0), m3: t.m3 + (l.volumeM3 ?? 0) }), { packages: 0, gross: 0, net: 0, m3: 0 });
  const n = (x: number, dp = 1) => x.toLocaleString('en', { maximumFractionDigits: dp });
  const lines = d.lines
    .map((l, i) => `<tr><td>${i + 1}</td><td>${esc(l.marks ?? '')}</td><td class="r">${n(l.packages, 0)} ${esc(l.packageKind)}</td><td>${esc(l.description)}</td><td class="mono">${l.hsCode ? esc(hsDisplay(l.hsCode)) : '—'}</td><td class="r">${n(l.grossKg)}</td><td class="r">${l.netKg != null ? n(l.netKg) : '—'}</td><td class="r">${l.volumeM3 != null ? n(l.volumeM3, 2) : '—'}</td></tr>`)
    .join('');
  const shipper = `<b>${esc(f.shipper.name)}</b>${f.shipper.address ? `<br>${esc(f.shipper.address)}` : ''}<br>${esc(countryName(f.shipper.country))}${f.shipper.registrationNo ? `<br>Registration ${esc(f.shipper.registrationNo)}` : ''}${f.shipper.taxNo ? `<br>Tax number ${esc(f.shipper.taxNo)}` : ''}${d.shipperContact ? `<br>${esc(d.shipperContact)}` : ''}`;
  const draft = sign === 'draft';
  const title = `${draft ? 'DRAFT — ' : ''}Shipper’s letter of instruction — ${f.code}${draft ? '' : ` — version ${sign.version}`}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>body{font:13px/1.45 system-ui,sans-serif;color:#111;margin:24px auto;max-width:820px;padding:0 16px}h1{font-size:19px;margin:0 0 4px}h2{font-size:14px;margin:20px 0 6px;border-bottom:1px solid #ccc;padding-bottom:3px}table{border-collapse:collapse;width:100%}th{text-align:left;font-weight:600;width:34%;padding:4px 8px 4px 0;vertical-align:top}td{padding:4px 6px 4px 0;vertical-align:top}.goods th,.goods td{border-bottom:1px solid #e3e3e3;width:auto;font-size:12px}.r{text-align:right}.mono{font-family:ui-monospace,monospace}.two{display:grid;grid-template-columns:1fr 1fr;gap:12px}.box{border:1px solid #ddd;border-radius:6px;padding:8px 10px}.h{font-size:11px;color:#555;text-transform:uppercase;letter-spacing:.04em;margin-bottom:3px}.draft{color:#b00020;font-weight:700}.note{color:#555;font-size:11px;margin-top:18px}@media print{body{margin:0}}</style></head><body>
<h1>${esc(title)}</h1>
${draft ? '<p class="draft">A draft: not signed, and not for the forwarder to act on.</p>' : ''}
<div>To ${esc(f.forwarder)} (${esc(f.bookedWith)}) · booking ${esc(f.booking)}${f.vessel ? ` · ${esc(f.vessel)}${f.voyage ? ` / ${esc(f.voyage)}` : ''}` : ''}</div>
<h2>The parties</h2>
<div class="two"><div class="box"><div class="h">Shipper</div>${shipper}</div><div class="box"><div class="h">Consignee</div>${consignee}</div><div class="box"><div class="h">Notify party</div>${notify}</div><div class="box"><div class="h">Forwarder</div><b>${esc(f.forwarder)}</b></div></div>
<h2>The voyage and the terms</h2><table>${row('Port of loading', esc(`${f.loadingPort} — ${f.terminal}`))}${row('Port of discharge', esc(d.dischargePort ?? '—'))}${d.placeOfDelivery ? row('Place of delivery', esc(d.placeOfDelivery)) : ''}${row('From → to', esc(`${countryName(f.originCountry)} → ${countryName(f.destCountry)}`))}${d.incoterm ? row('Incoterm', esc(`${d.incoterm}${d.incotermPlace ? ` ${d.incotermPlace}` : ''} (Incoterms 2020)`)) : ''}${row('Freight', d.freight === 'collect' ? 'Collect' : d.freight === 'prepaid' ? 'Prepaid' : '—')}${row('Bill of lading', d.blRelease ? esc(`${RELEASE_WORDS[d.blRelease]}${d.blRelease === 'originals' ? ` — ${d.originals ?? 3} original${(d.originals ?? 3) === 1 ? '' : 's'}` : ''}${d.copies != null ? `, ${d.copies} cop${d.copies === 1 ? 'y' : 'ies'}` : ''}`) : '—')}${d.letterOfCredit ? row('Letter of credit', esc(d.letterOfCredit)) : ''}${f.docsCutoffAt ? row('Documents cut-off', esc(utc(f.docsCutoffAt))) : ''}</table>
<h2>The box</h2><table>${row('Container', esc(`${f.container.number ?? '—'}${f.container.type ? ` (${f.container.type})` : ''}`))}${row('Seal', esc(f.container.seals.join(', ') || '—'))}${row('Verified gross mass', f.vgm ? esc(`${n(f.vgm.kg, 0)} kg, method ${f.vgm.method}, signed for by ${f.vgm.signatory}`) : '—')}</table>
<h2>The goods</h2><table class="goods"><tr><th>#</th><th>Marks and numbers</th><th class="r">Packages</th><th>Description</th><th>HS code</th><th class="r">Gross kg</th><th class="r">Net kg</th><th class="r">m³</th></tr>${lines}<tr><th></th><th>Total</th><th class="r">${n(totals.packages, 0)}</th><th></th><th></th><th class="r">${n(totals.gross)}</th><th class="r">${totals.net ? n(totals.net) : '—'}</th><th class="r">${totals.m3 ? n(totals.m3, 2) : '—'}</th></tr></table>
${d.dangerous ? `<h2>Dangerous goods</h2><table>${row('UN number', esc(d.dangerous.unNumber))}${row('Class', esc(d.dangerous.hazardClass))}${d.dangerous.properShippingName ? row('Proper shipping name', esc(d.dangerous.properShippingName)) : ''}${d.dangerous.packingGroup ? row('Packing group', esc(d.dangerous.packingGroup)) : ''}</table>` : ''}
${d.instructions ? `<h2>Special instructions</h2><p>${esc(d.instructions).replace(/\r?\n/g, '<br>')}</p>` : ''}
<h2>Papers enclosed</h2><p>${f.papers.length ? f.papers.map(esc).join(' · ') : 'None yet'}</p>
<h2>Signed</h2><p>${draft ? '<span class="draft">Not signed.</span>' : `${esc(sign.signedBy)}, for ${esc(f.shipper.name)}, on ${esc(utc(sign.signedAt))} — version ${sign.version}.`}</p>
<p class="note">Drawn on SeeBuyGet from the exporter’s own record and words, for its forwarder to draft the bill of lading. SeeBuyGet books no ship and sends this to nobody: the exporter hands it over. A signed version is kept exactly as signed; a change is a new version.</p>
</body></html>`;
}
