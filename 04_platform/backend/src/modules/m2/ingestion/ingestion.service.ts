import { Injectable } from '@nestjs/common';
import { CreateShipmentInput, ShipmentService } from '../shipment.service';
import { Shipment } from '../shipment.types';
import { PluginRegistry } from './plugins';

export interface BatchResult {
  total: number;
  created: Array<{ index: number; glosShipmentId: string }>;
  failed: Array<{ index: number; error: string }>;
}

/**
 * IngestionService (M2-010). Multi-channel intake — batch JSON, batch CSV, and plugin order
 * payloads — all funnel through the canonical ShipmentService.create, so the produced digital
 * twin is identical regardless of source. Batch is best-effort: each row succeeds or fails
 * independently and is reported per-row.
 */
@Injectable()
export class IngestionService {
  constructor(
    private readonly shipments: ShipmentService,
    private readonly plugins: PluginRegistry,
  ) {}

  ingestJsonBatch(items: CreateShipmentInput[]): BatchResult {
    const created: BatchResult['created'] = [];
    const failed: BatchResult['failed'] = [];
    items.forEach((item, index) => {
      try {
        created.push({ index, glosShipmentId: this.shipments.create(item).glosShipmentId });
      } catch (e) {
        failed.push({ index, error: e instanceof Error ? e.message : String(e) });
      }
    });
    return { total: items.length, created, failed };
  }

  ingestCsvBatch(csv: string): BatchResult {
    return this.ingestJsonBatch(parseCsv(csv));
  }

  ingestViaPlugin(name: string, order: Record<string, unknown>): Shipment {
    return this.shipments.create(this.plugins.get(name).parse(order));
  }

  listPlugins(): string[] {
    return this.plugins.list();
  }
}

/** Minimal CSV → CreateShipmentInput. Header row required; numeric fields coerced. */
function parseCsv(text: string): CreateShipmentInput[] {
  const lines = text.trim().split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const header = lines[0].split(',').map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cells = line.split(',').map((c) => c.trim());
    const row: Record<string, string> = {};
    header.forEach((h, i) => (row[h] = cells[i] ?? ''));
    return {
      origin: row.origin,
      destination: row.destination,
      totalWeightKg: Number(row.totalWeightKg),
      packageCount: Number(row.packageCount),
      mode: (row.mode as CreateShipmentInput['mode']) || undefined,
      shipperRef: row.shipperRef || undefined,
    };
  });
}
