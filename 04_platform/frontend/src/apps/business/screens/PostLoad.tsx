import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Abbreviated } from '../../../shared/ui/Abbr';
import { BackStep } from '../../../shared/ui/BackStep';
import { PhoneField, StepList } from '../../../shared/ui';
import { useT, type MessageKey } from '../../../shared/i18n';
import { countryNameIn } from '../../../shared/documents/documents';
import { quoteFigure } from '../../../shared/quote';
import { publicRequest } from '../../../lib/sbg';
import { SitePicker, type SiteView } from '../../tower/screens/SitePicker';
import { NATURES, PACKAGING_HELP, natureLabel } from '../../agent/logic';
import { ConsolePick } from '../../tower/ConsolePick';
import { CurrencySelect } from '../../tower/screens/CurrencySelect';
import { CountrySelect, useCountryAtlas, type CountryOption } from '../../tower/screens/CountrySelect';
import { businessConfig, type BusinessClient, type BusinessView, type CarriageContract, type Client } from '../api';
import { isColdNature, isDangerousNature, nextDay, orderableContracts } from '../logic';
import { codeOf, type ReceivingPointNamed } from '../inbound';
import {
  draftOwner,
  draftTouched,
  dropLoadDraft,
  gapStep,
  gapWords,
  keepLoadDraft,
  postBack,
  postGaps,
  postNext,
  postSteps,
  sendLoad,
  startForm,
  stepGaps,
  stepIn,
  tempRangeOf,
  todayIn,
  waitsUntil,
  type LoadDraft,
  type PostAt,
  type PostForm,
  type PostGap,
  type PostStep,
} from '../postLoad';
import { SentFor } from './SentFor';

const atlasApi = { countryCatalogue: () => publicRequest(businessConfig(), '/v1/sbg/country-catalogue') };

/** Each step's name in the step bar, and the question its screen asks. */
const STEP_NAME: Record<PostStep, MessageKey> = {
  carrier: 'business.post.step.carrier',
  route: 'business.post.step.route',
  goods: 'business.post.step.goods',
  when: 'business.post.step.when',
  value: 'business.post.step.value',
  day: 'business.post.step.day',
  check: 'business.post.step.check',
};
const STEP_TITLE: Record<PostStep, MessageKey> = {
  carrier: 'business.post.t.carrier',
  route: 'business.post.t.route',
  goods: 'business.post.t.goods',
  when: 'business.post.t.when',
  value: 'business.post.t.value',
  day: 'business.post.t.day',
  check: 'business.post.t.check',
};

type Receiving = ReceivingPointNamed & { code: string };

/** What came back once it was posted: its code, and where it is now. */
export interface PostedNow {
  freightId: string;
  code: string;
  status: string;
  commitMode: 'negotiate' | 'instant';
  scheduledPickupAt?: string;
  /** Ordered under a contract: with whom, to arrive which day. */
  fleet?: string;
  day?: string;
}

/** Where the wizard starts — the first step, empty, unless a test draws a later one with what it would have read. */
export interface PostStart {
  step?: PostAt;
  form?: PostForm;
  contracts?: CarriageContract[];
  clients?: Client[];
  toReceiver?: boolean;
  typedCode?: string;
  receiving?: Receiving | null;
  sites?: SiteView[];
  posted?: PostedNow;
  tried?: boolean;
  backTo?: 'check';
  now?: Date;
}

/**
 * 2026-11-03 — POST A LOAD, ONE STEP PER SCREEN (the owner: "the 'post a new load' is a pretty large page. It is in my
 * opinion better if we chunk it up similar to the sign up process. And an indicator shows how far we are before a load
 * goes public. That would enable us to use a slightly larger font size and more white space").
 *
 * As the business's sign-up has it (ChooseScreen.tsx): the step bar pinned at the top, saying in its head that nothing
 * goes out before the last step; one question per screen, its title focused and the page read from its top; Back on
 * every step and the phone's Back with it; each step's own needs said beside their field before Next. The last step
 * shows it all, with Change back to each part and who will see it — and only its button sends anything. Then the load's
 * code and where it is now.
 *
 * Every answer the one page asked is asked here, and the request is that page's own (postLoad.ts, loadBody). What is
 * typed is kept on the phone as it goes, for three days, so a phone call does not lose it.
 */
