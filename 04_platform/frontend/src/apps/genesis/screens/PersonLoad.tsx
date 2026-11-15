import { useEffect, useMemo, useState } from 'preact/hooks';
import type { SbgClient, SbgError } from '../../../lib/sbg';
import { Button, Card, Note, PhoneField, PlacePicker, Pill, refusalSentence, type PlaceNote } from '../../../shared/ui';
import { formatMoney, useT } from '../../../shared/i18n';
import { LoadWorkFields } from '../../../shared/load-work/LoadWorkFields';
import { LoadWorkSummary } from '../../../shared/load-work/LoadWorkSummary';
import { EMPTY_PERSON_LOAD, personLoadApi, personLoadBlocker, personLoadBody, type LoadOffer, type PersonLoadForm, type PersonLoadRow } from '../personLoads';
import type { SendActions, SendState } from '../useSendApp';

/**
 * 2026-11-13 — POST A LOAD (unusual loads, U5; part 3a): something too big for a shop — what it is, about how heavy, where from
 * and to, what it takes to move it, a number the driver can call. Drivers name prices; the person chooses one in My parcels and
 * pays the driver directly. Where a company of ours takes the money, the server says paying up front is coming.
 */
export function LoadPostScreen({ state, actions, client }: { state: SendState; actions: SendActions; client: SbgClient | null }) {
  const t = useT();
  const api = useMemo(() => (client ? personLoadApi(client) : null), [client]);
  const [form, setForm] = useState<PersonLoadForm>(() => EMPTY_PERSON_LOAD(state.authPhone));
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [posted, setPosted] = useState(false);
  const blocker = personLoadBlocker(form);
  const set = (patch: Partial<PersonLoadForm>) => setForm((f) => ({ ...f, ...patch }));
  const note = (n: PlaceNote) => (n.kind === 'notFound' ? t('send.load.geoNotFound') : n.kind === 'found' ? t('send.load.geoFound', { where: n.where }) : n.kind === 'pinned' ? t('send.load.pinned') : '');
  const post = async () => {
    if (!api || blocker) return;
    setBusy(true);
    setProblem(null);
    const r = await api.post(personLoadBody(form));
    setBusy(false);
    if (r.error) return setProblem(refusalSentence(r.error as SbgError));
    setPosted(true);
  };

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
      <p class="card__note">{t('send.load.payDirect')}</p>
      {problem ? (
        <p class="hint" role="alert">
          {problem}
        </p>
      ) : null}
      <div class="scr__cta">
        <Button busy={busy} disabled={blocker !== null || !api} onClick={() => void post()}>
          {t('send.load.post')}
        </Button>
        {blocker ? <p class="hint">{t(blocker)}</p> : null}
      </div>
    </div>
  );
}

/** One driver's price on the person's load: accept it, answer with your own, or say no thanks. */
function OfferRow({ offer, currency, api, onChanged }: { offer: LoadOffer; currency?: string; api: ReturnType<typeof personLoadApi>; onChanged: () => void }) {
  const t = useT();
  const [answering, setAnswering] = useState(false);
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const amount = Number(answer.replace(',', '.'));
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
        {offer.note ? <span class="row__s">“{offer.note}”</span> : null}
        {offer.counter ? <span class="row__s">{t('send.load.countered', { amount: formatMoney(offer.counter.price, currency) })}</span> : null}
        <span class="freight__acts">
          <Button variant="link" full={false} busy={busy} onClick={() => void act(() => api.accept(offer.proposalId))}>
            {t('send.load.accept')}
          </Button>
          <Button variant="link" full={false} onClick={() => setAnswering(!answering)}>
            {t('send.load.counter')}
          </Button>
          <Button variant="link" full={false} disabled={busy} onClick={() => void act(() => api.decline(offer.proposalId))}>
            {t('send.load.decline')}
          </Button>
        </span>
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
function LoadCard({ load, api, onChanged }: { load: PersonLoadRow; api: ReturnType<typeof personLoadApi>; onChanged: () => void }) {
  const t = useT();
  const [offers, setOffers] = useState<LoadOffer[] | null>(null);
  const waiting = load.status === 'available' || load.status === 'scheduled';
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
      <LoadWorkSummary work={load.work} forDriver={false} />
      {waiting ? (
        offers === null ? null : offers.length === 0 ? (
          <p class="hint">{t('send.load.noOffers')}</p>
        ) : (
          <div class="rows" role="list">
            {offers.map((o) => (
              <OfferRow key={o.proposalId} offer={o} currency={load.currency} api={api} onChanged={() => {
                void read();
                onChanged();
              }} />
            ))}
          </div>
        )
      ) : null}
      <p class="card__note">{t('send.load.payDirect')}</p>
    </Card>
  );
}

/** "Your loads", in My parcels: the loads this person posted, newest first. Nothing where they posted none. */
export function PersonLoadsGroup({ client }: { client: SbgClient | null }) {
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
        <LoadCard key={l.freightId} load={l} api={api} onChanged={() => void read()} />
      ))}
    </section>
  );
}
