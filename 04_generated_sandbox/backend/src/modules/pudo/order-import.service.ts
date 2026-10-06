import { Inject, Injectable } from '@nestjs/common';
import { GlosError } from '../../foundation/http/glos-error';
import { CarriageContractService } from './carriage-contract.service';
import { CarriageContract } from './carriage-contract.types';
import { DispatchService } from './dispatch.service';
import { GEOCODER, Geocoder } from './geocoder';
import { readOrderRows, readOrderSheet, type SheetOrder, type SheetReading } from './order-sheet';
import { readWorkbook } from './workbook';
import { ImportVerdict, OrderImportResult, OrderImportRow } from './order-import.types';
import { GeoPoint } from './pudo.types';

/**
 * P1b — A FLEET UPLOADS A SHEET OF ORDERS for a shipper it has a contract with.
 *
 * The user, 2026-10-05: orders reach the fleet from the Business app AND as a spreadsheet the office uploads — the
 * daily export of a webshop that is not here. Two steps, because a sheet is typed by people: CHECK it (every line
 * judged, nothing created), then IMPORT it (the good lines become orders, the rest are left out and said why).
 *
 * The sheet comes as TEXT (a CSV file, or cells pasted) or as a WORKBOOK (.xlsx): one or the other. A workbook's first
 * sheet is read, and the answer names it and the sheets that were not — so a wrong sheet is seen, not imported.
 *
 * A line's ORDER NUMBER is what makes sending the same sheet twice harmless: a number already under the contract is a
 * duplicate and is left exactly as it is — never updated, because the order may already be on a truck.
 *
 * WHERE. A line may carry its own points. Without one, its delivery address is looked up; an address the map does not
 * know is imported WITHOUT a point and said so, rather than given a made-up one — it can be delivered, and cannot be
 * planned until somebody pins it. The collection point is the sheet's own, or the one named for the whole upload.
 */
@Injectable()
export class OrderImportService {
  constructor(
    private readonly dispatch: DispatchService,
    private readonly contracts: CarriageContractService,
    @Inject(GEOCODER) private readonly geocoder: Geocoder,
  ) {}

  run(fleet: { did: string; name: string }, contract: CarriageContract, input: { text?: string; workbook?: Buffer; pickupLabel?: string; pickupLocation?: GeoPoint }, by: string, dryRun: boolean, now: number = Date.now()): OrderImportResult {
    if (contract.fleetDid !== fleet.did) throw new GlosError('NOT_FOUND', 'No such contract', { field: 'contractId' });
    if (contract.status !== 'active') throw new GlosError('INVALID_STATE', 'This contract has ended — orders under it cannot be placed');
    const today = new Date(now).toISOString().slice(0, 10);
    if (input.workbook && input.text?.trim()) throw new GlosError('INVALID_INPUT', 'Send the sheet as text or as a workbook, not both', { field: 'workbook' });
    let reading: SheetReading;
    let read: { sheet?: string; otherSheets?: string[] } = {};
    if (input.workbook) {
      const wb = readWorkbook(input.workbook);
      if ('refusal' in wb) reading = { refusal: wb.refusal, columns: {}, ignored: [], orders: [] };
      else {
        reading = readOrderRows(wb.rows, today, wb.lines);
        read = { sheet: wb.sheet, ...(wb.otherSheets.length ? { otherSheets: wb.otherSheets } : {}) };
      }
    } else reading = readOrderSheet(input.text ?? '', today);
    const base = { imported: false, rows: [], ok: 0, duplicates: 0, problems: 0, unlocated: 0, columns: reading.columns as Record<string, string>, ignored: reading.ignored, ...read };
    if (reading.refusal) return { ...base, refusal: reading.refusal };

    const sheetPickup = input.pickupLabel?.trim() && input.pickupLocation ? { label: input.pickupLabel.trim().slice(0, 160), location: input.pickupLocation } : undefined;
    const judged = reading.orders.map((o) => this.judge(contract, o, sheetPickup));
    const rows: OrderImportRow[] = [];
    for (const j of judged) {
      let code: string | undefined;
      if (!dryRun && j.verdict === 'ok') {
        const f = this.dispatch.registerFreight(
          {
            description: j.order.description,
            pickupLabel: j.pickup!.label,
            pickupLocation: j.pickup!.location,
            destLabel: j.order.dest,
            ...(j.destLocation ? { destLocation: j.destLocation } : {}),
            weightKg: j.order.weightKg,
            ...(j.order.packaging ? { packaging: j.order.packaging } : {}),
            // The office that uploaded it answers for it here: it is who may withdraw it, and whose name is on it.
            postedByDid: fleet.did,
            postedByName: by,
            contract: j.ref!,
            deliverOn: j.order.deliverOn,
            orderRef: j.order.reference,
            ...(j.order.instructions ? { instructions: j.order.instructions } : {}),
            ...(j.order.contactName ? { contactName: j.order.contactName } : {}),
            ...(j.order.contactPhone ? { contactPhone: j.order.contactPhone } : {}),
            ...(j.order.window ? { deliveryWindow: j.order.window } : {}),
          },
          now,
        );
        code = f.code;
      }
      rows.push({ line: j.order.line, reference: j.order.reference, description: j.order.description, weightKg: j.order.weightKg, dest: j.order.dest, deliverOn: j.order.deliverOn, verdict: j.verdict, problems: j.problems, located: Boolean(j.destLocation), ...(code ? { code } : {}) });
    }
    // The collection point named for this upload is the one the next upload starts from.
    if (!dryRun && sheetPickup && rows.some((r) => r.code)) this.contracts.rememberPickup(contract, sheetPickup);
    const count = (v: ImportVerdict) => rows.filter((r) => r.verdict === v).length;
    return { ...base, imported: !dryRun, rows, ok: count('ok'), duplicates: count('duplicate'), problems: count('problem'), unlocated: rows.filter((r) => r.verdict === 'ok' && !r.located).length };
  }

  private judge(contract: CarriageContract, order: SheetOrder, sheetPickup: { label: string; location: GeoPoint } | undefined) {
    const problems = [...order.problems];
    let ref: ReturnType<CarriageContractService['orderable']> | undefined;
    if (order.deliverOn) {
      try {
        ref = this.contracts.orderable(contract, order.deliverOn);
      } catch (e) {
        problems.push(e instanceof Error ? e.message : 'The contract does not cover this day');
      }
    }
    // The collection point: this line's own (with its point, or a name the map knows), else the upload's.
    let pickup = sheetPickup;
    if (order.pickup) {
      const at = order.pickupLocation ?? this.place(order.pickup);
      if (at) pickup = { label: order.pickup, location: at };
      else problems.push(`"${order.pickup}" is not a collection point the map knows — give its latitude and longitude`);
    }
    if (!pickup) problems.push('No collection point — name where the goods are collected for this sheet');
    const destLocation = order.destLocation ?? (order.dest ? this.place(order.dest) : undefined);
    if (problems.length) return { order, verdict: 'problem' as const, problems, pickup, destLocation, ref };
    if (this.dispatch.contractOrderByRef(contract.contractId, order.reference)) return { order, verdict: 'duplicate' as const, problems: [], pickup, destLocation, ref };
    return { order, verdict: 'ok' as const, problems: [], pickup, destLocation, ref };
  }

  /** A point for a name — only when the map really knows the place. A fallback is a made-up point, and is no point. */
  private place(label: string): GeoPoint | undefined {
    const hit = this.geocoder.geocode(label);
    return hit.confidence === 'fallback' ? undefined : hit.location;
  }
}