export function PostLoad({
  business,
  client,
  resume,
  start,
  onLeave,
  onPosted,
  onOpen,
  onAnother,
}: {
  business: BusinessView;
  client: BusinessClient | null;
  /** The load kept on this phone, carried on with. */
  resume?: LoadDraft | null;
  start?: PostStart;
  /** Left for now: what was typed stays kept. */
  onLeave: () => void;
  /** It is posted: the list is read again, so it is there to open. */
  onPosted: () => void | Promise<void>;
  onOpen: (freightId: string) => void;
  onAnother: () => void;
}) {
  const t = useT();
  const owner = draftOwner(business.entityId, business.you.memberId);
  // The first answers, as a new load has them: what is kept is only a load somebody has started.
  const fresh = useRef(startForm(business.country, start?.now)).current;
  const [form, setForm] = useState<PostForm>(start?.form ?? resume?.form ?? fresh);
  const [at, setAt] = useState<PostAt>(start?.step ?? resume?.step ?? 'carrier');
  // The contracts it could be ordered under and the clients it could be sent for decide the first step: read before it is drawn.
  const [contracts, setContracts] = useState<CarriageContract[] | null>(start?.contracts ?? (client ? null : []));
  const [clients, setClients] = useState<Client[] | null>(start?.clients ?? (client ? null : []));
  // Inbound, reading A: to another business's receiving point, by the code it gave — looked up before it is posted.
  const [toReceiver, setToReceiver] = useState(start?.toReceiver ?? resume?.toReceiver ?? false);
  const [typedCode, setTypedCode] = useState(start?.typedCode ?? resume?.typedCode ?? '');
  const [receiving, setReceiving] = useState<Receiving | null>(start?.receiving ?? null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [tried, setTried] = useState(start?.tried ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The business's saved places, for the check's names of the two ends.
  const [sites, setSites] = useState<SiteView[] | null>(start?.sites ?? null);
  const [posted, setPosted] = useState<PostedNow | null>(start?.posted ?? null);
  // Changing one part from the check: its way on is back to the check.
  const [backTo, setBackTo] = useState<'check' | null>(start?.backTo ?? null);
  const countries = useCountryAtlas(atlasApi);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);
  // One load per press, whatever the network does with the first.
  const sending = useRef(false);

  const offered = orderableContracts(contracts ?? [], form.deliverOn || nextDay());
  const contract = offered.find((c) => c.contractId === form.contractId) ?? null;
  const expeditor = business.activities.includes('expeditor');
  const sentFor = clients !== null && (expeditor || clients.length > 0);
  const ready = contracts !== null && clients !== null;
  const steps = postSteps({ choice: offered.length > 0 || sentFor, contract: Boolean(contract) });
  const step: PostAt = at === 'done' ? 'done' : stepIn(at, steps);
  // Across a border the consignment note asks more of the form (the CMR check, 2026-10-28).
  const crossing = Boolean(form.destCountry && form.destCountry !== business.country);
  const dangerous = isDangerousNature(form.natureCode);
  const cold = isColdNature(form.natureCode);
  const ctx = { crossing, contract: Boolean(contract), today: todayIn(start?.now) };
  const gaps = step === 'done' ? [] : stepGaps(step, form, ctx);
  const back = postBack(step, steps);
  const siteApi = client ? (client.api as never) : null;
  const set = (patch: Partial<PostForm>) => setForm((prev) => ({ ...prev, ...patch }));
  const gap = (g: PostGap) => (tried && gaps.includes(g) ? <span class="cerr">{t(gapWords(g) as MessageKey)}</span> : null);

  useEffect(() => {
    if (!client) return;
    if (contracts === null) void client.contracts().then((r) => setContracts(r.data?.items ?? []));
    if (clients === null) void client.clients().then((r) => setClients(r.data?.items ?? []));
  }, [client]);

  const lookUp = async (raw: string = typedCode) => {
    const code = codeOf(raw);
    setLookupError(null);
    setReceiving(null);
    setForm((prev) => ({ ...prev, receivingPoint: '' }));
    if (!code) return setLookupError(t('business.loads.f.codeShape'));
    if (!client) return;
    const r = await client.inbound.named(code);
    if (r.error || !r.data) return setLookupError(r.error?.detail || r.error?.title || null);
    setReceiving({ ...r.data, code });
    setForm((prev) => ({ ...prev, receivingPoint: code }));
  };

  // A load carried on to another business's place: what its code names is asked again, never kept on the phone.
  useEffect(() => {
    if (resume?.toReceiver && resume.typedCode.trim() && !start?.receiving) void lookUp(resume.typedCode);
  }, []);

  // Kept on the phone as it is typed — or forgotten again, while nothing is.
  useEffect(() => {
    if (step === 'done' || !ready) return;
    const d = { step, form, toReceiver, typedCode };
    if (draftTouched(d, fresh)) keepLoadDraft(owner, d);
    else dropLoadDraft(owner);
  }, [form, step, toReceiver, typedCode, ready]);

  // The check names the two ends by the business's own places.
  useEffect(() => {
    if (step !== 'check' || !client) return;
    void client.api.sites(business.entityId).then((r) => setSites((r as unknown as { data?: { sites?: SiteView[] } }).data?.sites ?? []));
  }, [step, client]);

  // A new step is a new screen: read from its top, its title the first thing a screen reader says.
  useEffect(() => {
    if (!moved.current) return;
    if (typeof window !== 'undefined') window.scrollTo?.(0, 0);
    titleRef.current?.focus();
  }, [step]);

  const go = (to: PostAt) => {
    moved.current = true;
    if (to === 'check' || to === 'done') setBackTo(null);
    setAt(to);
    setTried(false);
    setError(null);
  };
  const goBack = (to: PostStep) => {
    setBackTo(null);
    go(to);
  };

  // The one place a load leaves the phone: the last step's button (next, below), never another step's.
  const post = async () => {
    if (!client || sending.current) return;
    sending.current = true;
    setBusy(true);
    setError(null);
    const sent = await sendLoad(
      { sites: () => client.api.sites(business.entityId) as never, post: (body) => client.postLoad(body) as never },
      form,
      { country: business.country, ctx, receiving, contract, owner },
    );
    sending.current = false;
    setBusy(false);
    if ('refused' in sent) {
      if (sent.refused === 'placeGone') setError(t('business.loads.placeGone'));
      else if (sent.refused === 'server') setError(sent.error);
      return;
    }
    setPosted({
      freightId: sent.posted.freightId,
      code: sent.posted.code,
      status: sent.posted.status,
      commitMode: form.commitMode,
      ...(sent.posted.scheduledPickupAt ? { scheduledPickupAt: sent.posted.scheduledPickupAt } : {}),
      ...(contract ? { fleet: contract.fleetName, day: form.deliverOn } : {}),
    });
    go('done');
    await onPosted();
  };

  const next = async (e?: Event) => {
    e?.preventDefault();
    if (step === 'done' || busy) return;
    setTried(true);
    if (step === 'check') return post();
    if (gaps.length) return;
    go(backTo ? 'check' : postNext(step, steps));
  };

  const title = (key: MessageKey, params?: Record<string, string>) => (
    <h1 class="cons__title" id="biz-post-title" ref={titleRef} tabIndex={-1}>
      {t(key, params)}
    </h1>
  );

  if (!ready) {
    return (
      <section class="biz-post">
        <p class="cons__empty">{t('business.loading')}</p>
      </section>
    );
  }

  const barTitle = t(contract ? 'business.post.barOrder' : 'business.post.bar');

  return (
    <form class="biz-post biz-wiz" noValidate onSubmit={(e) => void next(e)}>
      {/* The phone's Back steps back through it as Back below does; from the first step it leaves the load for now,
          kept, and from done it goes to the list. */}
      <BackStep key={step} back={() => (back ? goBack(back) : onLeave())} />
      {step !== 'done' ? <StepList pinned title={barTitle} steps={steps.map((s) => t(STEP_NAME[s]))} at={steps.indexOf(step)} /> : null}

      {step === 'carrier' ? (
        <>
          {title(STEP_TITLE.carrier)}
          <p class="cons__lede">{t(offered.length ? 'business.post.l.carrier' : 'business.post.l.carrierFor')}</p>
          <SentFor client={client} items={clients} expeditor={expeditor} value={form.forClientId} onChange={(id) => set({ forClientId: id })} />
          {offered.length ? (
            <fieldset class="cfield biz-acts" aria-labelledby="biz-post-title">
              <label class="cfield--check biz-act">
                <input type="radio" name="biz-carrier" checked={!contract} onChange={() => set({ contractId: '' })} />
                <span>
                  <strong>{t('business.loads.f.board')}</strong>
                  <span class="chint">{t('business.loads.f.boardSub')}</span>
                </span>
              </label>
              {offered.map((c) => (
                <label class="cfield--check biz-act" key={c.contractId}>
                  <input type="radio" name="biz-carrier" checked={contract?.contractId === c.contractId} onChange={() => set({ contractId: c.contractId })} />
                  <span>
                    <strong>{c.reference ? `${c.fleetName} · ${c.reference}` : c.fleetName}</strong>
                    <span class="chint">{t('business.loads.f.contractSub')}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          ) : (
            <p class="cnote">{t('business.post.boardOnly')}</p>
          )}
          {contract ? (
            <>
              <label class="cfield">
                <span class="cfield__label">{t('business.loads.f.deliverOn')}</span>
                <input class="cinput" type="date" min={todayIn(start?.now)} value={form.deliverOn} onInput={(e) => set({ deliverOn: (e.target as HTMLInputElement).value })} />
                <span class="chint">{t('business.loads.f.deliverOnHint', { fleet: contract.fleetName })}</span>
                {gap('deliverOn')}
                {gap('deliverOnGone')}
              </label>
              <label class="cfield">
                <span class="cfield__label">{t('business.loads.f.orderRef')}</span>
                <input class="cinput" maxLength={60} value={form.orderRef} onInput={(e) => set({ orderRef: (e.target as HTMLInputElement).value })} />
                <span class="chint">{t('business.loads.f.orderRefHint')}</span>
              </label>
              {/* Under a contract the hours it can be delivered go with its day: there is no "when" of its own. */}
              <WindowField form={form} set={set} />
            </>
          ) : null}
        </>
      ) : null}

      {step === 'route' ? (
        <>
          {title(STEP_TITLE.route)}
          <p class="cons__lede">{t('business.post.l.route')}</p>
          <SitePicker kind="delivery" entityId={business.entityId} api={siteApi} value={form.fromSiteId} onChange={(id) => set({ fromSiteId: id })} label={t('business.loads.f.from')} addLabel={t('business.loads.f.addPlace')} />
          {gap('fromSiteId')}
          {toReceiver ? (
            <div class="cfield">
              <span class="cfield__label">{t('business.loads.f.deliverTo')}</span>
              <span class="biz-deliverto">
                <input class="cinput biz-code" maxLength={12} autocomplete="off" spellcheck={false} placeholder="7KQ3-PX9M" value={typedCode} onInput={(e) => setTypedCode((e.target as HTMLInputElement).value)} />
                <button type="button" class="cbtn cbtn--ghost cbtn--sm" disabled={!typedCode.trim()} onClick={() => void lookUp()}>
                  {t('business.loads.f.findCode')}
                </button>
              </span>
              {receiving ? <span class="cnote">{t('business.loads.f.deliverToFound', { name: receiving.name, place: receiving.siteName })}</span> : <span class="chint">{t('business.loads.f.deliverToHint')}</span>}
              {lookupError ? <span class="cerr">{lookupError}</span> : null}
              {gap('toSiteId')}
              {receiving ? (
                <label class="cfield">
                  <span class="cfield__label">{t('business.loads.f.receiverRef', { name: receiving.name })}</span>
                  <input class="cinput" maxLength={60} value={form.receiverRef} onInput={(e) => set({ receiverRef: (e.target as HTMLInputElement).value })} />
                  <span class="chint">{t('business.loads.f.receiverRefHint')}</span>
                </label>
              ) : null}
            </div>
          ) : (
            <>
              <SitePicker kind="delivery" entityId={business.entityId} api={siteApi} value={form.toSiteId} onChange={(id) => set({ toSiteId: id })} label={t('business.loads.f.to')} addLabel={t('business.loads.f.addPlace')} />
              {gap('toSiteId')}
            </>
          )}
          <label class="cfield--check">
            <input
              type="checkbox"
              checked={toReceiver}
              onChange={() => {
                setToReceiver((on) => !on);
                setReceiving(null);
                setLookupError(null);
                set({ receivingPoint: '' });
              }}
            />
            <span>{t('business.loads.f.toReceiver')}</span>
          </label>
          <div class="cfield">
            <CountrySelect value={form.destCountry} onChange={(destCountry) => set({ destCountry })} label={t('business.loads.f.destCountry')} options={countries} />
            {crossing ? <span class="chint">{t('business.loads.f.crossing')}</span> : null}
          </div>
          {/* Box 2 of the consignment note: who receives the goods. A receiving point is its own consignee. */}
          {receiving ? null : (
            <>
              <div class="biz-two">
                <label class="cfield">
                  <span class="cfield__label">{t('business.loads.f.consigneeName')}</span>
                  <input class="cinput" maxLength={120} value={form.consigneeName} onInput={(e) => set({ consigneeName: (e.target as HTMLInputElement).value })} />
                  {gap('consigneeName')}
                </label>
                <label class="cfield">
                  <span class="cfield__label">{t('business.loads.f.consigneeAddress')}</span>
                  <input class="cinput" maxLength={300} value={form.consigneeAddress} onInput={(e) => set({ consigneeAddress: (e.target as HTMLInputElement).value })} />
                  {gap('consigneeAddress')}
                </label>
              </div>
              <p class="chint biz-post__under">{t(crossing ? 'business.loads.f.consigneeHintCrossing' : 'business.loads.f.consigneeHint')}</p>
            </>
          )}
          {/* Box 13, for customs: where it is cleared and by whom — asked only of a load that crosses a border. */}
          {crossing ? (
            <label class="cfield">
              <span class="cfield__label">{t('business.loads.f.customs')}</span>
              <input class="cinput" maxLength={500} placeholder={t('business.loads.f.customsPlaceholder')} value={form.customsInstructions} onInput={(e) => set({ customsInstructions: (e.target as HTMLInputElement).value })} />
            </label>
          ) : null}
        </>
      ) : null}

      {step === 'goods' ? (
        <>
          {title(STEP_TITLE.goods)}
          <p class="cons__lede">{t(contract ? 'business.post.l.goodsContract' : 'business.post.l.goods')}</p>
          <label class="cfield">
            <span class="cfield__label">{t('business.loads.f.description')}</span>
            <input class="cinput" maxLength={160} value={form.description} onInput={(e) => set({ description: (e.target as HTMLInputElement).value })} />
            {gap('description')}
          </label>
          <ConsolePick label={t('business.loads.f.nature')} value={form.natureCode} options={NATURES.map((n) => ({ value: n.key, label: t(n.labelKey), sub: t(n.detailKey) }))} onChange={(natureCode) => set({ natureCode })} />
          {/* Box 9: dangerous goods by their generally recognised description — the sender's own, as on the safety data
              sheet. Asked only of goods that are dangerous, straight under the kind of goods that makes them so. */}
          {dangerous ? (
            <div class="biz-post__more">
              <h2 class="cons__panelt">{t('business.exports.sli.dangerous')}</h2>
              <p class="chint">
                <Abbreviated text={t('business.loads.f.dangerousHint')} />
              </p>
              <div class="biz-two">
                <label class="cfield">
                  <span class="cfield__label">{t('business.exports.sli.unNumber')}</span>
                  <input class="cinput" maxLength={8} placeholder="UN1263" value={form.unNumber} onInput={(e) => set({ unNumber: (e.target as HTMLInputElement).value })} />
                  {gap('unNumber')}
                </label>
                <label class="cfield">
                  <span class="cfield__label">{t('business.exports.sli.hazardClass')}</span>
                  <input class="cinput" maxLength={8} placeholder="3" value={form.hazardClass} onInput={(e) => set({ hazardClass: (e.target as HTMLInputElement).value })} />
                  {gap('hazardClass')}
                </label>
              </div>
              <div class="biz-two">
                <label class="cfield">
                  <span class="cfield__label">{t('business.exports.sli.shippingName')}</span>
                  <input class="cinput" maxLength={200} value={form.properShippingName} onInput={(e) => set({ properShippingName: (e.target as HTMLInputElement).value })} />
                  {gap('properShippingName')}
                </label>
                <ConsolePick
                  label={t('business.exports.sli.packingGroup')}
                  value={form.packingGroup}
                  options={[{ value: '', label: t('business.loads.f.packingGroupNone') }, ...(['I', 'II', 'III'] as const).map((g) => ({ value: g, label: g }))]}
                  onChange={(packingGroup) => set({ packingGroup })}
                />
              </div>
            </div>
          ) : null}
          {/* 2026-11-03 — the temperature fresh or frozen food is kept at, straight under the kind of goods that asks it.
              Both left empty keeps the usual 2–8 °C, and the request is the one it always was. No inputMode: a phone's
              number pad has no minus sign, and frozen goods need one. */}
          {cold ? (
            <div class="biz-post__more">
              <h2 class="cons__panelt" id="biz-post-temp">
                {t('business.post.temp.title')}
              </h2>
              <p class="chint">{t('business.post.temp.hint')}</p>
              <div class="cfield" role="group" aria-labelledby="biz-post-temp">
                <span class="biz-post__range">
                  <span>{t('business.post.temp.between')}</span>
                  <input class="cinput" type="number" step="0.5" min={-30} max={30} aria-label={t('business.post.temp.lowest')} value={form.tempMinC} onInput={(e) => set({ tempMinC: (e.target as HTMLInputElement).value })} />
                  <span>{t('business.post.temp.and')}</span>
                  <input class="cinput" type="number" step="0.5" min={-30} max={30} aria-label={t('business.post.temp.highest')} value={form.tempMaxC} onInput={(e) => set({ tempMaxC: (e.target as HTMLInputElement).value })} />
                  <span>{t('business.post.temp.unit')}</span>
                </span>
                {gap('tempRange')}
                {gap('tempBounds')}
                {gap('tempOrder')}
              </div>
            </div>
          ) : null}
          <div class="biz-two">
            <label class="cfield">
              <span class="cfield__label">{t('business.loads.f.weight')}</span>
              <input class="cinput" type="number" inputMode="decimal" min={1} value={form.weightKg} onInput={(e) => set({ weightKg: (e.target as HTMLInputElement).value })} />
              {gap('weightKg')}
            </label>
            {/* Each packaging said with what it means for the truck, as the counter's help sheet says it. */}
            <ConsolePick
              label={t('business.loads.f.packaging')}
              value={form.packaging}
              placeholder={t('agent.accept.packagingChoose')}
              options={PACKAGING_HELP.map((p) => ({ value: p.value, label: t(p.labelKey as MessageKey), sub: t(p.detailKey as MessageKey) }))}
              onChange={(packaging) => set({ packaging })}
            />
          </div>
          <div class="biz-two">
            <label class="cfield">
              <span class="cfield__label">{t('business.loads.f.packages')}</span>
              <input id="load-packages" class="cinput" inputMode="numeric" maxLength={3} value={form.packages} onInput={(e) => set({ packages: (e.target as HTMLInputElement).value })} />
              <span class="chint">{t(form.forClientId ? 'business.loads.f.packagesHintClient' : business.gs1 ? 'business.loads.f.packagesHintGs1' : 'business.loads.f.packagesHint')}</span>
              {gap('packages')}
            </label>
            {/* 2026-11-01 — the space the load takes: light, bulky goods fill a truck before they weigh it down. */}
            <label class="cfield">
              <span class="cfield__label">{t('business.loads.f.volume')}</span>
              <input class="cinput" type="number" inputMode="decimal" min="0.01" max="150" step="any" value={form.volumeM3} onInput={(e) => set({ volumeM3: (e.target as HTMLInputElement).value })} />
              <span class="chint">{t('business.loads.f.volumeHint')}</span>
              {gap('volumeM3')}
            </label>
          </div>
          <label class="cfield--check">
            <input type="checkbox" checked={form.fragile} onChange={() => set({ fragile: !form.fragile })} />
            <span>{t('business.loads.f.fragile')}</span>
          </label>
        </>
      ) : null}

      {step === 'when' ? (
        <>
          {title(STEP_TITLE.when)}
          <p class="cons__lede">{t('business.post.l.when')}</p>
          <label class="cfield">
            <span class="cfield__label">{t('business.loads.f.pickupOn')}</span>
            <input class="cinput" type="date" min={todayIn(start?.now)} value={form.pickupOn} onInput={(e) => set({ pickupOn: (e.target as HTMLInputElement).value })} />
            <span class="chint">{t('business.loads.f.pickupOnHint')}</span>
            {gap('pickupOnGone')}
          </label>
          <WindowField form={form} set={set} />
        </>
      ) : null}

      {step === 'value' ? (
        <>
          {title(STEP_TITLE.value)}
          <p class="cons__lede">{t(contract ? 'business.post.l.valueContract' : 'business.post.l.value')}</p>
          {contract ? (
            <p class="cnote">{t('business.loads.contractNote')}</p>
          ) : (
            <fieldset class="cfield biz-acts">
              <legend class="cfield__label">{t('business.loads.f.price')}</legend>
              {(['negotiate', 'instant'] as const).map((m) => (
                <label class="cfield--check biz-act" key={m}>
                  <input type="radio" name="biz-commit" checked={form.commitMode === m} onChange={() => set({ commitMode: m })} />
                  <span>
                    <strong>{t(m === 'negotiate' ? 'business.loads.f.negotiate' : 'business.loads.f.instant')}</strong>
                    <span class="chint">{t(m === 'negotiate' ? 'business.loads.f.negotiateSub' : 'business.loads.f.instantSub')}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          )}
          {/* CMR Art. 6(2)(a) and (d): a declared value, a special interest in delivery, no transhipment — each the sender's own. */}
          <div class="biz-two">
            <label class="cfield">
              <span class="cfield__label">{t('business.loads.f.declaredValue')}</span>
              <input class="cinput" type="number" inputMode="decimal" min={1} value={form.declaredValue} onInput={(e) => set({ declaredValue: (e.target as HTMLInputElement).value })} />
            </label>
            <label class="cfield">
              <span class="cfield__label">{t('business.loads.f.specialInterest')}</span>
              <input class="cinput" type="number" inputMode="decimal" min={1} value={form.specialInterest} onInput={(e) => set({ specialInterest: (e.target as HTMLInputElement).value })} />
            </label>
          </div>
          {form.declaredValue.trim() || form.specialInterest.trim() ? (
            <CurrencySelect api={siteApi} value={form.valueCurrency} onChange={(valueCurrency) => set({ valueCurrency })} label={t('business.loads.f.valueCurrency')} near={[business.country, form.destCountry]} />
          ) : null}
          {gap('valueCurrency')}
          <p class="chint biz-post__under">{t('business.loads.f.declaredHint')}</p>
          <label class="cfield--check">
            <input type="checkbox" checked={form.noTranshipment} onChange={() => set({ noTranshipment: !form.noTranshipment })} />
            <span>
              {t('business.loads.f.noTranshipment')}
              <span class="chint">{t('business.loads.f.noTranshipmentHint')}</span>
            </span>
          </label>
          {/* Cover asked for (2026-10-28): only a carrier whose insurance SeeBuyGet has checked, and which still runs, may take it. */}
          <label class="cfield--check">
            <input type="checkbox" checked={form.coverRequired} onChange={() => set({ coverRequired: !form.coverRequired })} />
            <span>
              {t('business.loads.f.cover')}
              <span class="chint">{t('business.loads.f.coverHint')}</span>
            </span>
          </label>
          {/* 2026-11-01 — a truck run as a flight: carried as a road load under road law, the waybill and flight a reference only. */}
          <label class="cfield--check">
            <input type="checkbox" checked={form.truckFlight} onChange={() => set({ truckFlight: !form.truckFlight })} />
            <span>
              {t('business.loads.f.truckFlight')}
              <span class="chint">{t('business.loads.f.truckFlightHint')}</span>
            </span>
          </label>
          {form.truckFlight ? (
            <div class="biz-post__more">
              <div class="biz-two">
                <label class="cfield">
                  <span class="cfield__label">{t('business.loads.f.flightAwb')}</span>
                  <input class="cinput" maxLength={20} value={form.flightAwb} onInput={(e) => set({ flightAwb: (e.target as HTMLInputElement).value })} />
                </label>
                <label class="cfield">
                  <span class="cfield__label">{t('business.loads.f.flightNo')}</span>
                  <input class="cinput" maxLength={10} value={form.flightNo} onInput={(e) => set({ flightNo: (e.target as HTMLInputElement).value })} />
                </label>
              </div>
              <label class="cfield">
                <span class="cfield__label">{t('business.loads.f.flightAirline')}</span>
                <input class="cinput" maxLength={80} value={form.flightAirline} onInput={(e) => set({ flightAirline: (e.target as HTMLInputElement).value })} />
              </label>
            </div>
          ) : null}
        </>
      ) : null}

      {step === 'day' ? (
        <>
          {title(STEP_TITLE.day)}
          <p class="cons__lede">{t('business.post.l.day')}</p>
          <label class="cfield">
            <span class="cfield__label">{t('business.loads.f.instructions')}</span>
            <input class="cinput" maxLength={500} value={form.instructions} onInput={(e) => set({ instructions: (e.target as HTMLInputElement).value })} />
          </label>
          <div class="biz-two">
            <label class="cfield">
              <span class="cfield__label">{t('business.loads.f.contactName')}</span>
              <input class="cinput" maxLength={80} value={form.contactName} onInput={(e) => set({ contactName: (e.target as HTMLInputElement).value })} />
            </label>
            <label class="cfield">
              <span class="cfield__label">{t('business.loads.f.contactPhone')}</span>
              <PhoneField id="load-contact-phone" value={form.contactPhone} onInput={(v) => set({ contactPhone: v })} autoComplete="off" inputClass="cinput" />
            </label>
          </div>
        </>
      ) : null}

      {step === 'check' ? (
        <CheckStep
          title={title(STEP_TITLE.check)}
          steps={steps}
          form={form}
          business={business}
          contract={contract}
          clients={clients ?? []}
          sentFor={sentFor}
          sites={sites}
          receiving={receiving}
          countries={countries}
          gaps={postGaps(form, ctx)}
          onChange={(s) => {
            go(s);
            setBackTo('check');
          }}
          now={start?.now}
        />
      ) : null}

      {step === 'done' && posted ? (
        <>
          {title(posted.fleet ? 'business.post.doneOrdered' : 'business.post.doneTitle')}
          <p class="biz-post__codek">{t('business.post.codeLabel')}</p>
          <p class="biz-post__code">{posted.code}</p>
          <p class="cons__lede">{doneWords(posted, t)}</p>
        </>
      ) : null}

      {error ? (
        <p class="cerr">
          <Abbreviated text={error} />
        </p>
      ) : null}
      {step === steps[0] && !backTo ? <p class="chint biz-post__kept">{t('business.post.keptHint')}</p> : null}

      <div class="twr-panelend biz-wiz__end">
        {step === 'done' ? null : back ? (
          <button type="button" class="cbtn cbtn--ghost" disabled={busy} onClick={() => goBack(back)}>
            {t('common.back')}
          </button>
        ) : (
          <button type="button" class="cbtn cbtn--ghost" onClick={onLeave}>
            {t('business.post.leave')}
          </button>
        )}
        <span class="biz-wiz__go">
          {step === 'done' && posted ? (
            <>
              <button type="button" class="cbtn cbtn--ghost" onClick={onAnother}>
                {t('business.post.another')}
              </button>
              <button type="button" class="cbtn cbtn--primary" onClick={() => onOpen(posted.freightId)}>
                {t('business.post.open')}
              </button>
            </>
          ) : step === 'check' ? (
            <button type="submit" class="cbtn cbtn--primary" disabled={busy}>
              {contract ? t('business.post.orderCta', { fleet: contract.fleetName }) : t('business.post.postCta')}
            </button>
          ) : (
            <button type="submit" class="cbtn cbtn--primary">
              {t(backTo ? 'business.post.toCheck' : 'common.next')}
            </button>
          )}
        </span>
      </div>
    </form>
  );
}

/** When it can be delivered: on the When step, or — under a contract, which has none — with the day it must arrive. */
function WindowField({ form, set }: { form: PostForm; set: (patch: Partial<PostForm>) => void }) {
  const t = useT();
  return (
    <label class="cfield">
      <span class="cfield__label">{t('business.loads.f.window')}</span>
      <input class="cinput" maxLength={80} value={form.deliveryWindow} placeholder={t('business.loads.f.windowPlaceholder')} onInput={(e) => set({ deliveryWindow: (e.target as HTMLInputElement).value })} />
    </label>
  );
}

/** Where it is now, once posted: in its carrier's orders, waiting for its day, or on the board. */
function doneWords(p: PostedNow, t: ReturnType<typeof useT>): string {
  if (p.fleet) return t('business.post.doneContract', { fleet: p.fleet, day: p.day ?? '' });
  if (p.status === 'scheduled' && p.scheduledPickupAt) return t('business.post.doneFrom', { day: dayOf(p.scheduledPickupAt) });
  return `${t('business.post.doneBoard')} ${t(p.commitMode === 'negotiate' ? 'business.post.doneNegotiate' : 'business.post.doneInstant')}`;
}

/** A moment as its day, in the reader's own calendar. */
const dayOf = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso.slice(0, 10) : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * CHECK AND POST: every part on one page, each with Change back to its step; what each part still needs, said under it;
 * and who will see the load once it goes — said before the one button that sends it.
 */
function CheckStep({
  title,
  steps,
  form,
  business,
  contract,
  clients,
  sentFor,
  sites,
  receiving,
  countries,
  gaps,
  onChange,
  now,
}: {
  title: JSX.Element;
  steps: PostStep[];
  form: PostForm;
  business: BusinessView;
  contract: CarriageContract | null;
  clients: Client[];
  sentFor: boolean;
  sites: SiteView[] | null;
  receiving: Receiving | null;
  countries: CountryOption[];
  gaps: PostGap[];
  onChange: (step: PostStep) => void;
  now?: Date;
}) {
  const t = useT();
  const crossing = Boolean(form.destCountry && form.destCountry !== business.country);
  const place = (id: string) => (sites === null ? t('business.loading') : sites.find((s) => s.siteId === id)?.name ?? '—');
  const country = (code: string) => countries.find((c) => c.code === code)?.name ?? countryNameIn(code, 'en');
  const packages = Number(form.packages);
  const money = (v: string) => quoteFigure({ amount: Number(v), currency: form.valueCurrency });
  const facts = (s: PostStep): Array<[string, string]> => {
    const out: Array<[string, string | false | null | undefined]> = [];
    if (s === 'carrier') {
      if (sentFor) out.push([t('business.sentFor.label'), form.forClientId ? clients.find((c) => c.clientId === form.forClientId)?.name ?? '—' : t('business.sentFor.own')]);
      out.push([t('business.loads.f.carrier'), contract ? (contract.reference ? `${contract.fleetName} · ${contract.reference}` : contract.fleetName) : t('business.loads.f.board')]);
      if (contract) {
        out.push([t('business.loads.f.deliverOn'), form.deliverOn]);
        out.push([t('business.post.k.orderRef'), form.orderRef.trim()]);
        out.push([t('business.post.k.window'), form.deliveryWindow.trim()]);
      }
    } else if (s === 'route') {
      out.push([t('business.loads.f.from'), form.fromSiteId ? place(form.fromSiteId) : '']);
      out.push([t('business.loads.f.to'), receiving ? t('business.loads.f.deliverToFound', { name: receiving.name, place: receiving.siteName }) : form.toSiteId ? place(form.toSiteId) : '']);
      if (receiving) out.push([t('business.post.k.receiverRef'), form.receiverRef.trim()]);
      out.push([t('business.loads.f.destCountry'), form.destCountry ? country(form.destCountry) : '']);
      if (!receiving) out.push([t('business.loads.f.consigneeName'), [form.consigneeName.trim(), form.consigneeAddress.trim()].filter(Boolean).join(', ')]);
      if (crossing) out.push([t('business.loads.f.customs'), form.customsInstructions.trim()]);
    } else if (s === 'goods') {
      out.push([t('business.loads.f.description'), form.description.trim()]);
      out.push([t('business.loads.f.nature'), natureLabel(form.natureCode, t)]);
      if (isDangerousNature(form.natureCode)) {
        const dg = [form.unNumber.trim(), form.properShippingName.trim(), form.hazardClass.trim() ? t('business.post.v.class', { cls: form.hazardClass.trim() }) : '', form.packingGroup ? t('business.post.v.group', { pg: form.packingGroup }) : ''];
        out.push([t('business.exports.sli.dangerous'), dg.filter(Boolean).join(' · ')]);
      }
      // Fresh or frozen food: the range it is kept in — or, none given, the usual one it will be kept in. Half given or
      // wrong, it is shown as typed, with what it still needs said under the part: never as the usual range.
      if (isColdNature(form.natureCode)) {
        const kept = tempRangeOf(form);
        const lo = form.tempMinC.trim();
        const hi = form.tempMaxC.trim();
        out.push([t('business.post.k.temp'), kept ? t('business.post.v.temp', { min: String(kept.minC), max: String(kept.maxC) }) : lo || hi ? t('business.post.v.temp', { min: lo || '—', max: hi || '—' }) : t('business.post.v.tempUsual')]);
      }
      out.push([t('business.post.k.weight'), Number(form.weightKg) >= 1 ? `${Number(form.weightKg).toLocaleString()} kg` : '']);
      out.push([t('business.loads.f.packaging'), form.packaging ? t((PACKAGING_HELP.find((p) => p.value === form.packaging)?.labelKey ?? 'agent.accept.packagingChoose') as MessageKey) : '']);
      out.push([t('business.loads.f.packages'), Number.isInteger(packages) && packages >= 1 && packages <= 500 ? String(packages) : '']);
      out.push([t('business.post.k.volume'), Number(form.volumeM3) > 0 ? `${form.volumeM3.trim()} m³` : '']);
      if (form.fragile) out.push([t('business.post.k.handling'), t('business.loads.f.fragile')]);
    } else if (s === 'when') {
      out.push([t('business.post.k.collect'), form.pickupOn || t('business.post.v.asSoon')]);
      out.push([t('business.post.k.window'), form.deliveryWindow.trim()]);
    } else if (s === 'value') {
      if (!contract) out.push([t('business.loads.f.price'), t(form.commitMode === 'negotiate' ? 'business.loads.f.negotiate' : 'business.loads.f.instant')]);
      if (Number(form.declaredValue) > 0 && form.valueCurrency) out.push([t('business.post.k.declared'), money(form.declaredValue)]);
      if (Number(form.specialInterest) > 0 && form.valueCurrency) out.push([t('business.post.k.interest'), money(form.specialInterest)]);
      const terms = [form.noTranshipment ? t('business.loads.f.noTranshipment') : '', form.coverRequired ? t('business.loads.f.cover') : ''].filter(Boolean);
      out.push([t('business.post.k.terms'), terms.join(' · ')]);
      if (form.truckFlight && form.flightAwb.trim() && form.flightNo.trim()) out.push([t('business.post.k.flight'), [form.flightAwb.trim(), t('business.post.v.flight', { no: form.flightNo.trim() }), form.flightAirline.trim()].filter(Boolean).join(' · ')]);
    } else if (s === 'day') {
      out.push([t('business.post.k.instructions'), form.instructions.trim()]);
      out.push([t('business.post.k.contact'), [form.contactName.trim(), form.contactPhone.trim()].filter(Boolean).join(' · ')]);
    }
    return out.filter((f): f is [string, string] => Boolean(f[1]));
  };

  const waits = waitsUntil(form, Boolean(contract), now?.getTime());
  const who = contract
    ? t('business.post.seeContract', { fleet: contract.fleetName, day: form.deliverOn })
    : t(waits ? 'business.post.seeBoardFrom' : 'business.post.seeBoardNow', { day: waits ?? '', how: t(form.commitMode === 'negotiate' ? 'business.post.howNegotiate' : 'business.post.howInstant') });

  return (
    <>
      {title}
      <p class="cons__lede">{t(contract ? 'business.post.l.checkContract' : 'business.post.l.check')}</p>
      {gaps.length ? <p class="cerr">{t('business.post.stillNeeds')}</p> : null}
      {steps
        .filter((s) => s !== 'check')
        .map((s) => {
          const rows = facts(s);
          const needs = gaps.filter((g) => gapStep(g) === s);
          return (
            <section class="biz-post__group" key={s} aria-labelledby={`biz-post-${s}`}>
              <div class="biz-post__grouphead">
                <h2 class="cons__panelt" id={`biz-post-${s}`}>
                  {t(STEP_NAME[s])}
                </h2>
                <button type="button" class="cbtn cbtn--ghost cbtn--sm" aria-label={t('business.post.changeAria', { part: t(STEP_NAME[s]) })} onClick={() => onChange(s)}>
                  {t('business.post.change')}
                </button>
              </div>
              {rows.length ? (
                <dl class="cons__facts">
                  {rows.map(([k, v]) => (
                    <div class="cons__fact" key={k}>
                      <dt class="cons__factk">{k}</dt>
                      <dd class="cons__factv">{v}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p class="chint">{t('business.post.nothingGiven')}</p>
              )}
              {needs.map((g) => (
                <p class="cerr" key={g}>
                  {t(gapWords(g) as MessageKey)}
                </p>
              ))}
            </section>
          );
        })}
      {/* Who will see it, in words, before the one button that sends it: nothing is shown to anybody until then. */}
      <section class="biz-post__who" aria-labelledby="biz-post-who">
        <h2 class="cons__panelt" id="biz-post-who">
          {t('business.post.whoTitle')}
        </h2>
        <p>{who}</p>
        {form.coverRequired ? <p>{t('business.post.seeCover')}</p> : null}
        {receiving ? <p>{t('business.post.seeReceiver', { name: receiving.name })}</p> : null}
        <p class="cnote">{t(contract ? 'business.loads.contractNote' : 'business.loads.settleNote')}</p>
      </section>
    </>
  );
}
