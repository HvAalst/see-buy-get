import type { ComponentChildren } from 'preact';
import { useCallback, useEffect, useState } from 'preact/hooks';
import { foundPhotos, foundWords } from '../../../shared/found';
import { formatDate, useT } from '../../../shared/i18n';
import type { SiteView } from '../../tower/screens/SitePicker';
import type { BusinessClient, BusinessView } from '../api';
import { carrierLine, dueLine, inboundState, inboundTitle, isStillExpected, sameClockAs, trackingPathOf, type InboundClosingHow, type InboundRow, type InboundState, type InboundView, type ReceivingPoint } from '../inbound';
import { mayAct } from '../logic';
import { InboundDetail } from './InboundDetail';

const STATE_TAG: Record<InboundState, string> = { booked: 'quiet', carrier: 'info', on_its_way: 'info', delivered: 'ok', withdrawn: 'quiet' };

/**
 * COMING IN (inbound, reading A; the user, 2026-10-25: "Yes, A then B"). Which of the business's own places receive
 * goods, with the code each gives its suppliers — and what its suppliers have sent there: its own number for the order,
 * who from, how much, where it is now and who brings it. Never a price: that is between it and its supplier.
 *
 * D9 — a load delivered not all as the note says shows what was found at the handover, and what did not come (or came and
 * is not the goods) stays under "Still expected" until one of its people closes it. D10 — when a load is expected, and
 * whether it is late, is said on the receiving place's own clock, named where the reader's clock is another.
 */
