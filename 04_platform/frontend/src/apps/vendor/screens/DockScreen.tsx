import { useState } from 'preact/hooks';
import { BagCloseFields } from '../../../shared/BagSealFields';
import { closeReady, closureBody, EMPTY_BAG_CLOSE, type BagCloseForm } from '../../../shared/bagSeal';
import { Button, Card, ErrorNote, Explainer, GlanceNumber, Note, PlaceMap, Sheet } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import { dockBlockers, stagingTone } from '../logic';
import type { VendorActions, VendorState } from '../useVendorApp';
import { HubHandIn } from './HubHandIn';

/**
 * The store's own dock — the screen for a capability that has been backend-complete and invisible.
 *
 * Two screens in one, because a store is in one of two states and the second only exists after a decision:
 *
 *  - NO DOCK: an explanation and an offer. This half matters most. The dock has existed for months and no
 *    merchant could discover it, so the empty state has to sell the idea, not just host a form.
 *  - A DOCK: the day's bagging work — what is waiting, grouped by where it is going, the bags on the floor,
 *    and how much floor is left.
 */
export function DockScreen({ state, actions }: { state: VendorState; actions: VendorActions }) {
  const dock = state.vendor?.collection;
  // Reading B — the other way parcels leave the store: brought to a hub in bulk. A store with a dock of its own works that
  // first. One without leads with the hub where it has parcels or arrivals there — the screen's title is then the hub's,
  // and the offer of a dock follows; otherwise the offer leads, and the hub's short line follows it.
  const [hubWork, setHubWork] = useState(false);
  const hubFirst = !dock && hubWork;
  const hub = <HubHandIn key="hub" api={actions.hubs} vendorId={state.vendor?.vendorId ?? null} onWork={setHubWork} onMoney={() => void actions.refresh()} lead={hubFirst} />;
  const offer = <DockOffer key="offer" state={state} actions={actions} lead={!hubFirst} />;
  return (
    <div class="scr">
      {state.error ? <ErrorNote error={state.error} onRetry={() => void actions.loadDock()} /> : null}
      {dock ? <DockWork state={state} actions={actions} /> : null}
      {dock ? hub : hubFirst ? [hub, offer] : [offer, hub]}
    </div>
  );
}

/* ------------------------------------------------------------------ no dock -- */

/**
 * What a dock IS, in the terms a merchant weighs it in — a saved trip and one handover fewer — and the
 * things it is not, stated plainly so nobody enables it expecting a shop counter.
 */
