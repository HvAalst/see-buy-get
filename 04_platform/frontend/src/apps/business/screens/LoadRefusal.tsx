import { useState } from 'preact/hooks';
import { useT } from '../../../shared/i18n';
import { refusalSays, type RefusalChoice } from '../../../shared/refusal';
import { SitePicker, type SiteView } from '../../tower/screens/SitePicker';
import type { BusinessClient, BusinessView, PostedLoad } from '../api';

/**
 * REFUSED AT THE DOOR (the user, 2026-10-27): the business says where the goods go — back to where they were picked up,
 * to one of its places, or given up — and pays the way; the driver who has them carries them on as a new load. With no
 * answer in 48 hours they go back. Once said, what became of them. The choice opens here, in the panel, as a claim does.
 */
export function LoadRefusal({ row, client, business, act, onChanged }: { row: PostedLoad; client: BusinessClient | null; business: BusinessView; act: boolean; onChanged: (message?: string) => void | Promise<void> }) {
  const t = useT();
  const [open, setOpen] = useState<RefusalChoice | null>(null);
  const [siteId, setSiteId] = useState('');
  const [contact, setContact] = useState({ name: '', phone: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const r = row.refusal;
  if (!r) return null;
  const pickup = row.pickupLabel ?? '';
  const decide = Boolean(row.canDecideRefusal && act && client);

  const send = async (choice: RefusalChoice) => {
    if (!client) return;
    setBusy(true);
    setError(null);
    let body: Parameters<BusinessClient['shipping']['decideRefusal']>[1] = { choice };
    if (choice === 'elsewhere') {
      // One of its saved places: their name and point are what the new load and its note carry.
      const sites = ((await client.api.sites(business.entityId)) as unknown as { data?: { sites?: SiteView[] } }).data?.sites ?? [];
      const site = sites.find((s) => s.siteId === siteId);
      if (!site) {
        setBusy(false);
        return setError(t('refusal.err.pin'));
      }
      body = { choice, destLabel: site.name, destLocation: site.location, ...(contact.name.trim() ? { contactName: contact.name.trim() } : {}), ...(contact.phone.trim() ? { contactPhone: contact.phone.trim() } : {}) };
    }
    const res = await client.shipping.decideRefusal(row.freightId, body);
    setBusy(false);
    if (res.error) return setError((res.error as { detail?: string; title?: string }).detail || (res.error as { title?: string }).title || '');
    setOpen(null);
    await onChanged(t(choice === 'give_up' ? 'refusal.done.giveUp' : choice === 'back' ? 'refusal.done.back' : 'refusal.done.elsewhere'));
  };

  return (
    <section class="cons__panel">
      <div class="cons__panelhead">
        <span class="cons__panelt">{t('refusal.head')}</span>
        {r.decision ? null : <span class="ctag ctag--warn">{t('refusal.status')}</span>}
      </div>
      {refusalSays(r, pickup, t).map((line) => (
        <p class="cons__lede" key={line}>
          {line}
        </p>
      ))}
      {!decide ? null : open === 'back' ? (
        <>
          <p class="cons__lede">{t('refusal.backBody')}</p>
          {error ? <p class="cerr">{error}</p> : null}
          <div class="twr-panelend">
            <button type="button" class="cbtn cbtn--primary" disabled={busy} onClick={() => void send('back')}>
              {t('refusal.backYes')}
            </button>
            <button type="button" class="cbtn cbtn--ghost" onClick={() => setOpen(null)}>
              {t('refusal.notNow')}
            </button>
          </div>
        </>
      ) : open === 'elsewhere' ? (
        <>
          <p class="cons__lede">{t('refusal.elsewhereBody')}</p>
          <SitePicker kind="delivery" entityId={business.entityId} api={client!.api as never} value={siteId} onChange={setSiteId} label={t('refusal.placeLabel')} addLabel={t('business.loads.f.addPlace')} />
          <div class="biz-two">
            <label class="cfield">
              <span class="cfield__label">{t('refusal.contactName')}</span>
              <input class="cinput" maxLength={80} value={contact.name} onInput={(e) => setContact((c) => ({ ...c, name: (e.target as HTMLInputElement).value }))} />
            </label>
            <label class="cfield">
              <span class="cfield__label">{t('refusal.contactPhone')}</span>
              <input class="cinput" maxLength={32} inputMode="tel" value={contact.phone} onInput={(e) => setContact((c) => ({ ...c, phone: (e.target as HTMLInputElement).value }))} />
            </label>
          </div>
          {error ? <p class="cerr">{error}</p> : null}
          <div class="twr-panelend">
            <button type="button" class="cbtn cbtn--primary" disabled={busy || !siteId} onClick={() => void send('elsewhere')}>
              {t('refusal.send')}
            </button>
            <button type="button" class="cbtn cbtn--ghost" onClick={() => setOpen(null)}>
              {t('refusal.notNow')}
            </button>
          </div>
        </>
      ) : open === 'give_up' ? (
        <>
          <p class="cons__lede">{t('refusal.giveUpBody')}</p>
          {error ? <p class="cerr">{error}</p> : null}
          <div class="twr-panelend">
            <button type="button" class="cbtn cbtn--primary" disabled={busy} onClick={() => void send('give_up')}>
              {t('refusal.giveUpYes')}
            </button>
            <button type="button" class="cbtn cbtn--ghost" onClick={() => setOpen(null)}>
              {t('refusal.notNow')}
            </button>
          </div>
        </>
      ) : (
        <div class="twr-panelend">
          <button type="button" class="cbtn cbtn--primary cbtn--sm" onClick={() => setOpen('back')}>
            {t('refusal.back', { pickup })}
          </button>
          <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => setOpen('elsewhere')}>
            {t('refusal.elsewhere')}
          </button>
          <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => setOpen('give_up')}>
            {t('refusal.giveUp')}
          </button>
        </div>
      )}
    </section>
  );
}
