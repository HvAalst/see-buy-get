import { useEffect } from 'preact/hooks';
import { Button, Card, CheckGate } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import { money } from '../logic';
import { EMPTY_LINE, MAX_ADDRESS, papersGaps, papersTotals, type PapersForm, type PapersLine } from '../papers';
import type { QuoteView } from '../types';

/**
 * ITS PAPERS ABROAD (the user, round 13: per item "As shippers do"; the buyer "shop or address as per the decision of
 * both sender and receiver. Address entered is address carried"; "The store, with the label"). On the price step, only
 * for a shipment whose route crosses a border: the commercial invoice it goes with, item by item, signed by the
 * declaration. The label is not minted until it is complete; the three copies are printed with the label.
 */
export function PapersCard({ quote, papers, onChange }: { quote: QuoteView; papers: PapersForm; onChange: (p: PapersForm) => void }) {
  const t = useT();
  const set = (patch: Partial<PapersForm>) => onChange({ ...papers, ...patch });
  const setLine = (i: number, patch: Partial<PapersLine>) => set({ lines: papers.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) });
  // The goods' money starts as the shipment's: most stores sell in the money they ship in. Theirs to change.
  useEffect(() => {
    if (!papers.currency && quote.currency) set({ currency: quote.currency });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quote.currency]);
  const crossing = (quote.crossings ?? []).map((c) => `${c.fromCountry} → ${c.toCountry}`).join(', ');
  const totals = papersTotals(papers);
  const gaps = papersGaps(papers);
  const field = (id: string, label: string, value: string, onInput: (v: string) => void, extra: Record<string, unknown> = {}) => (
    <div class="field">
      <label class="field__label" for={id}>
        {label}
      </label>
      <input id={id} class="input" value={value} onInput={(e) => onInput(e.currentTarget.value)} {...extra} />
    </div>
  );

  return (
    <Card title={t('vendor.papers.title')}>
      <p class="card__note">{t('vendor.papers.lede', { crossing })}</p>
      {field('papers-number', t('vendor.papers.number'), papers.number, (v) => set({ number: v }), { maxLength: 40 })}
      {field('papers-currency', t('vendor.papers.currency'), papers.currency, (v) => set({ currency: v.toUpperCase() }), { maxLength: 3, autocapitalize: 'characters' })}
      {field('papers-buyer', t('vendor.papers.buyer'), papers.buyerName, (v) => set({ buyerName: v }), { maxLength: 120 })}
      <div class="field">
        <label class="field__label" for="papers-address">
          {t('vendor.papers.address')}
        </label>
        {/* Carried exactly as typed — line breaks and all — or, left empty, the shop the buyer collects from. */}
        <textarea id="papers-address" class="input" rows={3} value={papers.buyerAddress} onInput={(e) => set({ buyerAddress: e.currentTarget.value })} />
        <p class="hint">{t('vendor.papers.addressHint', { max: MAX_ADDRESS })}</p>
      </div>

      {papers.lines.map((l, i) => (
        <div key={i} class="papers__line">
          <p class="card__note" style="margin-bottom:4px">
            <b>{t('vendor.papers.line', { n: i + 1 })}</b>
          </p>
          {field(`papers-${i}-description`, t('vendor.papers.description'), l.description, (v) => setLine(i, { description: v }), { maxLength: 200 })}
          <div class="dims">
            {field(`papers-${i}-quantity`, t('vendor.papers.quantity'), l.quantity, (v) => setLine(i, { quantity: v }), { inputMode: 'numeric' })}
            {field(`papers-${i}-netKg`, t('vendor.papers.netKg'), l.netKg, (v) => setLine(i, { netKg: v }), { inputMode: 'decimal' })}
          </div>
          <div class="dims">
            {field(`papers-${i}-unitValue`, t('vendor.papers.unitValue', { currency: papers.currency || '' }), l.unitValue, (v) => setLine(i, { unitValue: v }), { inputMode: 'decimal' })}
            {field(`papers-${i}-origin`, t('vendor.papers.origin'), l.originCountry, (v) => setLine(i, { originCountry: v.toUpperCase() }), { maxLength: 2, autocapitalize: 'characters' })}
          </div>
          {field(`papers-${i}-hs`, t('vendor.papers.hs'), l.hsCode, (v) => setLine(i, { hsCode: v }), { maxLength: 16, inputMode: 'numeric' })}
          {papers.lines.length > 1 ? (
            <Button variant="link" full={false} onClick={() => set({ lines: papers.lines.filter((_, j) => j !== i) })}>
              {t('vendor.papers.removeLine')}
            </Button>
          ) : null}
        </div>
      ))}
      <Button variant="link" full={false} onClick={() => set({ lines: [...papers.lines, { ...EMPTY_LINE }] })}>
        {t('vendor.papers.addLine')}
      </Button>

      <p class="kv">
        <span>{t('vendor.papers.totals')}</span>
        <b>{`${money(totals.value, papers.currency || quote.currency)} · ${totals.netKg} kg`}</b>
      </p>
      <CheckGate items={[{ key: 'declare', label: t('vendor.papers.declare') }]} checked={papers.declared ? ['declare'] : []} onChange={(keys) => set({ declared: keys.length > 0 })} />
      {gaps.length ? <p class="hint">{t('vendor.papers.missing')}</p> : null}
    </Card>
  );
}
