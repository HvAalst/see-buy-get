import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateShipmentInput } from '../shipment.service';

// Plugin ingestion framework (M2-010). An e-commerce/marketplace plugin maps its native order
// payload into the canonical CreateShipmentInput, so every channel produces an identical twin.

export interface ShipmentSourcePlugin {
  readonly name: string;
  parse(order: Record<string, unknown>): CreateShipmentInput;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown, fallback = 0): number => (typeof v === 'number' ? v : Number(v) || fallback);

/** Shopify order: { id, shipping_address:{city}, line_items:[{grams, quantity}] }. */
@Injectable()
export class ShopifyPlugin implements ShipmentSourcePlugin {
  readonly name = 'shopify';
  parse(order: Record<string, unknown>): CreateShipmentInput {
    const items = (order.line_items as Array<Record<string, unknown>>) ?? [];
    const grams = items.reduce((s, li) => s + num(li.grams) * num(li.quantity, 1), 0);
    const ship = (order.shipping_address as Record<string, unknown>) ?? {};
    return {
      origin: String(order.origin ?? 'Origin Warehouse'),
      destination: String(ship.city ?? order.destination ?? 'Unknown'),
      totalWeightKg: round2(grams / 1000) || 1,
      packageCount: items.length || 1,
      mode: 'courier',
      goods: { description: 'E-commerce order' },
      references: { 'shopify:orderId': String(order.id ?? '') },
    };
  }
}

/** Magento order: { increment_id, shipping:{city}, items:[{weight, qty}] }. */
@Injectable()
export class MagentoPlugin implements ShipmentSourcePlugin {
  readonly name = 'magento';
  parse(order: Record<string, unknown>): CreateShipmentInput {
    const items = (order.items as Array<Record<string, unknown>>) ?? [];
    const kg = items.reduce((s, it) => s + num(it.weight) * num(it.qty, 1), 0);
    const ship = (order.shipping as Record<string, unknown>) ?? {};
    return {
      origin: String(order.origin ?? 'Origin Warehouse'),
      destination: String(ship.city ?? 'Unknown'),
      totalWeightKg: round2(kg) || 1,
      packageCount: items.length || 1,
      mode: 'courier',
      goods: { description: 'E-commerce order' },
      references: { 'magento:incrementId': String(order.increment_id ?? '') },
    };
  }
}

@Injectable()
export class PluginRegistry {
  private readonly plugins = new Map<string, ShipmentSourcePlugin>();

  constructor(shopify: ShopifyPlugin, magento: MagentoPlugin) {
    [shopify, magento].forEach((p) => this.plugins.set(p.name, p));
  }

  get(name: string): ShipmentSourcePlugin {
    const plugin = this.plugins.get(name);
    if (!plugin) throw new NotFoundException(`Unknown ingestion plugin: ${name}`);
    return plugin;
  }

  list(): string[] {
    return [...this.plugins.keys()];
  }
}
