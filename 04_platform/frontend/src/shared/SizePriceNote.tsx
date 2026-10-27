import { useT } from './i18n';
import { Info } from './ui';
import { sizePriceLine, type ChargedBy } from './sizePrice';

/**
 * Under a measured parcel's price: whether its size or its weight set it, what it counts as — and, a tap away, the rule
 * behind it, so a big, light box's price is never a surprise left unexplained (the user, 2026-10-27: "build the say").
 */
export function SizePriceNote({ chargedBy }: { chargedBy?: ChargedBy }) {
  const t = useT();
  const line = sizePriceLine(chargedBy, t);
  if (!line) return null;
  return (
    <div class="info-row">
      <p class="card__note">{line}</p>
      <Info title={t('common.sizePrice.whyTitle')} aloud={`${t('common.sizePrice.whyRule')} ${t('common.sizePrice.whyMore')}`}>
        <p>{t('common.sizePrice.whyRule')}</p>
        <p>{t('common.sizePrice.whyMore')}</p>
      </Info>
    </div>
  );
}
