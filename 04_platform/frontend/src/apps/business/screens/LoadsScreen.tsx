import { useCallback, useEffect, useState } from 'preact/hooks';
import { useT, type MessageKey } from '../../../shared/i18n';
import { quoteFigure, quoteTone, type QuoteView } from '../../../shared/quote';
import { ConsoleDetail } from '../../tower/ConsoleDetail';
import { SitePicker, type SiteView } from '../../tower/screens/SitePicker';
import { QuotePanel } from '../../tower/screens/QuotePanel';
import { NATURES, PACKAGING_OPTIONS } from '../../agent/logic';
import { businessConfig, type BusinessClient, type BusinessView, type CarriageContract, type LoadProposal, type PostedLoad } from '../api';
import { deliverySays, loadGaps, loadStage, mayAct, nextDay, noteKept, orderableContracts, planDo, planSays, roadSays, type LoadForm, type LoadStage } from '../logic';
import { passageWords } from '../../../shared/passages';
import { heldLine } from '../../../shared/tamper';
import { heldByLine } from '../../../shared/heldByAuthority';

/** A time on the road, as the shipper reads it: its day and hour. */
const onRoad = (iso: string) => new Date(iso).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
import { NoteFile, NoteLinksPanel } from './LoadNote';
import { LoadPapers } from './LoadPapers';
import { LoadSeals } from './LoadSeals';
import { CountrySelect, useCountryAtlas } from '../../tower/screens/CountrySelect';
import { publicRequest } from '../../../lib/sbg';

/** A price on a load, in the money the load was posted in — the figure alone only where no company of ours names one. */
const priced = (amount: number, currency?: string): string => (currency ? quoteFigure({ amount, currency }) : amount.toLocaleString());
import { SentFor } from './SentFor';
import type { BusinessActions } from '../useBusinessApp';

const STAGE: Record<LoadStage, { label: MessageKey; tone: string }> = {
  ordered: { label: 'business.loads.stage.ordered', tone: 'info' },
  posted: { label: 'business.loads.stage.posted', tone: 'quiet' },
  offers: { label: 'business.loads.stage.offers', tone: 'info' },
  taken: { label: 'business.loads.stage.taken', tone: 'info' },
  moving: { label: 'business.loads.stage.moving', tone: 'info' },
  delivered: { label: 'business.loads.stage.delivered', tone: 'ok' },
  cancelled: { label: 'business.loads.stage.cancelled', tone: 'quiet' },
};

const atlasApi = { countryCatalogue: () => publicRequest(businessConfig(), '/v1/sbg/country-catalogue') };

