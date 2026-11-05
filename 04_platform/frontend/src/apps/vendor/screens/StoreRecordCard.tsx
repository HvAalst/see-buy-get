import { useEffect, useState } from 'preact/hooks';
import { Card, Icon } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import { frontDoorUrl } from '../../../shared/frontDoor';
import { fetchStoreRecord, type StoreRecordView } from '../api';

/** Below this many shipments a rate is a headline made of one or two parcels: counted instead (the server's floor of 3). */
const FEW = 3;

/**
 * 2026-11-05 — HOW BUYERS SEE YOU: a store's own public record, in its own app.
 *
 * The record had been public since October — measured by us, the same for every store, not the store's to switch off —
 * and the store itself was never shown it. Yet that is the sell the whole idea rests on: a store that ships fast earns
 * a record slow competitors cannot fake, and puts the link beside its shipping price. So the store sees what a buyer
 * sees (the same answer, from the same public door), opens the page itself, and is told the one setting that puts the
 * link at its checkout. Nothing here changes the record: there is nothing on this card that could.
 */
export function StoreRecordCard({ vendorId }: { vendorId?: string }) {
  const t = useT();
  const [record, setRecord] = useState<StoreRecordView | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!vendorId) return;
    let live = true;
    void fetchStoreRecord(vendorId).then((r) => {
      if (!live) return;
      if (r.error) setFailed(true);
      else setRecord(r.data);
    });
    return () => {
      live = false;
    };
  }, [vendorId]);

  if (!vendorId) return null;
  const page = `${frontDoorUrl()}?store=${encodeURIComponent(vendorId)}`;
  const few = record ? record.shipments > 0 && record.shipments < FEW : false;

  return (
    <Card title={t('vendor.record.title')}>
      <p class="card__note">{t('vendor.record.lede')}</p>
      {failed ? (
        <p class="hint">{t('vendor.record.error')}</p>
      ) : !record ? (
        <p class="hint">{t('vendor.record.loading')}</p>
      ) : record.shipments === 0 ? (
        <p class="t-body">{t('vendor.record.none')}</p>
      ) : (
        <>
          <p class="t-body">
            {few && record.nextDayCount != null
              ? t('vendor.record.nextDayFew', { n: String(record.nextDayCount), m: String(record.shipments) })
              : t('vendor.record.nextDay', { pct: `${Math.round((record.shipsNextDayRate ?? 0) * 100)}%` })}
          </p>
          <p class="card__note">
            {record.rating.isNew
              ? t('vendor.record.ratingNew', { count: record.rating.count })
              : t('vendor.record.rating', { avg: record.rating.average.toFixed(1), count: record.rating.count })}
          </p>
        </>
      )}
      <a class="btn btn--link" href={page} target="_blank" rel="noopener">
        <span class="btn__row">
          {t('vendor.record.open')}
          <Icon name="chevronRight" size={18} />
        </span>
      </a>
      {/* The one setting that puts the link at the checkout — the widget is the store's to place, the record is not theirs to hide. */}
      <p class="card__note">{t('vendor.record.widgetLead')}</p>
      <p class="mono-t" style="word-break:break-all">{`store="${vendorId}"`}</p>
      <p class="card__note">{t('vendor.record.widgetAfter')}</p>
    </Card>
  );
}
