import { useState } from 'preact/hooks';
import { Button, Card, ErrorNote, Note, PhotoField, ReadAloud, Sheet } from '../../../shared/ui';
import { OpensSoonNote } from '../../../shared/opening/OpensSoonNote';
import { useT } from '../../../shared/i18n';
import { toPlaceWords } from '../../../shared/placewords';
import { bagLine, fillPercent, fillingBags, floorOpen, freeBags, homeSummary, hubPapersStep, money, swatchIndex, unsortedAt } from '../logic';
import type { MdpActions, MdpState } from '../useMdpApp';
import { PeopleSheet } from '../../agent/screens/PeopleSheet';
import { HUB_PEOPLE_WORDS } from '../staffWords';
import { DeclarationCard } from '../../../shared/DeclarationCard';
import type { SbgClient } from '../../../lib/sbg';
import { HubReachCard } from './HubReachCard';
import { CarriersCard } from './CarriersCard';

export interface HomeScreenProps {
  state: MdpState;
  actions: MdpActions;
  /** Round 39 — for the security declaration, which the hub's owner signs. */
  sbg?: SbgClient | null;
}

/**
 * A HUB NOT YET APPROVED (the ISO 28000 check: "hubs are vetted"): what is wanted of it, and the way to send it — the
 * shop's papers card, in a hub's words. Papers with staff show that they are, and no button: sending them twice is not an
 * action. The hub's people are told whose move it is; the papers are the owner's, signed in as the hub.
 */
function HubPapers({ state, actions }: HomeScreenProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [idCopy, setIdCopy] = useState('');
  const [licence, setLicence] = useState('');
  const [premises, setPremises] = useState('');
  const step = hubPapersStep(state.hub);
  if (!step) return null;
  if (step.kind === 'with_staff') return <Note tone="info" icon="check" title={t('mdp.papers.pendingTitle')} detail={t('mdp.papers.pendingBody')} />;
  if (state.staff) return <Note tone="warn" icon="badge" title={t('mdp.papers.notYetTitle')} detail={t('mdp.papers.staffBody')} />;

  return (
    <>
      {step.refusedWhy ? (
        <Note tone="danger" icon="warning" title={t('mdp.papers.refusedTitle')} detail={t('mdp.papers.refusedBody', { reason: step.refusedWhy })} />
      ) : (
        <Note tone="warn" icon="badge" title={t('mdp.papers.needTitle')} detail={t('mdp.papers.needBody')} />
      )}
      <Button variant="outline" onClick={() => setOpen(true)}>
        {t(step.refusedWhy ? 'mdp.papers.sendAgain' : 'mdp.papers.send')}
      </Button>

      {open ? (
        <Sheet open onClose={() => setOpen(false)} title={t('mdp.papers.send')}>
          <p class="t-body">{t('mdp.papers.sheetBody')}</p>
          <PhotoField id="papers-id" value={idCopy} label={t('mdp.papers.idPhoto')} upload={(file) => actions.uploadPhoto(file, 'kyc_id')} onCapture={setIdCopy} />
          <PhotoField id="papers-licence" value={licence} label={t('mdp.papers.licencePhoto')} upload={(file) => actions.uploadPhoto(file, 'kyc_licence')} onCapture={setLicence} />
          <PhotoField id="papers-premises" value={premises} label={t('mdp.papers.premisesPhoto')} upload={(file) => actions.uploadPhoto(file, 'shop')} onCapture={setPremises} />
          <Button
            chevron={false}
            disabled={!(idCopy && licence && premises)}
            busy={state.busy === 'papers'}
            onClick={async () => {
              const sent = await actions.sendPapers({ idCopyRef: idCopy, licenceRef: licence, photoRefs: [premises] });
              if (!sent) return;
              setOpen(false);
              setIdCopy('');
              setLicence('');
              setPremises('');
            }}
          >
            {t('mdp.papers.submit')}
          </Button>
          <Button variant="link" onClick={() => setOpen(false)}>
            {t('mdp.papers.notNow')}
          </Button>
        </Sheet>
      ) : null}
    </>
  );
}