type Form = LoadForm & { packaging: string; packages: string; destCountry: string; natureCode: string; fragile: boolean; commitMode: 'negotiate' | 'instant'; instructions: string; contactName: string; contactPhone: string; deliveryWindow: string; pickupOn: string; forClientId: string; contractId: string; deliverOn: string; orderRef: string };
const EMPTY: Form = { description: '', fromSiteId: '', toSiteId: '', weightKg: '', packaging: '', packages: '', destCountry: '', natureCode: 'GEN', fragile: false, commitMode: 'negotiate', instructions: '', contactName: '', contactPhone: '', deliveryWindow: '', pickupOn: '', forClientId: '', contractId: '', deliverOn: '', orderRef: '' };

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
            onPosted={async (code, ordered) => {
              setPosting(false);
              setDone(ordered ? t('business.loads.ordered', { code, fleet: ordered.fleet, day: ordered.day }) : t('business.loads.posted', { code }));
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
              const says = planSays(r, t);
              const handed = deliverySays(r, t);
              const road = roadSays(r, t, onRoad);
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
                      {r.contract ? ` · ${t('business.loads.withCarrier', { fleet: r.contract.fleetName, day: r.deliverOn ?? '' })}` : ''}
                    </span>
                    {/* What a row must not lose to an ellipsis: which load of an order this is, and what its carrier's
                        plan says of it — on no vehicle, outside its window, or (with no tag: it needs nobody) about
                        when. The line above gives way to the width; this one wraps. */}
                    {r.partOf || says || handed || road || r.held || r.heldByAuthority || r.seals?.some((s) => s.state === 'broken') ? (
                      <span class="biz-loads__flags">
                        {r.partOf ? <span class="ctag ctag--quiet">{t('business.loads.loadOf', { no: r.partOf.no, of: r.partOf.of, order: r.partOf.rootCode })}</span> : null}
                        {says?.state === 'late' ? <span class="ctag ctag--danger">{t('business.loads.late.tag')}</span> : null}
                        {says?.state === 'left' ? <span class="ctag ctag--danger">{t('business.loads.left.tag')}</span> : null}
                        {says?.state === 'outside' ? <span class="ctag ctag--warn">{t('business.loads.win.tag')}</span> : null}
                        {says ? <span>{says.row}</span> : null}
                        {/* Delivered: when, and where that fell against what was asked — in colour only where it missed. */}
                        {handed?.tag ? <span class="ctag ctag--warn">{handed.tag}</span> : null}
                        {handed ? <span>{handed.row}</span> : null}
                        {/* Round 15 — a seal found broken on the road: in colour, on the row, until delivery and after. */}
                        {r.seals?.some((s) => s.state === 'broken') ? <span class="ctag ctag--danger">{t('business.loads.sealBroken')}</span> : null}
                        {/* Round 35 — held under the tamper protocol: in colour, with what was found, until operations releases it. */}
                        {r.held ? <span class="ctag ctag--danger">{t('common.tamper.heldShort')}</span> : null}
                        {r.held ? <span>{heldLine(r.held, t)}</span> : null}
                        {/* Held by the police or customs on the road, as its driver said: who and where, until let go. */}
                        {r.heldByAuthority ? <span class="ctag ctag--danger">{t('common.held.short')}</span> : null}
                        {r.heldByAuthority ? <span>{heldByLine(r.heldByAuthority, t)}</span> : null}
                        {/* Round 14 — on the road: where its driver said it is, and when it is expected. */}
                        {road ? <span>{[road.row, road.expected].filter(Boolean).join(' · ')}</span> : null}
                      </span>
                    ) : null}
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
          business={business}
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

function NewLoadPanel({ business, client, onCancel, onPosted }: { business: BusinessView; client: BusinessClient | null; onCancel: () => void; onPosted: (code: string, ordered?: { fleet: string; day: string }) => void | Promise<void> }) {
  const t = useT();
  const [form, setForm] = useState<Form>({ ...EMPTY, destCountry: business.country, deliverOn: nextDay() });
  const countries = useCountryAtlas(atlasApi);
  const packages = Number(form.packages);
  const counted = Number.isInteger(packages) && packages >= 1 && packages <= 500 ? packages : undefined;
  const [contracts, setContracts] = useState<CarriageContract[]>([]);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const gaps = loadGaps(form);
  const gap = (f: keyof LoadForm) => (tried && gaps.includes(f) ? <span class="cerr">{t(`business.loads.need.${f}` as MessageKey)}</span> : null);
  const siteApi = client ? (client.api as never) : null;
  // P1 — the carriers this business has a standing contract with. An order with one goes to its queue, not the board.
  useEffect(() => {
    if (!client) return;
    void client.contracts().then((r) => setContracts(r.data?.items ?? []));
  }, [client]);
  const offered = orderableContracts(contracts, form.deliverOn || nextDay());
  const contract = offered.find((c) => c.contractId === form.contractId) ?? null;

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
      // A business sends from its own country; where the goods go is its choice, and a crossing is asked of a known one.
      pickupCountry: business.country,
      destCountry: form.destCountry || business.country,
      weightKg: Number(form.weightKg),
      ...(form.packaging ? { packaging: form.packaging } : {}),
      ...(counted ? { packages: counted } : {}),
      natureCode: form.natureCode,
      fragile: form.fragile,
      commitMode: form.commitMode,
      ...(form.instructions.trim() ? { instructions: form.instructions.trim() } : {}),
      ...(form.contactName.trim() ? { contactName: form.contactName.trim() } : {}),
      ...(form.contactPhone.trim() ? { contactPhone: form.contactPhone.trim() } : {}),
      ...(form.deliveryWindow.trim() ? { deliveryWindow: form.deliveryWindow.trim() } : {}),
      ...(form.pickupOn && !contract ? { scheduledPickupAt: new Date(`${form.pickupOn}T08:00:00`).toISOString() } : {}),
      ...(form.forClientId ? { forClientId: form.forClientId } : {}),
      // Under a contract: the day it must arrive, and no pickup date of our own — the fleet plans when it collects.
      ...(contract ? { contractId: contract.contractId, deliverOn: form.deliverOn, ...(form.orderRef.trim() ? { orderRef: form.orderRef.trim() } : {}) } : {}),
    });
    setBusy(false);
    if (posted.error || !posted.data) return setError(posted.error?.detail || posted.error?.title || null);
    await onPosted(posted.data.code, contract ? { fleet: contract.fleetName, day: form.deliverOn } : undefined);
  };

  return (
    <section class="cons__panel">
      <div class="cons__panelhead">
        <span class="cons__panelt">{t('business.loads.newTitle')}</span>
      </div>
      <p class="cons__lede">{t(contract ? 'business.loads.newLedeContract' : 'business.loads.newLede')}</p>
      <form onSubmit={(e) => void submit(e)}>
        <SentFor client={client} expeditor={business.activities.includes('expeditor')} value={form.forClientId} onChange={(id) => setForm((prev) => ({ ...prev, forClientId: id }))} />
        {offered.length ? (
          <fieldset class="cfield biz-acts">
            <legend class="cfield__label">{t('business.loads.f.carrier')}</legend>
            <label class="cfield--check biz-act">
              <input type="radio" name="biz-carrier" checked={!contract} onChange={() => setForm((prev) => ({ ...prev, contractId: '' }))} />
              <span>
                <strong>{t('business.loads.f.board')}</strong>
                <span class="chint">{t('business.loads.f.boardSub')}</span>
              </span>
            </label>
            {offered.map((c) => (
              <label class="cfield--check biz-act" key={c.contractId}>
                <input type="radio" name="biz-carrier" checked={contract?.contractId === c.contractId} onChange={() => setForm((prev) => ({ ...prev, contractId: c.contractId }))} />
                <span>
                  <strong>{c.reference ? `${c.fleetName} · ${c.reference}` : c.fleetName}</strong>
                  <span class="chint">{t('business.loads.f.contractSub')}</span>
                </span>
              </label>
            ))}
          </fieldset>
        ) : null}
        {contract ? (
          <label class="cfield">
            <span class="cfield__label">{t('business.loads.f.deliverOn')}</span>
            <input class="cinput" type="date" min={new Date().toISOString().slice(0, 10)} value={form.deliverOn} onInput={(e) => setForm((prev) => ({ ...prev, deliverOn: (e.target as HTMLInputElement).value }))} />
            <span class="chint">{t('business.loads.f.deliverOnHint', { fleet: contract.fleetName })}</span>
          </label>
        ) : null}
        {contract ? (
          <label class="cfield">
            <span class="cfield__label">{t('business.loads.f.orderRef')}</span>
            <input class="cinput" maxLength={60} value={form.orderRef} onInput={(e) => setForm((prev) => ({ ...prev, orderRef: (e.target as HTMLInputElement).value }))} />
            <span class="chint">{t('business.loads.f.orderRefHint')}</span>
          </label>
        ) : null}
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
            <span class="cfield__label">{t('business.loads.f.packages')}</span>
            <input id="load-packages" class="cinput" inputMode="numeric" maxLength={3} value={form.packages} onInput={(e) => setForm((prev) => ({ ...prev, packages: (e.target as HTMLInputElement).value }))} />
            <span class="chint">{t(form.forClientId ? 'business.loads.f.packagesHintClient' : business.gs1 ? 'business.loads.f.packagesHintGs1' : 'business.loads.f.packagesHint')}</span>
          </label>
          <div class="cfield">
            <CountrySelect value={form.destCountry} onChange={(destCountry) => setForm((prev) => ({ ...prev, destCountry }))} label={t('business.loads.f.destCountry')} options={countries} />
            {form.destCountry && form.destCountry !== business.country ? <span class="chint">{t('business.loads.f.crossing')}</span> : null}
          </div>
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
          {contract ? null : (
            <label class="cfield">
              <span class="cfield__label">{t('business.loads.f.pickupOn')}</span>
              <input class="cinput" type="date" value={form.pickupOn} onInput={(e) => setForm((prev) => ({ ...prev, pickupOn: (e.target as HTMLInputElement).value }))} />
              <span class="chint">{t('business.loads.f.pickupOnHint')}</span>
            </label>
          )}
        </div>
        <label class="cfield--check">
          <input type="checkbox" checked={form.fragile} onChange={() => setForm((prev) => ({ ...prev, fragile: !prev.fragile }))} />
          <span>{t('business.loads.f.fragile')}</span>
        </label>
        <fieldset class="cfield biz-acts" style={contract ? 'display:none' : undefined}>
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
        <p class="cnote">{t(contract ? 'business.loads.contractNote' : 'business.loads.settleNote')}</p>
        {error ? <p class="cerr">{error}</p> : null}
        <div class="twr-panelend">
          <button type="button" class="cbtn cbtn--ghost" onClick={onCancel}>
            {t('common.cancel')}
          </button>
          <button type="submit" class="cbtn cbtn--primary" disabled={busy}>
            {t(contract ? 'business.loads.orderCta' : 'business.loads.postCta')}
          </button>
        </div>
      </form>
    </section>
  );
}

