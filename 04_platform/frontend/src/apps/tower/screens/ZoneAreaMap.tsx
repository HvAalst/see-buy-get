import type { ComponentType } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { useT } from '../../../shared/i18n';
import type { ZoneAreaMapProps } from './ZoneAreaMapLeaflet';

/**
 * The zone map's frame: Leaflet is loaded only when the screen opens, asked once more after a blip, and said plainly when
 * it cannot be had — the list beside it still holds every zone, so nothing on the screen depends on the map alone.
 */
export function ZoneAreaMap(props: ZoneAreaMapProps) {
  const t = useT();
  const [Comp, setComp] = useState<ComponentType<ZoneAreaMapProps> | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    const load = () => import('./ZoneAreaMapLeaflet');
    void load()
      .catch(() => new Promise<Awaited<ReturnType<typeof load>>>((resolve, reject) => setTimeout(() => load().then(resolve, reject), 1500)))
      .then((m) => {
        if (live) setComp(() => m.ZoneAreaMapLeaflet);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, []);

  if (failed) return <p class="cons__empty">{t('tower.zones.map.failed')}</p>;
  if (!Comp) return <p class="cons__empty">{t('tower.zones.map.loading')}</p>;
  return <Comp {...props} />;
}
