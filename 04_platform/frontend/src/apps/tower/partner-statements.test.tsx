import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { t } from '../../shared/i18n';
import { PartnerStatementsBody, statementState, unpaidLine, type PartnerStatements } from './screens/PartnerStatementsFold';
import { StatementsSection } from '../partner/screens/MoneyScreen';

/*
 * 2026-11-24 — WHAT COMPANIES OF OURS OWE A PARTNER, WEEK BY WEEK (route plan part 4; the owner: "we owe it weekly"): on the
 * partner's page in the console, with "Paid" and the transfer's reference for a week over; in the Partner app, read only.
 */
const view: PartnerStatements = {
  statements: [
    { statementId: 'pst_open', sellerName: 'SeeBuyGet Nederland', weekStart: '2026-11-29', weekEnd: '2026-12-05', amount: 12, currency: 'EUR', steps: 1, closed: false },
    { statementId: 'pst_due', sellerName: 'SeeBuyGet Nederland', weekStart: '2026-11-22', weekEnd: '2026-11-28', amount: 40, currency: 'EUR', steps: 3, closed: true },
    { statementId: 'pst_paid', sellerName: 'SeeBuyGet Nederland', weekStart: '2026-11-15', weekEnd: '2026-11-21', amount: 25, currency: 'EUR', steps: 2, closed: true, paidAt: '2026-11-23T09:00:00Z', paidBy: 'Amina', paidReference: 'NL12-0042' },
  ],
  unpaid: { EUR: 40 },
};

describe('what we owe a partner, week by week', () => {
  it('says what is still to pay, and each week’s state', () => {
    expect(unpaidLine(view, t)).toContain(t('tower.partner.statementsUnpaid', { amount: '' }).trim().split(':')[0]);
    expect(unpaidLine({ ...view, unpaid: {} }, t)).toBe(t('tower.partner.statementsAllPaid'));
    expect(statementState(view.statements[0], t)).toBe(t('tower.partner.statementOpen'));
    expect(statementState(view.statements[1], t)).toBe(t('tower.partner.statementToPay'));
    expect(statementState(view.statements[2], t)).toBe(t('tower.partner.statementPaid', { date: '2026-11-23', by: 'Amina', reference: 'NL12-0042' }));
  });

  it('offers "Paid" only for a week over and not paid yet; nothing owed is said so', () => {
    const html = renderToString(<PartnerStatementsBody view={view} t={t} onPaid={() => undefined} />);
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html.match(/<input/g)).toHaveLength(1);
    expect(html).toContain(t('tower.partner.statementWeek', { from: '2026-11-22', to: '2026-11-28' }));
    expect(html).toContain(t('tower.partner.statementWho', { company: 'SeeBuyGet Nederland', n: 3 }));
    expect(renderToString(<PartnerStatementsBody view={{ statements: [], unpaid: {} }} t={t} />)).toContain(t('tower.partner.statementsNone'));
  });

  it('the partner reads its own weeks in its app, with no button to press', () => {
    const html = renderToString(<StatementsSection view={view} t={t} />);
    expect(html).toContain(t('partner.app.statements.title'));
    expect(html).toContain(t('partner.app.statements.paid', { date: '2026-11-23', reference: 'NL12-0042' }));
    expect(html).not.toContain('<button');
    expect(renderToString(<StatementsSection view={{ statements: [], unpaid: {} }} t={t} />)).toBe('');
    // …on its Money screen, from what the app read.
    expect(readFileSync(join('src/apps/partner/screens', 'MoneyScreen.tsx'), 'utf8')).toMatch(/<StatementsSection view=\{state\.statements\} t=\{t\} \/>/);
    expect(readFileSync(join('src/apps/partner', 'usePartnerApp.ts'), 'utf8')).toMatch(/partner\.current\.statements\(\)/);
  });
});
