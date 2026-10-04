import { useCallback, useEffect, useState } from 'preact/hooks';
import { useT } from '../../../shared/i18n';
import { publicRequest } from '../../../lib/sbg';
import { ConsoleDetail } from '../../tower/ConsoleDetail';
import { CountrySelect, useCountryAtlas } from '../../tower/screens/CountrySelect';
import type { MyBookingRow } from '../../agent/types';
import { businessConfig, type BusinessClient, type BusinessView, type Client, type PostedLoad } from '../api';
import { loadStage, mayAct } from '../logic';
import type { BusinessActions } from '../useBusinessApp';

const atlasApi = { countryCatalogue: () => publicRequest(businessConfig(), '/v1/sbg/country-catalogue') };
const EMPTY = { name: '', country: '', address: '', contactName: '', contactPhone: '', contactEmail: '' };

/**
 * B4 — AN EXPEDITOR'S CLIENTS: who it sends for, as their agent, and everything sent for each of them.
 *
 * The user, 2026-10-04: the expeditor is the shipper's agent. So a load or a booking made "for" a client names the client
 * as the SENDER on the consignment note and the expeditor as the one who booked it — and this screen is where the
 * expeditor sees, per client, what is moving and the tracking link to hand them.
 */
export function ClientsScreen({ business, client }: { business: BusinessView; actions: BusinessActions; client: BusinessClient | null }) {
  const t = useT();
  const act = mayAct(business.you.role);
  const countries = useCountryAtlas(atlasApi);
  const [rows, setRows] = useState<Client[] | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [form, setForm] = useState({ ...EMPTY });
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<Client | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!client) return;
    const r = await client.clients(showArchived);
    if (r.error) return setError(r.error.detail || r.error.title);
    setRows(r.data?.items ?? []);
  }, [client, showArchived]);

  useEffect(() => {
    void load();
  }, [load]);

  const add = async (e: Event) => {
    e.preventDefault();
    if (!client || !form.name.trim()) return;
    setBusy(true);
    setError(null);
    const r = await client.addClient({
      name: form.name.trim(),
      ...(form.country ? { country: form.country } : {}),
      ...(form.address.trim() ? { address: form.address.trim() } : {}),
      ...(form.contactName.trim() ? { contactName: form.contactName.trim() } : {}),
      ...(form.contactPhone.trim() ? { contactPhone: form.contactPhone.trim() } : {}),
      ...(form.contactEmail.trim() ? { contactEmail: form.contactEmail.trim() } : {}),
    });
    setBusy(false);
    if (r.error) return setError(r.error.detail || r.error.title);
    setDone(t('business.clients.added', { name: form.name.trim() }));
    setForm({ ...EMPTY });
    setAdding(false);
    await load();
  };

  return (
    <>
      <header class="cons__head">
        <h1 class="cons__title">{t('business.clients.title')}</h1>
        <p class="cons__lede">{t('business.clients.lede')}</p>
      </header>
      {done ? <p class="cnote">{done}</p> : null}
      {error ? <p class="cerr">{error}</p> : null}

      {act ? (
        adding ? (
          <section class="cons__panel">
            <div class="cons__panelhead">
              <span class="cons__panelt">{t('business.clients.addTitle')}</span>
            </div>
            <form onSubmit={(e) => void add(e)}>
              <label class="cfield">
                <span class="cfield__label">{t('business.clients.f.name')}</span>
                <input class="cinput" maxLength={120} value={form.name} onInput={(e) => setForm((prev) => ({ ...prev, name: (e.target as HTMLInputElement).value }))} />
                <span class="chint">{t('business.clients.f.nameHint')}</span>
              </label>
              <div class="biz-two">
                <CountrySelect value={form.country} onChange={(country) => setForm((prev) => ({ ...prev, country }))} label={t('business.clients.f.country')} options={countries} />
                <label class="cfield">
                  <span class="cfield__label">{t('business.clients.f.address')}</span>
                  <input class="cinput" maxLength={200} value={form.address} onInput={(e) => setForm((prev) => ({ ...prev, address: (e.target as HTMLInputElement).value }))} />
                </label>
              </div>
              <div class="biz-two">
                <label class="cfield">
                  <span class="cfield__label">{t('business.clients.f.contactName')}</span>
                  <input class="cinput" maxLength={80} value={form.contactName} onInput={(e) => setForm((prev) => ({ ...prev, contactName: (e.target as HTMLInputElement).value }))} />
                </label>
                <label class="cfield">
                  <span class="cfield__label">{t('business.clients.f.contactPhone')}</span>
                  <input class="cinput" type="tel" maxLength={32} value={form.contactPhone} onInput={(e) => setForm((prev) => ({ ...prev, contactPhone: (e.target as HTMLInputElement).value }))} />
                </label>
              </div>
              <label class="cfield">
                <span class="cfield__label">{t('business.clients.f.contactEmail')}</span>
                <input class="cinput" type="email" maxLength={120} value={form.contactEmail} onInput={(e) => setForm((prev) => ({ ...prev, contactEmail: (e.target as HTMLInputElement).value }))} />
              </label>
              <div class="twr-panelend">
                <button type="button" class="cbtn cbtn--ghost" onClick={() => setAdding(false)}>
                  {t('common.cancel')}
                </button>
                <button type="submit" class="cbtn cbtn--primary" disabled={busy || !form.name.trim()}>
                  {t('business.clients.addCta')}
                </button>
              </div>
            </form>
          </section>
        ) : (
          <div class="twr-panelend biz-loads__new">
            <button type="button" class="cbtn cbtn--primary" onClick={() => setAdding(true)}>
              {t('business.clients.addTitle')}
            </button>
          </div>
        )
      ) : null}

      <section class="cons__panel">
        <div class="cons__panelhead">
          <span class="cons__panelt">{t('business.clients.listTitle')}</span>
          <label class="cfield--check">
            <input type="checkbox" checked={showArchived} onChange={() => setShowArchived((v) => !v)} />
            <span>{t('business.clients.showArchived')}</span>
          </label>
        </div>
        {rows === null ? (
          <p class="cons__empty">{t('business.loading')}</p>
        ) : rows.length === 0 ? (
          <p class="cons__empty">{t('business.clients.none')}</p>
        ) : (
          <div class="crows">
            {rows.map((c) => (
              <button type="button" class="crow" key={c.clientId} onClick={() => setOpen(c)}>
                <span class="crow__body">
                  <span class="crow__top">
                    <span class="crow__name">{c.name}</span>
                    {c.archivedAt ? <span class="ctag ctag--quiet">{t('business.clients.archivedTag')}</span> : null}
                  </span>
                  <span class="crow__sub">{[c.country, c.address, c.contactName, c.contactPhone].filter(Boolean).join(' · ') || t('business.clients.noContact')}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </section>

      {open ? (
        <ClientDetail
          row={open}
          client={client}
          act={act}
          onClose={() => setOpen(null)}
          onChanged={async (message) => {
            setDone(message);
            setOpen(null);
            await load();
          }}
        />
      ) : null}
    </>
  );
}

function ClientDetail({ row, client, act, onClose, onChanged }: { row: Client; client: BusinessClient | null; act: boolean; onClose: () => void; onChanged: (message: string) => void | Promise<void> }) {
  const t = useT();
  const [loads, setLoads] = useState<PostedLoad[] | null>(null);
  const [bookings, setBookings] = useState<MyBookingRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!client) return;
    void (async () => {
      const [l, b] = await Promise.all([client.shipping.postedFreight(), client.shipping.myDepartureBookings()]);
      const allLoads = ((l.data as unknown as { items?: PostedLoad[] })?.items ?? []) as PostedLoad[];
      const allBookings = ((b.data as unknown as { items?: Array<MyBookingRow & { onBehalfOf?: { clientId: string } }> })?.items ?? []) as Array<MyBookingRow & { onBehalfOf?: { clientId: string } }>;
      setLoads(allLoads.filter((x) => x.onBehalfOf?.clientId === row.clientId));
      setBookings(allBookings.filter((x) => x.onBehalfOf?.clientId === row.clientId));
    })();
  }, [client, row.clientId]);

  const archive = async (archived: boolean) => {
    if (!client) return;
    setBusy(true);
    setError(null);
    const r = await client.archiveClient(row.clientId, archived);
    setBusy(false);
    if (r.error) return setError(r.error.detail || r.error.title);
    await onChanged(t(archived ? 'business.clients.archived' : 'business.clients.restored', { name: row.name }));
  };

  return (
    <ConsoleDetail openKey={row.clientId} title={row.name} onClose={onClose}>
      <section class="cons__panel">
        <div class="cons__panelhead">
          <span class="cons__panelt">{row.name}</span>
        </div>
        <dl class="cons__facts">
          {row.country ? (
            <div class="cons__fact">
              <dt class="cons__factk">{t('business.clients.f.country')}</dt>
              <dd class="cons__factv">{row.country}</dd>
            </div>
          ) : null}
          {row.address ? (
            <div class="cons__fact">
              <dt class="cons__factk">{t('business.clients.f.address')}</dt>
              <dd class="cons__factv">{row.address}</dd>
            </div>
          ) : null}
          {row.contactName || row.contactPhone || row.contactEmail ? (
            <div class="cons__fact">
              <dt class="cons__factk">{t('business.clients.contact')}</dt>
              <dd class="cons__factv">{[row.contactName, row.contactPhone, row.contactEmail].filter(Boolean).join(' · ')}</dd>
            </div>
          ) : null}
          <div class="cons__fact">
            <dt class="cons__factk">{t('business.clients.since')}</dt>
            <dd class="cons__factv">{t('business.clients.sinceBy', { when: row.createdAt.slice(0, 10), who: row.createdBy })}</dd>
          </div>
        </dl>
        <p class="chint">{t('business.clients.agentNote')}</p>
      </section>

      <section class="cons__panel">
        <div class="cons__panelhead">
          <span class="cons__panelt">{t('business.clients.sentTitle')}</span>
        </div>
        {loads === null || bookings === null ? (
          <p class="cons__empty">{t('business.loading')}</p>
        ) : loads.length + bookings.length === 0 ? (
          <p class="cons__empty">{t('business.clients.sentNone')}</p>
        ) : (
          <div class="crows">
            {loads.map((l) => (
              <div class="crow" key={l.freightId}>
                <span class="crow__body">
                  <span class="crow__top">
                    <span class="crow__name">
                      {l.code} · {l.description}
                    </span>
                    <span class="ctag ctag--quiet">{t(`business.loads.stage.${loadStage(l)}` as never)}</span>
                  </span>
                  <span class="crow__sub">
                    {t('business.loads.rowSub', { dest: l.destLabel, kg: l.weightKg.toLocaleString(), when: l.createdAt.slice(0, 10) })}
                    {l.trackingUrl ? (
                      <>
                        {' · '}
                        <a href={l.trackingUrl} target="_blank" rel="noopener noreferrer">
                          {t('business.clients.trackLink')}
                        </a>
                      </>
                    ) : null}
                  </span>
                </span>
              </div>
            ))}
            {bookings.map((b) => (
              <div class="crow" key={b.bookingId}>
                <span class="crow__body">
                  <span class="crow__top">
                    <span class="crow__name">
                      {b.company} · {b.description}
                    </span>
                    <span class="ctag ctag--quiet">{t(`business.runs.status.${b.bookingStatus}` as never)}</span>
                  </span>
                  <span class="crow__sub">{t('business.runs.bookingSub', { from: b.originZone, to: b.destZone, when: b.leavesAt.slice(0, 16).replace('T', ' '), price: `${b.price.toLocaleString()} ${b.currency}` })}</span>
                </span>
              </div>
            ))}
          </div>
        )}
        <p class="chint">{t('business.clients.trackHint')}</p>
      </section>

      {act ? (
        <div class="twr-panelend">
          <button type="button" class="cbtn cbtn--ghost" disabled={busy} onClick={() => void archive(!row.archivedAt)}>
            {t(row.archivedAt ? 'business.clients.restore' : 'business.clients.archive')}
          </button>
        </div>
      ) : null}
      {error ? <p class="cerr">{error}</p> : null}
    </ConsoleDetail>
  );
}
