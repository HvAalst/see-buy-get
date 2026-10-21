import { useCallback, useEffect, useState } from 'preact/hooks';
import { Icon } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import { publicPageUrl } from '../../../lib/sbg/config';
import type { TowerActions, TowerState } from '../useTowerApp';
import { ContactCardPanel } from './ContactCardPanel';
import { CompanyPasswordPanel } from './CompanyPasswordPanel';
import { StaffSettings } from './StaffSettings';
import type { SiteView } from './SitePicker';

/**
 * A COMPANY'S OWN SETTINGS — the things they manage about themselves, in one place.
 *
 * Until now these were scattered or unreachable. "Change password" was a button in the masthead, beside
 * Help and Sign out, where it made the header a row of three controls of quite different weights. The
 * contact card — how anybody reaches this company, published on their public page and in every
 * directory — was only on the YARD screen, so a company that does not hold empties had no way to
 * publish a telephone number at all, while their page carried a slot for one. And the saved places had
 * no list: you could create a port while minting a road leg and never see it again, which is how a
 * typo becomes permanent.
 *
 * WHAT IS NOT HERE. The company RECORD — legal form, addresses, obligations, documents — is its own
 * screen and stays there: it is what the network has verified about them, most of it not theirs to
 * edit, and mixing "what we hold about you" with "what you set" makes both harder to read. This page
 * links to it rather than absorbing it.
 */
export function SettingsScreen({ state, actions }: { state: TowerState; actions: TowerActions }) {
  const t = useT();
  const client = actions.client();
  const entityId = state.who?.entityId ?? '';
  const [sites, setSites] = useState<SiteView[] | null>(null);
  // Their own public address, read off their own record — the one place that knows it.
  const [handle, setHandle] = useState<string | undefined>(undefined);
  // Round 39 — a country's company keeps the desk a held driver rings, on the same card.
  const [sister, setSister] = useState(false);

  const load = useCallback(async () => {
    if (!client || !entityId) return;
    const api = client.api as never as { sites: (id: string) => Promise<{ data?: unknown; error?: unknown }>; companyRecord: (id: string) => Promise<{ data?: unknown; error?: unknown }> };
    const r = await api.sites(entityId);
    setSites(r.error || !r.data ? [] : ((r.data as { sites: SiteView[] }).sites ?? []));
    const rec = await api.companyRecord(entityId);
    if (!rec.error && rec.data) {
      setHandle((rec.data as { handle?: string }).handle);
      setSister((rec.data as { entity?: { kind?: string } }).entity?.kind === 'sister');
    }
  }, [client, entityId]);

  useEffect(() => {
    void load();
  }, [load]);

  // A member of staff has settings too — how they sign in — and nothing else.
  if (!entityId && state.creds?.mode === 'staff') return <StaffSettings state={state} actions={actions} />;
  if (!entityId) return <p class="cons__empty">{t('tower.settings.companyOnly')}</p>;

  const page = handle ? publicPageUrl(handle) : null;

  return (
    <>
      <header class="cons__head">
        <h1 class="cons__title">{t('tower.settings.title')}</h1>
        <p class="cons__lede">{t('tower.settings.lede')}</p>
      </header>

      {/* Their own entry, and the one thing on the public page nobody else can write for them. It was
          reachable only from the yard screen, so a company that holds no empties could not publish a
          telephone number while their page carried a slot for one. */}
      <ContactCardPanel entityId={entityId} who={state.who?.name} client={client} desk={sister} />

      <section class="cons__panel">
        <div class="cons__panelhead">
          <span class="cons__panelt">{t('tower.settings.placesTitle')}</span>
          {sites ? <span class="chint">{t('tower.settings.placesCount', { n: sites.length })}</span> : null}
        </div>
        <p class="cons__lede">{t('tower.settings.placesLede')}</p>
        {sites === null ? (
          <p class="cons__empty">{t('tower.imports.loading')}</p>
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
                  {/* HOW the point was arrived at, because a pin and a resolved address are different
                      claims and both end up on a consignment note. */}
                  <span class="crow__sub">{s.from === 'pin' ? t('tower.sites.fromPin') : t('tower.sites.fromAddress', { address: s.address ?? '' })}</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <CompanyPasswordPanel actions={actions} />

      <section class="cons__panel">
        <div class="cons__panelhead">
          <span class="cons__panelt">{t('tower.settings.elsewhereTitle')}</span>
        </div>
        <div class="cdos">
          <button type="button" class="cdo" onClick={() => actions.go('company')}>
            <span class="cdo__body">
              <span class="cdo__t">{t('tower.nav.company')}</span>
              <span class="cdo__sub">{t('tower.settings.recordSub')}</span>
            </span>
            <Icon name="chevronRight" size={16} class="cdo__go" />
          </button>
          {page ? (
            <a class="cdo" href={page} target="_blank" rel="noopener noreferrer">
              <span class="cdo__body">
                <span class="cdo__t">@{handle}</span>
                <span class="cdo__sub">{t('tower.settings.pageSub')}</span>
              </span>
              <Icon name="chevronRight" size={16} class="cdo__go" />
            </a>
          ) : null}
        </div>
      </section>
    </>
  );
}
