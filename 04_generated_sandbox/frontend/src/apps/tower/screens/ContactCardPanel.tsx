import { useCallback, useEffect, useState } from 'preact/hooks';
import { useT } from '../../../shared/i18n';

export interface ContactCardView {
  contactName?: string;
  phone?: string;
  phoneAlt?: string;
  email?: string;
  website?: string;
  address?: string;
  hours?: string;
  visitDays?: string[];
  visitFrom?: string;
  visitTo?: string;
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
 */
export function ContactCardPanel({
  entityId,
  who,
  client,
}: {
  entityId: string;
  who?: string;
  client: { api: Record<string, (...args: never[]) => Promise<{ data?: unknown; error?: { detail?: string; title?: string } | null }>> } | null;
}) {
  const t = useT();
  const [card, setCard] = useState<ContactCardView | null>(null);
  const [form, setForm] = useState({ contactName: '', phone: '', phoneAlt: '', email: '', website: '', address: '', hours: '', visitDays: [] as string[], visitFrom: '', visitTo: '' });
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
        email: got.email ?? '',
        website: got.website ?? '',
        address: got.address ?? '',
        hours: got.hours ?? '',
        visitDays: got.visitDays ?? [],
        visitFrom: got.visitFrom ?? '',
        visitTo: got.visitTo ?? '',
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
    const r = await (client.api as never as { setContactCard: (id: string, body: Record<string, unknown>) => Promise<{ error?: { detail?: string; title?: string } | null }> }).setContactCard(entityId, {
      ...form,
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
      </div>

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
