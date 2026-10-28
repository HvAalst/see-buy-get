import { useCallback, useEffect, useState } from 'preact/hooks';
import { PlaceMap, Sheet } from '../../../shared/ui';
import { ConsolePick } from '../ConsolePick';
import { useT } from '../../../shared/i18n';
import type { GeoPoint } from '../../../shared/geo';

export interface SiteView {
  siteId: string;
  kind: 'port' | 'clearance' | 'delivery' | 'loading';
  name: string;
  location: GeoPoint;
  address?: string;
  from: 'pin' | 'address';
  /** When goods are loaded there, and how many trucks at once: the company's own word, read by its carriers' plans. */
  loading?: { hours?: Record<string, { open: string; close: string } | null>; bays?: number; setAt: string; setBy: string };
}

type Api = {
  sites: (entityId: string, kind?: string) => Promise<{ data?: unknown; error?: unknown }>;
  declareSite: (entityId: string, body: Record<string, unknown>) => Promise<{ data?: unknown; error?: { detail?: string; title?: string } | null }>;
};

/**
 * WHERE, CHOSEN RATHER THAN TYPED.
 *
 * Minting a road leg asked for a port LATITUDE, a port LONGITUDE and a delivery LABEL — three fields,
 * two of which nobody knows by heart and the third of which is prose a driver has to interpret. The
 * user's objection was that it is not consistent, and it is not: one end was coordinates and the other
 * was a sentence. Both are the same thing — a place with a name and a point.
 *
 * So a place is saved ONCE and chosen afterwards, and saving one happens in a sheet rather than on the
 * form somebody is already filling in: adding a port is a different job from despatching a container,
 * and a form that grows a second form inside it is how both get done badly.
 *
 * TWO WAYS TO SAY WHERE, AS A TOGGLE, because they are different claims and the record keeps which was
 * used. A pin is somebody pointing at a gate. An address is resolved to the middle of a town we know —
 * enough to route a truck to the right part of a city, not enough to call it a gate. The note this
 * eventually prints on is a legal document, so the difference is shown rather than flattened.
 */
export function SitePicker({
  kind,
  entityId,
  api,
  value,
  onChange,
  label,
  addLabel,
}: {
  kind: 'port' | 'clearance' | 'delivery' | 'loading';
  entityId: string;
  api: Api | null;
  value: string;
  onChange: (siteId: string) => void;
  label: string;
  addLabel: string;
}) {
  const t = useT();
  const [sites, setSites] = useState<SiteView[]>([]);
  const [adding, setAdding] = useState(false);
  const [how, setHow] = useState<'pin' | 'address'>('pin');
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [pin, setPin] = useState<GeoPoint | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!api || !entityId) return;
    const r = await api.sites(entityId, kind);
    if (r.error || !r.data) return;
    setSites((r.data as { sites: SiteView[] }).sites ?? []);
  }, [api, entityId, kind]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!api) return;
    setBusy(true);
    setError(null);
    const r = await api.declareSite(entityId, {
      kind,
      name: name.trim(),
      // Exactly one of the two travels: the toggle is the answer to "how do you know where this is",
      // and sending both would let the server pick, which is us deciding what somebody meant.
      ...(how === 'pin' && pin ? { location: pin } : {}),
      ...(how === 'address' ? { address: address.trim() } : {}),
    });
    setBusy(false);
    if (r.error || !r.data) {
      setError(r.error?.detail || r.error?.title || t('tower.sites.failed'));
      return;
    }
    const made = r.data as SiteView;
    setSites((was) => [...was, made].sort((a, b) => a.name.localeCompare(b.name)));
    // Chosen straight away: somebody who just saved a port meant to use it.
    onChange(made.siteId);
    setAdding(false);
    setName('');
    setAddress('');
    setPin(null);
  };

  const chosen = sites.find((s) => s.siteId === value);

  return (
    <div class="cfield">
      <span class="cfield__label">{label}</span>
      <div class="twr-panelend">
        <ConsolePick bare label={label} value={value} onChange={onChange} placeholder={t('tower.sites.choose')} options={sites.map((s) => ({ value: s.siteId, label: s.name }))} />
        <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => setAdding(true)}>
          {addLabel}
        </button>
      </div>
      {/* Which KIND of answer this place is. Said on the form as well as on the note, because somebody
          choosing between two saved places is entitled to know which one was pointed at. */}
      {chosen ? <span class="chint">{chosen.from === 'pin' ? t('tower.sites.fromPin') : t('tower.sites.fromAddress', { address: chosen.address ?? '' })}</span> : null}

      {adding ? (
        <Sheet open onClose={() => setAdding(false)} title={addLabel}>
          <label class="cfield">
            <span class="cfield__label">{t('tower.sites.name')}</span>
            <input class="cinput" value={name} onChange={(e) => setName((e.target as HTMLInputElement).value)} placeholder={t(kind === 'port' ? 'tower.sites.namePortPh' : kind === 'loading' ? 'tower.sites.nameLoadingPh' : 'tower.sites.nameDeliveryPh')} />
          </label>

          <div class="twr-panelend">
            <button type="button" class={`cbtn cbtn--ghost cbtn--sm${how === 'pin' ? ' cbtn--on' : ''}`} aria-pressed={how === 'pin'} onClick={() => setHow('pin')}>
              {t('tower.sites.byPin')}
            </button>
            <button type="button" class={`cbtn cbtn--ghost cbtn--sm${how === 'address' ? ' cbtn--on' : ''}`} aria-pressed={how === 'address'} onClick={() => setHow('address')}>
              {t('tower.sites.byAddress')}
            </button>
          </div>

          {how === 'pin' ? (
            <>
              <PlaceMap onDrop={setPin} dropped={pin} label={t('tower.sites.mapLabel')} />
              <span class="chint">{pin ? t('tower.sites.pinAt', { lat: pin.lat.toFixed(4), lng: pin.lng.toFixed(4) }) : t('tower.sites.pinNone')}</span>
            </>
          ) : (
            <label class="cfield">
              <span class="cfield__label">{t('tower.sites.address')}</span>
              <input class="cinput" value={address} onChange={(e) => setAddress((e.target as HTMLInputElement).value)} placeholder={t('tower.sites.addressPh')} />
              <span class="chint">{t('tower.sites.addressHint')}</span>
            </label>
          )}

          {error ? <p class="cerr">{error}</p> : null}
          <div class="twr-panelend">
            <button type="button" class="cbtn cbtn--primary" disabled={busy || !name.trim() || (how === 'pin' ? !pin : !address.trim())} onClick={() => void save()}>
              {t('tower.sites.save')}
            </button>
          </div>
        </Sheet>
      ) : null}
    </div>
  );
}
