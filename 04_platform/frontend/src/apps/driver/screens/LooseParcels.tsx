import { Button, Card, Note } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import type { LooseParcel } from '../types';
import { shopChoiceLine } from './ShopClosedSheet';

/**
 * 2026-11-06 — THE PARCELS HANDED TO THIS DRIVER LOOSE over a counter (the owner, point 6): never shown before. Each one's
 * shop; a shop closed — "Find another shop", its buyer choosing from the driver's pick; open but shut at the door — said so.
 */
export function LooseParcels({ loose, onFind }: { loose: LooseParcel[]; onFind: (p: LooseParcel, shut: boolean) => void }) {
  const t = useT();
  if (!loose.length) return null;
  return (
    <Card title={t('driver.loose.title', { count: loose.length })}>
      <ul class="rows">
        {loose.map((p) => (
          <li key={p.parcelId}>
            <div class="row row--static">
              <span class="row__body">
                <span class="row__t mono">{p.parcelId}</span>
                {p.destShop ? <span class="row__s">{t('driver.loose.to', { shop: p.destShop.name })}</span> : null}
              </span>
            </div>
            {p.destShop && !p.shopChoice?.settled ? (
              p.shopChoice ? (
                <p class="hint">{shopChoiceLine(p.shopChoice, t as never)}</p>
              ) : p.destShop.closed ? (
                <div class="load__nav">
                  <Note tone="warn" icon="warning" title={t('driver.shopClosed.title', { shop: p.destShop.name })} detail={t('driver.loose.closedDetail')} />
                  <Button full={false} onClick={() => onFind(p, false)}>
                    {t('driver.shopClosed.find')}
                  </Button>
                </div>
              ) : (
                <div class="load__nav">
                  <Button variant="link" full={false} onClick={() => onFind(p, true)}>
                    {t('driver.shopClosed.shut')}
                  </Button>
                </div>
              )
            ) : null}
          </li>
        ))}
      </ul>
    </Card>
  );
}
