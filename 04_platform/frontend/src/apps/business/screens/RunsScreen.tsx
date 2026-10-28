import { useCallback, useEffect, useState } from 'preact/hooks';
import { useT } from '../../../shared/i18n';
import { settleWords } from '../../../shared/settle';
import { coverWords } from '../../../shared/cover';
import { quoteFigure, quoteTone, type QuoteView } from '../../../shared/quote';
import { ConsoleDetail } from '../../tower/ConsoleDetail';
import { QuotePanel } from '../../tower/screens/QuotePanel';
import { NATURES } from '../../agent/logic';
import type { MyBookingRow, OfferQuote, OfferRow } from '../../agent/types';
import type { BusinessClient, BusinessView } from '../api';
import { mayAct } from '../logic';
import { SentFor } from './SentFor';
import type { BusinessActions } from '../useBusinessApp';
import { tabAtTheTap } from '../../../shared/openPage';

/**
 * B2 — SPACE ON A CARRIER'S RUN: a truck that is leaving anyway, with room in the back.
 *
 * The price is the carrier's own published rate, quoted before anything is taken, and the business pays the carrier
 * directly — how and when is the carrier's to say, and it is said on every offer. We neither bill nor hold it (the user,
 * 2026-10-04). What the business gets from us is the space, the consignment note, and one place to keep the carrier's
 * quotation and whether it is paid.
 */
