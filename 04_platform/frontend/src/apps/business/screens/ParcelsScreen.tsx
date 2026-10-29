import { useCallback, useEffect, useState } from 'preact/hooks';
import { formatDate, useT } from '../../../shared/i18n';
import { CodeCard } from '../../../shared/ui/CodeCard';
import { downscaleImage } from '../../../shared/media';
import { tabAtTheTap } from '../../../shared/openPage';
import { ConsolePick } from '../../tower/ConsolePick';
import { SitePicker } from '../../tower/screens/SitePicker';
import type { BusinessClient, BusinessView } from '../api';
import { mayAct } from '../logic';
import {
  bookWord,
  EMPTY_PARCEL,
  money,
  OWN_PLACE,
  TO_PLACE,
  parcelPriceGaps,
  parcelSendGaps,
  parcelSize,
  parcelsApi,
  parcelStage,
  sendBody,
  shopChoices,
  STAGE_TONE,
  STAGE_WORD,
  stepWord,
  type BusinessParcel,
  type BusinessParcelDetail,
  type DockView,
  type NetworkShop,
  type ParcelCollection,
  type ParcelAccount,
  type ParcelBookLine,
  type ParcelCallOff,
  type ParcelForm,
} from '../parcels';

type Err = { detail?: string; title: string } | null | undefined;
const words = (e: Err) => (e ? e.detail || e.title : null);
const when = (iso: string) => formatDate(iso, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/**
 * PARCELS (the user, 2026-10-29: business parcels "Billed to the business", from "A prepaid balance"). The parcel account
 * first — its balance, a top-up waiting to be confirmed — then sending one from a shop to a shop, and the parcels sent:
 * where each stands, the code for its receiver, its label, paying for one the balance did not cover, and calling one off.
 */
export function ParcelsScreen({ business, client }: { business: BusinessView; client: BusinessClient | null }) {
  const t = useT();
  const works = mayAct(business.you.role);
  const api = client ? parcelsApi(client.client.sbg) : null;
  const [account, setAccount] = useState<ParcelAccount | null>(null);
  const [rows, setRows] = useState<BusinessParcel[] | null>(null);
  const [shops, setShops] = useState<NetworkShop[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [topping, setTopping] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [bookOpen, setBookOpen] = useState(false);
  // Its own places a parcel can be delivered to (2026-10-29).
  const [places, setPlaces] = useState<Array<{ siteId: string; name: string }>>([]);

  const load = useCallback(async () => {
    if (!api) return;
    const a = await api.account();
    if (a.error) return setError(words(a.error));
    setAccount(a.data ?? null);
    if (a.data?.open) {
      const l = await api.list();
      setRows(l.error ? [] : (l.data?.items ?? []));
    } else setRows([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!api || !sending || shops.length) return;
    void api.shops().then((r) => setShops(r.error ? [] : shopChoices((r.data as NetworkShop[] | undefined) ?? [], business.country)));
    const sites = (client?.api as never as { sites?: (entityId: string) => Promise<{ data?: unknown; error?: unknown }> }).sites;
    void sites?.(business.entityId).then((r) => setPlaces(r.error || !r.data ? [] : (((r.data as { sites?: Array<{ siteId: string; name: string; kind: string }> }).sites ?? []).filter((s) => s.kind === 'delivery' || s.kind === 'loading'))));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, sending]);

  const act = async (key: string, fn: () => Promise<{ error?: Err }>, note?: string): Promise<boolean> => {
    setBusy(key);
    setError(null);
    setDone(null);
    const r = await fn();
    setBusy(null);
    if (r.error) {
      setError(words(r.error));
      return false;
    }
    if (note) setDone(note);
    await load();
    return true;
  };

  if (!account) {
    return (
      <>
        <Head />
        {error ? <p class="cerr">{error}</p> : <p class="cons__empty">{t('business.loading')}</p>}
      </>
    );
  }

  if (!account.open) {
    return (
      <>
        <Head />
        {error ? <p class="cerr">{error}</p> : null}
        <section class="cons__panel">
          <div class="cons__panelhead">
            <span class="cons__panelt">{t('business.parcels.openTitle')}</span>
          </div>
          <ol class="biz-steps">
            <li>{t('business.parcels.openStep1')}</li>
            <li>{t('business.parcels.openStep2')}</li>
            <li>{t('business.parcels.openStep3')}</li>
          </ol>
          {!account.canOpen ? (
            <p class="chint">{account.whyNot}</p>
          ) : !works ? (
            <p class="chint">{t('business.parcels.viewerNoOpen')}</p>
          ) : (
            <div class="twr-panelend">
              <button type="button" class="cbtn cbtn--primary" disabled={busy !== null} onClick={() => void act('open', () => api!.open(), t('business.parcels.opened'))}>
                {t('business.parcels.open')}
              </button>
            </div>
          )}
        </section>
      </>
    );
  }

  const currency = account.company?.currency ?? '';
  const opened = openId && rows ? rows.find((r) => r.parcelId === openId) : undefined;

  return (
    <>
      <Head />
      {done ? <p class="cnote">{done}</p> : null}
      {error ? <p class="cerr">{error}</p> : null}

      <div class="twr-kpis biz-kpis">
        <div class={`twr-kpi${(account.balance ?? 0) <= 0 ? ' twr-kpi--risk' : ''}`}>
          <div class="twr-kpi__v">{money(account.balance, currency)}</div>
          <div class="twr-kpi__l">{t('business.parcels.balance')}</div>
        </div>
        <div class="twr-kpi">
          <div class="twr-kpi__v">{account.moving}</div>
          <div class="twr-kpi__l">{t('business.parcels.moving')}</div>
        </div>
        <div class={`twr-kpi${account.unpaid ? ' twr-kpi--risk' : ''}`}>
          <div class="twr-kpi__v">{account.unpaid}</div>
          <div class="twr-kpi__l">{t('business.parcels.unpaidCount')}</div>
        </div>
      </div>

      <section class="cons__panel">
        <div class="cons__panelhead">
          <span class="cons__panelt">{t('business.parcels.moneyTitle')}</span>
        </div>
        <p class="chint">{t('business.parcels.heldBy', { company: account.company?.name ?? '' })}</p>
        {account.waiting ? (
          <p class="cnote" role="status">
            {t(account.waiting.pushed ? 'business.parcels.waitingPushed' : 'business.parcels.waiting', { amount: money(account.waiting.amount, account.waiting.currency), reference: account.waiting.reference })}
            {account.waiting.instructions ? ` ${account.waiting.instructions}` : ''}
          </p>
        ) : null}
        {account.terms?.freeAbove && account.terms.amount ? <p class="chint">{t('business.parcels.terms', { fee: money(account.terms.amount, currency), above: money(account.terms.freeAbove, currency) })}</p> : null}
        {works && !topping ? (
          <div class="twr-panelend">
            <button type="button" class="cbtn cbtn--ghost" onClick={() => setTopping(true)}>
              {t('business.parcels.topUp')}
            </button>
            <button type="button" class="cbtn cbtn--ghost" onClick={() => setBookOpen(!bookOpen)}>
              {t(bookOpen ? 'business.parcels.bookHide' : 'business.parcels.bookShow')}
            </button>
          </div>
        ) : null}
        {topping ? (
          <TopUpForm
            currency={currency}
            busy={busy === 'top-up'}
            onCancel={() => setTopping(false)}
            onAsk={async (amount, phone) => {
              if (await act('top-up', () => api!.topUp(amount, phone), t('business.parcels.asked'))) setTopping(false);
            }}
          />
        ) : null}
        {bookOpen && api ? <Book api={api} currency={currency} /> : null}
      </section>

      <section class="cons__panel">
        <div class="cons__panelhead">
          <span class="cons__panelt">{t('business.parcels.sendTitle')}</span>
        </div>
        {!works ? (
          <p class="chint">{t('business.parcels.viewerNoSend')}</p>
        ) : !sending ? (
          <>
            <p class="chint">{t('business.parcels.sendHint')}</p>
            <div class="twr-panelend">
              <button type="button" class="cbtn cbtn--primary" onClick={() => setSending(true)}>
                {t('business.parcels.sendOpen')}
              </button>
            </div>
          </>
        ) : api ? (
          <SendForm
            api={api}
            shops={shops}
            places={places}
            collection={account.collection}
            balance={account.balance ?? 0}
            onCancel={() => setSending(false)}
            onSent={async (sent) => {
              setSending(false);
              setOpenId(sent.parcel.parcelId);
              setDone(t(sent.paid ? 'business.parcels.sentPaid' : 'business.parcels.sentUnpaid', { id: sent.parcel.parcelId }));
              await load();
            }}
          />
        ) : null}
      </section>

      {api ? <CollectPanel api={api} siteApi={client?.api ?? null} business={business} works={works} collection={account.collection} onChanged={() => void load()} /> : null}

      <section class="cons__panel">
        <div class="cons__panelhead">
          <span class="cons__panelt">{t('business.parcels.listTitle', { n: account.sent })}</span>
        </div>
        {rows === null ? (
          <p class="cons__empty">{t('business.loading')}</p>
        ) : rows.length === 0 ? (
          <p class="cons__empty">{t('business.parcels.none')}</p>
        ) : (
          <div class="crows">
            {rows.map((r) => {
              const stage = parcelStage(r);
              return (
                <button key={r.parcelId} type="button" class={`crow${openId === r.parcelId ? ' crow--on' : ''}`} onClick={() => setOpenId(openId === r.parcelId ? null : r.parcelId)}>
                  <span class="crow__body">
                    <span class="crow__top">
                      <span class="crow__name">{r.reference ? `${r.reference} · ` : ''}{r.toOwnPlace ? t('business.parcels.toPlace', { place: r.toOwnPlace.label }) : t('business.parcels.toShop', { shop: r.to.name })}</span>
                      <span class={`ctag ctag--${STAGE_TONE[stage]}`}>{t(STAGE_WORD[stage])}</span>
                    </span>
                    <span class="crow__sub">{[r.receiver, money(r.cost, r.currency), r.sentBy, when(r.createdAt)].filter(Boolean).join(' · ')}</span>
                    <span class="crow__sub ctbl__mono">{r.parcelId}</span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {opened && api ? <ParcelOpened key={opened.parcelId} api={api} row={opened} works={works} busy={busy} act={act} /> : null}
    </>
  );
}

function Head() {
  const t = useT();
  return (
    <header class="cons__head">
      <h1 class="cons__title">{t('business.parcels.title')}</h1>
      <p class="cons__lede">{t('business.parcels.lede')}</p>
    </header>
  );
}

/* ------------------------------------------------------- its own place -- */

/**
 * COLLECTED FROM ITS OWN PLACE (the user, 2026-10-29: "they can set their own (business address) pick up"). One of its
 * places where goods are loaded becomes where drivers collect its parcels: they are bagged there by where they go, each
 * bag closed with its seal and a photograph, and the drivers near are told there is a bag to collect.
 */
function CollectPanel({ api, siteApi, business, works, collection, onChanged }: { api: ReturnType<typeof parcelsApi>; siteApi: unknown; business: BusinessView; works: boolean; collection?: ParcelCollection; onChanged: () => void }) {
  const t = useT();
  const [siteId, setSiteId] = useState('');
  const [bays, setBays] = useState('2');
  const [dock, setDock] = useState<DockView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [closing, setClosing] = useState<string | null>(null);
  const [seal, setSeal] = useState('');
  const [photoRef, setPhotoRef] = useState('');

  const loadDock = useCallback(async () => {
    if (!collection) return setDock(null);
    const r = await api.dock();
    if (r.error) setError(words(r.error));
    else setDock(r.data ?? null);
  }, [api, collection]);
  useEffect(() => {
    void loadDock();
  }, [loadDock]);

  const run = async (fn: () => Promise<{ error?: Err; data?: unknown }>, after?: () => void) => {
    setBusy(true);
    setError(null);
    const r = await fn();
    setBusy(false);
    if (r.error) return setError(words(r.error));
    if (r.data && (r.data as DockView).groups) setDock(r.data as DockView);
    after?.();
  };

  const photo = async (file: File | undefined) => {
    if (!file) return;
    const { dataUrl, thumbDataUrl } = await downscaleImage(file);
    const id = await uploadContent(api, dataUrl, thumbDataUrl);
    setPhotoRef(id ?? '');
    if (!id) setError(t('business.parcels.photoFailed'));
  };

  return (
    <section class="cons__panel">
      <div class="cons__panelhead">
        <span class="cons__panelt">{t('business.parcels.collectTitle')}</span>
      </div>
      {error ? <p class="cerr">{error}</p> : null}
      {!collection ? (
        <>
          <p class="chint">{t('business.parcels.collectHint')}</p>
          {works ? (
            <>
              <div class="biz-two">
                <SitePicker kind="loading" entityId={business.entityId} api={siteApi as never} value={siteId} onChange={setSiteId} label={t('business.parcels.collectPlace')} addLabel={t('business.parcels.collectAdd')} />
                <label class="cfield">
                  <span class="cfield__label">{t('business.parcels.collectBays')}</span>
                  <input class="cinput" inputMode="numeric" value={bays} onInput={(e) => setBays((e.target as HTMLInputElement).value)} />
                  <span class="chint">{t('business.parcels.collectBaysHint')}</span>
                </label>
              </div>
              <div class="twr-panelend">
                <button type="button" class="cbtn cbtn--primary" disabled={busy || !siteId} onClick={() => void run(() => api.collectFrom(siteId, Number(bays) || undefined), onChanged)}>
                  {t('business.parcels.collectSet')}
                </button>
              </div>
            </>
          ) : null}
        </>
      ) : (
        <>
          <p class="chint">{t('business.parcels.collectAt', { place: collection.label, zone: collection.zone, bays: collection.bays })}</p>
          {dock && dock.groups.length === 0 && dock.bags.length === 0 ? <p class="cons__empty">{t('business.parcels.dockEmpty')}</p> : null}
          {dock?.groups.length ? (
            <div class="crows">
              {dock.groups.map((g) => (
                <div class="crow" key={g.zone}>
                  <span class="crow__body">
                    <span class="crow__top">
                      <span class="crow__name">{t('business.parcels.dockFor', { zone: g.zone, n: g.parcels.length })}</span>
                    </span>
                    <span class="crow__sub ctbl__mono">{g.parcels.map((p) => p.parcelId).join(' · ')}</span>
                  </span>
                  {works ? (
                    <span class="crow__tail">
                      {g.openBagCode ? (
                        <button type="button" class="cbtn cbtn--sm cbtn--primary" disabled={busy} onClick={() => void (async () => { for (const p of g.parcels) await run(() => api.fillBag(g.openBagCode!, p.parcelId)); })()}>
                          {t('business.parcels.dockFill', { code: g.openBagCode })}
                        </button>
                      ) : (
                        <button type="button" class="cbtn cbtn--sm cbtn--ghost" disabled={busy || dock.used >= dock.capacity} onClick={() => void run(() => api.openBag(g.zone))}>
                          {t('business.parcels.dockOpen')}
                        </button>
                      )}
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
          {dock?.bags.length ? (
            <div class="crows">
              {dock.bags.map((b) => (
                <div class="crow" key={b.code}>
                  <span class="crow__body">
                    <span class="crow__top">
                      <span class="crow__name ctbl__mono">{b.code}</span>
                      <span class={`ctag ctag--${b.status === 'filling' ? 'info' : 'ok'}`}>{t(b.status === 'filling' ? 'business.parcels.bagOpen' : 'business.parcels.bagClosed')}</span>
                    </span>
                    <span class="crow__sub">{[b.destination, t('business.parcels.bagCount', { n: b.parcelIds.length })].filter(Boolean).join(' · ')}</span>
                  </span>
                  {works && b.status === 'filling' && b.parcelIds.length ? (
                    <span class="crow__tail">
                      <button type="button" class="cbtn cbtn--sm cbtn--primary" onClick={() => { setClosing(b.code); setSeal(''); setPhotoRef(''); }}>
                        {t('business.parcels.bagClose')}
                      </button>
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
          {closing ? (
            <div class="cnote">
              <p>{t('business.parcels.bagCloseLede', { code: closing })}</p>
              <div class="biz-two">
                <label class="cfield">
                  <span class="cfield__label">{t('business.parcels.bagSeal')}</span>
                  <input class="cinput" maxLength={40} value={seal} onInput={(e) => setSeal((e.target as HTMLInputElement).value)} />
                </label>
                <label class="cfield">
                  <span class="cfield__label">{t('business.parcels.bagPhoto')}</span>
                  <input class="cinput" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={(e) => void photo((e.currentTarget as HTMLInputElement).files?.[0])} />
                  {photoRef ? <span class="chint">{t('business.parcels.f.photoKept')}</span> : null}
                </label>
              </div>
              <div class="twr-panelend">
                <button type="button" class="cbtn cbtn--primary" disabled={busy || !photoRef} onClick={() => void run(() => api.sealBag(closing, { ...(seal.trim() ? { seal: seal.trim() } : {}), photoRef }), () => setClosing(null))}>
                  {t('business.parcels.bagCloseNow')}
                </button>
                <button type="button" class="cbtn cbtn--ghost" onClick={() => setClosing(null)}>
                  {t('business.parcels.cancel')}
                </button>
              </div>
            </div>
          ) : null}
          {works ? (
            <div class="twr-panelend">
              <button type="button" class="cbtn cbtn--ghost" disabled={busy} onClick={() => void run(() => api.stopCollecting(), onChanged)}>
                {t('business.parcels.collectStop')}
              </button>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ top up -- */

function TopUpForm({ currency, busy, onAsk, onCancel }: { currency: string; busy: boolean; onAsk: (amount: number, phone?: string) => void; onCancel: () => void }) {
  const t = useT();
  const [amount, setAmount] = useState('');
  const [phone, setPhone] = useState('');
  const n = Number(amount.replace(',', '.'));
  const ready = Number.isFinite(n) && n > 0;
  return (
    <>
      <div class="biz-two">
        <label class="cfield">
          <span class="cfield__label">{t('business.parcels.topUpAmount', { currency })}</span>
          <input class="cinput" inputMode="decimal" value={amount} onInput={(e) => setAmount((e.target as HTMLInputElement).value)} />
        </label>
        <label class="cfield">
          <span class="cfield__label">{t('business.parcels.topUpPhone')}</span>
          <input class="cinput" type="tel" inputMode="tel" value={phone} onInput={(e) => setPhone((e.target as HTMLInputElement).value)} />
          <span class="chint">{t('business.parcels.topUpPhoneHint')}</span>
        </label>
      </div>
      <div class="twr-panelend">
        <button type="button" class="cbtn cbtn--primary" disabled={!ready || busy} onClick={() => onAsk(n, phone)}>
          {t('business.parcels.topUpAsk')}
        </button>
        <button type="button" class="cbtn cbtn--ghost" onClick={onCancel}>
          {t('business.parcels.cancel')}
        </button>
      </div>
    </>
  );
}

function Book({ api, currency }: { api: ReturnType<typeof parcelsApi>; currency: string }) {
  const t = useT();
  const [lines, setLines] = useState<ParcelBookLine[] | null>(null);
  useEffect(() => {
    void api.book().then((r) => setLines(r.error ? [] : (r.data?.items ?? [])));
  }, [api]);
  if (lines === null) return <p class="cons__empty">{t('business.loading')}</p>;
  if (!lines.length) return <p class="cons__empty">{t('business.parcels.bookEmpty')}</p>;
  return (
    <div class="crows">
      {lines.map((l) => (
        <div class="crow" key={l.id}>
          <span class="crow__body">
            <span class="crow__top">
              <span class="crow__name">{t(bookWord(l.type))}</span>
              <span class={`ctag ctag--${l.sign === '+' ? 'ok' : 'quiet'}`}>
                {l.sign === '+' ? '+' : '−'}
                {money(l.amount, l.currency || currency)}
              </span>
            </span>
            <span class="crow__sub">{[l.parcelId, when(l.at)].filter(Boolean).join(' · ')}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------- send -- */

function SendForm({ api, shops, places, collection, balance, onSent, onCancel }: { api: ReturnType<typeof parcelsApi>; shops: NetworkShop[]; places: Array<{ siteId: string; name: string }>; collection?: ParcelCollection; balance: number; onSent: (sent: { parcel: BusinessParcelDetail; paid: boolean }) => void; onCancel: () => void }) {
  const t = useT();
  // Collected from its own place, where it set one: offered first, as the way it usually sends.
  const [form, setForm] = useState<ParcelForm>({ ...EMPTY_PARCEL, ...(collection ? { originDid: OWN_PLACE } : {}) });
  const [quote, setQuote] = useState<{ flexible: number; currency: string; door?: { via: string; suggestedMax: number } } | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<ParcelForm>) => setForm((f) => ({ ...f, ...patch }));
  const size = parcelSize(form);
  const priceGaps = parcelPriceGaps(form, t);
  const gaps = parcelSendGaps(form, t);
  const options = shops.map((s) => ({ value: s.did, label: s.shopName, sub: s.zone }));
  // Delivered to one of its own places, by a driver from the shop nearest it — or collected at a shop.
  const toOptions = [...places.map((p) => ({ value: `${TO_PLACE}${p.siteId}`, label: t('business.parcels.f.toPlace', { place: p.name }), sub: t('business.parcels.f.toPlaceSub') })), ...options];
  const toPlace = form.destDid.startsWith(TO_PLACE);
  const fromOptions = [...(collection ? [{ value: OWN_PLACE, label: t('business.parcels.f.ownPlace', { place: collection.label }), sub: t('business.parcels.f.ownPlaceSub') }] : []), ...options];

  // Priced as soon as both shops and the four measurements are in, the way the mint will price it.
  useEffect(() => {
    setQuote(null);
    setQuoteError(null);
    if (priceGaps.length || !size) return;
    let live = true;
    void api.price(form.originDid, form.destDid, size, form.fragile).then((r) => {
      if (!live) return;
      if (r.error) setQuoteError(words(r.error));
      else {
        setQuote(r.data ?? null);
        // The most for the last leg starts at what we suggest; theirs to change.
        if (r.data?.door) setForm((f) => (f.most ? f : { ...f, most: String(r.data!.door!.suggestedMax) }));
      }
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.originDid, form.destDid, form.l, form.w, form.h, form.kg, form.fragile]);

  const photo = async (file: File | undefined) => {
    if (!file) return;
    setPhotoBusy(true);
    try {
      const { dataUrl, thumbDataUrl } = await downscaleImage(file);
      const r = await uploadContent(api, dataUrl, thumbDataUrl);
      set({ photoRef: r ?? '' });
      if (!r) setError(t('business.parcels.photoFailed'));
    } finally {
      setPhotoBusy(false);
    }
  };

  const send = async () => {
    const body = sendBody(form, quote?.flexible);
    if (!body) return;
    setBusy(true);
    setError(null);
    const r = await api.send(body);
    setBusy(false);
    if (r.error) return setError(words(r.error));
    if (r.data) onSent(r.data);
  };

  const price = quote ? quote.flexible : null;
  return (
    <>
      <div class="biz-two">
        <ConsolePick label={t('business.parcels.f.from')} value={form.originDid} placeholder={t('business.parcels.f.pickShop')} options={fromOptions} onChange={(originDid) => set({ originDid })} />
        <ConsolePick label={t('business.parcels.f.to')} value={form.destDid} placeholder={t('business.parcels.f.pickShop')} options={toOptions} onChange={(destDid) => set({ destDid, most: '' })} />
      </div>
      <div class="biz-two">
        <label class="cfield">
          <span class="cfield__label">{t('business.parcels.f.receiver')}</span>
          <input class="cinput" type="tel" inputMode="tel" maxLength={30} value={form.receiver} onInput={(e) => set({ receiver: (e.target as HTMLInputElement).value })} />
          <span class="chint">{t('business.parcels.f.receiverHint')}</span>
        </label>
        <label class="cfield">
          <span class="cfield__label">{t('business.parcels.f.reference')}</span>
          <input class="cinput" maxLength={60} value={form.reference} onInput={(e) => set({ reference: (e.target as HTMLInputElement).value })} />
        </label>
      </div>
      <fieldset class="cfield biz-size">
        <legend class="cfield__label">{t('business.parcels.f.size')}</legend>
        <div class="biz-size__row">
          {(['l', 'w', 'h'] as const).map((k) => (
            <label key={k} class="cfield">
              <span class="chint">{t(k === 'l' ? 'business.parcels.f.length' : k === 'w' ? 'business.parcels.f.width' : 'business.parcels.f.height')}</span>
              <input class="cinput" inputMode="decimal" value={form[k]} onInput={(e) => set({ [k]: (e.target as HTMLInputElement).value } as Partial<ParcelForm>)} />
            </label>
          ))}
          <label class="cfield">
            <span class="chint">{t('business.parcels.f.weight')}</span>
            <input class="cinput" inputMode="decimal" value={form.kg} onInput={(e) => set({ kg: (e.target as HTMLInputElement).value })} />
          </label>
        </div>
      </fieldset>
      <label class="cfield--check">
        <input type="checkbox" checked={form.fragile} onChange={(e) => set({ fragile: (e.target as HTMLInputElement).checked })} />
        <span>{t('business.parcels.f.fragile')}</span>
      </label>
      <label class="cfield">
        <span class="cfield__label">{t('business.parcels.f.photo')}</span>
        <input class="cinput" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" disabled={photoBusy} onChange={(e) => void photo((e.currentTarget as HTMLInputElement).files?.[0])} />
        <span class="chint">{form.photoRef ? t('business.parcels.f.photoKept') : t('business.parcels.f.photoHint')}</span>
      </label>

      {toPlace && quote?.door ? (
        <label class="cfield">
          <span class="cfield__label">{t('business.parcels.f.most', { currency: quote.currency })}</span>
          <input class="cinput" inputMode="decimal" value={form.most} onInput={(e) => set({ most: (e.target as HTMLInputElement).value })} />
          <span class="chint">{t('business.parcels.f.mostHint', { via: quote.door.via, suggested: money(quote.door.suggestedMax, quote.currency) })}</span>
        </label>
      ) : null}
      {quoteError ? <p class="cerr">{quoteError}</p> : null}
      {price != null ? (
        <p class="cnote">
          {t('business.parcels.price', { price: money(price, quote!.currency) })} {price > balance ? t('business.parcels.priceShort') : ''}
        </p>
      ) : null}
      {gaps.length ? <p class="chint">{t('business.parcels.stillNeeded', { list: gaps.join(', ') })}</p> : null}
      {error ? <p class="cerr">{error}</p> : null}
      <div class="twr-panelend">
        <button type="button" class="cbtn cbtn--primary" disabled={busy || gaps.length > 0 || price == null} onClick={() => void send()}>
          {price != null ? t('business.parcels.sendFor', { price: money(price, quote!.currency) }) : t('business.parcels.send')}
        </button>
        <button type="button" class="cbtn cbtn--ghost" onClick={onCancel}>
          {t('business.parcels.cancel')}
        </button>
      </div>
    </>
  );
}

/** A photograph of what is inside, kept with us as the business's own. */
async function uploadContent(api: ReturnType<typeof parcelsApi>, dataUrl: string, thumbDataUrl?: string): Promise<string | null> {
  const r = await api.upload(dataUrl, thumbDataUrl);
  return r.error ? null : (r.data?.mediaId ?? null);
}

/* --------------------------------------------------------- its own door -- */

/**
 * ITS LAST LEG TO ITS OWN PLACE (2026-10-29): where it stands, and what the business can do — post it once its balance holds
 * the most, or raise the most while no driver has taken it. Collected at the shop with its code, the leg is withdrawn.
 */
function DoorLeg({ api, row, works, busy, act }: { api: ReturnType<typeof parcelsApi>; row: BusinessParcel; works: boolean; busy: string | null; act: (key: string, fn: () => Promise<{ error?: Err }>, note?: string) => Promise<boolean> }) {
  const t = useT();
  const d = row.toOwnPlace!;
  const [most, setMost] = useState('');
  const line =
    d.state === 'waiting'
      ? t('business.parcels.door.waiting', { via: d.via, most: money(d.maxSpend, d.currency) })
      : d.state === 'short'
        ? t('business.parcels.door.short', { via: d.via, most: money(d.maxSpend, d.currency) })
        : d.state === 'posted'
          ? d.loadStatus === 'claimed'
            ? t('business.parcels.door.taken', { name: d.driverName ?? '', code: d.loadCode ?? '', via: d.via })
            : t('business.parcels.door.posted', { code: d.loadCode ?? '', most: money(d.maxSpend, d.currency) })
          : d.state === 'handed'
            ? t('business.parcels.door.handed', { name: d.driverName ?? '', place: d.label })
            : d.state === 'delivered'
              ? d.receivedBy
                ? t('business.parcels.door.deliveredBy', { place: d.label, name: d.receivedBy })
                : t('business.parcels.door.delivered', { place: d.label })
              : t('business.parcels.door.collected', { via: d.via });
  const untaken = d.state === 'waiting' || d.state === 'short' || (d.state === 'posted' && d.loadStatus !== 'claimed');
  return (
    <div class={`cnote${d.state === 'short' ? ' cnote--warn' : ''}`}>
      <p>
        <strong>{t('business.parcels.door.title', { place: d.label })}</strong> {line}
      </p>
      {works && d.state === 'short' ? (
        <div class="twr-panelend">
          <button type="button" class="cbtn cbtn--primary" disabled={busy !== null} onClick={() => void act(`door:${row.parcelId}`, () => api.postDoor(row.parcelId), t('business.parcels.door.postedNow', { id: row.parcelId }))}>
            {t('business.parcels.door.post')}
          </button>
        </div>
      ) : null}
      {works && untaken ? (
        <div class="twr-panelend">
          <input class="cinput" inputMode="decimal" aria-label={t('business.parcels.door.newMost')} placeholder={t('business.parcels.door.newMost')} value={most} onInput={(e) => setMost((e.target as HTMLInputElement).value)} />
          <button type="button" class="cbtn cbtn--ghost" disabled={busy !== null || !(Number(most) > 0)} onClick={() => void act(`raise:${row.parcelId}`, () => api.raiseDoor(row.parcelId, Number(most)), t('business.parcels.door.raised', { most: money(Number(most), d.currency) })).then((ok) => ok && setMost(''))}>
            {t(d.state === 'posted' ? 'business.parcels.door.raise' : 'business.parcels.door.change')}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ opened -- */

function ParcelOpened({ api, row, works, busy, act }: { api: ReturnType<typeof parcelsApi>; row: BusinessParcel; works: boolean; busy: string | null; act: (key: string, fn: () => Promise<{ error?: Err }>, note?: string) => Promise<boolean> }) {
  const t = useT();
  const [d, setD] = useState<BusinessParcelDetail | null>(null);
  const [off, setOff] = useState<ParcelCallOff | null>(null);
  const [most, setMost] = useState('');
  const [labelError, setLabelError] = useState<string | null>(null);

  useEffect(() => {
    void api.detail(row.parcelId).then((r) => setD(r.error ? null : (r.data ?? null)));
  }, [api, row.parcelId, row.status, row.paid]);

  const print = async () => {
    const tab = tabAtTheTap();
    try {
      const r = await api.label(row.parcelId);
      if (r.error) return setLabelError(words(r.error));
      if (r.data?.svg) tab.show(r.data.svg, 'image/svg+xml');
    } finally {
      tab.cancel();
    }
  };

  const stage = parcelStage(row);
  const callable = works && !row.toOwnPlace?.loadStatus && (stage === 'unpaid' || stage === 'to_hand_in' || stage === 'at_your_place' || stage === 'on_its_way');
  return (
    <section class="cons__panel">
      <div class="cons__panelhead">
        <span class="cons__panelt">
          {row.reference ? `${row.reference} · ` : ''}
          {row.parcelId}
        </span>
        <span class={`ctag ctag--${STAGE_TONE[stage]}`}>{t(STAGE_WORD[stage])}</span>
      </div>
      <dl class="cons__facts">
        <div class="cons__fact">
          <dt class="cons__factk">{t(row.fromOwnPlace ? 'business.parcels.fact.collectedFrom' : 'business.parcels.fact.from')}</dt>
          <dd class="cons__factv">{row.from ? `${row.from.name} · ${row.from.zone}` : '—'}</dd>
        </div>
        <div class="cons__fact">
          <dt class="cons__factk">{t(row.toOwnPlace ? 'business.parcels.fact.deliveredTo' : 'business.parcels.fact.to')}</dt>
          <dd class="cons__factv">
            {row.toOwnPlace ? t('business.parcels.fact.viaShop', { place: row.toOwnPlace.label, shop: row.to.name }) : `${row.to.name} · ${row.to.zone}`}
          </dd>
        </div>
        <div class="cons__fact">
          <dt class="cons__factk">{t(row.toOwnPlace ? 'business.parcels.fact.receivesIt' : 'business.parcels.fact.receiver')}</dt>
          <dd class="cons__factv">{row.receiver}</dd>
        </div>
        <div class="cons__fact">
          <dt class="cons__factk">{t('business.parcels.fact.cost')}</dt>
          <dd class="cons__factv">
            {money(row.cost, row.currency)}
            {d?.platformFee != null ? ` · ${t('business.parcels.fact.fee', { fee: money(d.platformFee, row.currency) })}` : ''}
            {d?.tax ? ` · ${t('business.parcels.fact.tax', { tax: money(d.tax, row.currency), label: d.taxLabel ?? '' })}` : ''}
          </dd>
        </div>
        {d?.coverLimit ? (
          <div class="cons__fact">
            <dt class="cons__factk">{t('business.parcels.fact.cover')}</dt>
            <dd class="cons__factv">{money(d.coverLimit, row.currency)}</dd>
          </div>
        ) : null}
        {row.sentBy ? (
          <div class="cons__fact">
            <dt class="cons__factk">{t('business.parcels.fact.sentBy')}</dt>
            <dd class="cons__factv">
              {row.sentBy} · {when(row.createdAt)}
            </dd>
          </div>
        ) : null}
      </dl>

      {row.toOwnPlace ? <DoorLeg api={api} row={row} works={works} busy={busy} act={act} /> : null}

      {row.collectionCode ? (
        <>
          <CodeCard label={t('business.parcels.code')} code={row.collectionCode} scanAs="collect" />
          <p class="chint">{t('business.parcels.codeHint')}</p>
        </>
      ) : null}

      {labelError ? <p class="cerr">{labelError}</p> : null}
      <div class="twr-panelend">
        {row.paid && stage !== 'called_off' ? (
          <button type="button" class="cbtn cbtn--ghost" onClick={() => void print()}>
            {t('business.parcels.printLabel')}
          </button>
        ) : null}
        {works && !row.paid && stage !== 'called_off' ? (
          <button type="button" class="cbtn cbtn--primary" disabled={busy !== null} onClick={() => void act(`pay:${row.parcelId}`, () => api.pay(row.parcelId), t('business.parcels.paidNow', { id: row.parcelId }))}>
            {t('business.parcels.payNow', { price: money(row.cost, row.currency) })}
          </button>
        ) : null}
        {callable && !off ? (
          <button type="button" class="cbtn cbtn--ghost" onClick={() => void api.callOffPreview(row.parcelId).then((r) => setOff(r.data ?? { parcelId: row.parcelId, outcome: 'no', why: words(r.error) ?? '' }))}>
            {t('business.parcels.callOff')}
          </button>
        ) : null}
      </div>

      {off ? (
        <div class="cnote">
          <p>
            {off.outcome === 'refund'
              ? t('business.parcels.offRefund', { amount: money(off.amount ?? 0, off.currency) })
              : off.outcome === 'bring_back'
                ? t('business.parcels.offBringBack', { amount: money(off.amount ?? 0, off.currency), shop: off.backTo ?? '' })
                : off.outcome === 'pick'
                  ? t('business.parcels.offPick', { place: off.door ?? '' })
                  : off.outcome === 'to_door'
                    ? t('business.parcels.offToDoor', { place: off.backTo ?? '', most: money(off.suggestedMax ?? 0, off.currency) })
                    : off.why || t('business.parcels.offNo')}
          </p>
          <div class="twr-panelend">
            {off.outcome === 'pick' && off.door ? (
              <button type="button" class="cbtn cbtn--primary" onClick={() => void api.callOffPreview(row.parcelId, 'door').then((r) => { setOff(r.data ?? { parcelId: row.parcelId, outcome: 'no', why: words(r.error) ?? '' }); setMost(String(r.data?.suggestedMax ?? '')); })}>
                {t('business.parcels.offToPlace', { place: off.door })}
              </button>
            ) : null}
            {off.outcome === 'to_door' ? (
              <>
                <input class="cinput" inputMode="decimal" aria-label={t('business.parcels.offMost')} value={most} onInput={(e) => setMost((e.target as HTMLInputElement).value)} />
                <button type="button" class="cbtn cbtn--primary" disabled={busy !== null || !(Number(most) > 0)} onClick={() => void act(`off:${row.parcelId}`, () => api.callOff(row.parcelId, undefined, { backTo: 'door', maxSpend: Number(most) }), t('business.parcels.calledOffDoor', { id: row.parcelId })).then((ok) => ok && setOff(null))}>
                  {t('business.parcels.offConfirmDoor')}
                </button>
              </>
            ) : null}
            {off.outcome === 'refund' || off.outcome === 'bring_back' ? (
              <button type="button" class="cbtn cbtn--primary" disabled={busy !== null} onClick={() => void act(`off:${row.parcelId}`, () => api.callOff(row.parcelId), t('business.parcels.calledOff', { id: row.parcelId })).then((ok) => ok && setOff(null))}>
                {t(off.outcome === 'refund' ? 'business.parcels.offConfirmRefund' : 'business.parcels.offConfirmBack')}
              </button>
            ) : null}
            <button type="button" class="cbtn cbtn--ghost" onClick={() => setOff(null)}>
              {t('business.parcels.cancel')}
            </button>
          </div>
        </div>
      ) : null}

      {d?.steps.length ? (
        <div class="crows">
          {d.steps.map((s) => (
            <div class="crow" key={`${s.at}:${s.status}`}>
              <span class="crow__body">
                <span class="crow__top">
                  <span class="crow__name">{t(stepWord(s.status))}</span>
                </span>
                <span class="crow__sub">{[when(s.at), s.note].filter(Boolean).join(' · ')}</span>
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