function DockOffer({ state, actions, lead = true }: { state: VendorState; actions: VendorActions; lead?: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [zone, setZone] = useState('');
  const [bays, setBays] = useState('2');
  // Starts at the storefront pin, which is usually close and always a better start than nothing — but it is
  // editable, because the loading door is not the shop window.
  const [point, setPoint] = useState<{ lat: number; lng: number } | null>(state.vendor?.location ?? null);

  const blockers = dockBlockers({ label, zone, point, bays }, t);

  return (
    <>
      {lead ? <h1 class="scr__title">{t('vendor.dock.offerTitle')}</h1> : <h2 class="scr__section">{t('vendor.dock.offerTitle')}</h2>}
      <Explainer who={state.vendor?.did} id="vendor.dock.how" text={t('vendor.dock.offerLede')} />

      <Card title={t('vendor.dock.whatTitle')}>
        <ul class="bullets">
          <li>{t('vendor.dock.what1')}</li>
          <li>{t('vendor.dock.what2')}</li>
          <li>{t('vendor.dock.what3')}</li>
        </ul>
        {/* The limits sit on the same card as the benefits rather than buried below them — a dock is
            outbound only, and a store that enabled it expecting returns would find out from a driver. */}
        <p class="card__note">{t('vendor.dock.notNote')}</p>
      </Card>

      <div class="scr__cta">
        <Button onClick={() => setOpen(true)}>{t('vendor.dock.setUp')}</Button>
      </div>

      <Sheet open={open} onClose={() => setOpen(false)} title={t('vendor.dock.setUp')}>
        <div class="field">
          <label class="field__label" for="dock-label">
            {t('vendor.dock.labelLabel')}
          </label>
          <input id="dock-label" class="input" value={label} onInput={(e) => setLabel(e.currentTarget.value)} placeholder={t('vendor.dock.labelPlaceholder')} />
          <p class="card__note">{t('vendor.dock.labelNote')}</p>
        </div>

        <div class="field" style="margin-top:12px">
          <label class="field__label" for="dock-zone">
            {t('vendor.dock.zoneLabel')}
          </label>
          <input id="dock-zone" class="input" value={zone} onInput={(e) => setZone(e.currentTarget.value)} />
          <p class="card__note">{t('vendor.dock.zoneNote')}</p>
        </div>

        <div class="field" style="margin-top:12px">
          <label class="field__label" for="dock-bays">
            {t('vendor.dock.baysLabel')}
          </label>
          <input id="dock-bays" class="input" type="number" min="1" inputMode="numeric" value={bays} onInput={(e) => setBays(e.currentTarget.value)} />
          <p class="card__note">{t('vendor.dock.baysNote')}</p>
        </div>

        <div class="field" style="margin-top:12px">
          <span class="field__label">{t('vendor.dock.pinLabel')}</span>
          <p class="card__note">{t('vendor.dock.pinNote')}</p>
          <div style="margin-top:10px">
            <PlaceMap
              label={t('vendor.dock.pinMapLabel')}
              pins={state.points.filter((p) => p.location).map((p) => ({ id: p.did, label: p.shopName, point: p.location! }))}
              onDrop={setPoint}
              dropped={point}
              // The storefront pin orients the map without claiming to BE the answer: the loading door is
              // usually near it and almost never on it.
              reference={point ? null : (state.vendor?.location ?? null)}
            />
          </div>
        </div>

        <div class="scr__cta">
          <Button
            disabled={Boolean(blockers)}
            busy={state.busy === 'dock-enable'}
            onClick={() => {
              if (blockers || !point) return;
              void actions.enableDock({ label: label.trim(), zone: zone.trim(), location: point, bays: Number(bays) });
              setOpen(false);
            }}
          >
            {t('vendor.dock.enable')}
          </Button>
          {blockers ? <p class="hint" style="margin-top:8px">{blockers}</p> : null}
        </div>
      </Sheet>
    </>
  );
}

/* ------------------------------------------------------------ the day's work -- */

function DockWork({ state, actions }: { state: VendorState; actions: VendorActions }) {
  const t = useT();
  const dock = state.vendor!.collection!;
  const plan = state.dock;
  // Round 36 — the bag being closed for the road, and how.
  const [closingBag, setClosingBag] = useState<string | null>(null);
  const [closing, setClosing] = useState<BagCloseForm>(EMPTY_BAG_CLOSE);
  // 'idle' counts as loading: this loads after mount, and flashing "nothing to bag" at a store with a full
  // floor would be worse than a moment of nothing (the register epic's lesson).
  const loading = state.dockState === 'idle' || state.dockState === 'loading';

  if (loading && !plan) return <p class="hint">{t('vendor.dock.loading')}</p>;
  if (!plan) return null;

  const { staging } = plan;
  return (
    <>
      <h1 class="scr__title">{dock.label}</h1>
      <p class="scr__lede">{t('vendor.dock.workLede', { zone: dock.zone })}</p>

      {/* The floor as one figure and its bar: how much of the room the store DECLARED is in use. `alert`
          turns it red only when genuinely full, never merely busy — two bays with one bag is 50% and not a
          problem, and colouring that would teach the store to ignore the colour. */}
      <GlanceNumber
        value={staging.used}
        label={t('vendor.dock.onFloor')}
        percent={staging.capacity > 0 ? Math.round((staging.used / staging.capacity) * 100) : 0}
        sub={t('vendor.dock.floorSub', { used: String(staging.used), capacity: String(staging.capacity), free: String(staging.free) })}
        alert={stagingTone(staging) === 'warn'}
      />

      {/* A full floor is a real refusal rather than a warning — openDockBag rejects — so it is said before
          the store taps, not after. */}
      {staging.free === 0 ? <Note tone="warn" icon="warning" title={t('vendor.dock.fullTitle')} detail={t('vendor.dock.fullDetail', { n: String(staging.capacity) })} /> : null}

      <Card title={t('vendor.dock.waitingTitle')}>
        {plan.groups.length === 0 ? (
          <p class="card__note">{t('vendor.dock.nothingWaiting')}</p>
        ) : (
          plan.groups.map((g) => (
            <div key={g.key} class="dockrow">
              <div class="dockrow__text">
                <span class="dockrow__label">{g.label}</span>
                <span class="dockrow__sub">{t('vendor.dock.parcelsWaiting', { n: String(g.parcelIds.length) })}</span>
              </div>
              {g.openBagCode ? (
                <Button
                  variant="outline"
                  busy={g.parcelIds.some((id) => state.busy === `dock-fill-${id}`)}
                  onClick={() => {
                    const next = g.parcelIds[0];
                    if (next) void actions.fillDockBag(g.openBagCode!, next);
                  }}
                >
                  {t('vendor.dock.addOne')}
                </Button>
              ) : (
                <Button
                  variant="outline"
                  disabled={staging.free === 0}
                  busy={state.busy === `dock-open-${g.key}`}
                  onClick={() => void actions.openDockBag(g.key)}
                >
                  {t('vendor.dock.openBag')}
                </Button>
              )}
            </div>
          ))
        )}
      </Card>

      <Card title={t('vendor.dock.bagsTitle')}>
        {plan.bags.length === 0 ? (
          <p class="card__note">{t('vendor.dock.noBags')}</p>
        ) : (
          plan.bags.map((b) => (
            <div key={b.code} class="dockrow">
              <div class="dockrow__text">
                <span class="dockrow__label">{b.destinationLabel || b.code}</span>
                <span class="dockrow__sub">{t('vendor.dock.bagSub', { code: b.code, n: String(b.parcels), pct: String(b.fillPct) })}</span>
              </div>
              <Button variant="outline" disabled={b.parcels === 0} busy={state.busy === `dock-seal-${b.code}`} onClick={() => setClosingBag(b.code)}>
                {t('vendor.dock.seal')}
              </Button>
            </div>
          ))
        )}
        {/* Sealing is the store's own act and the only thing that publishes a bag. Said here because a
            store waiting on a driver who was never told is the failure this sentence prevents. */}
        <p class="card__note">{t('vendor.dock.sealNote')}</p>
      </Card>

      {/* Round 36 — closed for the road: a coded seal (suggested) with its number and a photograph, or a photograph alone. */}
      <Sheet open={closingBag !== null} onClose={() => setClosingBag(null)} title={t('vendor.dock.closeTitle', { code: closingBag ?? '' })}>
        {closingBag ? (
          <>
            <BagCloseFields id="dock-close" value={closing} onChange={setClosing} upload={(f) => actions.uploadSealPhoto(f)} disabled={state.busy === `dock-seal-${closingBag}`} />
            <Button
              chevron={false}
              busy={state.busy === `dock-seal-${closingBag}`}
              disabled={!closeReady(closing)}
              onClick={async () => {
                if (await actions.sealDockBag(closingBag, { closure: closureBody(closing) })) {
                  setClosingBag(null);
                  setClosing(EMPTY_BAG_CLOSE);
                }
              }}
            >
              {t('vendor.dock.seal')}
            </Button>
            <Button variant="link" onClick={() => setClosingBag(null)}>
              {t('vendor.dock.closeCancel')}
            </Button>
          </>
        ) : null}
      </Sheet>

      <div class="scr__foot">
        <Button variant="link" busy={state.busy === 'dock-disable'} onClick={() => void actions.disableDock()}>
          {t('vendor.dock.stop')}
        </Button>
        <p class="card__note">{t('vendor.dock.stopNote')}</p>
      </div>
    </>
  );
}