function LoadDetail({ row, business, client, act, onClose, onChanged }: { row: PostedLoad; business: BusinessView; client: BusinessClient | null; act: boolean; onClose: () => void; onChanged: (message?: string) => void | Promise<void> }) {
  const t = useT();
  const stage = loadStage(row);
  const says = planSays(row, t);
  const handed = deliverySays(row, t);
  const road = roadSays(row, t, onRoad);
  const kept = noteKept(row, stage);
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
          {row.contract ? (
            <div class="cons__fact">
              <dt class="cons__factk">{t('business.loads.fact.contract')}</dt>
              <dd class="cons__factv">
                {row.contract.fleetName}
                {row.contract.reference ? ` · ${row.contract.reference}` : ''}
                {row.deliverOn ? ` · ${t('business.loads.fact.arrivesOn', { day: row.deliverOn })}` : ''}
                {row.orderRef ? ` · ${row.orderRef}` : ''}
              </dd>
            </div>
          ) : null}
          {row.partOf ? (
            <div class="cons__fact">
              <dt class="cons__factk">{t('business.loads.fact.order')}</dt>
              <dd class="cons__factv">{t('business.loads.loadOfFull', { no: row.partOf.no, of: row.partOf.of, order: row.partOf.rootCode, kg: row.partOf.orderKg.toLocaleString() })}</dd>
            </div>
          ) : null}
          {says ? (
            <div class="cons__fact">
              <dt class="cons__factk">{t('business.loads.fact.plan')}</dt>
              <dd class="cons__factv">
                {says.full}
                <span class="chint"> {planDo(says, row.contract?.fleetName ?? '', t)}</span>
              </dd>
            </div>
          ) : null}
          {row.carrier?.driverName ? (
            <div class="cons__fact">
              <dt class="cons__factk">{t('business.loads.fact.carrier')}</dt>
              <dd class="cons__factv">
                {row.carrier.driverName}
                {row.carrier.plate ? ` · ${row.carrier.plate}` : ''}
              </dd>
            </div>
          ) : null}
          {/* Round 14 — what its driver said on the road, in order; across a border, the allowance and when it is expected. */}
          {row.passages?.length || road ? (
            <div class="cons__fact">
              <dt class="cons__factk">{t('business.loads.fact.road')}</dt>
              <dd class="cons__factv">
                {(row.passages ?? []).map((p) => (
                  <span key={`${p.kind}-${p.at}`} class="biz-road__line">
                    {passageWords(p, t, onRoad)}
                  </span>
                ))}
                {road?.row && !row.passages?.length ? <span class="biz-road__line">{road.row}</span> : null}
                {road?.wait ? <span class="biz-road__line chint">{road.wait}</span> : null}
                {road?.expected ? (
                  <span class="biz-road__line">
                    <b>{road.expected}</b>
                  </span>
                ) : null}
                {road?.drive ? <span class="biz-road__line chint">{road.drive}</span> : null}
              </dd>
            </div>
          ) : null}
          {/* Round 25 — its cold chain broken on the road: the reading that broke it, when, and whether it reached us late. */}
          {row.coldChainBroken ? (
            <div class="cons__fact">
              <dt class="cons__factk">{t('business.loads.fact.coldChain')}</dt>
              <dd class="cons__factv">
                <b>{t('business.loads.coldChainBroken', { temp: row.coldChainBroken.celsius, when: onRoad(row.coldChainBroken.at), min: row.coldChainBroken.minC, max: row.coldChainBroken.maxC })}</b>
                {row.coldChainBroken.receivedAt ? <span class="biz-road__line chint">{t('business.loads.coldChainLate', { when: onRoad(row.coldChainBroken.receivedAt) })}</span> : null}
              </dd>
            </div>
          ) : null}
          {row.agreedPrice != null ? (
            <div class="cons__fact">
              <dt class="cons__factk">{t('business.loads.fact.agreed')}</dt>
              <dd class="cons__factv">{priced(row.agreedPrice, row.currency)}</dd>
            </div>
          ) : null}
          {row.deliveredAt ? (
            <div class="cons__fact">
              <dt class="cons__factk">{t('business.loads.fact.delivered')}</dt>
              <dd class="cons__factv">
                {t('business.loads.fact.deliveredTo', { when: row.deliveredAt.slice(0, 10), who: row.receiverName ?? '—' })}
                {handed ? ` ${handed.full}` : ''}
                {handed ? <span class="chint"> {t('business.loads.done.clock')}</span> : null}
              </dd>
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
          {/* Once a copy is kept: the whole file — the note, every copy as it was signed, its photographs. */}
          {kept === 'kept' ? <NoteFile client={client} noteId={row.noteId!} code={row.code} /> : null}
        </div>
        {kept === 'not_yet' ? <p class="chint">{t('business.note.notYet')}</p> : null}
      </section>

      {/* The labels for its packages and, across a border, its commercial invoice — the business's own papers. */}
      {stage !== 'cancelled' ? <LoadPapers row={row} client={client} business={business} act={act} /> : null}
      {/* Round 15 — the seals on the load: written before pickup, and what became of each after. */}
      {stage !== 'cancelled' ? <LoadSeals row={row} client={client} act={act} /> : null}

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
                      <span class="crow__name">{priced(p.price, row.currency)}</span>
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

      {/* The links to its note — the one a receipt was emailed with, and the ones the business made to pass on. Shown to
          a viewer too: what is a way into the business's papers is everybody's in it to see. */}
      {kept === 'kept' ? <NoteLinksPanel client={client} noteId={row.noteId!} title={`${row.code} · ${row.description}`} act={act} /> : null}

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
