import { isDay } from './carriage-contract.service';
import { isPackaging, type Packaging } from './packaging';

/**
 * P1b — A SHEET OF ORDERS, READ.
 *
 * The user, 2026-10-05: orders also reach the fleet as a spreadsheet the office uploads — the daily export of a
 * webshop that is not on SeeBuyGet, or is and still works from Excel. So this reads what people actually have: a CSV
 * saved from a spreadsheet, or cells copied out of one and pasted (tabs), with whatever the columns happen to be
 * called and in whatever order. It is pure — text in, rows and their problems out — so the phone and the desk get the
 * same verdict on every line, and so it can be tested on the sheets that go wrong.
 *
 * It reads; it does not guess. A date it cannot read for certain, a weight with no number in it, a row with no order
 * number: each is a PROBLEM on that row, said in words, and that row is not imported. The rest are.
 */

/** The most rows one sheet may carry. A day's orders for one shipper, with room; not a way to load a year. */
export const MAX_SHEET_ROWS = 500;

export type SheetField = 'reference' | 'description' | 'weightKg' | 'dest' | 'destLat' | 'destLng' | 'deliverOn' | 'window' | 'contactName' | 'contactPhone' | 'packaging' | 'pickup' | 'pickupLat' | 'pickupLng' | 'instructions';

/** What each column may be called. Compared with case, spaces, dots, dashes and underscores taken out. */
const ALIASES: Record<SheetField, string[]> = {
  reference: ['reference', 'ref', 'order', 'orderno', 'ordernumber', 'orderid', 'ordernr', 'ordernummer', 'number', 'no'],
  description: ['description', 'goods', 'item', 'items', 'product', 'what', 'article', 'omschrijving'],
  weightKg: ['weight', 'weightkg', 'kg', 'kilos', 'gewicht', 'gewichtkg', 'grossweight'],
  dest: ['deliverto', 'destination', 'dest', 'address', 'deliveryaddress', 'to', 'dropoff', 'afleveradres', 'adres'],
  destLat: ['lat', 'latitude', 'destlat', 'deliverylat'],
  destLng: ['lng', 'lon', 'long', 'longitude', 'destlng', 'destlon', 'deliverylng'],
  deliverOn: ['deliveron', 'deliverydate', 'date', 'day', 'arrive', 'arriveon', 'mustarrive', 'leverdatum', 'datum'],
  window: ['window', 'deliverywindow', 'time', 'timewindow', 'when', 'tijdvak'],
  contactName: ['contact', 'contactname', 'customer', 'customername', 'name', 'receiver', 'klant'],
  contactPhone: ['phone', 'contactphone', 'tel', 'telephone', 'mobile', 'telefoon'],
  packaging: ['packaging', 'packed', 'pack', 'verpakking'],
  pickup: ['collectfrom', 'pickup', 'pickupaddress', 'from', 'origin', 'ophaaladres'],
  pickupLat: ['pickuplat', 'fromlat', 'originlat'],
  pickupLng: ['pickuplng', 'pickuplon', 'fromlng', 'originlng'],
  instructions: ['instructions', 'note', 'notes', 'remarks', 'comment', 'opmerking'],
};

/** The columns a sheet must have, whatever they are called. */
const REQUIRED: SheetField[] = ['reference', 'description', 'weightKg', 'dest', 'deliverOn'];

export interface SheetOrder {
  /** The line in the sheet as a person counts it: the header is line 1. */
  line: number;
  reference: string;
  description: string;
  weightKg: number;
  dest: string;
  destLocation?: { lat: number; lng: number };
  deliverOn: string;
  window?: string;
  contactName?: string;
  contactPhone?: string;
  packaging?: Packaging;
  pickup?: string;
  pickupLocation?: { lat: number; lng: number };
  instructions?: string;
  /** What is wrong with this line, in words. Empty means it can be imported. */
  problems: string[];
}

export interface SheetReading {
  /** Why the sheet as a whole cannot be read — no header, a column missing, too many rows. Then `orders` is empty. */
  refusal?: string;
  /** Which of the sheet's own column headings was read as what. */
  columns: Partial<Record<SheetField, string>>;
  /** Headings nothing was made of. Shown, so a misspelt column is seen rather than silently dropped. */
  ignored: string[];
  orders: SheetOrder[];
}

