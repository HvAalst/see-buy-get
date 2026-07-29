import { useState } from 'preact/hooks';
import { Button, Card, ErrorNote, PlaceMap, ReadAloud, Sheet } from '../../../shared/ui';
import { toPlaceWords } from '../../../shared/placewords';
import type { GeoPoint } from '../../../shared/geo';
import { money, policyLine } from '../logic';
import type { VendorActions, VendorState } from '../useVendorApp';

export interface StoreScreenProps {
  state: VendorState;
  actions: VendorActions;
}

/** The store's settings and books: split policy, callback wiring, settlement history. */
export function StoreScreen({ state, actions }: StoreScreenProps) {
  const [policyOpen, setPolicyOpen] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const v = state.vendor;
  const shownUrl = url ?? v?.callbackUrl ?? '';

  return (
    <div class="scr">
      {state.error ? <ErrorNote error={state.error} onRetry={() => actions.go('store')} /> : null}

      <Card label="Your store" aside={<b class="mono-t">{v?.vendorId}</b>}>
        <p class="t-body">{v?.name ?? '…'}</p>
        <p class="card__note">{v ? `${v.country}${v.address ? ` · ${v.address}` : ''}` : ''}</p>
      </Card>

      <Card title="What the buyer pays" aside={<Button variant="link" full={false} onClick={() => setPolicyOpen(true)}>Change</Button>}>
        <p class="t-body">{v ? policyLine(v.shippingPolicy) : ''}</p>
      </Card>

      <PinCard state={state} actions={actions} />

      <Card title="Status callbacks">
        <p class="card__note">SeeBuyGet signs every callback with your store secret — verify the signature before trusting one.</p>
        <div class="field" style="margin-top:8px">
          <label class="field__label" for="cb-url">
            Callback URL
          </label>
          <input id="cb-url" class="input" value={shownUrl} onInput={(e) => setUrl(e.currentTarget.value)} placeholder="https://store.example/hooks/sbg" autocapitalize="none" spellcheck={false} />
        </div>
        <div style="margin-top:12px">
          <Button chevron={false} full={false} busy={state.busy === 'callback'} disabled={url === null} onClick={() => void actions.saveCallback((url ?? '').trim())}>
            Save
          </Button>
        </div>
        {state.callbacks.length ? (
          <div style="margin-top:8px">
            {state.callbacks.slice(0, 6).map((c) => (
              <div key={c.id} class="kv">
                <span>{c.event}</span>
                <b>{new Date(c.at).toLocaleString()}</b>
              </div>
            ))}
          </div>
        ) : (
          <p class="hint" style="margin-top:8px">
            Nothing sent yet.
          </p>
        )}
      </Card>

      <Card title="Settlement book">
        {state.storeState === 'loading' ? <p class="hint">Getting the books…</p> : null}
        {state.settlement.length === 0 && state.storeState === 'ready' ? <p class="hint">No entries yet.</p> : null}
        {state.settlement.slice(0, 10).map((s) => (
          <div key={s.id} class="kv">
            <span>{`${s.type === 'TOP_UP' ? 'Top-up' : s.type === 'BILLING' ? 'Shipment' : 'Rebate'}${s.parcelId ? ` · ${s.parcelId}` : ''}`}</span>
            <b>{`${s.sign}${money(s.amount)}`}</b>
          </div>
        ))}
      </Card>

      <div class="scr__foot">
        <ReadAloud text={() => `Balance ${money(v?.balance)}. ${v ? policyLine(v.shippingPolicy) : ''}`} label="Read this aloud" />
        <Button variant="link" full={false} onClick={actions.signOut}>
          Sign out of this store
        </Button>
      </div>

      <PolicySheet open={policyOpen} onClose={() => setPolicyOpen(false)} state={state} actions={actions} />
    </div>
  );
}

/**
 * The store's map pin — the thing an address cannot be relied on to provide here. Tap
 * the map to move the pin; the three place words update with it, so the store can SAY
 * where it is (on the phone, in a listing) with no street name at all.
 */
