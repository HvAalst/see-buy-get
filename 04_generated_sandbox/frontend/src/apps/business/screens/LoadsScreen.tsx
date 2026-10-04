import { useCallback, useEffect, useState } from 'preact/hooks';
import { useT, type MessageKey } from '../../../shared/i18n';
import { quoteFigure, quoteTone, type QuoteView } from '../../../shared/quote';
import { ConsoleDetail } from '../../tower/ConsoleDetail';
import { SitePicker, type SiteView } from '../../tower/screens/SitePicker';
import { QuotePanel } from '../../tower/screens/QuotePanel';
import { NATURES, PACKAGING_OPTIONS } from '../../agent/logic';
import type { BusinessClient, BusinessView, LoadProposal, PostedLoad } from '../api';
import { loadGaps, loadStage, mayAct, type LoadForm, type LoadStage } from '../logic';
import { SentFor } from './SentFor';
import type { BusinessActions } from '../useBusinessApp';

const STAGE: Record<LoadStage, { label: MessageKey; tone: string }> = {
  posted: { label: 'business.loads.stage.posted', tone: 'quiet' },
  offers: { label: 'business.loads.stage.offers', tone: 'info' },
  taken: { label: 'business.loads.stage.taken', tone: 'info' },
  moving: { label: 'business.loads.stage.moving', tone: 'info' },
  delivered: { label: 'business.loads.stage.delivered', tone: 'ok' },
  cancelled: { label: 'business.loads.stage.cancelled', tone: 'quiet' },
};

type Form = LoadForm & { packaging: string; natureCode: string; fragile: boolean; commitMode: 'negotiate' | 'instant'; instructions: string; contactName: string; contactPhone: string; deliveryWindow: string; pickupOn: string; forClientId: string };
const EMPTY: Form = { description: '', fromSiteId: '', toSiteId: '', weightKg: '', packaging: '', natureCode: 'GEN', fragile: false, commitMode: 'negotiate', instructions: '', contactName: '', contactPhone: '', deliveryWindow: '', pickupOn: '', forClientId: '' };

/**
 * B2 — A BUSINESS'S OWN LOADS: post one, and follow it to the door.
 *
 * Posted as the business, by a named person, onto the same open board every carrier reads — and SETTLED BETWEEN THE
 * PARTIES: the business pays the carrier itself, or through its own payment network, and nothing about it lands on
 * our books (the user, 2026-10-04). What we keep is the record: the price the two agreed, the carrier's quotation and
 * proforma, and whether it is paid as the business says so.
 */
