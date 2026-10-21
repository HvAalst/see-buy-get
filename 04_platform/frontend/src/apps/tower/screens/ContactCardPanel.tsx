import { useCallback, useEffect, useState } from 'preact/hooks';
import { useT } from '../../../shared/i18n';
import { addClosedDate, closedDateWords, ownHoursOf, removeClosedDate, visitorsPerHourOf, windowOk, type ClosedDate, type VisitWindow } from '../contactCard';

export interface ContactCardView {
  contactName?: string;
  phone?: string;
  phoneAlt?: string;
  /** Round 39 — the desk a driver held at a checkpoint in this country rings. On the company's own card only. */
  deskPhone?: string;
  email?: string;
  website?: string;
  address?: string;
  hours?: string;
  visitDays?: string[];
  visitFrom?: string;
  visitTo?: string;
  /** A day of the week with hours of its own. */
  visitHoursByDay?: Record<string, VisitWindow>;
  closedDates?: ClosedDate[];
  visitorsPerHour?: number;
  saidAt: string;
  saidBy: string;
  basis: string;
}

/** The days of a week, in the order a company ticks them. */
export const VISIT_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

/**
 * A COMPANY'S OWN ENTRY — how to reach them, written by them, changed by them whenever they like.
 *
 * ONE PANEL IN TWO PLACES, because there is one card per company: a yard manages it beside its register
 * and a clearing agent beside its advertisement, and both are editing the same entry. A second form with
 * its own copy of these fields is how a telephone number ends up correct in one directory and stale in
 * the other.
 *
 * It is PUBLISHED — on the public page and in every directory — which is the point of writing one. The
 * screen says so plainly, because the difference between the gate's number and somebody's private one is
 * a decision only the person typing it can make.
 *
 * AND WHEN IT RECEIVES VISITORS. The user, 2026-10-08: "it's up to the countries to set visiting days and visiting
 * hours", and "the country needs to set its address info in their admin from there we fetch." This is that admin:
 * somebody who has to come in person — over a disputed ID, for one — is offered the days ticked here and no other,
 * and their ticket carries the address and the hours written here. Nobody at SeeBuyGet types either for them.
 *
 * AND WHEN IT IS CLOSED, AND HOW MANY IT CAN SEE. "The country should set it's own public holidays and/or one off
 * closure"; "the limitation is set by the country as an actual number of visitors per hour. They themselves can
 * decide how many desk workers they will dedicate for these visitation hours." Both are here too, and both are
 * saved with the rest of the entry: nothing takes effect until the company presses Save.
 */
