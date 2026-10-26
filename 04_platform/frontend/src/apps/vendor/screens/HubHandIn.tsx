import { useCallback, useEffect, useState } from 'preact/hooks';
import type { SbgError } from '../../../lib/sbg';
import { formatDate, useT } from '../../../shared/i18n';
import { Button, Card, ErrorNote, Note, Pill, type PillTone } from '../../../shared/ui';
import { arrivalWord, bookableDays, bookingReady, HUB_UNIT_KINDS, hoursLine, todayAt, type ArrivalWord, type HubArrivalView, type HubsApi, type HubUnitKind, type HubWaiting, type StoreHubArrivals } from '../hubs';

const WORD_TONE: Record<ArrivalWord, PillTone> = { expected: 'info', late: 'warn', receiving: 'info', all_in: 'ok', some_missing: 'warn', withdrawn: 'idle' };

interface BookingForm {
  mdpId: string;
  parcelIds: string[];
  unitKind: HubUnitKind;
  units: string;
  expectedOn: string;
  reference: string;
  bringer: string;
}

/** "Tue 27 Oct" — a day as the hub keeps it, the same date wherever it is read. */
const dayLabel = (day: string) => formatDate(`${day}T12:00:00Z`, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

/**
 * TO A HUB, IN BULK (reading B, hubs.ts) — on the Dock screen, because it is the other way a store's parcels leave it: the
 * parcels it chose to hand in at a hub, waiting to be booked; booking an arrival (which parcels, on what, which day the hub
 * receives on its own clock); and its arrivals as the hub takes them in — scanned in one by one, and what was not there.
 * With nothing booked or waiting, a line on how it works: a hub is chosen where the parcel is shipped.
 */
export function HubHandIn({ api, vendorId }: { api: HubsApi | null; vendorId: string | null }) {
  const t = useT();
  const [data, setData] = useState<StoreHubArrivals | null>(null);
  const [booking, setBooking] = useState<BookingForm | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SbgError | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!api || !vendorId) return;
    const r = await api.arrivals(vendorId);
    if (r.error) return setError(r.error);
    setData(r.data ?? { waiting: [], arrivals: [] });
  }, [api, vendorId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!api || !vendorId || !data) return null;

  const start = (w: HubWaiting) => {
    const days = bookableDays(w.bulk?.hours, todayAt(w.bulk?.zone));
    setDone(null);
    setError(null);
    setBooking({ mdpId: w.mdpId, parcelIds: w.parcels.map((p) => p.parcelId), unitKind: 'pallet', units: '1', expectedOn: days[0] ?? '', reference: '', bringer: '' });
  };

  const book = async (hubName: string) => {
    if (!booking || !bookingReady(booking)) return;
    setBusy(true);
    setError(null);
    const r = await api.book(vendorId, {
      mdpId: booking.mdpId,
      parcelIds: booking.parcelIds,
      unitKind: booking.unitKind,
      units: Number(booking.units),
      expectedOn: booking.expectedOn,
      ...(booking.reference.trim() ? { reference: booking.reference.trim() } : {}),
      ...(booking.bringer.trim() ? { bringer: booking.bringer.trim() } : {}),
    });
    setBusy(false);
    if (r.error) return setError(r.error);
    setDone(t('vendor.hub.booked', { hub: hubName, day: dayLabel(booking.expectedOn) }));
    setBooking(null);
    await load();
  };

  const withdraw = async (a: HubArrivalView) => {
    setBusy(true);
    setError(null);
    const r = await api.withdraw(vendorId, a.arrivalId);
    setBusy(false);
    if (r.error) return setError(r.error);
    setDone(t('vendor.hub.withdrawn'));
    await load();
  };

  if (!data.waiting.length && !data.arrivals.length) {
    return (
      <Card title={t('vendor.hub.title')}>
        <p class="card__note">{t('vendor.hub.pitch')}</p>
      </Card>
    );
  }

  return (
    <>
      <h2 class="scr__section">{t('vendor.hub.title')}</h2>
      <p class="hint">{t('vendor.hub.lede')}</p>
      {done ? <Note tone="ok" icon="check" title={done} /> : null}
      {error ? <ErrorNote error={error} /> : null}

      {data.waiting.map((w) => {
        const open = booking?.mdpId === w.mdpId ? booking : null;
        const hours = hoursLine(w.bulk?.hours, t);
        const days = bookableDays(w.bulk?.hours, todayAt(w.bulk?.zone));
        return (
          <Card key={w.mdpId} title={w.hubName}>
            <p class="card__note">{t('vendor.hub.waiting', { n: w.parcels.length, hub: w.hubName })}</p>
            {hours ? <p class="card__note">{t('vendor.mint.hubHours', { hours })}</p> : null}
            {!open ? (
              <Button variant="outline" disabled={!w.bulk || busy} onClick={() => start(w)}>
                {t('vendor.hub.book')}
              </Button>
            ) : (
              <>
                <div class="field" style="margin-top:12px">
                  <span class="field__label">{t('vendor.hub.parcelsLabel')}</span>
                  <div class="rows" role="list">
                    {w.parcels.map((p) => {
                      const on = open.parcelIds.includes(p.parcelId);
                      return (
                        <label key={p.parcelId} class="row row--tap" role="listitem">
                          <input type="checkbox" checked={on} onChange={() => setBooking({ ...open, parcelIds: on ? open.parcelIds.filter((x) => x !== p.parcelId) : [...open.parcelIds, p.parcelId] })} />
                          <span class="row__body">
                            <span class="row__t mono-t">{p.parcelId}</span>
                            <span class="row__s">{p.destination}</span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
                <div class="field" style="margin-top:12px">
                  <label class="field__label" for={`hub-kind-${w.mdpId}`}>
                    {t('vendor.hub.kindLabel')}
                  </label>
                  <select id={`hub-kind-${w.mdpId}`} class="input" value={open.unitKind} onChange={(e) => setBooking({ ...open, unitKind: e.currentTarget.value as HubUnitKind })}>
                    {HUB_UNIT_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {t(`vendor.hub.kind.${k}` as never)}
                      </option>
                    ))}
                  </select>
                </div>
                <div class="field" style="margin-top:12px">
                  <label class="field__label" for={`hub-units-${w.mdpId}`}>
                    {t('vendor.hub.unitsLabel')}
                  </label>
                  <input id={`hub-units-${w.mdpId}`} class="input" type="number" inputMode="numeric" min={1} max={100} value={open.units} onInput={(e) => setBooking({ ...open, units: e.currentTarget.value })} />
                </div>
                <div class="field" style="margin-top:12px">
                  <label class="field__label" for={`hub-day-${w.mdpId}`}>
                    {t('vendor.hub.dayLabel')}
                  </label>
                  <select id={`hub-day-${w.mdpId}`} class="input" value={open.expectedOn} onChange={(e) => setBooking({ ...open, expectedOn: e.currentTarget.value })}>
                    {days.map((d) => (
                      <option key={d} value={d}>
                        {dayLabel(d)}
                      </option>
                    ))}
                  </select>
                  <p class="hint">{t('vendor.hub.dayHint', { hub: w.hubName })}</p>
                </div>
                <div class="field" style="margin-top:12px">
                  <label class="field__label" for={`hub-ref-${w.mdpId}`}>
                    {t('vendor.hub.refLabel')}
                  </label>
                  <input id={`hub-ref-${w.mdpId}`} class="input" maxLength={60} value={open.reference} onInput={(e) => setBooking({ ...open, reference: e.currentTarget.value })} />
                </div>
                <div class="field" style="margin-top:12px">
                  <label class="field__label" for={`hub-bringer-${w.mdpId}`}>
                    {t('vendor.hub.bringerLabel')}
                  </label>
                  <input id={`hub-bringer-${w.mdpId}`} class="input" maxLength={80} value={open.bringer} onInput={(e) => setBooking({ ...open, bringer: e.currentTarget.value })} />
                  <p class="hint">{t('vendor.hub.bringerHint')}</p>
                </div>
                <div class="scr__cta">
                  <Button busy={busy} disabled={!bookingReady(open)} onClick={() => void book(w.hubName)}>
                    {t('vendor.hub.send')}
                  </Button>
                  <Button variant="link" onClick={() => setBooking(null)}>
                    {t('vendor.hub.cancel')}
                  </Button>
                </div>
              </>
            )}
          </Card>
        );
      })}

      {data.arrivals.length ? (
        <>
          <h2 class="scr__section">{t('vendor.hub.arrivalsTitle')}</h2>
          <div class="rows" role="list">
            {data.arrivals.map((a) => {
              const word = arrivalWord(a);
              return (
                <div key={a.arrivalId} class="row" role="listitem">
                  <span class="row__body">
                    <span class="row__t">
                      {a.hubName} · {dayLabel(a.expectedOn)}
                      {a.reference ? ` · ${a.reference}` : ''}
                    </span>
                    <span class="row__s">
                      {t(`vendor.hub.units.${a.unitKind}` as never, { n: a.units })} · {t('vendor.hub.parcels', { n: a.parcels.length })}
                    </span>
                    {a.state === 'receiving' ? <span class="row__s">{t('vendor.hub.progress', { done: a.scannedCount, all: a.parcels.length })}</span> : null}
                    {a.finished?.missing.length ? <span class="row__s">{t('vendor.hub.missing', { n: a.finished.missing.length })}</span> : null}
                  </span>
                  <span class="row__end">
                    <Pill tone={WORD_TONE[word]}>{t(`vendor.hub.word.${word}` as never)}</Pill>
                    {a.state === 'expected' ? (
                      <Button variant="link" full={false} disabled={busy} onClick={() => void withdraw(a)}>
                        {t('vendor.hub.withdraw')}
                      </Button>
                    ) : null}
                  </span>
                </div>
              );
            })}
          </div>
        </>
      ) : null}
    </>
  );
}
