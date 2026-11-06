import { useEffect, useState } from 'preact/hooks';
import { Button, Icon, Pill, Sheet } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import type { Claimable } from '../types';
import type { DriverActions } from '../useDriverApp';

const MAX_PICKS = 3;

/** A bag on board, or a parcel handed over loose, whose shop is closed — or found shut. */
export interface ShopClosedTarget {
  kind: 'bag' | 'parcel';
  ref: string;
  shop: string;
  shut: boolean;
}

/**
 * 2026-11-06 — A BAG ON BOARD — OR A PARCEL HANDED OVER LOOSE — FOR A SHOP THAT IS CLOSED (the owner, point 6: "let a driver
 * be able to search for a pudos near to the closed shop so the buyer can select from his pick"): the open shops near it with
 * room, nearest first; the driver picks up to three they can take it to — the first is where it goes when nobody chooses.
 * Its buyers are asked. Found SHUT though it never said so: said, and the shop and operations told.
 */
export function ShopClosedSheet({ target, actions, busy, onClose }: { target: ShopClosedTarget | null; actions: DriverActions; busy?: boolean; onClose: () => void }) {
  const t = useT();
  const [near, setNear] = useState<{ shops: Array<{ did: string; name: string; km: number }> } | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const key = target ? `${target.kind}:${target.ref}` : null;
  useEffect(() => {
    setNear(null);
    setPicked([]);
    if (target) void actions.shopsNear(target.kind, target.ref).then((n) => setNear(n ?? { shops: [] }));
  }, [key]);
  const toggle = (did: string) => setPicked((p) => (p.includes(did) ? p.filter((x) => x !== did) : p.length < MAX_PICKS ? [...p, did] : p));
  return (
    <Sheet open={target !== null} onClose={onClose} title={target?.shut ? t('driver.shopClosed.shutTitle', { shop: target.shop }) : t('driver.shopClosed.findTitle')}>
      <p class="hint">{target?.shut ? t('driver.shopClosed.shutLede') : t('driver.shopClosed.findLede')}</p>
      {near === null ? (
        <p class="hint">{t('driver.shopClosed.loading')}</p>
      ) : near.shops.length === 0 ? (
        <p class="hint">{t('driver.shopClosed.none')}</p>
      ) : (
        <div class="rows">
          {near.shops.map((s) => {
            const n = picked.indexOf(s.did);
            return (
              <button key={s.did} type="button" class="row" aria-pressed={n >= 0} onClick={() => toggle(s.did)}>
                <span class="row__body">
                  <span class="row__t">{s.name}</span>
                  <span class="row__s">{t('driver.shopClosed.km', { km: s.km })}</span>
                </span>
                <span class="row__end">{n >= 0 ? <Pill tone="ok">{String(n + 1)}</Pill> : <Icon name="chevronRight" size={22} />}</span>
              </button>
            );
          })}
        </div>
      )}
      <Button chevron={false} busy={busy} disabled={!picked.length} onClick={() => target && void actions.askBuyers(target.kind, target.ref, picked, target.shut).then((ok) => ok && onClose())}>
        {t('driver.shopClosed.ask')}
      </Button>
      <Button variant="link" onClick={onClose}>
        {t('driver.shopClosed.cancel')}
      </Button>
    </Sheet>
  );
}

/** The line once its buyers were asked: how many answered, and the shop to take it to (most chose; else the first pick). */
export function shopChoiceLine(c: NonNullable<Claimable['shopChoice']>, t: (key: 'driver.shopClosed.status', values: Record<string, string | number>) => string): string {
  return t('driver.shopClosed.status', { answered: c.answered, asked: c.of, shop: c.leading.name });
}
