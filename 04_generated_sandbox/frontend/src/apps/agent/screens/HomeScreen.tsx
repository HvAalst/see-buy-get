import { useState } from 'preact/hooks';
import { Button, Card, ErrorNote, GlanceNumber, Icon, Note, Pill, ReadAloud, Sheet, type IconName } from '../../../shared/ui';
import { toPlaceWords } from '../../../shared/placewords';
import { canAccept, gateNotice, homeSummary, money, statusNotice } from '../logic';
import type { AgentActions, AgentState, Screen } from '../useAgentApp';

export interface HomeScreenProps {
  state: AgentState;
  actions: AgentActions;
}

/** The counter jobs, in field-frequency order. Each is one row — one task per screen. */
const JOBS: Array<{ screen: Screen; icon: IconName; title: string; sub: string; gated?: boolean }> = [
  { screen: 'accept', icon: 'box', title: 'Take in a parcel', sub: 'A customer drops something off', gated: true },
  { screen: 'release', icon: 'person', title: 'Hand to a customer', sub: 'Verify the code and hand over' },
  { screen: 'collect', icon: 'search', title: 'Collect an order', sub: 'Release an online order to the buyer' },
  { screen: 'handover', icon: 'truck', title: 'Hand to the bus', sub: 'Give waiting parcels to the driver' },
  { screen: 'receivebag', icon: 'bag', title: 'Receive a bag', sub: 'A bus dropped a bag for your shop' },
  { screen: 'void', icon: 'refresh', title: 'Undo a drop-off', sub: 'Cancel a parcel you just took in' },
  { screen: 'rates', icon: 'scale', title: 'Prices near you', sub: 'See what nearby shops charge' },
];

export function HomeScreen({ state, actions }: HomeScreenProps) {
  const [sheet, setSheet] = useState<'topup' | 'price' | 'close' | null>(null);
  const agent = state.agent;
  const gate = gateNotice(agent, state.gate);
  const onboarding = statusNotice(agent?.status);
  const open = agent?.openState !== 'closed';

  return (
    <div class="scr">
      {state.error ? <ErrorNote error={state.error} onRetry={actions.refresh} /> : null}

      {/* Money as the hero — the one number a shopkeeper runs the day on. */}
      <GlanceNumber
        label="Money in your wallet"
        value={money(agent?.balance)}
        sub={
          agent
            ? `You charge ${money(agent.pricePerParcel)} per parcel${agent.rating?.count ? ` · rated ${agent.rating.average.toFixed(1)} by ${agent.rating.count}` : ''}`
            : undefined
        }
        aside={
          <Button variant="link" full={false} onClick={() => setSheet('topup')}>
            Top up
          </Button>
        }
      />

      {onboarding ? <Note tone="warn" icon="clock" title="Not active yet" detail={onboarding} /> : null}
      {gate ? <Note tone={gate.tone} icon={gate.tone === 'danger' ? 'lock' : 'wallet'} title={gate.title} detail={gate.detail} /> : null}

      <Card
        label="Your shop"
        aside={
          <Pill tone={open ? 'ok' : 'idle'} dot>
            {open ? 'Open' : 'Closed'}
          </Pill>
        }
      >
        <p class="t-body">{agent?.shopName ?? '…'}</p>
        <p class="card__note">{agent ? `Zone ${agent.zone}` : ''}</p>
        <div class="home__shopactions">
          <Button variant="link" full={false} onClick={() => (open ? setSheet('close') : void actions.setOpen(true))} busy={state.busy === 'open'}>
            {open ? 'Close for now' : 'Reopen the shop'}
          </Button>
          <Button variant="link" full={false} onClick={() => setSheet('price')}>
            Change my price
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
              text={() => `Your shop's three words are: ${toPlaceWords(agent.location!).split(' ').join(', ')}. Customers can find you with them.`}
              label="Say my three words"
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
                <span class="row__t">{j.title}</span>
                <span class="row__s">{disabled ? 'Top up your wallet first' : j.sub}</span>
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
        <ReadAloud text={() => homeSummary(state.agent, state.gate)} label="Read this aloud" />
        <Button variant="link" full={false} onClick={actions.signOut}>
          Sign out of this shop
        </Button>
      </div>

      <TopUpSheet open={sheet === 'topup'} onClose={() => setSheet(null)} state={state} actions={actions} />
      <PriceSheet open={sheet === 'price'} onClose={() => setSheet(null)} state={state} actions={actions} />

      <Sheet open={sheet === 'close'} onClose={() => setSheet(null)} title="Close the shop for now?">
        <p class="t-body">Customers and buses stop being sent here until you reopen. Parcels already on your shelf stay yours.</p>
        <Button
          chevron={false}
          busy={state.busy === 'open'}
          onClick={() => {
            setSheet(null);
            void actions.setOpen(false);
          }}
        >
          Yes, close for now
        </Button>
        <Button variant="link" onClick={() => setSheet(null)}>
          Stay open
        </Button>
      </Sheet>
    </div>
  );
}

function TopUpSheet({ open, onClose, state, actions }: { open: boolean; onClose: () => void; state: AgentState; actions: AgentActions }) {
  const [amount, setAmount] = useState('50');
  const value = Number(amount);
  return (
    <Sheet open={open} onClose={onClose} title="Top up your wallet">
      <p class="t-body">Every parcel you accept is paid from this wallet, and your earnings land back into it.</p>
      <div class="field">
        <label class="field__label" for="topup">
          Amount
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
        {value > 0 ? `Add ${value.toFixed(2)}` : 'Add money'}
      </Button>
      <Button variant="link" onClick={onClose}>
        Not now
      </Button>
    </Sheet>
  );
}

function PriceSheet({ open, onClose, state, actions }: { open: boolean; onClose: () => void; state: AgentState; actions: AgentActions }) {
  const [price, setPrice] = useState(money(state.agent?.pricePerParcel));
  const value = Number(price);
  return (
    <Sheet open={open} onClose={onClose} title="Your price per parcel">
      <p class="t-body">This is what senders pay your shop to handle a parcel. It is public — nearby shops compete on it.</p>
      <div class="field">
        <label class="field__label" for="price">
          Price per parcel
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
        Save the new price
      </Button>
      <Button variant="link" onClick={onClose}>
        Keep it as it is
      </Button>
    </Sheet>
  );
}
