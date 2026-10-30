import { Abbreviated } from '../../../shared/ui/Abbr';
import { useCallback, useEffect, useState } from 'preact/hooks';
import { useT } from '../../../shared/i18n';
import { ContactCardPanel } from '../../tower/screens/ContactCardPanel';
import type { SiteView } from '../../tower/screens/SitePicker';
import type { BusinessActivity, BusinessClient, BusinessView } from '../api';
import { ACTIVITIES, mayAct, mayManage } from '../logic';
import { baysOf, DAY_NAME, loadsLine, WEEK, weekForm, type SiteWeek, type WeekForm } from '../../fleet/sites';
import type { BusinessActions } from '../useBusinessApp';
import { ACTIVITY_LABEL, ACTIVITY_SUB } from './ChooseScreen';
import { Gs1Panel } from './Gs1Panel';
import { SystemPanel } from './SystemPanel';
import { KeysPanel } from './KeysPanel';
import { DirectoryPanel } from './DirectoryPanel';

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
  const [form, setForm] = useState({ name: business.name, registrationNo: business.registrationNo, taxNo: business.taxNo ?? '', address: business.address ?? '', activities: business.activities });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sites, setSites] = useState<SiteView[] | null>(null);
  // The place whose loading hours and bays are being written, and what is written so far.
  const [loadingOf, setLoadingOf] = useState<string | null>(null);
  const [bays, setBays] = useState('');
  const [keepsHours, setKeepsHours] = useState(false);
  const [week, setWeek] = useState<WeekForm>(weekForm(undefined));
  const [placeBusy, setPlaceBusy] = useState(false);
  const [placeError, setPlaceError] = useState<string | null>(null);
  const works = mayAct(business.you.role);

  useEffect(() => {
    setForm({ name: business.name, registrationNo: business.registrationNo, taxNo: business.taxNo ?? '', address: business.address ?? '', activities: business.activities });
  }, [business]);

  const loadSites = useCallback(async () => {
    if (!client) return;
    const r = await (client.api as never as { sites: (id: string) => Promise<{ data?: unknown; error?: unknown }> }).sites(business.entityId);
    setSites(r.error || !r.data ? [] : ((r.data as { sites: SiteView[] }).sites ?? []));
  }, [client, business.entityId]);

  useEffect(() => {
    void loadSites();
  }, [loadSites]);

  const editLoading = (s: SiteView) => {
    setLoadingOf(s.siteId);
    setBays(s.loading?.bays ? String(s.loading.bays) : '');
    setKeepsHours(Boolean(s.loading?.hours));
    setWeek(weekForm(s.loading?.hours as SiteWeek | undefined));
    setPlaceError(null);
  };
  const saveLoading = async (siteId: string) => {
    if (!client) return;
    setPlaceBusy(true);
    setPlaceError(null);
    const api = client.api as never as { setSiteLoading: (entityId: string, siteId: string, body: Record<string, unknown>) => Promise<{ data?: unknown; error?: { detail?: string; title?: string } | null }> };
    const r = await api.setSiteLoading(business.entityId, siteId, { hours: keepsHours ? week : null, bays: baysOf(bays) });
    setPlaceBusy(false);
    if (r.error || !r.data) return setPlaceError(r.error?.detail || r.error?.title || null);
    setLoadingOf(null);
    actions.say(t('business.places.saved'));
    void loadSites();
  };

  const identityChanges = form.name.trim() !== business.name || form.registrationNo.trim() !== business.registrationNo;
  const dirty = identityChanges || form.taxNo.trim() !== (business.taxNo ?? '') || form.address.trim() !== (business.address ?? '') || form.activities.join() !== business.activities.join();
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
      ...(form.address.trim() !== (business.address ?? '') ? { address: form.address.trim() || null } : {}),
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
            <label class="cfield">
              <span class="cfield__label">{t('business.details.address')}</span>
              <input class="cinput" maxLength={300} value={form.address} onInput={(e) => setForm((prev) => ({ ...prev, address: (e.target as HTMLInputElement).value }))} />
              <span class="chint">{t('business.details.addressHint')}</span>
            </label>
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
            {error ? <p class="cerr"><Abbreviated text={error} /></p> : null}
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
              <dt class="cons__factk">{t('business.details.address')}</dt>
              <dd class="cons__factv">{business.address ?? t('business.details.addressNone')}</dd>
            </div>
            <div class="cons__fact">
              <dt class="cons__factk">{t('business.new.activities')}</dt>
              <dd class="cons__factv">{business.activities.map((a) => t(ACTIVITY_LABEL[a])).join(', ')}</dd>
            </div>
          </dl>
        )}
      </section>

      {/* How anybody reaches them, published on their page and in every directory — once they are checked. */}
      <ContactCardPanel entityId={business.entityId} who={business.you.name} client={client as never} />

      {/* Its place in SeeBuyGet's public logistics directory, and its own line there (2026-10-30): an owner's to say. */}
      <DirectoryPanel client={client} owner={owner} actions={actions} />

      {/* The global barcode on its packages, beside ours: a GS1 company prefix is the business's own to give. */}
      <Gs1Panel business={business} actions={actions} client={client} owner={owner} />

      {/* Its own system, told each step of its loads (round 10): the address and secret an owner’s, the messages everybody’s to read. */}
      <SystemPanel actions={actions} client={client} owner={owner} works={works} />

      {/* Its keys, for its own systems to post and read its loads (round 12): an owner's to make and take away. */}
      <KeysPanel client={client} owner={owner} />

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
                  {/* WHEN GOODS ARE LOADED HERE: a place of its own only, and its own word — read by its carriers' plans. */}
                  {s.kind === 'delivery' ? <span class="crow__sub">{loadsLine({ loadingBays: s.loading?.bays, hours: s.loading?.hours as SiteWeek | undefined }, t) ?? t('business.places.noLoading')}</span> : null}
                  {loadingOf === s.siteId ? (
                    <div style="margin-top:10px">
                      <span class="chint">{t('business.places.loadingHint')}</span>
                      <div class="twr-knobs__row">
                        <label class="twr-knob cfield">
                          <span class="cfield__label">{t('business.places.bays')}</span>
                          <input id={`place-bays-${s.siteId}`} class="cinput" inputMode="numeric" maxLength={2} value={bays} onInput={(e) => setBays((e.target as HTMLInputElement).value)} />
                        </label>
                      </div>
                      <label class="cfield cfield--check" style="margin-top:8px">
                        <input id={`place-hours-${s.siteId}`} type="checkbox" checked={keepsHours} onChange={(e) => setKeepsHours((e.target as HTMLInputElement).checked)} />
                        <span>{t('business.places.keepsHours')}</span>
                      </label>
                      {keepsHours
                        ? WEEK.map((d) => {
                            const day = week[d];
                            const dayName = t(DAY_NAME[d]);
                            const setDay = (value: { open: string; close: string } | null) => setWeek((was) => ({ ...was, [d]: value }));
                            return (
                              <div class="twr-knobs__row" key={d}>
                                <label class="twr-knob cfield cfield--check">
                                  <input id={`place-open-${d}`} type="checkbox" checked={Boolean(day)} onChange={(e) => setDay((e.target as HTMLInputElement).checked ? { open: '08:00', close: '18:00' } : null)} />
                                  <span>{day ? dayName : t('business.places.closedOn', { day: dayName })}</span>
                                </label>
                                {day ? (
                                  <>
                                    <label class="twr-knob cfield">
                                      <span class="cfield__label">{t('fleet.sites.opens')}</span>
                                      <input class="cinput" type="time" aria-label={`${dayName} ${t('fleet.sites.opens')}`} value={day.open} onChange={(e) => setDay({ open: (e.target as HTMLInputElement).value, close: day.close })} />
                                    </label>
                                    <label class="twr-knob cfield">
                                      <span class="cfield__label">{t('fleet.sites.closes')}</span>
                                      <input class="cinput" type="time" aria-label={`${dayName} ${t('fleet.sites.closes')}`} value={day.close} onChange={(e) => setDay({ open: day.open, close: (e.target as HTMLInputElement).value })} />
                                    </label>
                                  </>
                                ) : null}
                              </div>
                            );
                          })
                        : <span class="chint">{t('business.places.anyHour')}</span>}
                      {placeError ? <p class="cerr"><Abbreviated text={placeError} /></p> : null}
                      <div style="display:flex;gap:8px;margin-top:10px">
                        <button type="button" class="cbtn cbtn--primary" disabled={placeBusy} onClick={() => void saveLoading(s.siteId)}>
                          {t('business.places.save')}
                        </button>
                        <button type="button" class="cbtn cbtn--ghost" disabled={placeBusy} onClick={() => setLoadingOf(null)}>
                          {t('business.places.cancel')}
                        </button>
                      </div>
                    </div>
                  ) : null}
                </span>
                {s.kind === 'delivery' && works && loadingOf !== s.siteId ? (
                  <button type="button" class="cbtn cbtn--ghost" onClick={() => editLoading(s)}>
                    {t('business.places.loadingCta')}
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
