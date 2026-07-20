import { BadRequestException, Injectable } from '@nestjs/common';

/**
 * NamespaceRegistry (M2-021). Manages the namespaces allowed for extensible e-waybill tags.
 * Tag keys are `namespace:attribute` (e.g. `eu:eori`, `fda:priorNotice`); an unregistered
 * namespace is rejected so the tag space stays governed.
 */
@Injectable()
export class NamespaceRegistry {
  private readonly namespaces = new Set<string>(['eu', 'fda', 'wco', 'iata', 'imo', 'glos', 'custom', 'shopify', 'magento']);

  register(namespace: string): void {
    this.namespaces.add(namespace.toLowerCase());
  }

  list(): string[] {
    return [...this.namespaces];
  }

  isRegistered(namespace: string): boolean {
    return this.namespaces.has(namespace.toLowerCase());
  }

  /** Validate every reference key uses a registered namespace; throws on the first offender. */
  validateTags(references: Record<string, string>): void {
    for (const key of Object.keys(references)) {
      const [ns, attr] = key.split(':');
      if (!attr) throw new BadRequestException(`Tag "${key}" must be namespaced as "namespace:attribute"`);
      if (!this.isRegistered(ns)) throw new BadRequestException(`Unknown tag namespace "${ns}". Register it first.`);
    }
  }
}
