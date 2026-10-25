import { useEffect, useRef, useState } from 'preact/hooks';
import { AuthImage, Button, Card, ErrorNote, GlanceNumber, Icon, NeedsSignalNote, Note, Pill, PlaceMap, PushPrompt, ReadAloud, Sheet, TopUpCostNote, type IconName, PhoneField } from '../../../shared/ui';
import { capLine, type CustodyCapView } from '../../../shared/custodyCap';
import { formatDate, useT, type MessageKey } from '../../../shared/i18n';
import { fromPlaceWords, toPlaceWords } from '../../../shared/placewords';
import { canAccept, gateNotice, homeSummary, licenceNotice, licenceReady, money, papersReady, papersStep } from '../logic';
import { PhotoField } from './PhotoField';
import { PeopleSheet } from './PeopleSheet';
import type { AgentActions, AgentState, Screen } from '../useAgentApp';
import type { GeoPoint } from '../../../shared/geo';
import type { Weekday, WeeklyHours } from '../types';
import { useConnectivity } from '../../../shared/connectivity';
import { DeclarationCard } from '../../../shared/DeclarationCard';
import type { SbgClient } from '../../../lib/sbg';

export interface HomeScreenProps {
  state: AgentState;
  actions: AgentActions;
  /** Round 39 — for the security declaration, which the owner signs (never somebody at the counter). */
  sbg?: SbgClient | null;
}

/** The counter jobs, in field-frequency order. Each is one row — one task per screen. */
const JOBS: Array<{ screen: Screen; icon: IconName; titleKey: MessageKey; subKey: MessageKey; gated?: boolean; owner?: boolean }> = [
  { screen: 'accept', icon: 'box', titleKey: 'agent.accept.title', subKey: 'agent.home.jobAcceptSub', gated: true },
  { screen: 'release', icon: 'person', titleKey: 'agent.counter.title', subKey: 'agent.home.jobCounterSub' },
  { screen: 'handover', icon: 'truck', titleKey: 'agent.handover.title', subKey: 'agent.home.jobHandoverSub' },
  { screen: 'bag', icon: 'bag', titleKey: 'agent.bag.title', subKey: 'agent.home.jobBagSub' },
  { screen: 'receivebag', icon: 'bag', titleKey: 'agent.receivebag.title', subKey: 'agent.home.jobReceiveBagSub' },
  { screen: 'void', icon: 'refresh', titleKey: 'agent.void.title', subKey: 'agent.home.jobVoidSub' },
  // Round 35 — the tamper protocol: a parcel found cut or opened is held here and operations told.
  { screen: 'tamper', icon: 'warning', titleKey: 'agent.tamper.title', subKey: 'agent.home.jobTamperSub' },
  { screen: 'rates', icon: 'scale', titleKey: 'agent.rates.title', subKey: 'agent.home.jobRatesSub', owner: true },
  { screen: 'consignments', icon: 'bag', titleKey: 'agent.consignments.title', subKey: 'agent.home.jobConsignmentsSub' },
  // FB2b — answering a driver's price is occasional, not part of the daily counter loop, so it lives here
  // as a job rather than taking a fifth slot in the bottom nav. The badge above carries the urgency.
  { screen: 'freight', icon: 'truck', titleKey: 'agent.freight.title', subKey: 'agent.home.jobFreightSub', owner: true },
];

const DAYS: Array<{ key: Weekday; labelKey: MessageKey }> = [
  { key: 'mon', labelKey: 'agent.hours.day.mon' },
  { key: 'tue', labelKey: 'agent.hours.day.tue' },
  { key: 'wed', labelKey: 'agent.hours.day.wed' },
  { key: 'thu', labelKey: 'agent.hours.day.thu' },
  { key: 'fri', labelKey: 'agent.hours.day.fri' },
  { key: 'sat', labelKey: 'agent.hours.day.sat' },
  { key: 'sun', labelKey: 'agent.hours.day.sun' },
];

type SheetKind = 'topup' | 'price' | 'close' | 'photo' | 'location' | 'hours' | 'people' | null;

/**
 * The PUDO's operational cockpit (My shop). Action-first: shop identity + status at the top, the wallet the
 * day runs on, a live health strip (shelf occupancy + rating), then the counter jobs, then the shop settings —
 * each edited in its own slide-up sheet. Backed entirely by what the shop already exposes; the heavier
 * dashboard sections (staff, payouts, forecasts) are deliberately out of scope.
 */
