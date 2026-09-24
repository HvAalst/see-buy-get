import { HelpLink } from '../../../shared/guide/HelpLink';
import { mdpConfig } from '../api';
import { ChangePasswordSheet } from '../../../shared/account/ChangePasswordSheet';
import { useState } from 'preact/hooks';
import { Button, Card, ErrorNote, ExplainerReset, ReadAloud, Sheet } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import { toPlaceWords } from '../../../shared/placewords';
import { bagLine, fillPercent, fillingBags, freeBags, homeSummary, money, swatchIndex, unsortedAt } from '../logic';
import type { MdpActions, MdpState } from '../useMdpApp';

export interface HomeScreenProps {
  state: MdpState;
  actions: MdpActions;
}

/**
 * The floor at a glance: four tiles (the one that matters — TO SORT — first and alert
 * when non-zero), the loose inbound pile, the outbound destination bags with their fill
 * bars, and the hub's open-data sort fee.
 */
export function HomeScreen({ state, actions }: HomeScreenProps) {
  const t = useT();
  const [priceOpen, setPriceOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const hub = state.hub;
  const unsorted = hub ? unsortedAt(state.inbound, hub.mdpId) : [];
  const filling = fillingBags(state.totes);
  const free = freeBags(state.totes);

  return (
    <div class="scr">
      {state.error ? <ErrorNote error={state.error} onRetry={actions.refresh} /> : null}

      <div class="tiles">
        <Tile value={unsorted.length} label={t('mdp.home.tileToSort')} alert={unsorted.length > 0} />
        <Tile value={filling.length} label={t('mdp.home.tileOutbound')} />
        <Tile value={free.length} label={t('mdp.home.tileEmpty')} />
        <Tile value={hub?.zones.length ?? 0} label={t('mdp.home.tileZones')} />
      </div>

      <Card
        title={t('mdp.home.inboundTitle')}
        aside={<span class="row__count">{unsorted.length}</span>}
      >
        {unsorted.length === 0 ? (
          <p class="hint">{t('mdp.home.nothingToSort')}</p>
        ) : (
          <div>
            {unsorted.slice(0, 8).map((p) => (
              <div key={p.parcelId} class="kv">
                <span class="mono">{p.parcelId}</span>
                <b>{`→ ${p.destZone}`}</b>
              </div>
            ))}
            {unsorted.length > 8 ? <p class="hint">{t('mdp.home.andMore', { count: unsorted.length - 8 })}</p> : null}
          </div>
        )}
        <div class="btnrow">
          <Button variant="outline" full={false} onClick={() => actions.go('drop')}>
            {t('mdp.home.dropBag')}
          </Button>
          <Button full={false} chevron={false} disabled={unsorted.length === 0 && state.queue.length === 0} onClick={() => actions.go('sort')}>
            {t('mdp.home.sortParcels')}
          </Button>
        </div>
      </Card>

      <Card title={t('mdp.home.outboundTitle')} aside={<span class="hint">{t('mdp.home.openFree', { open: filling.length, free: free.length })}</span>}>
        {filling.length === 0 ? (
          <p class="hint">{t('mdp.home.noBagsYet')}</p>
        ) : (
          <div class="bags">
            {filling.map((bag) => (
              <div key={bag.code} class="bagrow bagrow--static">
                <span class={`swatch swatch--${swatchIndex(bag.destinationNodeId)}`} aria-hidden="true" />
                <span class="bagrow__body">
                  <span class="bagrow__code">{bag.code}</span>
                  <span class="bagrow__dest">{bagLine(bag, t)}</span>
                  <span class="fillbar" role="progressbar" aria-valuenow={fillPercent(bag.unitsUsed)} aria-valuemin={0} aria-valuemax={100} aria-label={t('mdp.bagFillAria', { code: bag.code })}>
                    <span style={`width:${fillPercent(bag.unitsUsed)}%`} />
                  </span>
                </span>
              </div>
            ))}
          </div>
        )}
        <div class="btnrow">
          <Button full={false} chevron={false} disabled={filling.length === 0} onClick={() => actions.go('load')}>
            {t('mdp.home.loadBag')}
          </Button>
          <Button variant="outline" full={false} onClick={() => actions.go('newtote')}>
            {t('mdp.home.newTote')}
          </Button>
        </div>
      </Card>

      {hub?.location ? (
        <Card label={t('mdp.home.whereHub')}>
          {/* The hub's three place words — what a new driver is told, address or not. */}
          <p class="words">{toPlaceWords(hub.location)}</p>
          <ReadAloud
            text={() => t('mdp.home.hubWordsAloud', { words: toPlaceWords(hub.location!).split(' ').join(', ') })}
            label={t('mdp.home.sayWords')}
          />
        </Card>
      ) : null}

      <Card title={t('mdp.home.yourFee')} aside={<b class="mono">{money(hub?.pricePerParcel)}</b>}>
        <p class="card__note">{t('mdp.home.feeNote')}</p>
        <div class="btnrow">
          <Button variant="link" full={false} onClick={() => actions.go('rates')}>
            {t('mdp.home.feesNear')}
          </Button>
          <Button variant="link" full={false} onClick={() => setPriceOpen(true)}>
            {t('mdp.home.changeFee')}
          </Button>
        </div>
      </Card>

      <div class="scr__foot">
        <ReadAloud text={() => homeSummary(unsorted.length, filling.length, t)} label={t('mdp.readAloud')} />
        <HelpLink app="mdp" />
        <ExplainerReset who={state.hub?.did} />
        <Button variant="link" full={false} onClick={() => setPasswordOpen(true)}>
          {t('mdp.home.changePassword')}
        </Button>
        <Button variant="link" full={false} onClick={actions.signOut}>
          {t('mdp.home.signOut')}
        </Button>
      </div>

      <PriceSheet open={priceOpen} onClose={() => setPriceOpen(false)} state={state} actions={actions} />
      <ChangePasswordSheet open={passwordOpen} onClose={() => setPasswordOpen(false)} config={mdpConfig()} email={actions.readEmail()} onChanged={actions.adoptToken} />
    </div>
  );
}

function Tile({ value, label, alert }: { value: number; label: string; alert?: boolean }) {
  return (
    <div class={`tile${alert ? ' tile--alert' : ''}`}>
      <span class="tile__v">{value}</span>
      <span class="tile__l">{label}</span>
    </div>
  );
}

function PriceSheet({ open, onClose, state, actions }: { open: boolean; onClose: () => void; state: MdpState; actions: MdpActions }) {
  const t = useT();
  const [price, setPrice] = useState(money(state.hub?.pricePerParcel));
  const value = Number(price);
  return (
    <Sheet open={open} onClose={onClose} title={t('mdp.home.feeSheetTitle')}>
      <p class="t-body">{t('mdp.home.feeSheetBody')}</p>
      <div class="field">
        <label class="field__label" for="fee">
          {t('mdp.home.feeSheetLabel')}
        </label>
        <input
          id="fee"
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
        {t('mdp.home.feeSheetSave')}
      </Button>
      <Button variant="link" onClick={onClose}>
        {t('mdp.home.feeSheetKeep')}
      </Button>
    </Sheet>
  );
}
