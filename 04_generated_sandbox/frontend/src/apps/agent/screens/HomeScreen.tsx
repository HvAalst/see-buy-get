import { useState } from 'preact/hooks';
import { Button, Card, ErrorNote, GlanceNumber, Icon, Note, Pill, ReadAloud, Sheet, type IconName } from '../../../shared/ui';
import { useT, type MessageKey } from '../../../shared/i18n';
import { toPlaceWords } from '../../../shared/placewords';
import { canAccept, gateNotice, homeSummary, money, statusNotice } from '../logic';
import type { AgentActions, AgentState, Screen } from '../useAgentApp';

export interface HomeScreenProps {
  state: AgentState;
  actions: AgentActions;
}

/** The counter jobs, in field-frequency order. Each is one row — one task per screen. */
const JOBS: Array<{ screen: Screen; icon: IconName; titleKey: MessageKey; subKey: MessageKey; gated?: boolean }> = [
  { screen: 'accept', icon: 'box', titleKey: 'agent.accept.title', subKey: 'agent.home.jobAcceptSub', gated: true },
  { screen: 'release', icon: 'person', titleKey: 'agent.release.title', subKey: 'agent.home.jobReleaseSub' },
  { screen: 'collect', icon: 'search', titleKey: 'agent.collect.title', subKey: 'agent.home.jobCollectSub' },
  { screen: 'handover', icon: 'truck', titleKey: 'agent.handover.title', subKey: 'agent.home.jobHandoverSub' },
  { screen: 'receivebag', icon: 'bag', titleKey: 'agent.receivebag.title', subKey: 'agent.home.jobReceiveBagSub' },
  { screen: 'void', icon: 'refresh', titleKey: 'agent.void.title', subKey: 'agent.home.jobVoidSub' },
  { screen: 'rates', icon: 'scale', titleKey: 'agent.rates.title', subKey: 'agent.home.jobRatesSub' },
  { screen: 'consignments', icon: 'bag', titleKey: 'agent.consignments.title', subKey: 'agent.home.jobConsignmentsSub' },
];

export function HomeScreen({ state, actions }: HomeScreenProps) {
  const t = useT();
  const [sheet, setSheet] = useState<'topup' | 'price' | 'close' | null>(null);
  const agent = state.agent;
  const gate = gateNotice(agent, state.gate, t);
  const onboarding = statusNotice(agent?.status, t);
  const open = agent?.openState !== 'closed';

  let walletSub: string | undefined;
  if (agent) {
    walletSub = t('agent.home.chargePer', { price: money(agent.pricePerParcel) });
    const r = agent.rating;
    if (r?.count) {
      walletSub +=
        ' · ' +
        (r.isNew
          ? r.count === 1
            ? t('agent.home.ratingNewOne', { count: r.count })
            : t('agent.home.ratingNewMany', { count: r.count })
          : t('agent.home.ratingRated', { avg: r.average.toFixed(1), count: r.count }));
    }
  }

  return (
    <div class="scr">
      {state.error ? <ErrorNote error={state.error} onRetry={actions.refresh} /> : null}

      {/* Money as the hero — the one number a shopkeeper runs the day on. */}
      <GlanceNumber
        label={t('agent.home.walletLabel')}
        value={money(agent?.balance)}
        sub={walletSub}
        aside={
          <Button variant="link" full={false} onClick={() => setSheet('topup')}>
            {t('agent.home.topUp')}
          </Button>
        }
      />

      {onboarding ? <Note tone="warn" icon="clock" title={t('agent.home.notActive')} detail={onboarding} /> : null}
      {gate ? <Note tone={gate.tone} icon={gate.tone === 'danger' ? 'lock' : 'wallet'} title={gate.title} detail={gate.detail} /> : null}

      <Card
        label={t('agent.home.yourShop')}
        aside={
          <Pill tone={open ? 'ok' : 'idle'} dot>
            {open ? t('agent.open') : t('agent.closed')}
          </Pill>
        }
      >
        <p class="t-body">{agent?.shopName ?? '…'}</p>
        <p class="card__note">{agent ? t('agent.zone', { zone: agent.zone }) : ''}</p>
        <div class="home__shopactions">
          <Button variant="link" full={false} onClick={() => (open ? setSheet('close') : void actions.setOpen(true))} busy={state.busy === 'open'}>
            {open ? t('agent.home.closeForNow') : t('agent.home.reopen')}
          </Button>
          <Button variant="link" full={false} onClick={() => setSheet('price')}>
            {t('agent.home.changePrice')}
          </Button>
          <Button variant="link" full={false} onClick={() => actions.go('shelf')}>
            {t('agent.home.shelfLink')}
          </Button>
        </div>
        {agent?.location ? (
          <>
            {/* The shop's three place words — what a customer with no street address is told.
                Put them on the sign; say them over the phone. */}
            <p class="words" style="margin-top:10px">
              {toPlaceWords(agent.location)}
            </p>
            <ReadAloud
              text={() => t('agent.home.wordsAloud', { words: toPlaceWords(agent.location!).split(' ').join(', ') })}
              label={t('agent.home.sayWords')}
            />
          </>
        ) : null}
      </Card>

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

      <div class="scr__foot">
        <ReadAloud text={() => homeSummary(state.agent, state.gate, t)} label={t('agent.readAloud')} />
        <Button variant="link" full={false} onClick={actions.signOut}>
          {t('agent.home.signOut')}
        </Button>
      </div>

      <TopUpSheet open={sheet === 'topup'} onClose={() => setSheet(null)} state={state} actions={actions} />
      <PriceSheet open={sheet === 'price'} onClose={() => setSheet(null)} state={state} actions={actions} />

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
        <input
          id="topup"
          class="input"
          type="number"
          inputMode="decimal"
          min="1"
          step="1"
          value={amount}
          onInput={(e) => setAmount(e.currentTarget.value)}
        />
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
        <input
          id="price"
          class="input"
          type="number"
          inputMode="decimal"
          min="0"
          step="0.05"
          value={price}
          onInput={(e) => setPrice(e.currentTarget.value)}
        />
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
