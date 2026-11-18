/** The Send page's head, written at build time (send-head.mjs). */
export const SHARE_CARD: { path: string; width: number; height: number; type: string };
export const SEND_TITLE: string;
export const SEND_DESCRIPTION: string;
export const SEND_SUMMARY: string;
export function sendHead(html: string, site?: string): string;