export function HomeScreen({ state, actions, sbg }: HomeScreenProps) {
  const t = useT();
  const [sheet, setSheet] = useState<SheetKind>(null);
  const agent = state.agent;
  const gate = gateNotice(agent, state.gate, t);
  // Papers first, money after: a shop that is not approved yet is not told to top up to take a parcel in.
  const step = papersStep(agent);
  const awaitingApproval = step?.kind === 'send' || step?.kind === 'with_staff';
  const open = agent?.openState !== 'closed';
  // One of the shop's people at the counter: the owner's rows — money, prices, hours, people, papers — are not theirs.
  const staff = state.staff;

  // Refresh the shelf occupancy each time the cockpit is shown (Home re-mounts on navigation), so a bag just
  // received or a pickup just handed over shows the new free-slot count — not a stale first-mount snapshot.
  useEffect(() => {
    void actions.loadShelf();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shelf = state.shelf;
  const usedPct = shelf && shelf.capacity > 0 ? Math.round(((shelf.capacity - shelf.available) / shelf.capacity) * 100) : 0;
  const occTone = usedPct > 85 ? 'danger' : usedPct > 60 ? 'warn' : 'ok';

  const r = agent?.rating;
  const ratingText = r?.count ? (r.isNew ? t('agent.home.ratingNew') : r.average.toFixed(1)) : '—';

  return (
    <div class="scr">
      {state.error ? <ErrorNote error={state.error} onRetry={actions.refresh} /> : null}
      {/* Round 39 — the security declaration, while it asks for their hand: at joining, and every year. */}
      {state.staff ? null : <DeclarationCard sbg={sbg ?? null} />}
      {/* Round 40 — the trading licence, from thirty days before it runs out: the owner's to renew, never the counter's. */}
      {state.staff ? null : <Licence state={state} actions={actions} />}

      {/* Shop identity — photo + name + status. The photo taps through to its own sheet. */}
      <Card>
        <div class="shophead">
          {staff ? (
            <div class="shophead__photo">{agent?.shopfrontMediaId ? <AuthImage mediaId={agent.shopfrontMediaId} load={actions.loadMedia} alt={t('agent.home.photoAlt')} /> : <Icon name="home" size={26} />}</div>
          ) : (
            <button type="button" class="shophead__photo" onClick={() => setSheet('photo')} aria-label={agent?.shopfrontMediaId ? t('agent.home.changePhoto') : t('agent.home.addPhoto')}>
              {agent?.shopfrontMediaId ? (
                <AuthImage mediaId={agent.shopfrontMediaId} load={actions.loadMedia} alt={t('agent.home.photoAlt')} />
              ) : (
                <span class="shophead__placeholder">
                  <Icon name="camera" size={26} />
                  <span>{t('agent.home.addPhoto')}</span>
                </span>
              )}
            </button>
          )}
          <div class="shophead__body">
            <h1 class="shophead__name">{agent?.shopName ?? '…'}</h1>
            <p class="shophead__meta">{agent ? t('agent.zone', { zone: agent.zone }) : ''}</p>
            <Pill tone={open ? 'ok' : 'idle'} dot>{open ? t('agent.open') : t('agent.closed')}</Pill>
          </div>
        </div>
        <div class="home__shopactions">
          <Button variant="link" full={false} onClick={() => (open ? setSheet('close') : void actions.setOpen(true))} busy={state.busy === 'open'}>
            {open ? t('agent.home.closeForNow') : t('agent.home.reopen')}
          </Button>
        </div>
      </Card>

      {/* The money the day runs on — or, where we hold none for this shop, that fact. NULL is not an empty
          float: showing 0.00 and a Top up button there invites a top-up the network would have to refuse. */}
      {staff ? null : agent && agent.balance === null ? (
        <GlanceNumber label={t('agent.home.noFloat')} value="—" sub={t('agent.home.noFloatSub')} />
      ) : (
        <GlanceNumber
          label={t('agent.home.walletLabel')}
          value={money(agent?.balance, agent?.currency)}
          sub={agent ? t('agent.home.chargePer', { price: money(agent.pricePerParcel, agent.currency) }) : undefined}
          aside={
            <Button variant="link" full={false} onClick={() => setSheet('topup')}>
              {t('agent.home.topUp')}
            </Button>
          }
        />
      )}

      {/* Live health: shelf occupancy + rating. */}
      <div class="healthstrip">
        <div class="health">
          <span class="health__label">{t('agent.home.occupancyTitle')}</span>
          <div class="occbar" role="img" aria-label={t('agent.home.occupancyAria', { pct: usedPct })}>
            <span class={`occbar__fill occbar__fill--${occTone}`} style={`width:${usedPct}%`} />
          </div>
          <span class="health__sub">{shelf ? t('agent.home.occupancyLabel', { free: shelf.available, total: shelf.capacity }) : state.shelfState === 'error' ? t('agent.home.occupancyUnavailable') : t('agent.records.loadingShort')}</span>
        </div>
        <div class="health">
          <span class="health__label">{t('agent.home.ratingLabel')}</span>
          <span class="health__big">{ratingText}</span>
        </div>
      </div>

      {/* A TOP-UP STILL WAITING ON THE PROVIDER, said on the home screen and not only inside the sheet.
          "Why is my balance still low" is asked here, looking at the float — and the answer to it is the
          most useful sentence this screen can carry that day. */}
      {state.funding?.status === 'awaiting' ? (
        <button type="button" class="row" onClick={() => setSheet('topup')}>
          <span class="row__ic">
            <Icon name="clock" size={24} />
          </span>
          <span class="row__body">
            <span class="row__t">{t('agent.home.topUpWaitNote', { amount: money(state.funding.amount, state.funding.currency) })}</span>
            <span class="row__s">{t('agent.home.topUpWaitRow', { reference: state.funding.reference })}</span>
          </span>
          <span class="row__end">
            <Icon name="chevronRight" size={22} />
          </span>
        </button>
      ) : null}

      {/* The same ask as the store's, and for a sharper reason: a shopkeeper who has paid at a kiosk is
          standing at their own counter unable to scan, and the alternative to being told is refreshing. */}
      <PushPrompt
        api={actions.notifications}
        title={t('agent.push.title')}
        reason={t('agent.push.reason')}
        turnOn={t('agent.push.turnOn')}
        notNow={t('agent.push.notNow')}
        storageKey="glos-agent-push-asked"
      />

      {staff ? null : <Papers state={state} actions={actions} />}
      {/* Round 38 — a new shop's custody cap: what it holds, the most it may now, how it grows. A live fact, never dismissed. */}
      <CapNote view={state.custodyCap} />
      {gate ? <Note tone={gate.tone} icon={gate.tone === 'danger' ? 'lock' : gate.tone === 'info' ? 'clock' : 'wallet'} title={gate.title} detail={gate.detail} /> : null}

      {/* Quick actions — the counter jobs. */}
      <div class="rows" role="list">
        {JOBS.filter((j) => !(staff && j.owner)).map((j) => {
          const disabled = j.gated ? !canAccept(state.gate) : false;
          return (
            <button key={j.screen} type="button" class="row" disabled={disabled} onClick={() => actions.go(j.screen)}>
              <span class="row__ic">
                <Icon name={j.icon} size={24} />
              </span>
              <span class="row__body">
                <span class="row__t">{t(j.titleKey)}</span>
                <span class="row__s">{disabled ? t(awaitingApproval ? 'agent.home.approvalFirst' : 'agent.home.topUpFirst') : t(j.subKey)}</span>
              </span>
              <span class="row__end">
                {j.screen === 'handover' && state.shopParcels.length ? <span class="row__count">{state.shopParcels.length}</span> : null}
                <Icon name="chevronRight" size={22} />
              </span>
            </button>
          );
        })}
      </div>

      {/* Shop settings — each opens its own sheet (or the shelf screen). The owner's, all of them. */}
      {staff ? null : <Card title={t('agent.home.shopSettings')}>
        <div class="rows">
          <SettingRow icon="pin" title={t('agent.home.locationRow')} sub={t('agent.home.locationSub')} onClick={() => setSheet('location')} />
          <SettingRow icon="clock" title={t('agent.home.hoursRow')} sub={t('agent.home.hoursSub')} onClick={() => setSheet('hours')} />
          <SettingRow icon="scale" title={t('agent.home.changePrice')} sub={t('agent.home.priceSub', { price: money(agent?.pricePerParcel, agent?.currency) })} onClick={() => setSheet('price')} />
          <SettingRow icon="grid" title={t('agent.home.shelfLink')} sub={t('agent.home.shelfSub')} onClick={() => actions.go('shelf')} />
          <SettingRow icon="person" title={t('agent.people.row')} sub={t('agent.people.rowSub')} onClick={() => setSheet('people')} />
        </div>
      </Card>}

      {/* Help, "stop showing me this" and sign out moved to the account menu in the bar — they belong
          to the person, not to this screen. Read aloud stays: it reads out what is on THIS screen. */}
      <div class="scr__foot">
        <ReadAloud text={() => homeSummary(state.agent, state.gate, t)} label={t('agent.readAloud')} />
      </div>

      <TopUpSheet open={sheet === 'topup'} onClose={() => setSheet(null)} state={state} actions={actions} />
      <PriceSheet open={sheet === 'price'} onClose={() => setSheet(null)} state={state} actions={actions} />
      <PhotoSheet open={sheet === 'photo'} onClose={() => setSheet(null)} state={state} actions={actions} />
      <LocationSheet open={sheet === 'location'} onClose={() => setSheet(null)} state={state} actions={actions} />
      <HoursSheet open={sheet === 'hours'} onClose={() => setSheet(null)} state={state} actions={actions} />
      <PeopleSheet open={sheet === 'people'} onClose={() => setSheet(null)} api={actions.people} />

      <Sheet open={sheet === 'close'} onClose={() => setSheet(null)} title={t('agent.home.closeSheetTitle')}>
        <p class="t-body">{t('agent.home.closeSheetBody')}</p>
        <Button
          chevron={false}
          busy={state.busy === 'open'}
          onClick={() => {
            setSheet(null);
            void actions.setOpen(false);
          }}
        >
          {t('agent.home.closeConfirm')}
        </Button>
        <Button variant="link" onClick={() => setSheet(null)}>
          {t('agent.home.stayOpen')}
        </Button>
      </Sheet>
    </div>
  );
}

function SettingRow({ icon, title, sub, onClick }: { icon: IconName; title: string; sub: string; onClick: () => void }) {
  return (
    <button type="button" class="row" onClick={onClick}>
      <span class="row__ic"><Icon name={icon} size={24} /></span>
      <span class="row__body">
        <span class="row__t">{title}</span>
        <span class="row__s">{sub}</span>
      </span>
      <span class="row__end"><Icon name="chevronRight" size={22} /></span>
    </button>
  );
}

/**
 * TOP UP — WHICH IS ASKING TO PAY, NOT PAYING.
 *
 * This sheet used to take a number, close itself, and show "Balance topped up · Added 50.00". The money
 * had not moved and nobody outside the building had said it had: the shop's own word created the entry.
 * It now hands back a reference, and the sheet's job is to make that reference impossible to mistype and
 * to be honest about what happens next — the float changes when the payment provider confirms it.
 *
 * So the sheet has two faces. With a request waiting, it shows the reference and the rail's own words and
 * offers nothing else, because there is nothing else to do. With none, it asks for an amount.
 */
function TopUpSheet({ open, onClose, state, actions }: { open: boolean; onClose: () => void; state: AgentState; actions: AgentActions }) {
  const t = useT();
  const [amount, setAmount] = useState('50');
  const [phone, setPhone] = useState('');
  const value = Number(amount);
  // Asked of M-Pesa through SeeBuyGet: with no signal it is said here, and the button waits, rather than an error behind the sheet.
  const { online } = useConnectivity();
  // A float is paid into in the shop's company's money: the box says which, and so does the button.
  const currency = state.agent?.currency;
  const waiting = state.funding?.status === 'awaiting' ? state.funding : null;
  const refused = state.funding?.status === 'failed' ? state.funding : null;

  if (waiting) {
    return (
      <Sheet open={open} onClose={onClose} title={t(waiting.pushed ? 'agent.home.topUpPushTitle' : 'agent.home.topUpWaitTitle')}>
        {/*
         * TWO WAYS OF WAITING, AND THEY ASK DIFFERENT THINGS OF THE PERSON.
         *
         * A prompt is on their phone: the job is to pick it up and enter a PIN, and the biggest thing on
         * the sheet should say so. Nobody pushed anything: the job is to read a reference off this screen
         * and type it at a kiosk, and the reference is the biggest thing. Showing the wrong one leaves a
         * shopkeeper watching a handset that is never going to ring.
         */}
        <Note
          tone="info"
          icon={waiting.pushed ? 'keypad' : 'clock'}
          title={t(waiting.pushed ? 'agent.home.topUpPushNote' : 'agent.home.topUpWaitNote', { amount: money(waiting.amount, waiting.currency) })}
          detail={waiting.instructions}
        />
        <div class="field">
          <span class="field__label">{t(waiting.pushed ? 'agent.home.topUpReferenceAlso' : 'agent.home.topUpReference')}</span>
          <p class="payref">{waiting.reference}</p>
        </div>
        <p class="t-body">{t('agent.home.topUpWaitBody')}</p>
        <Button variant="outline" chevron={false} busy={state.refreshing} onClick={() => void actions.refresh()}>
          {t('agent.home.topUpCheck')}
        </Button>
        <Button variant="link" onClick={onClose}>
          {t('agent.home.notNow')}
        </Button>
      </Sheet>
    );
  }

  return (
    <Sheet open={open} onClose={onClose} title={t('agent.home.topUpTitle')}>
      <p class="t-body">{t('agent.home.topUpBody')}</p>
      {/* A prompt the payer answered "no" to, said in the provider's own words — because the next thing
          they will do is ask again, and "nothing happened" is not an answer they can act on. */}
      {refused?.failureReason ? <Note tone="warn" icon="clock" title={t('agent.home.topUpRefused')} detail={refused.failureReason} /> : null}
      <div class="field">
        <label class="field__label" for="topup">
          {currency ? t('agent.home.amountIn', { currency }) : t('agent.home.amount')}
        </label>
        <input id="topup" class="input" type="number" inputMode="decimal" min="1" step="1" value={amount} onInput={(e) => setAmount(e.currentTarget.value)} />
      </div>
      {/*
       * WHAT IT COSTS, HERE, WHERE THE AMOUNT IS BEING DECIDED.
       *
       * Directly under the box rather than by the button, because the threshold can only change what
       * somebody types while they are still typing it. Nothing at all renders where this sister charges
       * no fee, which is the default.
       */}
      <TopUpCostNote terms={state.topUpTerms} amount={value} risesBy={t('agent.home.topUpLands')} />
      {/*
       * THE NUMBER THE PROMPT GOES TO — typed, never read off the shop's record.
       *
       * The phone that pays is often not the one we have on file: a shopkeeper sends somebody to the
       * kiosk, the float is topped up from the owner's own line. And a PIN request landing on a handset
       * whose owner did not ask for it is the one thing worse than no prompt at all. Optional, because
       * the paybill has to keep working for everybody who has no phone to hand.
       */}
      <div class="field">
        <label class="field__label" for="topup-phone">
          {t('agent.home.topUpPhone')}
        </label>
        <PhoneField id="topup-phone" value={phone} onInput={(v) => setPhone(v)} />
        <p class="hint">{t('agent.home.topUpPhoneHint')}</p>
      </div>
      <NeedsSignalNote title={t('agent.home.topUpNeedsSignalTitle')} detail={t('agent.home.topUpNeedsSignalDetail')} />
      <Button
        chevron={false}
        busy={state.busy === 'topup'}
        disabled={!(value > 0) || !online}
        onClick={() => void actions.topUp(value, phone.trim() || undefined)}
      >
        {value > 0 ? t(phone.trim() ? 'agent.home.askAmountPush' : 'agent.home.askAmount', { amount: money(value, currency) }) : t('agent.home.addMoney')}
      </Button>
      <Button variant="link" onClick={onClose}>
        {t('agent.home.notNow')}
      </Button>
    </Sheet>
  );
}

function PriceSheet({ open, onClose, state, actions }: { open: boolean; onClose: () => void; state: AgentState; actions: AgentActions }) {
  const t = useT();
  // A number for the box to edit, not a sum said in words: no money beside it, no thousands separator.
  const [price, setPrice] = useState((Number(state.agent?.pricePerParcel) || 0).toFixed(2));
  const value = Number(price);
  return (
    <Sheet open={open} onClose={onClose} title={t('agent.home.priceTitle')}>
      <p class="t-body">{t('agent.home.priceBody')}</p>
      <div class="field">
        <label class="field__label" for="price">
          {state.agent?.currency ? t('agent.home.pricePerParcelIn', { currency: state.agent.currency }) : t('agent.home.pricePerParcel')}
        </label>
        <input id="price" class="input" type="number" inputMode="decimal" min="0" step="0.05" value={price} onInput={(e) => setPrice(e.currentTarget.value)} />
      </div>
      <Button
        chevron={false}
        busy={state.busy === 'price'}
        disabled={!(value >= 0)}
        onClick={() => {
          onClose();
          void actions.setPrice(Math.round(value * 100) / 100);
        }}
      >
        {t('agent.home.savePrice')}
      </Button>
      <Button variant="link" onClick={onClose}>
        {t('agent.home.keepPrice')}
      </Button>
    </Sheet>
  );
}

function PhotoSheet({ open, onClose, state, actions }: { open: boolean; onClose: () => void; state: AgentState; actions: AgentActions }) {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  const agent = state.agent;
  return (
    <Sheet open={open} onClose={onClose} title={t('agent.home.photoTitle')}>
      <div class="shopphoto">
        {agent?.shopfrontMediaId ? <AuthImage mediaId={agent.shopfrontMediaId} load={actions.loadMedia} alt={t('agent.home.photoAlt')} /> : <span class="shopphoto__empty"><Icon name="camera" size={30} /></span>}
      </div>
      <input
        ref={input}
        class="photo__input"
        type="file"
        accept="image/*"
        capture="environment"
        disabled={state.busy === 'shopfront'}
        onChange={(e) => {
          const f = e.currentTarget.files?.[0];
          e.currentTarget.value = '';
          if (f) void actions.saveShopfront(f);
        }}
      />
      <Button chevron={false} busy={state.busy === 'shopfront'} onClick={() => input.current?.click()}>
        {agent?.shopfrontMediaId ? t('agent.home.changePhoto') : t('agent.home.addPhoto')}
      </Button>
      <p class="hint" style="margin-top:6px">{t('agent.home.photoHint')}</p>
      <Button variant="link" onClick={onClose}>{t('agent.done')}</Button>
    </Sheet>
  );
}

function LocationSheet({ open, onClose, state, actions }: { open: boolean; onClose: () => void; state: AgentState; actions: AgentActions }) {
  const t = useT();
  const agent = state.agent;
  const [pin, setPin] = useState<GeoPoint | null>(agent?.location ?? null);
  const [wordsText, setWordsText] = useState('');
  const near = fromPlaceWords(wordsText);
  // Reset the working pin to the shop's current location each time the sheet opens.
  useEffect(() => {
    if (open) {
      setPin(agent?.location ?? null);
      setWordsText(''); // clear last time's lookup so the reference marker/button don't reopen stale
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const moved = pin && (pin.lat !== agent?.location?.lat || pin.lng !== agent?.location?.lng);
  return (
    <Sheet open={open} onClose={onClose} title={t('agent.loc.title')}>
      <PlaceMap
        label={t('agent.loc.mapLabel')}
        pins={[]}
        onDrop={(loc) => setPin(loc)}
        dropped={pin}
        reference={near}
      />

      <div class="field" style="margin-top:12px">
        <label class="field__label" for="loc-words">{t('agent.loc.wordsLabel')}</label>
        <input id="loc-words" class="input" value={wordsText} onInput={(e) => setWordsText(e.currentTarget.value)} placeholder="goldfox calmriver blueowl" autocapitalize="none" autocomplete="off" spellcheck={false} />
        {near ? (
          <Button variant="outline" chevron={false} onClick={() => setPin(near)}>{t('agent.loc.useWords')}</Button>
        ) : null}
      </div>

      {pin ? (
        <>
          <p class="card__note">{t('agent.loc.yourWords')}</p>
          <p class="words">{toPlaceWords(pin)}</p>
          <ReadAloud text={() => t('agent.loc.wordsAloud', { words: toPlaceWords(pin).split(' ').join(', ') })} label={t('agent.loc.sayWords')} />
        </>
      ) : (
        <p class="hint">{t('agent.loc.noPin')}</p>
      )}

      <div class="scr__cta">
        <Button
          chevron={false}
          disabled={!pin || !moved}
          busy={state.busy === 'location'}
          onClick={async () => {
            if (pin) {
              await actions.setLocationPin(pin.lat, pin.lng);
              onClose();
            }
          }}
        >
          {t('agent.loc.save')}
        </Button>
      </div>
      <Button variant="link" onClick={onClose}>{t('agent.done')}</Button>
    </Sheet>
  );
}

function HoursSheet({ open, onClose, state, actions }: { open: boolean; onClose: () => void; state: AgentState; actions: AgentActions }) {
  const t = useT();
  const agent = state.agent;
  const [draft, setDraft] = useState<WeeklyHours>({});
  // Load the current schedule each time the sheet opens.
  useEffect(() => {
    if (open) setDraft({ ...(agent?.openingHours ?? {}) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const setDay = (day: Weekday, value: { open: string; close: string } | null) => setDraft((d) => ({ ...d, [day]: value }));

  return (
    <Sheet open={open} onClose={onClose} title={t('agent.hours.title')}>
      <p class="hint">{t('agent.hours.hint')}</p>
      <div class="hours">
        {DAYS.map(({ key, labelKey }) => {
          const day = draft[key];
          const isOpen = Boolean(day);
          return (
            <div key={key} class="hoursrow">
              <span class="hoursrow__day">{t(labelKey)}</span>
              <label class="checkline hoursrow__toggle">
                <input type="checkbox" checked={isOpen} onChange={(e) => setDay(key, e.currentTarget.checked ? { open: '08:00', close: '18:00' } : null)} />
                <span>{isOpen ? t('agent.hours.open') : t('agent.hours.closed')}</span>
              </label>
              {isOpen ? (
                <div class="hoursrow__times">
                  <input class="input input--time" type="time" value={day!.open} aria-label={t('agent.hours.from')} onInput={(e) => setDay(key, { open: e.currentTarget.value, close: day!.close })} />
                  <span class="hoursrow__dash">–</span>
                  <input class="input input--time" type="time" value={day!.close} aria-label={t('agent.hours.to')} onInput={(e) => setDay(key, { open: day!.open, close: e.currentTarget.value })} />
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      <div class="scr__cta">
        <Button
          chevron={false}
          busy={state.busy === 'hours'}
          onClick={async () => {
            await actions.saveHours(draft as Record<string, { open: string; close: string } | null>);
            onClose();
          }}
        >
          {t('agent.hours.save')}
        </Button>
      </div>
      <Button variant="link" onClick={onClose}>{t('agent.done')}</Button>
    </Sheet>
  );
}

/** Round 38 — where this shop stands under its company's custody cap; nothing when none applies to it now. */
function CapNote({ view }: { view: CustodyCapView | null }) {
  const t = useT();
  const line = capLine(view, t);
  return line ? <Note tone={line.full ? 'warn' : 'info'} icon="info" title={line.title} detail={line.detail} /> : null;
}

/**
 * Round 40 — THE TRADING LICENCE (the user: "Expiry, notice, grace"): what the shop is told from thirty days before it runs out,
 * and the way to send the renewed one — a photo of it, and the date it runs to as written on it. Staff read it; until then the
 * date on record is the one that counts, and the card says the licence is with SeeBuyGet.
 */
function Licence({ state, actions }: HomeScreenProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [photo, setPhoto] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const notice = licenceNotice(state.agent, t, (iso) => formatDate(`${iso}T12:00:00Z`));
  if (!notice) return null;
  return (
    <>
      <Note tone={notice.tone} icon={notice.tone === 'info' ? 'check' : 'badge'} title={notice.title} detail={notice.detail} />
      {notice.send ? (
        <Button variant="outline" onClick={() => setOpen(true)}>
          {t('agent.licence.send')}
        </Button>
      ) : null}
      {open ? (
        <Sheet open onClose={() => setOpen(false)} title={t('agent.licence.send')}>
          <p class="t-body">{t('agent.licence.sheetBody')}</p>
          <PhotoField id="licence-renewed" value={photo} label={t('agent.licence.photo')} upload={(file) => actions.uploadPhoto('kyc_licence', file)} onCapture={setPhoto} />
          <div class="field">
            <label class="field__label" for="licence-until">
              {t('agent.licence.dateLabel')}
            </label>
            <input id="licence-until" class="input" type="date" value={expiresAt} onInput={(e) => setExpiresAt(e.currentTarget.value)} />
            <p class="hint" style="margin-top:8px">{t('agent.licence.dateHint')}</p>
          </div>
          <Button
            chevron={false}
            disabled={!licenceReady({ photo, expiresAt })}
            busy={state.busy === 'licence'}
            onClick={async () => {
              const sent = await actions.sendLicenceRenewal({ copyRef: photo, expiresAt });
              if (!sent) return;
              setOpen(false);
              setPhoto('');
              setExpiresAt('');
            }}
          >
            {t('agent.papers.submit')}
          </Button>
          <Button variant="link" onClick={() => setOpen(false)}>
            {t('agent.papers.notNow')}
          </Button>
        </Sheet>
      ) : null}
    </>
  );
}

/**
 * A SHOP THAT IS NOT YET APPROVED: what is wanted of it, and the way to send it.
 *
 * This is where a new shop used to read "Your shop is draft" and nothing else. Staff can only approve a shop that
 * has sent a copy of an ID, its trading licence and a photograph of the shop — and no screen sent them, so every
 * shop that signed up waited for an approval that could not come. (The courier's app had the same hole and the same
 * card: see Clearance there.)
 *
 * Papers with staff show that they are, and no button: sending them twice is not an action.
 */
function Papers({ state, actions }: HomeScreenProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [idCopy, setIdCopy] = useState('');
  const [licence, setLicence] = useState('');
  const [shopFront, setShopFront] = useState('');
  const step = papersStep(state.agent);
  if (!step) return null;

  if (step.kind === 'with_staff') return <Note tone="info" icon="check" title={t('agent.papers.pendingTitle')} detail={t('agent.papers.pendingBody')} />;
  if (step.kind === 'pay_in') return <Note tone="info" icon="wallet" title={t('agent.papers.approvedTitle')} detail={t('agent.papers.approvedBody')} />;

  return (
    <>
      {step.refusedWhy ? (
        <Note tone="danger" icon="warning" title={t('agent.papers.refusedTitle')} detail={t('agent.papers.refusedBody', { reason: step.refusedWhy })} />
      ) : (
        <Note tone="warn" icon="badge" title={t('agent.papers.needTitle')} detail={t('agent.papers.needBody')} />
      )}
      <Button variant="outline" onClick={() => setOpen(true)}>
        {t(step.refusedWhy ? 'agent.papers.sendAgain' : 'agent.papers.send')}
      </Button>

      {open ? (
        <Sheet open onClose={() => setOpen(false)} title={t('agent.papers.send')}>
          <p class="t-body">{t('agent.papers.sheetBody')}</p>
          <PhotoField id="papers-id" value={idCopy} label={t('agent.papers.idPhoto')} upload={(file) => actions.uploadPhoto('kyc_id', file)} onCapture={setIdCopy} />
          <PhotoField id="papers-licence" value={licence} label={t('agent.papers.licencePhoto')} upload={(file) => actions.uploadPhoto('kyc_licence', file)} onCapture={setLicence} />
          <PhotoField id="papers-shop" value={shopFront} label={t('agent.papers.shopPhoto')} upload={(file) => actions.uploadPhoto('shop', file)} onCapture={setShopFront} />
          <Button
            chevron={false}
            disabled={!papersReady({ idCopy, licence, shopFront })}
            busy={state.busy === 'papers'}
            onClick={async () => {
              const sent = await actions.sendPapers({ idCopyRef: idCopy, tradingLicenceRef: licence, shopPhotoRefs: [shopFront] });
              if (!sent) return;
              setOpen(false);
              setIdCopy('');
              setLicence('');
              setShopFront('');
            }}
          >
            {t('agent.papers.submit')}
          </Button>
          <Button variant="link" onClick={() => setOpen(false)}>
            {t('agent.papers.notNow')}
          </Button>
        </Sheet>
      ) : null}
    </>
  );
}
