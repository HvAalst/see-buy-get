import { useEffect, useState } from 'preact/hooks';
import { Button, Icon, Pill, Sheet } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import type { Claimable } from '../types';
import type { DriverActions } from '../useDriverApp';

const MAX_PICKS = 3;

/**
 * 2026-11-06 — A BAG ON BOARD FOR A SHOP THAT IS CLOSED (the owner, point 6: "let a driver be able to search for a pudos near
 * to the closed shop so the buyer can select from his pick"): the open shops near it with room for the whole bag, nearest
 * first; the driver picks up to three they can take it to — the first is where it goes when nobody chooses. Its buyers are
 * asked; the bag goes whole to the shop most chose. Found SHUT though it never said so: said, and the shop and operations told.
 */
export function ShopClosedSheet({ target, actions, busy, onClose }: { target: { claim: Claimable; shut: boolean } | null; actions: DriverActions; busy?: boolean; onClose: () => void }) {
  const t = useT();
  const code = target ? (target.claim.code ?? target.claim.ref) : null;
  const [near, setNear] = useState<{ shops: Array<{ did: string; name: string; km: number }> } | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  useEffect(() => {
    setNear(null);
    setPicked([]);
    if (code) void actions.shopsNear(code).then((n) => setNear(n ?? { shops: [] }));
  }, [code]);
  const toggle = (did: string) => setPicked((p) => (p.includes(did) ? p.filter((x) => x !== did) : p.length < MAX_PICKS ? [...p, did] : p));
  const shop = target?.claim.destShop?.name ?? '';
  return (
    <Sheet open={target !== null} onClose={onClose} title={target?.shut ? t('driver.shopClosed.shutTitle', { shop }) : t('driver.shopClosed.findTitle')}>
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
      <Button chevron={false} busy={busy} disabled={!picked.length} onClick={() => code && target && void actions.askBuyers(code, picked, target.shut).then((ok) => ok && onClose())}>
        {t('driver.shopClosed.ask')}
      </Button>
      <Button variant="link" onClick={onClose}>
        {t('driver.shopClosed.cancel')}
      </Button>
    </Sheet>
  );
}

/** The bag's line once its buyers were asked: how many answered, and the shop to take it to (most chose; else the first pick). */
export function shopChoiceLine(c: NonNullable<Claimable['shopChoice']>, t: (key: 'driver.shopClosed.status', values: Record<string, string | number>) => string): string {
  return t('driver.shopClosed.status', { answered: c.answered, asked: c.of, shop: c.leading.name });
}
