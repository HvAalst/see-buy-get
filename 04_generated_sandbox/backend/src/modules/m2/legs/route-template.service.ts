import { Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { HandoverVerification, TransportMode } from '../shipment.types';

// Reusable multi-leg route templates (M2-063): save common routes (legs + handover methods +
// leg constraints) and apply them to new shipments instead of auto-decomposing.

export interface RouteLeg {
  mode: TransportMode;
  origin: string;
  destination: string;
  verification?: HandoverVerification;
  constraints?: string[];
}

export interface RouteTemplate {
  id: string;
  name: string;
  legs: RouteLeg[];
  createdAt: string;
}

@Injectable()
export class RouteTemplateService {
  private readonly routes = new Map<string, RouteTemplate>();

  save(name: string, legs: RouteLeg[]): RouteTemplate {
    const route: RouteTemplate = { id: `rte_${randomBytes(8).toString('hex')}`, name, legs, createdAt: new Date().toISOString() };
    this.routes.set(route.id, route);
    return route;
  }

  list(): RouteTemplate[] {
    return [...this.routes.values()];
  }

  get(id: string): RouteTemplate {
    const route = this.routes.get(id);
    if (!route) throw new NotFoundException(`Route template not found: ${id}`);
    return route;
  }
}
