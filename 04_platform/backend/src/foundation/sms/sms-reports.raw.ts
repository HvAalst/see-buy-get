import { raw } from 'express';

/**
 * 2026-11-16 — WHERE WHATSAPP AND TELEGRAM REPORT WHAT BECAME OF A CODE, read as the bytes they arrived in: each is
 * believed by a signature over those bytes (WhatsApp: `X-Hub-Signature-256`; Telegram: `X-Request-Signature`). Put in
 * front of every parser where the server starts (`main.ts`), as the mail provider's address is (readProviderEventsRaw).
 * Left out, nothing is believed.
 */
export const SIGNED_REPORT_PATHS = ['/v1/sms/status/whatsapp', '/v1/sms/status/telegram'] as const;

export function readSignedReportsRaw(app: { use: (...args: never[]) => unknown }): void {
  for (const path of SIGNED_REPORT_PATHS) (app.use as (path: string, handler: unknown) => unknown)(path, raw({ type: () => true, limit: '256kb' }));
}