/* ------------------------------------------------------------------ cells -- */

/** Tab if any line has one (cells pasted from a spreadsheet); else whichever of ; and , the header uses more. */
export function delimiterOf(text: string): string {
  const first = text.split(/\r?\n/).find((l) => l.trim()) ?? '';
  if (first.includes('\t')) return '\t';
  return (first.match(/;/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? ';' : ',';
}

/** Rows of cells. Quoted cells may hold the delimiter, a doubled quote, and a line break. */
export function cellsOf(text: string, delimiter = delimiterOf(text)): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === delimiter) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  row.push(cell);
  rows.push(row);
  return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c !== ''));
}

/* ------------------------------------------------------------- one value -- */

/**
 * A weight in kilos. "4000", "4 000", "4,000 kg", "1.5 t", "1,5 t" — the forms a person types. A comma is a decimal
 * only where it cannot be a thousands mark (not followed by exactly three digits).
 */
export function kilosOf(raw: string): number | undefined {
  const s = raw.trim().toLowerCase();
  const m = /^([\d\s.,']+)\s*(kg|kgs|kilo|kilos|t|ton|tons|tonne|tonnes)?$/.exec(s);
  if (!m) return undefined;
  let digits = m[1].replace(/[\s']/g, '');
  if (/,\d{3}(\D|$)/.test(digits) || (digits.includes(',') && digits.includes('.'))) digits = digits.replace(/,/g, '');
  else digits = digits.replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(digits)) return undefined;
  const n = Number(digits) * (m[2] && m[2].startsWith('t') ? 1000 : 1);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : undefined;
}

/**
 * A calendar day. ISO (2026-10-06) is read as written. A date with a four-digit year last (06/10/2026, 6-10-2026,
 * 06.10.2026) is read DAY FIRST, the way it is written almost everywhere these sheets come from; the template says
 * so. A "month" above 12 is refused rather than swapped: a date this had to guess at is not a date it read.
 */
export function dayOfCell(raw: string): string | undefined {
  const s = raw.trim();
  if (isDay(s)) return s;
  const iso = /^(\d{4}-\d{2}-\d{2})[T ]/.exec(s);
  if (iso && isDay(iso[1])) return iso[1];
  const m = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/.exec(s);
  if (!m) return undefined;
  const day = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return isDay(day) ? day : undefined;
}

function coordOf(raw: string | undefined, limit: number): number | undefined {
  if (!raw?.trim()) return undefined;
  const n = Number(raw.trim().replace(',', '.'));
  return Number.isFinite(n) && Math.abs(n) <= limit ? n : undefined;
}

const PACK_WORDS: Record<string, Packaging> = { pallet: 'palletised', pallets: 'palletised', palletized: 'palletised', bags: 'bagged', bag: 'bagged', sacks: 'bagged', bulk: 'loose', drums: 'drummed', drum: 'drummed', bales: 'baled', bale: 'baled', pieces: 'piece', box: 'piece', boxes: 'piece' };

/* ------------------------------------------------------------- the sheet -- */

const keyOf = (heading: string) => heading.toLowerCase().replace(/\(.*?\)/g, '').replace(/[^a-z0-9]/g, '');

/**
 * Read a sheet of orders. `today` is the server's day: an order for a day already gone is a problem on its row.
 */
export function readOrderSheet(text: string, today: string): SheetReading {
  const empty = (refusal: string): SheetReading => ({ refusal, columns: {}, ignored: [], orders: [] });
  if (!text?.trim()) return empty('The sheet is empty');
  const rows = cellsOf(text);
  if (rows.length < 2) return empty('The sheet needs a first line naming its columns, and at least one order under it');
  const [header, ...body] = rows;
  if (body.length > MAX_SHEET_ROWS) return empty(`A sheet holds ${MAX_SHEET_ROWS} orders at most — this one has ${body.length}. Send it in parts`);

  const at: Partial<Record<SheetField, number>> = {};
  const columns: Partial<Record<SheetField, string>> = {};
  const ignored: string[] = [];
  header.forEach((heading, i) => {
    const key = keyOf(heading);
    const field = (Object.keys(ALIASES) as SheetField[]).find((f) => at[f] === undefined && ALIASES[f].includes(key));
    if (field) {
      at[field] = i;
      columns[field] = heading;
    } else if (heading) ignored.push(heading);
  });
  const missing = REQUIRED.filter((f) => at[f] === undefined);
  if (missing.length) {
    const WORDS: Record<string, string> = { reference: 'an order number', description: 'what the goods are', weightKg: 'the weight', dest: 'where to deliver', deliverOn: 'the delivery date' };
    return { refusal: `The sheet has no column for ${missing.map((f) => WORDS[f]).join(', ')}. Name the columns in the first line — the template shows how`, columns, ignored, orders: [] };
  }

  const seen = new Map<string, number>();
  const orders = body.map((cells, i): SheetOrder => {
    const line = i + 2;
    const get = (f: SheetField) => (at[f] === undefined ? '' : (cells[at[f]!] ?? '')).trim();
    const problems: string[] = [];

    const reference = get('reference').slice(0, 60);
    if (!reference) problems.push('No order number');
    else if (seen.has(reference.toLowerCase())) problems.push(`The same order number as line ${seen.get(reference.toLowerCase())}`);
    else seen.set(reference.toLowerCase(), line);

    const description = get('description').slice(0, 160);
    if (!description) problems.push('Nothing says what the goods are');

    const weightKg = kilosOf(get('weightKg'));
    if (weightKg === undefined) problems.push(get('weightKg') ? `"${get('weightKg')}" is not a weight` : 'No weight');

    const dest = get('dest').slice(0, 160);
    if (!dest) problems.push('No delivery address');

    const deliverOn = dayOfCell(get('deliverOn'));
    if (!deliverOn) problems.push(get('deliverOn') ? `"${get('deliverOn')}" is not a date this can read — write 2026-10-06 or 06/10/2026` : 'No delivery date');
    else if (deliverOn < today) problems.push(`${deliverOn} has gone by`);

    const lat = coordOf(get('destLat'), 90);
    const lng = coordOf(get('destLng'), 180);
    if ((get('destLat') || get('destLng')) && (lat === undefined || lng === undefined)) problems.push('The delivery point is not a latitude and a longitude');

    const pLat = coordOf(get('pickupLat'), 90);
    const pLng = coordOf(get('pickupLng'), 180);
    if ((get('pickupLat') || get('pickupLng')) && (pLat === undefined || pLng === undefined)) problems.push('The collection point is not a latitude and a longitude');

    const packRaw = get('packaging').toLowerCase();
    const packaging = isPackaging(packRaw) ? packRaw : PACK_WORDS[packRaw];
    if (packRaw && !packaging) problems.push(`"${get('packaging')}" is not a way of packing this knows — loose, bagged, palletised, drummed, baled, ibc or piece`);

    return {
      line,
      reference,
      description,
      weightKg: weightKg ?? 0,
      dest,
      ...(lat !== undefined && lng !== undefined ? { destLocation: { lat, lng } } : {}),
      deliverOn: deliverOn ?? '',
      ...(get('window') ? { window: get('window').slice(0, 80) } : {}),
      ...(get('contactName') ? { contactName: get('contactName').slice(0, 80) } : {}),
      ...(get('contactPhone') ? { contactPhone: get('contactPhone').slice(0, 32) } : {}),
      ...(packaging ? { packaging } : {}),
      ...(get('pickup') ? { pickup: get('pickup').slice(0, 160) } : {}),
      ...(pLat !== undefined && pLng !== undefined ? { pickupLocation: { lat: pLat, lng: pLng } } : {}),
      ...(get('instructions') ? { instructions: get('instructions').slice(0, 500) } : {}),
      problems,
    };
  });
  return { columns, ignored, orders };
}

/** The template a fleet hands its shipper: the columns by the names this reads, and one line showing each form. */
export const ORDER_SHEET_TEMPLATE = [
  'Order number,Goods,Weight (kg),Deliver to,Lat,Lng,Delivery date,Window,Contact,Phone,Packaging,Instructions',
  'WS-10432,"Bricks, 4 pallets",4000,"Plot 12, Kitengela",-1.4780,36.9620,2026-10-06,8-12,J. Mwangi,+254700000000,palletised,Crane offload on site',
].join('\r\n');
