import { useEffect, useRef, useState } from 'preact/hooks';
import { AuthImage, Button, Card, ErrorNote, GlanceNumber, Icon, Note, Pill, PlaceMap, ReadAloud, Sheet, type IconName } from '../../../shared/ui';
import { useT, type MessageKey } from '../../../shared/i18n';
import { fromPlaceWords, toPlaceWords } from '../../../shared/placewords';
import { canAccept, gateNotice, homeSummary, money, statusNotice } from '../logic';
import type { AgentActions, AgentState, Screen } from '../useAgentApp';
import type { GeoPoint } from '../../../shared/geo';
import type { Weekday, WeeklyHours } from '../types';

export interface HomeScreenProps {
  state: AgentState;
  actions: AgentActions;
}

/** The counter jobs, in field-frequency order. Each is one row — one task per screen. */
const JOBS: Array<{ screen: Screen; icon: IconName; titleKey: MessageKey; subKey: MessageKey; gated?: boolean }> = [
  { screen: 'accept', icon: 'box', titleKey: 'agent.accept.title', subKey: 'agent.home.jobAcceptSub', gated: true },
  { screen: 'release', icon: 'person', titleKey: 'agent.counter.title', subKey: 'agent.home.jobCounterSub' },
  { screen: 'handover', icon: 'truck', titleKey: 'agent.handover.title', subKey: 'agent.home.jobHandoverSub' },
  { screen: 'bag', icon: 'bag', titleKey: 'agent.bag.title', subKey: 'agent.home.jobBagSub' },
  { screen: 'receivebag', icon: 'bag', titleKey: 'agent.receivebag.title', subKey: 'agent.home.jobReceiveBagSub' },
  { screen: 'void', icon: 'refresh', titleKey: 'agent.void.title', subKey: 'agent.home.jobVoidSub' },
  { screen: 'rates', icon: 'scale', titleKey: 'agent.rates.title', subKey: 'agent.home.jobRatesSub' },
  { screen: 'consignments', icon: 'bag', titleKey: 'agent.consignments.title', subKey: 'agent.home.jobConsignmentsSub' },
  // FB2b — answering a driver's price is occasional, not part of the daily counter loop, so it lives here
  // as a job rather than taking a fifth slot in the bottom nav. The badge above carries the urgency.
  { screen: 'freight', icon: 'truck', titleKey: 'agent.freight.title', subKey: 'agent.home.jobFreightSub' },
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

type SheetKind = 'topup' | 'price' | 'close' | 'photo' | 'location' | 'hours' | null;

/**
 * The PUDO's operational cockpit (My shop). Action-first: shop identity + status at the top, the wallet the
 * day runs on, a live health strip (shelf occupancy + rating), then the counter jobs, then the shop settings —
 * each edited in its own slide-up sheet. Backed entirely by what the shop already exposes; the heavier
 * dashboard sections (staff, payouts, forecasts) are deliberately out of scope.
 */
export function HomeScreen({ state, actions }: HomeScreenProps) {
  const t = useT();
  const [sheet, setSheet] = useState<SheetKind>(null);
  const agent = state.agent;
  const gate = gateNotice(agent, state.gate, t);
  const onboarding = statusNotice(agent?.status, t);
  const open = agent?.openState !== 'closed';

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

      {/* Shop identity — photo + name + status. The photo taps through to its own sheet. */}
      <Card>
        <div class="shophead">
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

      {/* The money the day runs on. */}
      <GlanceNumber
        label={t('agent.home.walletLabel')}
        value={money(agent?.balance)}
        sub={agent ? t('agent.home.chargePer', { price: money(agent.pricePerParcel) }) : undefined}
        aside={
          <Button variant="link" full={false} onClick={() => setSheet('topup')}>
            {t('agent.home.topUp')}
          </Button>
        }
      />

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

      {onboarding ? <Note tone="warn" icon="clock" title={t('agent.home.notActive')} detail={onboarding} /> : null}
      {gate ? <Note tone={gate.tone} icon={gate.tone === 'danger' ? 'lock' : 'wallet'} title={gate.title} detail={gate.detail} /> : null}

      {/* Quick actions — the counter jobs. */}
      <div class="rows" role="list">
        {JOBS.map((j) => {
          const disabled = j.gated ? !canAccept(state.gate) : false;
          return (
            <button key={j.screen} type="button" class="row" disabled={disabled} onClick={() => actions.go(j.screen)}>
              <span class="row__ic">
                <Icon name={j.icon} size={24} />
              </span>
              <span class="row__body">
                <span class="row__t">{t(j.titleKey)}</span>
                <span class="row__s">{disabled ? t('agent.home.topUpFirst') : t(j.subKey)}</span>
              </span>
              <span class="row__end">
                {j.screen === 'handover' && state.shopParcels.length ? <span class="row__count">{state.shopParcels.length}</span> : null}
                <Icon name="chevronRight" size={22} />
              </span>
            </button>
          );
        })}
      </div>

      {/* Shop settings — each opens its own sheet (or the shelf screen). */}
      <Card title={t('agent.home.shopSettings')}>
        <div class="rows">
          <SettingRow icon="pin" title={t('agent.home.locationRow')} sub={t('agent.home.locationSub')} onClick={() => setSheet('location')} />
          <SettingRow icon="clock" title={t('agent.home.hoursRow')} sub={t('agent.home.hoursSub')} onClick={() => setSheet('hours')} />
          <SettingRow icon="scale" title={t('agent.home.changePrice')} sub={t('agent.home.priceSub', { price: money(agent?.pricePerParcel) })} onClick={() => setSheet('price')} />
          <SettingRow icon="grid" title={t('agent.home.shelfLink')} sub={t('agent.home.shelfSub')} onClick={() => actions.go('shelf')} />
        </div>
      </Card>

      <div class="scr__foot">
        <ReadAloud text={() => homeSummary(state.agent, state.gate, t)} label={t('agent.readAloud')} />
        <Button variant="link" full={false} onClick={actions.signOut}>
          {t('agent.home.signOut')}
        </Button>
      </div>

      <TopUpSheet open={sheet === 'topup'} onClose={() => setSheet(null)} state={state} actions={actions} />
      <PriceSheet open={sheet === 'price'} onClose={() => setSheet(null)} state={state} actions={actions} />
      <PhotoSheet open={sheet === 'photo'} onClose={() => setSheet(null)} state={state} actions={actions} />
      <LocationSheet open={sheet === 'location'} onClose={() => setSheet(null)} state={state} actions={actions} />
      <HoursSheet open={sheet === 'hours'} onClose={() => setSheet(null)} state={state} actions={actions} />

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

function TopUpSheet({ open, onClose, state, actions }: { open: boolean; onClose: () => void; state: AgentState; actions: AgentActions }) {
  const t = useT();
  const [amount, setAmount] = useState('50');
  const value = Number(amount);
  return (
    <Sheet open={open} onClose={onClose} title={t('agent.home.topUpTitle')}>
      <p class="t-body">{t('agent.home.topUpBody')}</p>
      <div class="field">
        <label class="field__label" for="topup">
          {t('agent.home.amount')}
        </label>
        <input id="topup" class="input" type="number" inputMode="decimal" min="1" step="1" value={amount} onInput={(e) => setAmount(e.currentTarget.value)} />
      </div>
      <Button
        chevron={false}
        busy={state.busy === 'topup'}
        disabled={!(value > 0)}
        onClick={() => {
          onClose();
          void actions.topUp(value);
        }}
      >
        {value > 0 ? t('agent.home.addAmount', { amount: value.toFixed(2) }) : t('agent.home.addMoney')}
      </Button>
      <Button variant="link" onClick={onClose}>
        {t('agent.home.notNow')}
      </Button>
    </Sheet>
  );
}

function PriceSheet({ open, onClose, state, actions }: { open: boolean; onClose: () => void; state: AgentState; actions: AgentActions }) {
  const t = useT();
  const [price, setPrice] = useState(money(state.agent?.pricePerParcel));
  const value = Number(price);
  return (
    <Sheet open={open} onClose={onClose} title={t('agent.home.priceTitle')}>
      <p class="t-body">{t('agent.home.priceBody')}</p>
      <div class="field">
        <label class="field__label" for="price">
          {t('agent.home.pricePerParcel')}
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