function PinCard({ state, actions }: { state: VendorState; actions: VendorActions }) {
  const [draft, setDraft] = useState<GeoPoint | null>(null);
  const current = draft ?? state.vendor?.location ?? null;

  return (
    <Card title="Where your store is">
      <p class="card__note">Tap the map to drop the pin. The network's shops are shown for bearings.</p>
      <div style="margin-top:10px">
        <PlaceMap
          label="Your store's pin — tap the map to move it"
          pins={state.points.filter((p) => p.location).map((p) => ({ id: p.did, label: p.shopName, point: p.location! }))}
          onDrop={setDraft}
          dropped={draft}
          reference={draft ? null : state.vendor?.location ?? null}
        />
      </div>
      {current ? (
        <>
          <p class="words" style="margin-top:10px">
            {toPlaceWords(current)}
          </p>
          <ReadAloud text={() => `Your store's three words are: ${toPlaceWords(current).split(' ').join(', ')}.`} label="Say my three words" />
        </>
      ) : (
        <p class="hint" style="margin-top:10px">
          No pin yet — tap the map.
        </p>
      )}
      {draft ? (
        <div style="margin-top:10px">
          <Button chevron={false} full={false} busy={state.busy === 'location'} onClick={() => void actions.saveLocation(draft).then(() => setDraft(null))}>
            Save the pin
          </Button>
          <Button variant="link" full={false} onClick={() => setDraft(null)}>
            Undo
          </Button>
        </div>
      ) : null}
    </Card>
  );
}

function PolicySheet({ open, onClose, state, actions }: { open: boolean; onClose: () => void; state: VendorState; actions: VendorActions }) {
  const p = state.vendor?.shippingPolicy;
  const [mode, setMode] = useState<'full' | 'capped'>(p?.mode ?? 'capped');
  const [cap, setCap] = useState(String(p?.buyerContributionCap ?? 3));
  const [freeOver, setFreeOver] = useState(String(p?.freeOverSubtotal ?? 50));
  const [freightCap, setFreightCap] = useState(p?.maxTransportSpend != null ? String(p.maxTransportSpend) : '');

  return (
    <Sheet open={open} onClose={onClose} title="What the buyer pays">
      <div class="field">
        <label class="field__label" for="p-mode">
          Split
        </label>
        <select id="p-mode" class="select" value={mode} onChange={(e) => setMode(e.currentTarget.value as 'full' | 'capped')}>
          <option value="capped">Capped — you absorb most of it</option>
          <option value="full">Full — the buyer pays it all</option>
        </select>
      </div>
      {mode === 'capped' ? (
        <>
          <div class="field" style="margin-top:12px">
            <label class="field__label" for="p-cap">
              Buyer pays at most
            </label>
            <input id="p-cap" class="input" type="number" inputMode="decimal" min="0" step="0.5" value={cap} onInput={(e) => setCap(e.currentTarget.value)} />
          </div>
          <div class="field" style="margin-top:12px">
            <label class="field__label" for="p-free">
              Free for the buyer on orders over
            </label>
            <input id="p-free" class="input" type="number" inputMode="decimal" min="0" step="1" value={freeOver} onInput={(e) => setFreeOver(e.currentTarget.value)} />
          </div>
        </>
      ) : null}
      {/* S34c — the freight-spend cap applies to heavy (dedicated-freight) orders, independent of the buyer split. */}
      <div class="field" style="margin-top:12px">
        <label class="field__label" for="p-freight">
          Most you'll pay to ship a heavy order
        </label>
        <input id="p-freight" class="input" type="number" inputMode="decimal" min="0" step="1" placeholder="no limit" value={freightCap} onInput={(e) => setFreightCap(e.currentTarget.value)} />
        <p class="hint" style="margin-top:6px">A big order goes by dedicated freight at a live market rate. Leave blank for no limit; set a cap and it waits for a rate within it.</p>
      </div>
      <Button
        chevron={false}
        busy={state.busy === 'policy'}
        onClick={() => {
          onClose();
          void actions.savePolicy({ mode, buyerContributionCap: Number(cap) || 0, freeOverSubtotal: Number(freeOver) || 0, maxTransportSpend: freightCap.trim() ? Number(freightCap) || 0 : 0 });
        }}
      >
        Save the policy
      </Button>
      <Button variant="link" onClick={onClose}>
        Keep it as it is
      </Button>
    </Sheet>
  );
}
