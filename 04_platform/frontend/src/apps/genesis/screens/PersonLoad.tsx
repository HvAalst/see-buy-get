import { useEffect, useMemo, useState } from 'preact/hooks';
import type { SbgClient, SbgError } from '../../../lib/sbg';
import { Button, Card, Note, PhoneField, PlacePicker, Pill, refusalSentence, type PlaceNote } from '../../../shared/ui';
import { formatMoney, useT } from '../../../shared/i18n';
import { LoadWorkFields } from '../../../shared/load-work/LoadWorkFields';
import { LoadWorkSummary } from '../../../shared/load-work/LoadWorkSummary';
import { EMPTY_PERSON_LOAD, choosesPayWay, personLoadApi, personLoadBlocker, personLoadBody, type LoadOffer, type LoadPaymentView, type LoadPayWays, type PersonLoadForm, type PersonLoadRow } from '../personLoads';
import type { SendActions, SendState } from '../useSendApp';
import type { Uploaded } from '../../../shared/upload';
import { HoldBlock } from './HoldBlock';
import { GoodsWord, goodsWordAsked, type UnionPassage } from '../../../shared/ui/GoodsWord';
import { FiscalCodeLines, FiscalCodes, FiscalNewCode } from '../../../shared/ui/FiscalCodes';
import { fiscalBody, fiscalCodesAsked, fiscalReady, type FiscalCountry, type FiscalForm } from '../../../shared/fiscal-codes';
import { arrivedWho, nowWithLine, nowWithSince } from '../../../shared/nowWith';
import { ArrivedConfirm } from '../../../shared/ArrivedConfirm';
import { CodeMailBounced } from '../../../shared/CodeMailBounced';
import { ReaderLanguageOptions, defaultReaderLanguage } from '../../../shared/readerLanguage';

/**
 * 2026-11-13 — POST A LOAD (unusual loads, U5; part 3a): something too big for a shop — what it is, about how heavy, where from
 * and to, what it takes to move it, a number the driver can call. Drivers name prices; the person chooses one in My parcels and
 * pays the driver directly. Where a company of ours takes the money, the server says paying up front is coming.
 */