export function LoadsScreen({ business, client }: { business: BusinessView; actions: BusinessActions; client: BusinessClient | null }) {
  const t = useT();
  const act = mayAct(business.you.role);
  const [rows, setRows] = useState<PostedLoad[] | null>(null);
  const [open, setOpen] = useState<PostedLoad | null>(null);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!client) return;
    const r = await client.shipping.postedFreight();
    if (r.error) return setError(r.error.detail || r.error.title);
    const items = ((r.data as unknown as { items?: PostedLoad[] })?.items ?? []) as PostedLoad[];
    setRows(items.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (open) setOpen(rows?.find((r) => r.freightId === open.freightId) ?? null);
  }, [rows]);

  return (
    <>
      <header class="cons__head">
        <h1 class="cons__title">{t('business.loads.title')}</h1>
        <p class="cons__lede">{t('business.loads.lede')}</p>
      </header>
      {done ? <p class="cnote">{done}</p> : null}
      {error ? <p class="cerr">{error}</p> : null}

      {act ? (
        posting ? (
          <NewLoadPanel
            business={business}
            client={client}
            onCancel={() => setPosting(false)}
            onPosted={async (code) => {
              setPosting(false);
              setDone(t('business.loads.posted', { code }));
              await load();
            }}
          />
        ) : (
          <div class="twr-panelend biz-loads__new">
            <button type="button" class="cbtn cbtn--primary" onClick={() => setPosting(true)}>
              {t('business.loads.newCta')}
            </button>
          </div>
        )
      ) : null}

      <section class="cons__panel">
        <div class="cons__panelhead">
          <span class="cons__panelt">{t('business.loads.listTitle')}</span>
          {rows ? <span class="chint">{t('business.loads.count', { n: rows.length })}</span> : null}
        </div>
        {rows === null ? (
          <p class="cons__empty">{t('business.loading')}</p>
        ) : rows.length === 0 ? (
          <p class="cons__empty">{t('business.loads.none')}</p>
        ) : (
          <div class="crows">
            {rows.map((r) => {
              const stage = loadStage(r);
              return (
                <button type="button" class="crow" key={r.freightId} onClick={() => setOpen(r)}>
                  <span class="crow__body">
                    <span class="crow__top">
                      <span class="crow__name">
                        {r.code} · {r.description}
                      </span>
                      <span class={`ctag ctag--${STAGE[stage].tone}`}>{stage === 'offers' ? t('business.loads.stage.offersN', { n: r.openProposals }) : t(STAGE[stage].label)}</span>
                    </span>
                    <span class="crow__sub">
                      {t('business.loads.rowSub', { dest: r.destLabel, kg: r.weightKg.toLocaleString(), when: r.createdAt.slice(0, 10) })}
                      {r.carrier?.driverName ? ` · ${t('business.loads.carriedBy', { who: r.carrier.driverName })}` : ''}
                      {r.onBehalfOf ? ` · ${t('business.sentFor.forClient', { name: r.onBehalfOf.name })}` : ''}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {open ? (
        <LoadDetail
          row={open}
          client={client}
          act={act}
          onClose={() => setOpen(null)}
          onChanged={async (message) => {
            if (message) setDone(message);
            await load();
          }}
        />
      ) : null}
    </>
  );
}

function NewLoadPanel({ business, client, onCancel, onPosted }: { business: BusinessView; client: BusinessClient | null; onCancel: () => void; onPosted: (code: string) => void | Promise<void> }) {
  const t = useT();
  const [form, setForm] = useState<Form>({ ...EMPTY });
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const gaps = loadGaps(form);
  const gap = (f: keyof LoadForm) => (tried && gaps.includes(f) ? <span class="cerr">{t(`business.loads.need.${f}` as MessageKey)}</span> : null);
  const siteApi = client ? (client.api as never) : null;

  const submit = async (e: Event) => {
    e.preventDefault();
    setTried(true);
    if (gaps.length || !client) return;
    setBusy(true);
    setError(null);
    // The two ends are saved places: their name and point are what the board and the consignment note carry.
    const r = (await client.api.sites(business.entityId)) as unknown as { data?: { sites?: SiteView[] }; error?: { detail?: string; title?: string } };
    const sites = r.data?.sites ?? [];
    const from = sites.find((s) => s.siteId === form.fromSiteId);
    const to = sites.find((s) => s.siteId === form.toSiteId);
    if (!from || !to) {
      setBusy(false);
      return setError(t('business.loads.placeGone'));
    }
    const posted = await client.postLoad({
      description: form.description.trim(),
      pickupLabel: from.name,
      pickupLocation: from.location,
      destLabel: to.name,
      destLocation: to.location,
      // A business works in its own country unless it says otherwise; the rules of a crossing are asked of a known one.
      pickupCountry: business.country,
      destCountry: business.country,
      weightKg: Number(form.weightKg),
      ...(form.packaging ? { packaging: form.packaging } : {}),
      natureCode: form.natureCode,
      fragile: form.fragile,
      commitMode: form.commitMode,
      ...(form.instructions.trim() ? { instructions: form.instructions.trim() } : {}),
      ...(form.contactName.trim() ? { contactName: form.contactName.trim() } : {}),
      ...(form.contactPhone.trim() ? { contactPhone: form.contactPhone.trim() } : {}),
      ...(form.deliveryWindow.trim() ? { deliveryWindow: form.deliveryWindow.trim() } : {}),
      ...(form.pickupOn ? { scheduledPickupAt: new Date(`${form.pickupOn}T08:00:00`).toISOString() } : {}),
      ...(form.forClientId ? { forClientId: form.forClientId } : {}),
    });
    setBusy(false);
    if (posted.error || !posted.data) return setError(posted.error?.detail || posted.error?.title || null);
    await onPosted(posted.data.code);
  };

  return (
    <section class="cons__panel">
      <div class="cons__panelhead">
        <span class="cons__panelt">{t('business.loads.newTitle')}</span>
      </div>
      <p class="cons__lede">{t('business.loads.newLede')}</p>
      <form onSubmit={(e) => void submit(e)}>
        <SentFor client={client} expeditor={business.activities.includes('expeditor')} value={form.forClientId} onChange={(id) => setForm((prev) => ({ ...prev, forClientId: id }))} />
        <label class="cfield">
          <span class="cfield__label">{t('business.loads.f.description')}</span>
          <input class="cinput" maxLength={160} value={form.description} onInput={(e) => setForm((prev) => ({ ...prev, description: (e.target as HTMLInputElement).value }))} />
          {gap('description')}
        </label>
        <div class="biz-two">
          <div>
            <SitePicker kind="delivery" entityId={business.entityId} api={siteApi} value={form.fromSiteId} onChange={(id) => setForm((prev) => ({ ...prev, fromSiteId: id }))} label={t('business.loads.f.from')} addLabel={t('business.loads.f.addPlace')} />
            {gap('fromSiteId')}
          </div>
          <div>
            <SitePicker kind="delivery" entityId={business.entityId} api={siteApi} value={form.toSiteId} onChange={(id) => setForm((prev) => ({ ...prev, toSiteId: id }))} label={t('business.loads.f.to')} addLabel={t('business.loads.f.addPlace')} />
            {gap('toSiteId')}
          </div>
        </div>
        <div class="biz-two">
          <label class="cfield">
            <span class="cfield__label">{t('business.loads.f.weight')}</span>
            <input class="cinput" type="number" min={1} value={form.weightKg} onInput={(e) => setForm((prev) => ({ ...prev, weightKg: (e.target as HTMLInputElement).value }))} />
            {gap('weightKg')}
          </label>
          <label class="cfield">
            <span class="cfield__label">{t('business.loads.f.packaging')}</span>
            <select class="cinput" value={form.packaging} onChange={(e) => setForm((prev) => ({ ...prev, packaging: (e.target as HTMLSelectElement).value }))}>
              {PACKAGING_OPTIONS.map((p) => (
                <option key={p.value} value={p.value}>
                  {t(p.labelKey as MessageKey)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div class="biz-two">
          <label class="cfield">
            <span class="cfield__label">{t('business.loads.f.nature')}</span>
            <select class="cinput" value={form.natureCode} onChange={(e) => setForm((prev) => ({ ...prev, natureCode: (e.target as HTMLSelectElement).value }))}>
              {NATURES.map((n) => (
                <option key={n.key} value={n.key}>
                  {t(n.labelKey)}
                </option>
              ))}
            </select>
          </label>
          <label class="cfield">
            <span class="cfield__label">{t('business.loads.f.pickupOn')}</span>
            <input class="cinput" type="date" value={form.pickupOn} onInput={(e) => setForm((prev) => ({ ...prev, pickupOn: (e.target as HTMLInputElement).value }))} />
            <span class="chint">{t('business.loads.f.pickupOnHint')}</span>
          </label>
        </div>
        <label class="cfield--check">
          <input type="checkbox" checked={form.fragile} onChange={() => setForm((prev) => ({ ...prev, fragile: !form.fragile }))} />
          <span>{t('business.loads.f.fragile')}</span>
        </label>
        <fieldset class="cfield biz-acts">
          <legend class="cfield__label">{t('business.loads.f.price')}</legend>
          {(['negotiate', 'instant'] as const).map((m) => (
            <label class="cfield--check biz-act" key={m}>
              <input type="radio" name="biz-commit" checked={form.commitMode === m} onChange={() => setForm((prev) => ({ ...prev, commitMode: m }))} />
              <span>
                <strong>{t(m === 'negotiate' ? 'business.loads.f.negotiate' : 'business.loads.f.instant')}</strong>
                <span class="chint">{t(m === 'negotiate' ? 'business.loads.f.negotiateSub' : 'business.loads.f.instantSub')}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <label class="cfield">
          <span class="cfield__label">{t('business.loads.f.instructions')}</span>
          <input class="cinput" maxLength={500} value={form.instructions} onInput={(e) => setForm((prev) => ({ ...prev, instructions: (e.target as HTMLInputElement).value }))} />
        </label>
        <div class="biz-two">
          <label class="cfield">
            <span class="cfield__label">{t('business.loads.f.contactName')}</span>
            <input class="cinput" maxLength={80} value={form.contactName} onInput={(e) => setForm((prev) => ({ ...prev, contactName: (e.target as HTMLInputElement).value }))} />
          </label>
          <label class="cfield">
            <span class="cfield__label">{t('business.loads.f.contactPhone')}</span>
            <input class="cinput" type="tel" maxLength={32} value={form.contactPhone} onInput={(e) => setForm((prev) => ({ ...prev, contactPhone: (e.target as HTMLInputElement).value }))} />
          </label>
        </div>
        <label class="cfield">
          <span class="cfield__label">{t('business.loads.f.window')}</span>
          <input class="cinput" maxLength={80} value={form.deliveryWindow} placeholder={t('business.loads.f.windowPlaceholder')} onInput={(e) => setForm((prev) => ({ ...prev, deliveryWindow: (e.target as HTMLInputElement).value }))} />
        </label>
        <p class="cnote">{t('business.loads.settleNote')}</p>
        {error ? <p class="cerr">{error}</p> : null}
        <div class="twr-panelend">
          <button type="button" class="cbtn cbtn--ghost" onClick={onCancel}>
            {t('common.cancel')}
          </button>
          <button type="submit" class="cbtn cbtn--primary" disabled={busy}>
            {t('business.loads.postCta')}
          </button>
        </div>
      </form>
    </section>
  );
}

function LoadDetail({ row, client, act, onClose, onChanged }: { row: PostedLoad; client: BusinessClient | null; act: boolean; onClose: () => void; onChanged: (message?: string) => void | Promise<void> }) {
  const t = useT();
  const stage = loadStage(row);
  const [proposals, setProposals] = useState<LoadProposal[] | null>(null);
  const [quote, setQuote] = useState<QuoteView | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [quoteForm, setQuoteForm] = useState({ amount: '', currency: '', reference: '' });

  const read = useCallback(async () => {
    if (!client) return;
    if (row.commitMode === 'negotiate' && (stage === 'posted' || stage === 'offers')) {
      const p = await client.shipping.freightProposals(row.freightId);
      setProposals(p.error ? [] : (((p.data as unknown as { items?: LoadProposal[] })?.items ?? []) as LoadProposal[]));
    } else setProposals([]);
    const q = await client.freightQuote(row.freightId);
    setQuote(q.error ? null : (q.data?.quote ?? null));
  }, [client, row.freightId, stage]);

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
    const r = await client.shipping.freightNote(row.freightId);
    if (r.error || !r.data) return setError(t('business.loads.noteGone'));
    const url = URL.createObjectURL(new Blob([r.data as unknown as string], { type: 'text/html' }));
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  return (
    <ConsoleDetail openKey={row.freightId} title={`${row.code} · ${row.description}`} onClose={onClose}>
      <section class="cons__panel">
        <div class="cons__panelhead">
          <span class="cons__panelt">
            {row.code} · {row.description}
          </span>
          <span class={`ctag ctag--${STAGE[stage].tone}`}>{t(STAGE[stage].label)}</span>
        </div>
        <dl class="cons__facts">
          <div class="cons__fact">
            <dt class="cons__factk">{t('business.loads.fact.to')}</dt>
            <dd class="cons__factv">{row.destLabel}</dd>
          </div>
          <div class="cons__fact">
            <dt class="cons__factk">{t('business.loads.fact.weight')}</dt>
            <dd class="cons__factv">{row.weightKg.toLocaleString()} kg</dd>
          </div>
          {row.carrier?.driverName ? (
            <div class="cons__fact">
              <dt class="cons__factk">{t('business.loads.fact.carrier')}</dt>
              <dd class="cons__factv">
                {row.carrier.driverName}
                {row.carrier.plate ? ` · ${row.carrier.plate}` : ''}
              </dd>
            </div>
          ) : null}
          {row.agreedPrice != null ? (
            <div class="cons__fact">
              <dt class="cons__factk">{t('business.loads.fact.agreed')}</dt>
              <dd class="cons__factv">{row.agreedPrice.toLocaleString()}</dd>
            </div>
          ) : null}
          {row.deliveredAt ? (
            <div class="cons__fact">
              <dt class="cons__factk">{t('business.loads.fact.delivered')}</dt>
              <dd class="cons__factv">{t('business.loads.fact.deliveredTo', { when: row.deliveredAt.slice(0, 10), who: row.receiverName ?? '—' })}</dd>
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
        </div>
      </section>

      {proposals && proposals.some((p) => p.status === 'open') ? (
        <section class="cons__panel">
          <div class="cons__panelhead">
            <span class="cons__panelt">{t('business.loads.offersTitle')}</span>
          </div>
          <p class="cons__lede">{t('business.loads.offersLede')}</p>
          <div class="crows">
            {proposals
              .filter((p) => p.status === 'open')
              .map((p) => (
                <div class="crow" key={p.proposalId}>
                  <span class="crow__body">
                    <span class="crow__top">
                      <span class="crow__name">{p.price.toLocaleString()}</span>
                    </span>
                    {p.note ? <span class="crow__sub">{p.note}</span> : null}
                  </span>
                  {act ? (
                    <span class="crow__tail biz-choose__acts">
                      <button type="button" class="cbtn cbtn--primary cbtn--sm" disabled={busy} onClick={() => void run(() => client!.shipping.acceptProposal(p.proposalId) as never, t('business.loads.accepted'))}>
                        {t('business.loads.accept')}
                      </button>
                      <button type="button" class="cbtn cbtn--ghost cbtn--sm" disabled={busy} onClick={() => void run(() => client!.shipping.declineProposal(p.proposalId) as never, t('business.loads.declined'))}>
                        {t('business.loads.decline')}
                      </button>
                    </span>
                  ) : null}
                </div>
              ))}
          </div>
        </section>
      ) : null}

      {/* What the carrier asked to be paid, once a carrier has it — kept here, settled between the two of them. */}
      {stage === 'taken' || stage === 'moving' || stage === 'delivered' ? (
        <section class="cons__panel">
          <div class="cons__panelhead">
            <span class="cons__panelt">{t('business.pay.title')}</span>
            {quote ? <span class={`ctag ctag--${quoteTone(quote)}`}>{quote.status === 'paid' ? t('business.pay.paid') : t('business.pay.open', { figure: quoteFigure(quote) })}</span> : null}
          </div>
          {quote ? (
            <QuotePanel quote={quote} api={client ? (client.api as never) : null} canChange={act} onChanged={() => read()} />
          ) : quote === null ? (
            <>
              <p class="cons__lede">{t('business.pay.lede')}</p>
              {act ? (
                <>
                  <div class="biz-two">
                    <label class="cfield">
                      <span class="cfield__label">{t('business.pay.amount')}</span>
                      <input class="cinput" type="number" min={0} value={quoteForm.amount} placeholder={row.agreedPrice != null ? String(row.agreedPrice) : ''} onInput={(e) => setQuoteForm((prev) => ({ ...prev, amount: (e.target as HTMLInputElement).value }))} />
                    </label>
                    <label class="cfield">
                      <span class="cfield__label">{t('business.pay.reference')}</span>
                      <input class="cinput" value={quoteForm.reference} onInput={(e) => setQuoteForm((prev) => ({ ...prev, reference: (e.target as HTMLInputElement).value }))} />
                    </label>
                  </div>
                  <div class="twr-panelend">
                    <button
                      type="button"
                      class="cbtn cbtn--primary"
                      disabled={busy}
                      onClick={() =>
                        void run(
                          () =>
                            client!.recordFreightQuote(row.freightId, {
                              ...(Number(quoteForm.amount) > 0 ? { amount: Number(quoteForm.amount) } : {}),
                              ...(quoteForm.currency.trim() ? { currency: quoteForm.currency.trim() } : {}),
                              ...(quoteForm.reference.trim() ? { reference: quoteForm.reference.trim() } : {}),
                            }),
                          t('business.pay.recorded'),
                        )
                      }
                    >
                      {t('business.pay.record')}
                    </button>
                  </div>
                </>
              ) : null}
            </>
          ) : null}
        </section>
      ) : null}

      {act && row.canCancel ? (
        <section class="cons__panel">
          <div class="cons__panelhead">
            <span class="cons__panelt">{t('business.loads.cancelTitle')}</span>
          </div>
          <label class="cfield">
            <span class="cfield__label">{t('business.loads.cancelWhy')}</span>
            <input class="cinput" value={reason} onInput={(e) => setReason((e.target as HTMLInputElement).value)} />
          </label>
          <div class="twr-panelend">
            <button type="button" class="cbtn cbtn--danger" disabled={busy || !reason.trim()} onClick={() => void run(() => client!.shipping.cancelFreight(row.freightId, reason.trim()) as never, t('business.loads.cancelled'))}>
              {t('business.loads.cancelCta')}
            </button>
          </div>
        </section>
      ) : null}

      {act && row.canRate ? (
        <section class="cons__panel">
          <div class="cons__panelhead">
            <span class="cons__panelt">{t('business.loads.rateTitle')}</span>
            {row.rating ? <span class="chint">{t('business.loads.rated', { n: row.rating.stars })}</span> : null}
          </div>
          <div class="biz-stars">
            {[1, 2, 3, 4, 5].map((n) => (
              <button type="button" key={n} class={`cbtn cbtn--sm ${row.rating?.stars === n ? 'cbtn--primary' : 'cbtn--ghost'}`} disabled={busy} onClick={() => void run(() => client!.shipping.rateFreight(row.freightId, { stars: n }) as never, t('business.loads.thanks'))}>
                {n}
              </button>
            ))}
          </div>
        </section>
      ) : null}
      {error ? <p class="cerr">{error}</p> : null}
    </ConsoleDetail>
  );
}
