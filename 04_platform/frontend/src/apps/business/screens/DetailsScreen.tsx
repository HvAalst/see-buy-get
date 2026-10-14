import { useCallback, useEffect, useState } from 'preact/hooks';
import { useT } from '../../../shared/i18n';
import { ContactCardPanel } from '../../tower/screens/ContactCardPanel';
import type { SiteView } from '../../tower/screens/SitePicker';
import type { BusinessActivity, BusinessClient, BusinessView } from '../api';
import { ACTIVITIES, mayManage } from '../logic';
import type { BusinessActions } from '../useBusinessApp';
import { ACTIVITY_LABEL, ACTIVITY_SUB } from './ChooseScreen';

/**
 * WHAT THE BUSINESS SAYS ABOUT ITSELF — its name and numbers, what it does, how to reach it, the places it uses.
 *
 * The name and the registration number are what SeeBuyGet checked, so changing either puts the business back to
 * unchecked — and the form says that before it is saved, not after. What it does and its tax number are its own to
 * change at any time.
 */
export function DetailsScreen({ business, actions, client }: { business: BusinessView; actions: BusinessActions; client: BusinessClient | null }) {
  const t = useT();
  const owner = mayManage(business.you.role);
  const [form, setForm] = useState({ name: business.name, registrationNo: business.registrationNo, taxNo: business.taxNo ?? '', activities: business.activities });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sites, setSites] = useState<SiteView[] | null>(null);

  useEffect(() => {
    setForm({ name: business.name, registrationNo: business.registrationNo, taxNo: business.taxNo ?? '', activities: business.activities });
  }, [business]);

  const loadSites = useCallback(async () => {
    if (!client) return;
    const r = await (client.api as never as { sites: (id: string) => Promise<{ data?: unknown; error?: unknown }> }).sites(business.entityId);
    setSites(r.error || !r.data ? [] : ((r.data as { sites: SiteView[] }).sites ?? []));
  }, [client, business.entityId]);

  useEffect(() => {
    void loadSites();
  }, [loadSites]);

  const identityChanges = form.name.trim() !== business.name || form.registrationNo.trim() !== business.registrationNo;
  const dirty = identityChanges || form.taxNo.trim() !== (business.taxNo ?? '') || form.activities.join() !== business.activities.join();
  const checked = business.check.state !== 'unverified';
  const toggle = (a: BusinessActivity) => setForm((f) => ({ ...f, activities: f.activities.includes(a) ? f.activities.filter((x) => x !== a) : [...f.activities, a] }));

  const save = async (e: Event) => {
    e.preventDefault();
    if (!client || !dirty) return;
    setBusy(true);
    setError(null);
    const r = await client.update({
      ...(form.name.trim() !== business.name ? { name: form.name.trim() } : {}),
      ...(form.registrationNo.trim() !== business.registrationNo ? { registrationNo: form.registrationNo.trim() } : {}),
      ...(form.taxNo.trim() !== (business.taxNo ?? '') ? { taxNo: form.taxNo.trim() || null } : {}),
      ...(form.activities.join() !== business.activities.join() ? { activities: form.activities } : {}),
    });
    setBusy(false);
    if (r.error || !r.data) return setError(r.error?.detail || r.error?.title || null);
    actions.setBusiness(r.data);
    actions.say(t('business.details.saved'));
  };

  return (
    <>
      <header class="cons__head">
        <h1 class="cons__title">{t('business.details.title')}</h1>
        <p class="cons__lede">{t('business.details.lede')}</p>
      </header>

      <section class="cons__panel">
        <div class="cons__panelhead">
          <span class="cons__panelt">{t('business.details.factsTitle')}</span>
        </div>
        {owner ? (
          <form onSubmit={(e) => void save(e)}>
            <label class="cfield">
              <span class="cfield__label">{t('business.new.name')}</span>
              <input class="cinput" value={form.name} onInput={(e) => setForm((prev) => ({ ...prev, name: (e.target as HTMLInputElement).value }))} />
            </label>
            <div class="biz-two">
              <label class="cfield">
                <span class="cfield__label">{t('business.new.registrationNo')}</span>
                <input class="cinput" value={form.registrationNo} onInput={(e) => setForm((prev) => ({ ...prev, registrationNo: (e.target as HTMLInputElement).value }))} />
              </label>
              <label class="cfield">
                <span class="cfield__label">{t('business.new.taxNo')}</span>
                <input class="cinput" value={form.taxNo} onInput={(e) => setForm((prev) => ({ ...prev, taxNo: (e.target as HTMLInputElement).value }))} />
              </label>
            </div>
            <fieldset class="cfield biz-acts">
              <legend class="cfield__label">{t('business.new.activities')}</legend>
              {ACTIVITIES.map((a) => (
                <label class="cfield--check biz-act" key={a}>
                  <input type="checkbox" checked={form.activities.includes(a)} onChange={() => toggle(a)} />
                  <span>
                    <strong>{t(ACTIVITY_LABEL[a])}</strong>
                    <span class="chint">{t(ACTIVITY_SUB[a])}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            {identityChanges && checked ? <p class="cons__caveat">{t('business.details.recheck')}</p> : null}
            {error ? <p class="cerr">{error}</p> : null}
            <div class="twr-panelend">
              <button type="submit" class="cbtn cbtn--primary" disabled={busy || !dirty || !form.activities.length}>
                {t('business.details.save')}
              </button>
            </div>
          </form>
        ) : (
          <dl class="cons__facts">
            <div class="cons__fact">
              <dt class="cons__factk">{t('business.new.name')}</dt>
              <dd class="cons__factv">{business.name}</dd>
            </div>
            <div class="cons__fact">
              <dt class="cons__factk">{t('business.new.registrationNo')}</dt>
              <dd class="cons__factv">{business.registrationNo}</dd>
            </div>
            {business.taxNo ? (
              <div class="cons__fact">
                <dt class="cons__factk">{t('business.new.taxNo')}</dt>
                <dd class="cons__factv">{business.taxNo}</dd>
              </div>
            ) : null}
            <div class="cons__fact">
              <dt class="cons__factk">{t('business.new.activities')}</dt>
              <dd class="cons__factv">{business.activities.map((a) => t(ACTIVITY_LABEL[a])).join(', ')}</dd>
            </div>
          </dl>
        )}
      </section>

      {/* How anybody reaches them, published on their page and in every directory — once they are checked. */}
      <ContactCardPanel entityId={business.entityId} who={business.you.name} client={client as never} />

      <section class="cons__panel">
        <div class="cons__panelhead">
          <span class="cons__panelt">{t('tower.settings.placesTitle')}</span>
          {sites ? <span class="chint">{t('tower.settings.placesCount', { n: sites.length })}</span> : null}
        </div>
        <p class="cons__lede">{t('business.details.placesLede')}</p>
        {sites === null ? (
          <p class="cons__empty">{t('business.loading')}</p>
        ) : sites.length === 0 ? (
          <p class="cons__empty">{t('tower.settings.placesNone')}</p>
        ) : (
          <div class="crows">
            {sites.map((s) => (
              <div class="crow" key={s.siteId}>
                <span class="crow__body">
                  <span class="crow__top">
                    <span class="crow__name">{s.name}</span>
                    <span class="ctag ctag--quiet">{t(s.kind === 'port' ? 'tower.settings.kindPort' : 'tower.settings.kindDelivery')}</span>
                  </span>
                  <span class="crow__sub">{s.from === 'pin' ? t('tower.sites.fromPin') : t('tower.sites.fromAddress', { address: s.address ?? '' })}</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