/**
 * The floor at a glance: four tiles (the one that matters — TO SORT — first and alert
 * when non-zero), the loose inbound pile, the outbound destination bags with their fill
 * bars, and the hub's open-data sort fee.
 */
export function HomeScreen({ state, actions, sbg }: HomeScreenProps) {
  const t = useT();
  const [priceOpen, setPriceOpen] = useState(false);
  const [peopleOpen, setPeopleOpen] = useState(false);
  const hub = state.hub;
  const unsorted = hub ? unsortedAt(state.inbound, hub.mdpId) : [];
  const filling = fillingBags(state.totes);
  const free = freeBags(state.totes);
  // Not yet approved: the floor is shut (the server refuses the work), so the papers stand where the floor would.
  const open = floorOpen(hub);

  return (
    <div class="scr">
      {state.error ? <ErrorNote error={state.error} onRetry={actions.refresh} /> : null}
      {/* Signed up before its country opened (COMING, 2026-10-25): why the floor does nothing yet, and when it will. */}
      <OpensSoonNote country={hub?.country} detail={t('opening.hub')} />
      {/* Round 39 — the security declaration, while it asks for their hand: at joining, and every year. */}
      {state.staff ? null : <DeclarationCard sbg={sbg ?? null} />}

      {hub && !open ? <HubPapers state={state} actions={actions} /> : null}

      {open ? (
      <>
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
      </>
      ) : null}

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

      {/* When the hub is open and how to reach it: what drivers and stores working with it see; its owner writes it. */}
      <HubReachCard sbg={sbg ?? null} mdpId={hub?.mdpId} staff={Boolean(state.staff)} />

      {/* What it moves bags on to other hubs (D11): its pallets, cages and crates; what each holds is worked out. */}
      <CarriersCard sbg={sbg ?? null} mdpId={hub?.mdpId} staff={Boolean(state.staff)} />

      {/* The hub's people work the floor; its fee and its people are the owner's (the server refuses them those doors). */}
      {state.staff ? null : (
        <Card title={t('mdp.people.row')}>
          <p class="card__note">{t('mdp.people.rowSub')}</p>
          <Button variant="link" full={false} onClick={() => setPeopleOpen(true)}>
            {t('mdp.people.open')}
          </Button>
        </Card>
      )}
      {state.staff ? null : (
      <Card title={t('mdp.home.yourFee')} aside={<b class="mono">{money(hub?.pricePerParcel, hub?.currency)}</b>}>
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
      )}

      <div class="scr__foot">
        <ReadAloud text={() => homeSummary(unsorted.length, filling.length, t)} label={t('mdp.readAloud')} />

        <Button variant="link" full={false} onClick={actions.signOut}>
          {t('mdp.home.signOut')}
        </Button>
      </div>

      <PriceSheet open={priceOpen} onClose={() => setPriceOpen(false)} state={state} actions={actions} />
      <PeopleSheet open={peopleOpen} onClose={() => setPeopleOpen(false)} api={actions.people} words={HUB_PEOPLE_WORDS} statePrefix="mdp.people.state" />
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
  // A number for the box to edit, not a sum said in words: no money beside it, no thousands separator.
  const [price, setPrice] = useState((Number(state.hub?.pricePerParcel) || 0).toFixed(2));
  const value = Number(price);
  return (
    <Sheet open={open} onClose={onClose} title={t('mdp.home.feeSheetTitle')}>
      <p class="t-body">{t('mdp.home.feeSheetBody')}</p>
      <div class="field">
        <label class="field__label" for="fee">
          {state.hub?.currency ? t('mdp.home.feeSheetLabelIn', { currency: state.hub.currency }) : t('mdp.home.feeSheetLabel')}
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
