import { Card, CheckGate } from '../../../shared/ui';
import { useLocale, useT } from '../../../shared/i18n';
import { countryNameIn } from '../../../shared/documents/documents';
import type { QuoteView } from '../types';

/**
 * 2026-11-22 — TO ANOTHER EU COUNTRY (the owner's BG-2): no customs, so no invoice and no declaration — and so nobody reads what
 * is inside. The store says it holds no alcohol, tobacco, medicines or weapons, which have rules of their own between EU
 * countries; the label is not minted until it is ticked, and the server refuses it unticked.
 */
export function UnionCard({ passage, said, onChange }: { passage: NonNullable<QuoteView['withinUnion']>; said: boolean; onChange: (said: boolean) => void }) {
  const t = useT();
  const locale = useLocale();
  const from = countryNameIn(passage.fromCountry, locale);
  const to = countryNameIn(passage.toCountry, locale);
  return (
    <Card title={t('vendor.union.title')} tone="soft">
      <p class="hint">{t('vendor.union.body', { from, to })}</p>
      <CheckGate items={[{ key: 'none', label: t('vendor.union.none') }]} checked={said ? ['none'] : []} onChange={(keys) => onChange(keys.length > 0)} />
    </Card>
  );
}