export function LoadPostScreen({ state, actions, client }: { state: SendState; actions: SendActions; client: SbgClient | null }) {
  const t = useT();
  const api = useMemo(() => (client ? personLoadApi(client) : null), [client]);
  // 2026-11-24 — from the parcel the person was sending, its weight comes along (route plan part 9).
  const [form, setForm] = useState<PersonLoadForm>(() => EMPTY_PERSON_LOAD(state.authPhone, state.dims.kg));
  // 2026-11-24 — when they may pay, by the pickup's country (route plan part 9): asked only where it offers both.
  const [ways, setWays] = useState<LoadPayWays | null>(null);
  useEffect(() => {
    const pin = form.from.pin;
    if (!api || !pin) return setWays(null);
    let live = true;
    void api.payWays(pin).then((r) => {
      if (!live || r.error) return;
      const got = (r.data as unknown as { ways?: LoadPayWays }).ways ?? null;
      setWays(got);
      if (!choosesPayWay(got)) setForm((f) => (f.payWay ? { ...f, payWay: '' } : f));
    });
    return () => {
      live = false;
    };
  }, [api, form.from.pin?.lat, form.from.pin?.lng]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [posted, setPosted] = useState(false);
  // 2026-11-22 — to another EU country (BG-2): the server says where the pins fall, and asks the person's word on what it holds.
  const [word, setWord] = useState<UnionPassage | null>(null);
  const [said, setSaid] = useState(false);
  // 2026-11-23 — taken over or delivered in Romania or Bulgaria: the server asks the UIT or UTN, or the word that none is needed.
  const [fiscalAsk, setFiscalAsk] = useState<FiscalCountry[] | null>(null);
  const [fiscal, setFiscal] = useState<FiscalForm>({});
  const blocker = personLoadBlocker(form);
  const set = (patch: Partial<PersonLoadForm>) => setForm((f) => ({ ...f, ...patch }));
  const note = (n: PlaceNote) => (n.kind === 'notFound' ? t('send.load.geoNotFound') : n.kind === 'found' ? t('send.load.geoFound', { where: n.where }) : n.kind === 'pinned' ? t('send.load.pinned') : '');
  const post = async () => {
    if (!api || blocker) return;
    setBusy(true);
    setProblem(null);
    const codes = fiscalAsk ? fiscalBody(fiscal, fiscalAsk) : undefined;
    const r = await api.post({ ...personLoadBody(form), ...(word ? { noGoodsWithOwnRules: said } : {}), ...(codes ? { fiscalCodes: codes } : {}) });
    setBusy(false);
    const asked = goodsWordAsked(r.error as SbgError);
    if (asked) return setWord(asked);
    const fiscalAsked = fiscalCodesAsked(r.error as SbgError);
    if (fiscalAsked) return setFiscalAsk(fiscalAsked);
    if (r.error) return setProblem(refusalSentence(r.error as SbgError));
    setPosted(true);
  };

  const payChoice = choosesPayWay(ways) ? (
    <Card title={t('send.load.payWhen')}>
      <div class="chips" role="radiogroup" aria-label={t('send.load.payWhen')}>
        {(['held', 'at_pickup'] as const).map((w) => (
          <button key={w} type="button" role="radio" aria-checked={(form.payWay || 'held') === w} class={'chip chip--tap' + ((form.payWay || 'held') === w ? ' chip--on' : '')} onClick={() => set({ payWay: w })}>
            {t(w === 'held' ? 'send.load.payHeld' : 'send.load.payAtPickup')}
          </button>
        ))}
      </div>
      <p class="hint">{t((form.payWay || 'held') === 'held' ? 'send.load.payHeldHint' : 'send.load.payAtPickupHint')}</p>
    </Card>
  ) : null;

  if (posted) {
    return (
      <div class="scr">
        <Note tone="ok" icon="check" title={t('send.load.posted')} detail={t('send.load.postedDetail')} />
        <Button onClick={() => actions.go('parcels')}>{t('send.load.seeIt')}</Button>
      </div>
    );
  }
  return (
    <div class="scr">
      <h1 class="scr__title">{t('send.load.title')}</h1>
      <p class="scr__lede">{t('send.load.lede')}</p>
      <Card>
        <div class="field">
          <label class="field__label" for="load-what">
            {t('send.load.what')}
          </label>
          <input id="load-what" class="input" maxLength={200} placeholder={t('send.load.whatPh')} value={form.description} onInput={(e) => set({ description: e.currentTarget.value })} />
        </div>
        <div class="field">
          <label class="field__label" for="load-kg">
            {t('send.load.kg')}
          </label>
          <input id="load-kg" class="input" type="number" inputMode="decimal" min="1" step="any" value={form.weightKg} onInput={(e) => set({ weightKg: e.currentTarget.value })} />
        </div>
      </Card>
      <Card>
        <PlacePicker
          id="load-from"
          fieldLabel={t('send.load.from')}
          placeholder={t('send.load.fromPh')}
          mapLabel={t('send.load.mapLabel')}
          findLabel={t('send.load.find')}
          label={form.from.label}
          pin={form.from.pin}
          onLabel={(label) => set({ from: { ...form.from, label } })}
          onPin={(pin) => set({ from: { ...form.from, pin } })}
          geocode={actions.findPlace}
          noteText={note}
          startHere
        />
        <PlacePicker
          id="load-to"
          fieldLabel={t('send.load.to')}
          placeholder={t('send.load.toPh')}
          mapLabel={t('send.load.mapLabel')}
          findLabel={t('send.load.find')}
          label={form.to.label}
          pin={form.to.pin}
          onLabel={(label) => set({ to: { ...form.to, label } })}
          onPin={(pin) => set({ to: { ...form.to, pin } })}
          geocode={actions.findPlace}
          noteText={note}
          {...(form.from.pin ? { reference: form.from.pin } : {})}
        />
      </Card>
      <Card label={t('work.title')}>
        <LoadWorkFields value={form.work} onChange={(work) => set({ work })} />
      </Card>
      <Card>
        <div class="field">
          <label class="field__label" for="load-phone">
            {t('send.load.phone')}
          </label>
          <PhoneField id="load-phone" value={form.contactPhone} onInput={(v) => set({ contactPhone: v })} />
        </div>
        <div class="field">
          <label class="field__label" for="load-note">
            {t('send.load.note')}
          </label>
          <textarea id="load-note" class="input" rows={3} maxLength={500} value={form.note} onInput={(e) => set({ note: e.currentTarget.value })} />
        </div>
      </Card>
      {/* 2026-11-15 — who receives it, if not them: the code reaches that person, not by hand (plan R2). */}
      <Card title={t('send.load.receiverTitle')}>
        <p class="card__note">{t('send.load.receiverNote')}</p>
        <div class="field">
          <label class="field__label" for="load-rcv-name">
            {t('send.load.receiverName')}
          </label>
          <input id="load-rcv-name" class="input" maxLength={80} autoComplete="off" value={form.receiverName} onInput={(e) => set({ receiverName: e.currentTarget.value })} />
        </div>
        <div class="field">
          <label class="field__label" for="load-rcv-phone">
            {t('send.load.receiverPhone')}
          </label>
          <PhoneField id="load-rcv-phone" value={form.receiverPhone} onInput={(v) => set({ receiverPhone: v })} autoComplete="off" />
        </div>
        <div class="field">
          <label class="field__label" for="load-rcv-email">
            {t('send.load.receiverEmail')}
          </label>
          <input id="load-rcv-email" class="input" type="email" inputMode="email" maxLength={120} autoComplete="off" value={form.receiverEmail} onInput={(e) => set({ receiverEmail: e.currentTarget.value })} />
        </div>
        {form.receiverEmail.trim() ? (
          <div class="field">
            <label class="field__label" for="load-rcv-lang">
              {t('common.receiverLanguage')}
            </label>
            <select id="load-rcv-lang" class="input" value={form.receiverLanguage || defaultReaderLanguage()} onChange={(e) => set({ receiverLanguage: e.currentTarget.value })}>
              <ReaderLanguageOptions />
            </select>
            <p class="hint">{t('common.receiverLanguageHint')}</p>
          </div>
        ) : null}
      </Card>
      {payChoice ?? <p class="card__note">{t('send.load.howPay')}</p>}
      {word ? <GoodsWord passage={word} said={said} onChange={setSaid} /> : null}
      {fiscalAsk ? <FiscalCodes countries={fiscalAsk} value={fiscal} onChange={setFiscal} idPrefix="load-fiscal" /> : null}
      {problem ? (
        <p class="hint" role="alert">
          {problem}
        </p>
      ) : null}
      <div class="scr__cta">
        <Button busy={busy} disabled={blocker !== null || !api || (word !== null && !said) || (fiscalAsk !== null && !fiscalReady(fiscal, fiscalAsk))} onClick={() => void post()}>
          {t('send.load.post')}
        </Button>
        {blocker ? <p class="hint">{t(blocker)}</p> : null}
      </div>
    </div>
  );
}

/** One driver's price on the person's load: accept it, answer with your own, or say no thanks. */
function OfferRow({ offer, currency, api, onChanged, escrow = false, freightId, phone = '', needsPhone = true }: { offer: LoadOffer; currency?: string; api: ReturnType<typeof personLoadApi>; onChanged: () => void; escrow?: boolean; freightId: string; phone?: string; needsPhone?: boolean }) {
  const t = useT();
  // 2026-11-13 — a load paid first: accepting is paying, from a number M-Pesa asks (part 3b).
  const [paying, setPaying] = useState(false);
  const [payPhone, setPayPhone] = useState(phone);
  const [answering, setAnswering] = useState(false);
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const amount = Number(answer.replace(',', '.'));
  const payOnPage = async () => {
    setBusy(true);
    setProblem(null);
    const r = await api.pay(freightId, offer.proposalId);
    setBusy(false);
    if (r.error) return setProblem(refusalSentence(r.error as SbgError));
    const link = (r.data as unknown as LoadPaymentView | undefined)?.link;
    onChanged();
    if (link) window.location.assign(link);
  };
  const act = async (call: () => Promise<{ error?: unknown }>) => {
    setBusy(true);
    setProblem(null);
    const r = await call();
    setBusy(false);
    if (r.error) return setProblem(refusalSentence(r.error as SbgError));
    setAnswering(false);
    onChanged();
  };
  return (
    <div class="row row--static" role="listitem">
      <span class="row__body">
        <span class="row__t">{t('send.load.offerLine', { amount: formatMoney(offer.price, currency) })}</span>
        {escrow && offer.charge != null ? <span class="row__s">{t('send.load.payTotal', { amount: formatMoney(offer.charge, currency) })}</span> : null}
        {offer.counterTaken ? <span class="row__s">{t('send.load.counterTaken')}</span> : null}
        {offer.note ? <span class="row__s">“{offer.note}”</span> : null}
        {offer.counter ? <span class="row__s">{t('send.load.countered', { amount: formatMoney(offer.counter.price, currency) })}</span> : null}
        <span class="freight__acts">
          {escrow ? (
            needsPhone ? (
              <Button variant="link" full={false} onClick={() => setPaying(!paying)}>
                {t('send.load.pay', { amount: formatMoney(offer.charge ?? offer.price, currency) })}
              </Button>
            ) : (
              // 2026-11-24 — paid on the country's payment page (iDEAL in the Netherlands): no number asked; the page opens (part 9).
              <Button variant="link" full={false} busy={busy} onClick={() => void payOnPage()}>
                {t('send.load.pay', { amount: formatMoney(offer.charge ?? offer.price, currency) })}
              </Button>
            )
          ) : (
            <Button variant="link" full={false} busy={busy} onClick={() => void act(() => api.accept(offer.proposalId))}>
              {t('send.load.accept')}
            </Button>
          )}
          <Button variant="link" full={false} onClick={() => setAnswering(!answering)}>
            {t('send.load.counter')}
          </Button>
          <Button variant="link" full={false} disabled={busy} onClick={() => void act(() => api.decline(offer.proposalId))}>
            {t('send.load.decline')}
          </Button>
        </span>
        {paying ? (
          <span class="freight__answer">
            <label class="field__label" for={`load-pay-${offer.proposalId}`}>
              {t('send.load.payPhone')}
            </label>
            <PhoneField id={`load-pay-${offer.proposalId}`} value={payPhone} onInput={setPayPhone} />
            <Button full={false} chevron={false} busy={busy} disabled={!payPhone.trim()} onClick={() => void act(() => api.pay(freightId, offer.proposalId, payPhone.trim()))}>
              {t('send.load.payNow')}
            </Button>
          </span>
        ) : null}
        {answering ? (
          <span class="freight__answer">
            <label class="field__label" for={`load-counter-${offer.proposalId}`}>
              {t('send.load.counterPrice')}
            </label>
            <input id={`load-counter-${offer.proposalId}`} class="input" type="number" inputMode="decimal" min="1" step="any" value={answer} onInput={(e) => setAnswer(e.currentTarget.value)} />
            <Button full={false} chevron={false} busy={busy} disabled={!(amount > 0) || amount === offer.price} onClick={() => void act(() => api.counter(offer.proposalId, amount))}>
              {t('send.load.counterSend')}
            </Button>
          </span>
        ) : null}
        {problem ? (
          <span class="row__s" role="alert">
            {problem}
          </span>
        ) : null}
      </span>
    </div>
  );
}

/** One of the person's loads: what it is, where it stands, the work, and — while it waits — the drivers' prices. */
function LoadCard({ load, api, onChanged, phone, client, upload }: { load: PersonLoadRow; api: ReturnType<typeof personLoadApi>; onChanged: () => void; phone?: string; client: SbgClient | null; upload: (file: File) => Promise<Uploaded> }) {
  const t = useT();
  const [offers, setOffers] = useState<LoadOffer[] | null>(null);
  const [payment, setPayment] = useState<LoadPaymentView | null>(null);
  const [arrived, setArrived] = useState(false);
  const [asking, setAsking] = useState(false); // 2026-11-15 — "It arrived" asks them to confirm first
  const [resentTo, setResentTo] = useState(''); // 2026-11-16 — the code sent to another address, after the first came back
  const waiting = (load.status === 'available' || load.status === 'scheduled') && !load.awaitingPayment;
  const readPayment = async () => {
    if (!load.escrow) return;
    const r = await api.payment(load.freightId);
    setPayment(r.error ? null : (r.data as unknown as LoadPaymentView));
  };
  useEffect(() => {
    void readPayment();
  }, [load.freightId, load.status, load.awaitingPayment]);
  const when = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const read = async () => {
    const r = await api.offers(load.freightId);
    if (!r.error) setOffers(((r.data as { items?: LoadOffer[] } | undefined)?.items ?? []).filter((o) => o.status === 'open'));
  };
  useEffect(() => {
    if (waiting) void read();
  }, [load.freightId, load.status]);
  return (
    <Card title={`${load.code} · ${load.description}`}>
      <p class="card__note">
        <Pill tone={waiting ? 'idle' : 'info'}>{t(waiting ? 'send.load.waiting' : 'send.load.taken')}</Pill> {load.destLabel}
      </p>
      {/* 2026-11-15 — who has it now (plan R1). */}
      {load.nowWith ? <p class="hint">{nowWithLine(load.nowWith, t)} · {nowWithSince(load.nowWith, t)}</p> : null}
      <LoadWorkSummary work={load.work} forDriver={false} />
      {/* 2026-11-23 — its UIT (Romania) or UTN (Bulgaria), or the word that none is needed; a new one until it is delivered. */}
      <FiscalCodeLines cards={load.fiscalCodes} compliance={load.fiscalCompliance} />
      {['scheduled', 'available', 'ordered', 'claimed', 'in_transit'].includes(load.status) ? (
        <FiscalNewCode
          cards={load.fiscalCodes}
          idPrefix={`fiscal-${load.freightId}`}
          save={async (body) => {
            const r = await api.fiscalCodes(load.freightId, body);
            if (r.error) return refusalSentence(r.error as SbgError);
            onChanged();
            return null;
          }}
        />
      ) : null}
      {waiting ? (
        offers === null ? null : offers.length === 0 ? (
          <p class="hint">{t('send.load.noOffers')}</p>
        ) : (
          <div class="rows" role="list">
            {offers.map((o) => (
              <OfferRow key={o.proposalId} offer={o} currency={load.currency} api={api} escrow={Boolean(load.escrow)} freightId={load.freightId} phone={phone} needsPhone={load.payNeedsPhone !== false} onChanged={() => {
                void read();
                onChanged();
              }} />
            ))}
          </div>
        )
      ) : null}
      {/* 2026-11-13 — a load paid first (part 3b): the payment waiting, the delivery code, money back. */}
      {payment?.state === 'awaiting' ? (
        <>
          {payment.phoneMasked ? (
            <Note tone="info" icon="clock" title={t('send.load.payWaiting', { phone: payment.phoneMasked, amount: formatMoney(payment.amount, payment.currency), time: when(payment.until) })} detail={payment.instructions ?? ''} />
          ) : (
            // 2026-11-24 — paid on a page (iDEAL in the Netherlands): opened again from here, until it is paid or its time runs out.
            <>
              <Note tone="info" icon="clock" title={t('send.load.payWaitingPage', { amount: formatMoney(payment.amount, payment.currency), time: when(payment.until) })} detail={payment.instructions ?? ''} />
              {payment.link ? (
                <Button variant="outline" full={false} chevron={false} onClick={() => window.location.assign(payment.link!)}>
                  {t('send.load.payOpenPage')}
                </Button>
              ) : null}
            </>
          )}
          <Button variant="link" full={false} onClick={() => void readPayment().then(onChanged)}>
            {t('send.load.checkAgain')}
          </Button>
        </>
      ) : null}
      {load.deliveryCode ? (
        <>
          <Note tone="ok" icon="check" title={t('send.load.codeTitle', { code: load.deliveryCode })} detail={t('send.load.codeDetail')} />
          {arrived || load.arrivedSaid ? (
            <p class="hint">{t('send.load.arrivedDone')}</p>
          ) : (
            asking ? (
              <ArrivedConfirm who={arrivedWho(load, t)} onCancel={() => setAsking(false)} onConfirm={() => void api.arrived(load.freightId).then((r) => { if (!r.error) { setArrived(true); setAsking(false); } })} />
            ) : (
              <Button variant="link" full={false} onClick={() => setAsking(true)}>
                {t('send.load.arrived')}
              </Button>
            )
          )}
          {/* 2026-11-16 — the code email to the receiver came back: send it to another address. */}
          {resentTo ? <p class="hint">{t('nowWith.bounced.sent', { to: resentTo })}</p> : null}
          {load.codeMailBounced && !arrived && !load.arrivedSaid && !resentTo ? (
            <CodeMailBounced to={load.codeMailBounced.to} onSend={(email) => void api.receiverEmail(load.freightId, email).then((r) => { if (!r.error) { setResentTo(email); onChanged(); } })} />
          ) : null}
        </>
      ) : null}
      {payment?.state === 'lapsed' && waiting ? <p class="hint">{t('send.load.lapsed')}</p> : null}
      {/* 2026-11-15 — delivered: the driver's pay held 24 hours; a problem reported within them, decided by the protocol. */}
      <HoldBlock freightId={load.freightId} hold={load} client={client} upload={upload} onChanged={onChanged} />
      {payment?.owedBack ? <p class="hint">{t(payment.backTo === 'account' ? 'send.load.refundedAccount' : 'send.load.refunded', { amount: formatMoney(payment.owedBack, payment.currency) })}</p> : null}
      <p class="card__note">{t(load.escrow ? 'send.load.escrowNote' : 'send.load.payDirect')}</p>
    </Card>
  );
}

/** "Your loads", in My parcels: the loads this person posted, newest first. Nothing where they posted none. */
export function PersonLoadsGroup({ client, phone, upload }: { client: SbgClient | null; phone?: string; upload: (file: File) => Promise<Uploaded> }) {
  const t = useT();
  const api = useMemo(() => (client ? personLoadApi(client) : null), [client]);
  const [loads, setLoads] = useState<PersonLoadRow[] | null>(null);
  const read = async () => {
    if (!api) return;
    const r = await api.mine();
    if (!r.error) setLoads(((r.data as { items?: PersonLoadRow[] } | undefined)?.items ?? []) as PersonLoadRow[]);
  };
  useEffect(() => {
    void read();
  }, [api]);
  if (!api || !loads?.length) return null;
  return (
    <section>
      <h2 class="scr__section">{t('send.load.mine')}</h2>
      {loads.map((l) => (
        <LoadCard key={l.freightId} load={l} api={api} phone={phone} client={client} upload={upload} onChanged={() => void read()} />
      ))}
    </section>
  );
}
