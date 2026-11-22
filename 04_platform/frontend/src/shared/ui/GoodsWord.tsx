import { Card } from './Card';
import { CheckGate } from './CheckGate';
import { useLocale, useT } from '../i18n';
import { countryNameIn } from '../documents/documents';
import type { SbgError } from '../../lib/sbg/errors';

/** 2026-11-22 — goods going to another EU country: the two countries, by their codes. */
export interface UnionPassage {
  fromCountry: string;
  toCountry: string;
}

/**
 * 2026-11-22 — THE SERVER ASKS FOR THE WORD (the owner's BG-2): a parcel or load to another EU country, where no customs list
 * what is inside, refused until its sender says it holds no alcohol, tobacco, medicines or weapons. The two countries it named,
 * or nothing for any other refusal — medicines by their kind of goods are refused outright and asked nothing.
 */
export function goodsWordAsked(error: SbgError | null | undefined): UnionPassage | null {
  const p = error?.params;
  if (error?.code !== 'GOODS_WITH_OWN_RULES' || p?.field !== 'noGoodsWithOwnRules') return null;
  return typeof p.fromCountry === 'string' && typeof p.toCountry === 'string' ? { fromCountry: p.fromCountry, toCountry: p.toCountry } : null;
}

/**
 * 2026-11-22 — TO ANOTHER EU COUNTRY (BG-2): no customs, so no invoice and no declaration, and so nobody reads what is inside.
 * The sender says it holds no alcohol, tobacco, medicines or weapons, which have rules of their own between EU countries; the
 * server refuses it unsaid. One card for every app that sends there: the Store app, the Business app, the Send app, the Shop app.
 */
export function GoodsWord({ passage, said, onChange }: { passage: UnionPassage; said: boolean; onChange: (said: boolean) => void }) {
  const t = useT();
  const locale = useLocale();
  const from = countryNameIn(passage.fromCountry, locale);
  const to = countryNameIn(passage.toCountry, locale);
  return (
    <Card title={t('common.union.title')} tone="soft">
      <p class="hint">{t('common.union.body', { from, to })}</p>
      <CheckGate items={[{ key: 'none', label: t('common.union.none') }]} checked={said ? ['none'] : []} onChange={(keys) => onChange(keys.length > 0)} />
    </Card>
  );
}