export function RunsScreen({ business, client }: { business: BusinessView; actions: BusinessActions; client: BusinessClient | null }) {
  const t = useT();
  const act = mayAct(business.you.role);
  const [offers, setOffers] = useState<OfferRow[] | null>(null);
  const [bookings, setBookings] = useState<MyBookingRow[] | null>(null);
  const [offer, setOffer] = useState<OfferRow | null>(null);
  const [booking, setBooking] = useState<MyBookingRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!client) return;
    const [o, b] = await Promise.all([client.shipping.departureOffers(), client.shipping.myDepartureBookings()]);
    if (o.error) setError(o.error.detail || o.error.title);
    setOffers(((o.data as unknown as { items?: OfferRow[] })?.items ?? []) as OfferRow[]);
    setBookings(((b.data as unknown as { items?: MyBookingRow[] })?.items ?? []) as MyBookingRow[]);
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (booking) setBooking(bookings?.find((x) => x.bookingId === booking.bookingId) ?? null);
  }, [bookings]);

  return (
    <>
      <header class="cons__head">
        <h1 class="cons__title">{t('business.runs.title')}</h1>
        <p class="cons__lede">{t('business.runs.lede')}</p>
      </header>
      {done ? <p class="cnote">{done}</p> : null}
      {error ? <p class="cerr">{error}</p> : null}

      <section class="cons__panel">
        <div class="cons__panelhead">
          <span class="cons__panelt">{t('business.runs.mineTitle')}</span>
          {bookings ? <span class="chint">{t('business.runs.mineCount', { n: bookings.length })}</span> : null}
        </div>
        {bookings === null ? (
          <p class="cons__empty">{t('business.loading')}</p>
        ) : bookings.length === 0 ? (
          <p class="cons__empty">{t('business.runs.mineNone')}</p>
        ) : (
          <div class="crows">
            {bookings.map((b) => (
              <button type="button" class="crow" key={b.bookingId} onClick={() => setBooking(b)}>
                <span class="crow__body">
                  <span class="crow__top">
                    <span class="crow__name">
                      {b.company} · {b.description}
                    </span>
                    <span class={`ctag ctag--${b.bookingStatus === 'delivered' ? 'ok' : b.bookingStatus === 'cancelled' || b.runStatus === 'cancelled' ? 'warn' : 'info'}`}>
                      {t(b.runStatus === 'cancelled' && b.bookingStatus === 'booked' ? 'business.runs.status.runOff' : `business.runs.status.${b.bookingStatus}`)}
                    </span>
                  </span>
                  <span class="crow__sub">
                    {t('business.runs.bookingSub', { from: b.originZone, to: b.destZone, when: b.leavesAt.slice(0, 16).replace('T', ' '), price: `${b.price.toLocaleString()} ${b.currency}` })}
                    {(b as MyBookingRow & { onBehalfOf?: { name: string } }).onBehalfOf ? ` · ${t('business.sentFor.forClient', { name: (b as MyBookingRow & { onBehalfOf?: { name: string } }).onBehalfOf!.name })}` : ''}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
      </section>

      <section class="cons__panel">
        <div class="cons__panelhead">
          <span class="cons__panelt">{t('business.runs.openTitle')}</span>
          {offers ? <span class="chint">{t('business.runs.openCount', { n: offers.length })}</span> : null}
        </div>
        {offers === null ? (
          <p class="cons__empty">{t('business.loading')}</p>
        ) : offers.length === 0 ? (
          <p class="cons__empty">{t('business.runs.openNone')}</p>
        ) : (
          <div class="crows">
            {offers.map((o) => (
              <button type="button" class="crow" key={o.departureId} onClick={() => setOffer(o)}>
                <span class="crow__body">
                  <span class="crow__top">
                    <span class="crow__name">
                      {o.company} · {t('business.runs.route', { from: o.originZone, to: o.destZone })}
                    </span>
                    <span class="ctag ctag--quiet">{t('business.runs.left', { kg: o.remainingKg.toLocaleString() })}</span>
                  </span>
                  <span class="crow__sub">
                    {t('business.runs.offerSub', { when: o.leavesAt.slice(0, 16).replace('T', ' '), amount: o.rate.amount.toLocaleString(), currency: o.rate.currency })} · {settleWords(o.settle, t)}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
      </section>

      {offer ? (
        <BookPanel
          offer={offer}
          client={client}
          act={act}
          onClose={() => setOffer(null)}
          business={business}
          onBooked={async () => {
            setOffer(null);
            setDone(t('business.runs.booked', { company: offer.company }));
            await load();
          }}
        />
      ) : null}
      {booking ? (
        <BookingDetail
          row={booking}
          client={client}
          act={act}
          onClose={() => setBooking(null)}
          onChanged={async (message) => {
            if (message) setDone(message);
            await load();
          }}
        />
      ) : null}
    </>
  );
}

function BookPanel({ offer, business, client, act, onClose, onBooked }: { offer: OfferRow; business: BusinessView; client: BusinessClient | null; act: boolean; onClose: () => void; onBooked: () => void | Promise<void> }) {
  const t = useT();
  const [form, setForm] = useState({ description: '', nature: 'GEN', weightKg: '', volumeM3: '', declaredValue: '', forClientId: '' });
  const [quote, setQuote] = useState<OfferQuote | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = () => ({
    description: form.description.trim(),
    nature: form.nature,
    weightKg: Number(form.weightKg),
    ...(Number(form.volumeM3) > 0 ? { volumeM3: Number(form.volumeM3) } : {}),
    ...(Number(form.declaredValue) > 0 ? { declaredValue: Number(form.declaredValue) } : {}),
    ...(form.forClientId ? { forClientId: form.forClientId } : {}),
  });
  const ready = Boolean(form.description.trim()) && Number(form.weightKg) > 0;

  const price = async () => {
    if (!client || !ready) return;
    setBusy(true);
    setError(null);
    const r = await client.shipping.quoteDeparture(offer.departureId, load() as never);
    setBusy(false);
    if (r.error) return setError(r.error.detail || r.error.title);
    setQuote(r.data as unknown as OfferQuote);
  };

  const book = async () => {
    if (!client || !ready) return;
    setBusy(true);
    setError(null);
    const r = await client.shipping.bookDeparture(offer.departureId, load() as never);
    setBusy(false);
    if (r.error) return setError(r.error.detail || r.error.title);
    await onBooked();
  };

  return (
    <ConsoleDetail openKey={offer.departureId} title={offer.company} onClose={onClose}>
      <section class="cons__panel">
        <div class="cons__panelhead">
          <span class="cons__panelt">{t('business.runs.route', { from: offer.originZone, to: offer.destZone })}</span>
        </div>
        <dl class="cons__facts">
          <div class="cons__fact">
            <dt class="cons__factk">{t('business.runs.fact.carrier')}</dt>
            <dd class="cons__factv">{offer.company}</dd>
          </div>
          <div class="cons__fact">
            <dt class="cons__factk">{t('business.runs.fact.leaves')}</dt>
            <dd class="cons__factv">{offer.leavesAt.slice(0, 16).replace('T', ' ')}</dd>
          </div>
          <div class="cons__fact">
            <dt class="cons__factk">{t('business.runs.fact.rate')}</dt>
            <dd class="cons__factv">
              {offer.rate.amount.toLocaleString()} {offer.rate.currency} · {t(`business.runs.basis.${offer.rate.basis}` as never)}
            </dd>
          </div>
          <div class="cons__fact">
            <dt class="cons__factk">{t('business.runs.fact.room')}</dt>
            <dd class="cons__factv">{offer.remainingM3 != null ? t('business.runs.roomBoth', { kg: offer.remainingKg.toLocaleString(), m3: offer.remainingM3 }) : t('business.runs.left', { kg: offer.remainingKg.toLocaleString() })}</dd>
          </div>
          <div class="cons__fact">
            <dt class="cons__factk">{t('business.runs.fact.pay')}</dt>
            <dd class="cons__factv">{settleWords(offer.settle, t)}</dd>
          </div>
          <div class="cons__fact">
            <dt class="cons__factk">{t('business.runs.fact.cover')}</dt>
            <dd class="cons__factv">{coverWords(offer.cover, offer.rate.currency, t)}</dd>
          </div>
          {offer.waiting ? (
            <div class="cons__fact">
              <dt class="cons__factk">{t('business.runs.fact.waiting')}</dt>
              <dd class="cons__factv">{t('business.runs.waiting', { min: offer.waiting.freeMin, rate: offer.waiting.perHour, currency: offer.rate.currency })}</dd>
            </div>
          ) : null}
          {offer.note ? (
            <div class="cons__fact">
              <dt class="cons__factk">{t('business.runs.fact.note')}</dt>
              <dd class="cons__factv">{offer.note}</dd>
            </div>
          ) : null}
        </dl>
      </section>

      {act ? (
        <section class="cons__panel">
          <div class="cons__panelhead">
            <span class="cons__panelt">{t('business.runs.bookTitle')}</span>
          </div>
          <SentFor client={client} expeditor={business.activities.includes('expeditor')} value={form.forClientId} onChange={(id) => setForm((prev) => ({ ...prev, forClientId: id }))} />
          <label class="cfield">
            <span class="cfield__label">{t('business.loads.f.description')}</span>
            <input class="cinput" maxLength={160} value={form.description} onInput={(e) => (setForm((prev) => ({ ...prev, description: (e.target as HTMLInputElement).value })), setQuote(null))} />
          </label>
          <div class="biz-two">
            <label class="cfield">
              <span class="cfield__label">{t('business.loads.f.nature')}</span>
              <select class="cinput" value={form.nature} onChange={(e) => (setForm((prev) => ({ ...prev, nature: (e.target as HTMLSelectElement).value })), setQuote(null))}>
                {NATURES.map((n) => (
                  <option key={n.key} value={n.key}>
                    {t(n.labelKey)}
                  </option>
                ))}
              </select>
            </label>
            <label class="cfield">
              <span class="cfield__label">{t('business.loads.f.weight')}</span>
              <input class="cinput" type="number" min={0.1} value={form.weightKg} onInput={(e) => (setForm((prev) => ({ ...prev, weightKg: (e.target as HTMLInputElement).value })), setQuote(null))} />
            </label>
          </div>
          <div class="biz-two">
            <label class="cfield">
              <span class="cfield__label">{t('business.runs.f.volume')}</span>
              <input class="cinput" type="number" min={0} value={form.volumeM3} onInput={(e) => (setForm((prev) => ({ ...prev, volumeM3: (e.target as HTMLInputElement).value })), setQuote(null))} />
            </label>
            <label class="cfield">
              <span class="cfield__label">{t('business.runs.f.value', { currency: offer.rate.currency })}</span>
              <input class="cinput" type="number" min={0} value={form.declaredValue} onInput={(e) => setForm((prev) => ({ ...prev, declaredValue: (e.target as HTMLInputElement).value }))} />
              <span class="chint">{coverWords(offer.cover, offer.rate.currency, t)}</span>
            </label>
          </div>
          {quote ? <p class="cnote">{t('business.runs.quoteLine', { price: `${quote.price.toLocaleString()} ${quote.currency}`, binds: t(quote.binds === 'space' ? 'business.runs.bindsSpace' : 'business.runs.bindsWeight') })}</p> : null}
          {error ? <p class="cerr">{error}</p> : null}
          <div class="twr-panelend">
            <button type="button" class="cbtn cbtn--ghost" disabled={busy || !ready} onClick={() => void price()}>
              {t('business.runs.priceCta')}
            </button>
            <button type="button" class="cbtn cbtn--primary" disabled={busy || !ready || !quote} onClick={() => void book()}>
              {quote ? t('business.runs.bookCta', { price: `${quote.price.toLocaleString()} ${quote.currency}` }) : t('business.runs.bookFirst')}
            </button>
          </div>
          <p class="chint">{t('business.runs.payNote')}</p>
        </section>
      ) : null}
    </ConsoleDetail>
  );
}

function BookingDetail({ row, client, act, onClose, onChanged }: { row: MyBookingRow; client: BusinessClient | null; act: boolean; onClose: () => void; onChanged: (message?: string) => void | Promise<void> }) {
  const t = useT();
  const [quote, setQuote] = useState<QuoteView | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const read = useCallback(async () => {
    if (!client) return;
    const q = await client.bookingQuote(row.departureId, row.bookingId);
    setQuote(q.error ? null : (q.data?.quote ?? null));
  }, [client, row.departureId, row.bookingId]);

  useEffect(() => {
    void read();
  }, [read]);

  const run = async (fn: () => Promise<{ error?: { detail?: string; title?: string } | null }>, message: string) => {
    setBusy(true);
    setError(null);
    const r = await fn();
    setBusy(false);
    if (r.error) return setError(r.error.detail || r.error.title || '');
    await onChanged(message);
    await read();
  };

  const note = async () => {
    if (!client) return;
    const tab = tabAtTheTap();
    try {
      const r = await client.bookingNote(row.departureId, row.bookingId);
      if (r.error || !r.data) return setError(t('business.loads.noteGone'));
      tab.show(r.data);
    } finally {
      tab.cancel();
    }
  };

  return (
    <ConsoleDetail openKey={row.bookingId} title={`${row.company} · ${row.description}`} onClose={onClose}>
      <section class="cons__panel">
        <div class="cons__panelhead">
          <span class="cons__panelt">{t('business.runs.route', { from: row.originZone, to: row.destZone })}</span>
        </div>
        <dl class="cons__facts">
          <div class="cons__fact">
            <dt class="cons__factk">{t('business.runs.fact.carrier')}</dt>
            <dd class="cons__factv">{row.company}</dd>
          </div>
          <div class="cons__fact">
            <dt class="cons__factk">{t('business.runs.fact.leaves')}</dt>
            <dd class="cons__factv">{row.leavesAt.slice(0, 16).replace('T', ' ')}</dd>
          </div>
          <div class="cons__fact">
            <dt class="cons__factk">{t('business.runs.fact.price')}</dt>
            <dd class="cons__factv">
              {row.price.toLocaleString()} {row.currency}
            </dd>
          </div>
          <div class="cons__fact">
            <dt class="cons__factk">{t('business.runs.fact.pay')}</dt>
            <dd class="cons__factv">{settleWords(row.settle, t)}</dd>
          </div>
          {row.cancellation ? (
            <div class="cons__fact">
              <dt class="cons__factk">{t('business.runs.fact.cancelled')}</dt>
              <dd class="cons__factv">{t(row.cancellation.by === 'carrier' ? 'business.runs.cancelledCarrier' : 'business.runs.cancelledYou', { when: row.cancellation.at.slice(0, 10) })}</dd>
            </div>
          ) : null}
          {row.deliveredAt ? (
            <div class="cons__fact">
              <dt class="cons__factk">{t('business.loads.fact.delivered')}</dt>
              <dd class="cons__factv">{t('business.loads.fact.deliveredTo', { when: row.deliveredAt.slice(0, 10), who: row.receivedBy ?? '—' })}</dd>
            </div>
          ) : null}
          {row.trackingUrl ? (
            <div class="cons__fact">
              <dt class="cons__factk">{t('business.loads.fact.tracking')}</dt>
              <dd class="cons__factv">
                <a href={row.trackingUrl} target="_blank" rel="noopener noreferrer">
                  {row.trackingKey}
                </a>
                <span class="chint"> {t('business.loads.fact.trackingHint')}</span>
              </dd>
            </div>
          ) : null}
        </dl>
        <div class="twr-panelend">
          <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => void note()}>
            {t('business.loads.note')}
          </button>
          {act && row.cancellable ? (
            <button type="button" class="cbtn cbtn--danger cbtn--sm" disabled={busy} onClick={() => void run(() => client!.shipping.cancelDepartureBooking(row.departureId, row.bookingId) as never, t('business.runs.givenBack'))}>
              {t('business.runs.giveBack')}
            </button>
          ) : null}
        </div>
      </section>

      {row.bookingStatus !== 'cancelled' ? (
        <section class="cons__panel">
          <div class="cons__panelhead">
            <span class="cons__panelt">{t('business.pay.title')}</span>
            {quote ? <span class={`ctag ctag--${quoteTone(quote)}`}>{quote.status === 'paid' ? t('business.pay.paid') : t('business.pay.open', { figure: quoteFigure(quote) })}</span> : null}
          </div>
          {quote ? (
            <QuotePanel quote={quote} api={client ? (client.api as never) : null} canChange={act} onChanged={() => read()} />
          ) : quote === null ? (
            <>
              <p class="cons__lede">{t('business.pay.ledeRun', { price: `${row.price.toLocaleString()} ${row.currency}` })}</p>
              {act ? (
                <div class="twr-panelend">
                  <button type="button" class="cbtn cbtn--primary" disabled={busy} onClick={() => void run(() => client!.recordBookingQuote(row.departureId, row.bookingId, {}), t('business.pay.recorded'))}>
                    {t('business.pay.record')}
                  </button>
                </div>
              ) : null}
            </>
          ) : null}
        </section>
      ) : null}
      {error ? <p class="cerr">{error}</p> : null}
    </ConsoleDetail>
  );
}
