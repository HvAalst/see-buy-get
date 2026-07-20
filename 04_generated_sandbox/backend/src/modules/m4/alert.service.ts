import { Injectable, OnModuleInit } from '@nestjs/common';
import { createHmac, randomBytes } from 'crypto';
import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import { Severity } from './exception.types';

export type AlertChannel = 'in_app' | 'email' | 'sms' | 'webhook';

export interface AlertRule {
  id: string;
  /** What to alert on: any exception, or only those at/above a severity, or a specific type. */
  on: 'exception' | 'delivered';
  minSeverity?: Severity;
  exceptionType?: string;
  lane?: string; // reserved filter (zone/lane)
  channels: AlertChannel[];
  label: string;
}

export interface Notification {
  id: string;
  ruleId: string;
  channel: AlertChannel;
  glosShipmentId: string;
  message: string;
  severity?: Severity;
  at: string;
}

export interface WebhookDelivery {
  id: string;
  url: string;
  event: string;
  signature: string; // HMAC-SHA256 of the body
  body: string;
  attempt: number;
  at: string;
}

const SEVERITY_RANK: Record<Severity, number> = { low: 0, medium: 1, high: 2, critical: 3 };

/**
 * AlertService (VTT-050/051/053). Configurable alert rules → multi-channel notifications
 * (in-app / email / sms / webhook) plus a webhook streaming outbox: validated events + exceptions
 * are pushed to registered endpoints with HMAC-SHA256-signed payloads (at-least-once, reusing the
 * event bus). Channels other than in-app/webhook are recorded as queued notifications (no real
 * email/SMS gateway in the sandbox).
 */
@Injectable()
export class AlertService implements OnModuleInit {
  private readonly rules = new Map<string, AlertRule>();
  private readonly webhooks = new Map<string, { url: string; secret: string; events: string[] }>();
  private readonly notifications: Notification[] = [];
  private readonly outbox: WebhookDelivery[] = [];

  constructor(private readonly events: EventBus) {}

  onModuleInit(): void {
    this.events.subscribe<{ glosShipmentId: string; exceptionType?: string; severity?: Severity; reason?: string }>(GlosEvent.Tracking.ExceptionRaised, (e) => {
      this.fanOut('exception', e.payload.glosShipmentId, { severity: e.payload.severity, exceptionType: e.payload.exceptionType, message: e.payload.reason ?? 'Exception raised' });
      this.stream('tracking.exception_raised', e.payload);
    });
    for (const topic of [GlosEvent.Tracking.PickupOk, GlosEvent.Tracking.HandoverOk, GlosEvent.Tracking.Delivered]) {
      this.events.subscribe<{ glosShipmentId: string }>(topic, (e) => {
        if (topic === GlosEvent.Tracking.Delivered) this.fanOut('delivered', e.payload.glosShipmentId, { message: 'Delivered' });
        this.stream(topic, e.payload);
      });
    }
  }

  // --- rules + webhooks ---

  addRule(input: Omit<AlertRule, 'id'>): AlertRule {
    const rule: AlertRule = { id: `rule_${randomBytes(5).toString('hex')}`, ...input };
    this.rules.set(rule.id, rule);
    return rule;
  }

  listRules(): AlertRule[] {
    return [...this.rules.values()];
  }

  registerWebhook(input: { url: string; secret?: string; events?: string[] }): { id: string; url: string; events: string[] } {
    const id = `wh_${randomBytes(5).toString('hex')}`;
    const events = input.events ?? ['tracking.exception_raised', 'tracking.delivered'];
    this.webhooks.set(id, { url: input.url, secret: input.secret ?? 'glos-secret', events });
    return { id, url: input.url, events };
  }

  notificationsFor(glosShipmentId?: string): Notification[] {
    return (glosShipmentId ? this.notifications.filter((n) => n.glosShipmentId === glosShipmentId) : this.notifications).slice(-100).reverse();
  }

  webhookOutbox(): WebhookDelivery[] {
    return this.outbox.slice(-100).reverse();
  }

  // --- internals ---

  private fanOut(on: AlertRule['on'], glosShipmentId: string, ctx: { severity?: Severity; exceptionType?: string; message: string }): void {
    for (const rule of this.rules.values()) {
      if (rule.on !== on) continue;
      if (rule.minSeverity && (!ctx.severity || SEVERITY_RANK[ctx.severity] < SEVERITY_RANK[rule.minSeverity])) continue;
      if (rule.exceptionType && rule.exceptionType !== ctx.exceptionType) continue;
      for (const channel of rule.channels) {
        this.notifications.push({ id: `ntf_${randomBytes(5).toString('hex')}`, ruleId: rule.id, channel, glosShipmentId, message: `${rule.label}: ${ctx.message}`, severity: ctx.severity, at: new Date().toISOString() });
      }
    }
  }

  /** Push a validated event/exception to every subscribed webhook, HMAC-signed (VTT-053). */
  private stream(event: string, payload: unknown): void {
    const body = JSON.stringify({ event, payload, at: new Date().toISOString() });
    for (const [, hook] of this.webhooks) {
      if (!hook.events.includes(event)) continue;
      const signature = createHmac('sha256', hook.secret).update(body).digest('hex');
      this.outbox.push({ id: `dlv_${randomBytes(5).toString('hex')}`, url: hook.url, event, signature, body, attempt: 1, at: new Date().toISOString() });
    }
  }
}
