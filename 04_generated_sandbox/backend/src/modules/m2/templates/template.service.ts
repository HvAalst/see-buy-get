import { Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { CreateShipmentInput } from '../shipment.service';

export interface ShipmentTemplate {
  id: string;
  name: string;
  fields: Partial<CreateShipmentInput>;
  createdAt: string;
}

/**
 * TemplateService (M2-013). Save reusable shipment templates (e.g. "Standard Export to EU",
 * "Cold Chain Pharma") that pre-fill repeated fields; create-from-template merges the template
 * with per-shipment overrides.
 */
@Injectable()
export class TemplateService {
  private readonly templates = new Map<string, ShipmentTemplate>();

  save(name: string, fields: Partial<CreateShipmentInput>): ShipmentTemplate {
    const template: ShipmentTemplate = { id: `tpl_${randomBytes(8).toString('hex')}`, name, fields, createdAt: new Date().toISOString() };
    this.templates.set(template.id, template);
    return template;
  }

  list(): ShipmentTemplate[] {
    return [...this.templates.values()];
  }

  get(id: string): ShipmentTemplate {
    const template = this.templates.get(id);
    if (!template) throw new NotFoundException(`Template not found: ${id}`);
    return template;
  }

  /** Merge a template with overrides into a full create input (overrides win). */
  merge(id: string, overrides: Partial<CreateShipmentInput>): CreateShipmentInput {
    return { ...this.get(id).fields, ...overrides } as CreateShipmentInput;
  }
}
