import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { t } from '../../shared/i18n';
import './english';
import { PaidLabelCard, PayOnlineBody, stickSteps } from './screens/PayOnline';
import { printParcelLabel } from '../../shared/print-label';
import type { BookingPayView } from './types';

/*
 * 2026-11-21 — PAY NOW, PRINT AT HOME (the payments plan, 5a/5b; P5-a "netherlands first", P5-b "it stays optional"; the owner:
 * "with the print option comes the instruction on how to paste it on the parcel"). Offered where it runs, beside the code; the
 * label once paid, with how to stick it on; at the shop, nothing to take.
 */
const body = (view: BookingPayView | null) => renderToString(<PayOnlineBody view={view} busy={false} failed={null} onPay={() => undefined} />);

describe('paying a booking online', () => {
  it('offered: the price, iDEAL, and the shop beside it; nothing where it is not offered', () => {
    const html = body({ offered: true, amount: 7.95, currency: 'EUR', testmode: false });
    expect(html).toContain(t('send.pay.title'));
    expect(html).toContain('iDEAL');
    expect(html).toContain('7.95');
    expect(html).toContain(t('send.pay.orShop'));
    expect(html).not.toContain(t('send.pay.testTitle'));
    expect(body({ offered: false, why: 'not_here' })).toBe('');
    expect(body(null)).toBe('');
  });

  it('test money said as such; a payment not made said, and offered again', () => {
    expect(body({ offered: true, amount: 7.95, currency: 'EUR', testmode: true })).toContain(t('send.pay.testTitle'));
    expect(body({ offered: true, amount: 7.95, currency: 'EUR', status: 'expired' })).toContain(t('send.pay.notPaid'));
  });

  it('back from the bank before the bank said: waiting, with the way back to paying', () => {
    const html = body({ offered: true, amount: 7.95, currency: 'EUR', status: 'open', checkoutUrl: 'https://www.mollie.com/checkout/x' });
    expect(html).toContain(t('send.pay.waitingTitle'));
    expect(html).toContain(t('send.pay.backToBank'));
  });

  it('paid: the label, a button to print it, and the shop as the other way', () => {
    const html = renderToString(<PaidLabelCard parcelId="PUD-NL1" svg="<svg width='320' height='400'><rect/></svg>" />);
    expect(html).toContain(t('send.pay.paidTitle'));
    expect(html).toContain(t('send.pay.print'));
    expect(html).toContain(t('send.pay.orShow'));
    expect(html).toContain('<rect');
  });

  it('the printed page: the label at 100 mm, and how to stick it on, step by step', () => {
    const written: string[] = [];
    const win = { document: { write: (s: string) => written.push(s), close: () => undefined }, focus: () => undefined, print: () => undefined };
    vi.stubGlobal('open', () => win);
    expect(printParcelLabel({ title: 'PUD-NL1', svg: '<svg width="320" height="400"><rect/></svg>', steps: stickSteps(t), note: t('send.pay.printNote') })).toBe(true);
    const page = written.join('');
    expect(page).toContain('<svg width="100mm"');
    for (const step of stickSteps(t)) expect(page).toContain(step.replace(/&/g, '&amp;'));
    expect(stickSteps(t)).toHaveLength(5);
    vi.stubGlobal('open', () => null);
    expect(printParcelLabel({ title: 'PUD-NL1', svg: '<svg/>', steps: [] })).toBe(false);
    vi.unstubAllGlobals();
  });
});

describe('where it is reached', () => {
  const src = (p: string) => readFileSync(join('src', p), 'utf8');
  it('the Send app: after booking, and on the booking until it is handed in', () => {
    expect(src('apps/genesis/screens/SendScreen.tsx')).toContain('<PayOnlineCard parcelId={m.parcel.parcelId}');
    const mine = src('apps/genesis/screens/MyParcelsScreen.tsx');
    expect(mine).toContain('<PaidLabelCard parcelId={parcel.parcelId} svg={parcel.label} />');
    expect(mine).toContain('<PayOnlineCard parcelId={parcel.parcelId}');
  });

  it('the Shop app: paid online, nothing to take — said, and the button only takes it in', () => {
    const accept = src('apps/agent/screens/AcceptScreen.tsx');
    expect(accept).toContain("t('agent.accept.paidOnlineTitle')");
    expect(accept).toContain("pm.kind === 'peer_send' && !pm.paidOnline ? t('agent.accept.collectAndTakeIn'");
  });

  it('every new word in each language', async () => {
    for (const locale of ['nl', 'sw', 'am'] as const) {
      const send = (await import(`../../shared/i18n/words/${locale}/send.ts`)).words as Record<string, string>;
      const agent = (await import(`../../shared/i18n/words/${locale}/agent.ts`)).words as Record<string, string>;
      for (const k of ['send.pay.title', 'send.pay.cta', 'send.pay.step1', 'send.pay.step5', 'send.pay.paidBody']) expect(send[k], `${locale} ${k}`).toBeTruthy();
      for (const k of ['agent.accept.paidOnlineTitle', 'agent.accept.paidOnlineDetail']) expect(agent[k], `${locale} ${k}`).toBeTruthy();
    }
  });
});