export function ContactCardPanel({
  entityId,
  who,
  client,
  desk = false,
}: {
  entityId: string;
  who?: string;
  /** Round 39 — a country's company: it also keeps the desk a held driver rings. Nowhere else is it asked. */
  desk?: boolean;
  client: { api: Record<string, (...args: never[]) => Promise<{ data?: unknown; error?: { detail?: string; title?: string } | null }>> } | null;
}) {
  const t = useT();
  const [card, setCard] = useState<ContactCardView | null>(null);
  const [form, setForm] = useState({
    contactName: '',
    phone: '',
    phoneAlt: '',
    deskPhone: '',
    email: '',
    website: '',
    address: '',
    hours: '',
    visitDays: [] as string[],
    visitFrom: '',
    visitTo: '',
    visitHoursByDay: {} as Record<string, VisitWindow | undefined>,
    visitorsPerHour: '',
    closedDates: [] as ClosedDate[],
  });
  // The date being added to the closed dates, before it joins the list — with hours, a shorter day instead.
  const [closing, setClosing] = useState({ date: '', note: '', from: '', to: '' });
  const ownOf = (day: string, patch: Partial<VisitWindow> | null) =>
    setForm({ ...form, visitHoursByDay: { ...form.visitHoursByDay, [day]: patch === null ? undefined : { from: '', to: '', ...form.visitHoursByDay[day], ...patch } } });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!client) return;
    const r = await (client.api as never as { contactCard: (id: string) => Promise<{ data?: unknown; error?: unknown }> }).contactCard(entityId);
    // No entry yet is a 404 and not a failure: the form simply starts empty.
    const got = r.error ? null : (r.data as ContactCardView);
    setCard(got);
    if (got) {
      setForm({
        contactName: got.contactName ?? '',
        phone: got.phone ?? '',
        phoneAlt: got.phoneAlt ?? '',
        deskPhone: got.deskPhone ?? '',
        email: got.email ?? '',
        website: got.website ?? '',
        address: got.address ?? '',
        hours: got.hours ?? '',
        visitDays: got.visitDays ?? [],
        visitFrom: got.visitFrom ?? '',
        visitTo: got.visitTo ?? '',
        visitHoursByDay: got.visitHoursByDay ?? {},
        visitorsPerHour: got.visitorsPerHour ? String(got.visitorsPerHour) : '',
        closedDates: got.closedDates ?? [],
      });
    }
  }, [client, entityId]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!client) return;
    setBusy(true);
    setError(null);
    setDone(null);
    // Every field travels, including the empty ones: an empty string — or an empty list of days — is how the
    // server is told to CLEAR a field, and sending only what changed would leave a wrong number on the page for ever.
    // The desk number travels only from a screen that shows it: a card saved anywhere else leaves it as it was.
    const { deskPhone, ...rest } = form;
    const r = await (client.api as never as { setContactCard: (id: string, body: Record<string, unknown>) => Promise<{ error?: { detail?: string; title?: string } | null }> }).setContactCard(entityId, {
      ...rest,
      ...(desk ? { deskPhone } : {}),
      // A number, or zero to say none — and the whole list of closed dates, which replaces the one before.
      visitorsPerHour: visitorsPerHourOf(form.visitorsPerHour),
      // The ticked days' own hours, which replace the ones before: a day left alone keeps the usual hours. A day
      // given half a window is sent as it is, so the server says what is missing rather than this dropping it.
      visitHoursByDay: ownHoursOf(form.visitDays, form.visitHoursByDay),
      ...(who ? { by: who } : {}),
    });
    setBusy(false);
    if (r.error) {
      setError(r.error.detail || r.error.title || 'That did not work');
      return;
    }
    setDone(t('tower.contact.saved'));
    await load();
  };

  return (
    <section class="cons__panel">
      <div class="cons__panelhead">
        <span class="cons__panelt">{t('tower.contact.title')}</span>
        {card ? <span class="ctag ctag--quiet">{t('tower.contact.saidBy', { by: card.saidBy, d: card.saidAt.slice(0, 10) })}</span> : null}
      </div>
      <p class="cons__lede">{t('tower.contact.hint')}</p>

      {error ? <p class="cons__caveat">{error}</p> : null}
      {done ? <p class="cons__lede">{done}</p> : null}

      <div class="twr-knobs__row">
        <label class="twr-knob cfield">
          <span class="cfield__label">{t('tower.contact.f.person')}</span>
          <input class="cinput" value={form.contactName} onChange={(e) => setForm({ ...form, contactName: (e.target as HTMLInputElement).value })} placeholder={t('tower.contact.f.personPh')} />
        </label>
        <label class="twr-knob cfield">
          <span class="cfield__label">{t('tower.contact.f.phone')}</span>
          <input class="cinput" value={form.phone} onChange={(e) => setForm({ ...form, phone: (e.target as HTMLInputElement).value })} placeholder="+254 712 345 678" />
        </label>
        <label class="twr-knob cfield">
          <span class="cfield__label">{t('tower.contact.f.phoneAlt')}</span>
          <input class="cinput" value={form.phoneAlt} onChange={(e) => setForm({ ...form, phoneAlt: (e.target as HTMLInputElement).value })} placeholder={t('tower.contact.f.phoneAltPh')} />
        </label>
        {desk ? (
          <label class="twr-knob cfield">
            <span class="cfield__label">{t('tower.contact.f.desk')}</span>
            <input class="cinput" value={form.deskPhone} onChange={(e) => setForm({ ...form, deskPhone: (e.target as HTMLInputElement).value })} placeholder="+254 20 765 4321" />
            <span class="chint">{t('tower.contact.f.deskHint')}</span>
          </label>
        ) : null}
        <label class="twr-knob cfield">
          <span class="cfield__label">{t('tower.contact.f.email')}</span>
          <input class="cinput" value={form.email} onChange={(e) => setForm({ ...form, email: (e.target as HTMLInputElement).value })} placeholder="gate@example.com" />
        </label>
        <label class="twr-knob cfield">
          <span class="cfield__label">{t('tower.contact.f.website')}</span>
          <input class="cinput" value={form.website} onChange={(e) => setForm({ ...form, website: (e.target as HTMLInputElement).value })} placeholder="https://example.com" />
        </label>
        <label class="twr-knob cfield">
          <span class="cfield__label">{t('tower.contact.f.address')}</span>
          <input class="cinput" value={form.address} onChange={(e) => setForm({ ...form, address: (e.target as HTMLInputElement).value })} placeholder={t('tower.contact.f.addressPh')} />
        </label>
        <label class="twr-knob cfield">
          <span class="cfield__label">{t('tower.contact.f.hours')}</span>
          <input class="cinput" value={form.hours} onChange={(e) => setForm({ ...form, hours: (e.target as HTMLInputElement).value })} placeholder={t('tower.contact.f.hoursPh')} />
        </label>
      </div>

      {/* WHEN VISITORS ARE RECEIVED. Theirs to set, like everything else here: the days, then from when until when. */}
      <div class="cfield" style="margin-top:14px">
        <span class="cfield__label">{t('tower.contact.visit.title')}</span>
        <span class="chint">{t('tower.contact.visit.hint')}</span>
        <div role="group" aria-label={t('tower.contact.visit.title')} style="display:flex;flex-wrap:wrap;gap:6px 18px;margin-top:6px">
          {VISIT_DAYS.map((d) => (
            <label class="cfield cfield--check" key={d}>
              <input
                type="checkbox"
                checked={form.visitDays.includes(d)}
                onChange={(e) => setForm({ ...form, visitDays: (e.target as HTMLInputElement).checked ? [...form.visitDays.filter((x) => x !== d), d] : form.visitDays.filter((x) => x !== d) })}
              />
              <span>{t(`tower.contact.day.${d}` as never)}</span>
            </label>
          ))}
        </div>
      </div>
      <div class="twr-knobs__row">
        <label class="twr-knob cfield">
          <span class="cfield__label">{t('tower.contact.visit.from')}</span>
          <input class="cinput" type="time" value={form.visitFrom} onChange={(e) => setForm({ ...form, visitFrom: (e.target as HTMLInputElement).value })} />
        </label>
        <label class="twr-knob cfield">
          <span class="cfield__label">{t('tower.contact.visit.to')}</span>
          <input class="cinput" type="time" value={form.visitTo} onChange={(e) => setForm({ ...form, visitTo: (e.target as HTMLInputElement).value })} />
        </label>
        {/* Their own number: how many desks they give to visitors is theirs to decide, and this is what follows from it. */}
        <label class="twr-knob cfield">
          <span class="cfield__label">{t('tower.contact.visit.perHour')}</span>
          <input class="cinput" type="number" min="0" max="200" step="1" inputMode="numeric" value={form.visitorsPerHour} onChange={(e) => setForm({ ...form, visitorsPerHour: (e.target as HTMLInputElement).value })} />
          <span class="chint">{t('tower.contact.visit.perHourHint')}</span>
        </label>
      </div>

      {/* A DAY WITH OTHER HOURS — "a Saturday morning only". Offered for the days ticked above; a day left alone keeps
          the hours above. */}
      {form.visitDays.length ? (
        <div class="cfield" style="margin-top:14px">
          <span class="cfield__label">{t('tower.contact.visit.ownTitle')}</span>
          <span class="chint">{t('tower.contact.visit.ownHint')}</span>
          {VISIT_DAYS.filter((d) => form.visitDays.includes(d)).map((d) => {
            const own = form.visitHoursByDay[d];
            const dayName = t(`tower.contact.day.${d}` as never);
            return (
              <div class="twr-knobs__row" key={d}>
                <label class="twr-knob cfield cfield--check">
                  <input type="checkbox" checked={Boolean(own)} onChange={(e) => ownOf(d, (e.target as HTMLInputElement).checked ? { from: form.visitFrom, to: form.visitTo } : null)} />
                  <span>{own ? t('tower.contact.visit.ownOn', { day: dayName }) : `${dayName} · ${t('tower.contact.visit.ownSame')}`}</span>
                </label>
                {own ? (
                  <>
                    <label class="twr-knob cfield">
                      <span class="cfield__label">{t('tower.contact.visit.from')}</span>
                      <input class="cinput" type="time" aria-label={`${dayName} ${t('tower.contact.visit.from')}`} value={own.from} onChange={(e) => ownOf(d, { from: (e.target as HTMLInputElement).value })} />
                    </label>
                    <label class="twr-knob cfield">
                      <span class="cfield__label">{t('tower.contact.visit.to')}</span>
                      <input class="cinput" type="time" aria-label={`${dayName} ${t('tower.contact.visit.to')}`} value={own.to} onChange={(e) => ownOf(d, { to: (e.target as HTMLInputElement).value })} />
                    </label>
                  </>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}

      {/* WHEN IT IS CLOSED: public holidays and one-off closures, each a date and what the day is. */}
      <div class="cfield" style="margin-top:14px">
        <span class="cfield__label">{t('tower.contact.closed.title')}</span>
        <span class="chint">{t('tower.contact.closed.hint')}</span>
        {form.closedDates.length ? (
          <div class="crows" style="margin-top:6px">
            {form.closedDates.map((c) => (
              <div class="crow" key={c.date}>
                <span class="crow__body">
                  <span class="crow__top">
                    <span class="crow__name">{closedDateWords(c.date)}</span>
                    <span class={`ctag ${c.from && c.to ? 'ctag--warn' : 'ctag--quiet'}`}>{c.from && c.to ? t('tower.contact.closed.openOnly', { from: c.from, to: c.to }) : t('tower.contact.closed.allDay')}</span>
                  </span>
                  {c.note ? <span class="crow__sub">{c.note}</span> : null}
                </span>
                <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => setForm({ ...form, closedDates: removeClosedDate(form.closedDates, c.date) })}>
                  {t('tower.contact.closed.remove')}
                </button>
              </div>
            ))}
          </div>
        ) : (
          <span class="chint">{t('tower.contact.closed.none')}</span>
        )}
      </div>
      <div class="twr-knobs__row">
        <label class="twr-knob cfield">
          <span class="cfield__label">{t('tower.contact.closed.date')}</span>
          <input class="cinput" type="date" value={closing.date} onChange={(e) => setClosing({ ...closing, date: (e.target as HTMLInputElement).value })} />
        </label>
        <label class="twr-knob cfield">
          <span class="cfield__label">{t('tower.contact.closed.note')}</span>
          <input class="cinput" maxLength={60} value={closing.note} onChange={(e) => setClosing({ ...closing, note: (e.target as HTMLInputElement).value })} placeholder={t('tower.contact.closed.notePh')} />
        </label>
        <label class="twr-knob cfield">
          <span class="cfield__label">{t('tower.contact.closed.from')}</span>
          <input class="cinput" type="time" value={closing.from} onChange={(e) => setClosing({ ...closing, from: (e.target as HTMLInputElement).value })} />
        </label>
        <label class="twr-knob cfield">
          <span class="cfield__label">{t('tower.contact.closed.to')}</span>
          <input class="cinput" type="time" value={closing.to} onChange={(e) => setClosing({ ...closing, to: (e.target as HTMLInputElement).value })} />
        </label>
        <div class="twr-knob cfield">
          <span class="cfield__label">&nbsp;</span>
          <button
            type="button"
            class="cbtn cbtn--ghost"
            // Half a window is neither closed nor shorter: both times, or neither.
            disabled={!closing.date || (Boolean(closing.from || closing.to) && !windowOk(closing.from, closing.to))}
            onClick={() => {
              setForm({ ...form, closedDates: addClosedDate(form.closedDates, closing.date, closing.note, closing.from, closing.to) });
              setClosing({ date: '', note: '', from: '', to: '' });
            }}
          >
            {t('tower.contact.closed.add')}
          </button>
        </div>
      </div>
      <span class="chint">{t('tower.contact.closed.shortHint')}</span>

      <div class="twr-panelend">
        <button type="button" class="cbtn cbtn--primary" disabled={busy} onClick={() => void save()}>
          {t('tower.contact.save')}
        </button>
      </div>
      {/* Said on the screen as well as in the payload: an entry in a directory reads as endorsed unless
          somebody says otherwise, and nobody here checked any of it. */}
      {card ? <p class="cons__lede">{card.basis}</p> : null}
    </section>
  );
}