export function InboundScreen({ business, client }: { business: BusinessView; client: BusinessClient | null }) {
  const t = useT();
  const works = mayAct(business.you.role);
  const [view, setView] = useState<InboundView | null>(null);
  const [places, setPlaces] = useState<SiteView[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  // D9 — closing what is still expected of one load: which, how, and a line for the business's own records.
  const [closing, setClosing] = useState<{ freightId: string; how: InboundClosingHow } | null>(null);
  const [closeNote, setCloseNote] = useState('');
  // A delivered load, opened: its copy of the note, and a problem with the goods.
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!client) return;
    const [coming, sites] = await Promise.all([client.inbound.comingIn(), (client.api as never as { sites: (id: string) => Promise<{ data?: unknown; error?: unknown }> }).sites(business.entityId)]);
    if (coming.error) setError(coming.error.detail || coming.error.title);
    else setView(coming.data ?? { points: [], items: [] });
    setPlaces(sites.error || !sites.data ? [] : ((sites.data as { sites: SiteView[] }).sites ?? []).filter((s) => s.kind === 'delivery'));
  }, [client, business.entityId]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (key: string, fn: () => Promise<{ error?: { detail?: string; title: string } | null }>, note: string): Promise<boolean> => {
    setBusy(key);
    setError(null);
    setDone(null);
    const r = await fn();
    setBusy(null);
    if (r.error) {
      setError(r.error.detail || r.error.title);
      return false;
    }
    setDone(note);
    await load();
    return true;
  };

  const pointOf = (siteId: string): ReceivingPoint | undefined => view?.points.find((p) => p.siteId === siteId);
  const share = async (p: ReceivingPoint) => {
    const text = t('business.inbound.shareText', { business: business.name, place: p.name, code: p.code });
    try {
      if (typeof navigator !== 'undefined' && navigator.share) await navigator.share({ title: t('business.inbound.shareTitle'), text });
      else if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(text);
        setDone(t('business.inbound.copied', { place: p.name }));
      }
    } catch {
      /* dismissed: nothing to say */
    }
  };

  const closeExpected = async (row: InboundRow, how: InboundClosingHow) => {
    const title = inboundTitle(row);
    const what = title.kind === 'order' ? t('business.inbound.order', { ref: title.text }) : title.text;
    const ok = await act(`close:${row.freightId}`, () => client!.inbound.closeExpected(row.freightId, how, closeNote.trim() || undefined), t(how === 'came' ? 'business.inbound.closedCame' : 'business.inbound.closedNotComing', { what }));
    if (ok) {
      setClosing(null);
      setCloseNote('');
    }
  };

  const items = view?.items ?? [];
  const opened = openId ? items.find((r) => r.freightId === openId) : undefined;
  const openOf = (r: InboundRow) => (inboundState(r) === 'delivered' ? () => setOpenId(r.freightId) : undefined);
  const coming = items.filter((r) => inboundState(r) !== 'delivered' && inboundState(r) !== 'withdrawn');
  const still = items.filter(isStillExpected);
  const past = items.filter((r) => (inboundState(r) === 'delivered' || inboundState(r) === 'withdrawn') && !isStillExpected(r));

  return (
    <>
      <header class="cons__head">
        <h1 class="cons__title">{t('business.inbound.title')}</h1>
        <p class="cons__lede">{t('business.inbound.lede')}</p>
      </header>
      {done ? <p class="cnote">{done}</p> : null}
      {error ? <p class="cerr">{error}</p> : null}

      <section class="cons__panel">
        <div class="cons__panelhead">
          <span class="cons__panelt">{t('business.inbound.pointsTitle')}</span>
        </div>
        <p class="chint">{t('business.inbound.pointsHint')}</p>
        {places === null ? (
          <p class="cons__empty">{t('business.loading')}</p>
        ) : places.length === 0 ? (
          <p class="cons__empty">{t('business.inbound.noPlaces')}</p>
        ) : (
          <div class="crows">
            {places.map((s) => {
              const p = pointOf(s.siteId);
              return (
                <div class="crow" key={s.siteId}>
                  <span class="crow__body">
                    <span class="crow__top">
                      <span class="crow__name">{s.name}</span>
                      {p ? <span class="ctag ctag--ok">{t('business.inbound.receiving')}</span> : <span class="ctag ctag--quiet">{t('business.inbound.notReceiving')}</span>}
                    </span>
                    {p ? (
                      <>
                        <span class="crow__sub">
                          {t('business.inbound.codeLine')} <code class="biz-code biz-inbound__code">{p.code}</code>
                        </span>
                        <span class="crow__sub">{t('business.inbound.since', { when: formatDate(p.since, { day: 'numeric', month: 'short', year: 'numeric' }), who: p.by })}</span>
                      </>
                    ) : null}
                    {works ? (
                      <span class="twr-panelend">
                        {p ? (
                          <>
                            <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => void share(p)}>
                              {t('business.inbound.share')}
                            </button>
                            <button type="button" class="cbtn cbtn--ghost cbtn--sm" disabled={busy !== null} onClick={() => void act(`code:${s.siteId}`, () => client!.inbound.newCode(s.siteId), t('business.inbound.newCodeDone', { place: s.name }))}>
                              {t('business.inbound.newCode')}
                            </button>
                            <button type="button" class="cbtn cbtn--ghost cbtn--sm" disabled={busy !== null} onClick={() => void act(`close:${s.siteId}`, () => client!.inbound.close(s.siteId), t('business.inbound.closedDone', { place: s.name }))}>
                              {t('business.inbound.close')}
                            </button>
                          </>
                        ) : (
                          <button type="button" class="cbtn cbtn--primary cbtn--sm" disabled={busy !== null} onClick={() => void act(`open:${s.siteId}`, () => client!.inbound.open(s.siteId), t('business.inbound.openDone', { place: s.name }))}>
                            {t('business.inbound.open')}
                          </button>
                        )}
                      </span>
                    ) : null}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section class="cons__panel">
        <div class="cons__panelhead">
          <span class="cons__panelt">{t('business.inbound.comingTitle')}</span>
          {view ? <span class="cons__panelt">{coming.length}</span> : null}
        </div>
        {view === null ? (
          <p class="cons__empty">{t('business.loading')}</p>
        ) : coming.length === 0 ? (
          <p class="cons__empty">{t(view.points.length ? 'business.inbound.noneComing' : 'business.inbound.noneYet')}</p>
        ) : (
          <div class="crows">
            {coming.map((r) => (
              <InboundLine key={r.freightId} row={r} />
            ))}
          </div>
        )}
      </section>

      {still.length ? (
        <section class="cons__panel">
          <div class="cons__panelhead">
            <span class="cons__panelt">{t('business.inbound.stillTitle')}</span>
            <span class="cons__panelt">{still.length}</span>
          </div>
          <p class="chint">{t('business.inbound.stillHint')}</p>
          <div class="crows">
            {still.map((r) => (
              <InboundLine key={r.freightId} row={r} onOpen={openOf(r)}>
                {works ? (
                  closing?.freightId === r.freightId ? (
                    <span class="biz-inbound__close">
                      <input class="cinput" maxLength={300} aria-label={t('business.inbound.closeNote')} placeholder={t('business.inbound.closeNote')} value={closeNote} onInput={(e) => setCloseNote((e.target as HTMLInputElement).value)} />
                      <button type="button" class="cbtn cbtn--primary cbtn--sm" disabled={busy !== null} onClick={() => void closeExpected(r, closing.how)}>
                        {t(closing.how === 'came' ? 'business.inbound.closeCame' : 'business.inbound.closeNotComing')}
                      </button>
                      <button
                        type="button"
                        class="cbtn cbtn--ghost cbtn--sm"
                        onClick={() => {
                          setClosing(null);
                          setCloseNote('');
                        }}
                      >
                        {t('business.inbound.back')}
                      </button>
                    </span>
                  ) : (
                    <span class="twr-panelend">
                      {(['came', 'not_coming'] as const).map((how) => (
                        <button
                          key={how}
                          type="button"
                          class="cbtn cbtn--ghost cbtn--sm"
                          disabled={busy !== null}
                          onClick={() => {
                            setClosing({ freightId: r.freightId, how });
                            setCloseNote('');
                          }}
                        >
                          {t(how === 'came' ? 'business.inbound.came' : 'business.inbound.notComing')}
                        </button>
                      ))}
                    </span>
                  )
                ) : null}
              </InboundLine>
            ))}
          </div>
        </section>
      ) : null}

      {past.length ? (
        <section class="cons__panel">
          <div class="cons__panelhead">
            <span class="cons__panelt">{t('business.inbound.pastTitle')}</span>
          </div>
          <div class="crows">
            {past.map((r) => (
              <InboundLine key={r.freightId} row={r} onOpen={openOf(r)} />
            ))}
          </div>
        </section>
      ) : null}

      {opened ? (
        <InboundDetail
          row={opened}
          client={client}
          act={works}
          onClose={() => setOpenId(null)}
          onChanged={async (message) => {
            if (message) setDone(message);
            await load();
          }}
        />
      ) : null}
    </>
  );
}

/**
 * One load coming in: its name, who from and how much, where it stands and when, who brings it, and its tracking page —
 * and, delivered, what was found at the handover, what is still expected, and who closed it.
 */
function InboundLine({ row, children, onOpen }: { row: InboundRow; children?: ComponentChildren; onOpen?: () => void }) {
  const t = useT();
  const state = inboundState(row);
  const title = inboundTitle(row);
  const day = (iso: string) => formatDate(iso, { weekday: 'short', day: 'numeric', month: 'short' });
  const hour = (iso: string) => formatDate(iso, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const what = [
    t('business.inbound.from', { from: row.from }),
    row.packages ? t('business.inbound.packages', { n: row.packages }) : null,
    `${row.weightKg.toLocaleString()} kg`,
    t('business.inbound.to', { place: row.site.name }),
  ].filter(Boolean);
  const delivered = row.steps.find((s) => s.status === 'delivered')?.at;
  // D10 — on the place's own clock where the row says it; the place's clock named where the reader's is another.
  const due = row.due ? dueLine(row.due) : null;
  const dueText = due && row.due ? (sameClockAs(row.due.zone) ? t(due.key, due.params) : t('business.inbound.due.onClock', { when: t(due.key, due.params), clock: row.due.zoneName })) : null;
  const when =
    state === 'delivered' && delivered
      ? row.receiverName
        ? t('business.inbound.deliveredBy', { when: hour(delivered), who: row.receiverName })
        : t('business.inbound.delivered', { when: hour(delivered) })
      : state === 'withdrawn'
        ? t('business.inbound.withdrawn')
        : dueText
          ? dueText
          : row.late
            ? t('business.inbound.late')
            : row.expectedAbout
              ? t('business.inbound.expectedAbout', { when: row.expectedAbout })
              : row.expectedOn
                ? t('business.inbound.expectedOn', { day: day(row.expectedOn) })
                : row.scheduledPickupAt && state === 'booked'
                  ? t('business.inbound.leaves', { when: hour(row.scheduledPickupAt) })
                  : t(state === 'booked' ? 'business.inbound.waitingCarrier' : state === 'carrier' ? 'business.inbound.collecting' : 'business.inbound.onItsWay');
  const late = state !== 'delivered' && state !== 'withdrawn' && Boolean(row.due ? row.due.late : row.late);
  const found = foundWords(row.exceptions, t);
  const photos = foundPhotos(row.exceptions);
  const still = isStillExpected(row);
  const track = trackingPathOf(row);
  return (
    <div class="crow">
      <span class="crow__body">
        <span class="crow__top">
          <span class="crow__name">{title.kind === 'order' ? t('business.inbound.order', { ref: title.text }) : title.text}</span>
          <span class={`ctag ctag--${late || still ? 'warn' : STATE_TAG[state]}`}>{still ? t('business.inbound.stillLine', { n: row.stillExpected ?? 0 }) : t(`business.inbound.state.${state}` as never)}</span>
        </span>
        <span class="crow__sub">{what.join(' · ')}</span>
        {title.kind === 'order' ? <span class="crow__sub">{row.description}</span> : null}
        <span class="crow__sub">{when}</span>
        {/* D9 — what was found at the handover, as the note has it beside the receiver's name. */}
        {found ? <span class="crow__sub">{photos ? t('business.inbound.foundWithPhotos', { found, n: photos }) : t('business.inbound.found', { found })}</span> : null}
        {row.closed ? (
          <span class="crow__sub">
            {t(row.closed.how === 'came' ? 'business.inbound.closedLineCame' : 'business.inbound.closedLineNotComing', { when: formatDate(row.closed.at, { day: 'numeric', month: 'short' }), who: row.closed.by })}
            {row.closed.note ? ` — ${row.closed.note}` : ''}
          </span>
        ) : null}
        {row.carrier && state !== 'delivered' && state !== 'withdrawn' ? (
          <span class="crow__sub">{t('business.inbound.carrier', { who: carrierLine(row.carrier) })}</span>
        ) : null}
        {track ? (
          <span class="crow__sub">
            <a href={track} target="_blank" rel="noopener">
              {t('business.inbound.follow')}
            </a>
          </span>
        ) : null}
        {onOpen ? (
          <span class="twr-panelend">
            <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={onOpen}>
              {t('business.inbound.openRow')}
            </button>
          </span>
        ) : null}
        {children}
      </span>
    </div>
  );
}
