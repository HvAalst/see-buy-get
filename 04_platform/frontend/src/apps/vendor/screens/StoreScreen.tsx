import { CredentialAge } from '../../../shared/account/CredentialAge';
import { useEffect, useState } from 'preact/hooks';
import { Button, Card, ErrorNote, Info, Note, PlaceMap, ReadAloud, Sheet, ShopDetailSheet } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import { toPlaceWords } from '../../../shared/placewords';
import type { GeoPoint } from '../../../shared/geo';
import type { SbgError } from '../../../lib/sbg';
import { callbackLine, insurerLine, ledgerTypeWord, money, policyLine } from '../logic';
import type { VendorActions, VendorState } from '../useVendorApp';
import { CallbacksInfo, callbacksAloud } from './CallbacksInfo';
import { Gs1Card } from './Gs1Card';

export interface StoreScreenProps {
  state: VendorState;
  actions: VendorActions;
}

/** The store's settings and books: split policy, callback wiring, settlement history. */
export function StoreScreen({ state, actions }: StoreScreenProps) {
  const t = useT();
  const [policyOpen, setPolicyOpen] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const v = state.vendor;
  const shownUrl = url ?? v?.callbackUrl ?? '';
  // The code tick box answers at once and settles on what the server says once the store record reloads.
  const [codeOn, setCodeOn] = useState<boolean | null>(null);
  const [allMessages, setAllMessages] = useState(false);
  useEffect(() => setCodeOn(null), [v?.callbackCarriesCode]);

  return (
    <div class="scr">
      {state.error ? <ErrorNote error={state.error} onRetry={() => actions.go('store')} /> : null}

      <Card title={t('vendor.store.yourStore')} aside={<b class="mono-t">{v?.vendorId}</b>}>
        <p class="t-body">{v?.name ?? '…'}</p>
        <p class="card__note">{v ? `${v.country}${v.address ? ` · ${v.address}` : ''}` : ''}</p>
      </Card>

      <Card title={t('vendor.store.buyerPaysTitle')} aside={<Button variant="link" full={false} onClick={() => setPolicyOpen(true)}>{t('vendor.store.change')}</Button>}>
        <p class="t-body">{v ? policyLine(v.shippingPolicy, t, v.currency) : ''}</p>
        {/* The insurer, on the same policy: where every damage claim report on this store's orders is emailed. */}
        <p class="card__note">{v ? insurerLine(v.shippingPolicy, t) : ''}</p>
      </Card>

      <PinCard state={state} actions={actions} />

      <Gs1Card state={state} api={actions.gs1} />

      {/* What a callback URL is, and whether this store needs one, in the (i)'s sheet (the user, 2026-10-26). */}
      <Card
        title={t('vendor.store.callbacksTitle')}
        aside={
          <Info title={t('vendor.store.cbInfo.title')} aloud={callbacksAloud(t)}>
            <CallbacksInfo />
          </Info>
        }
      >
        <p class="card__note">{t('vendor.store.callbacksNote')}</p>
        <div class="field" style="margin-top:8px">
          <label class="field__label" for="cb-url">
            {t('vendor.store.callbackUrl')}
          </label>
          <input id="cb-url" class="input" value={shownUrl} onInput={(e) => setUrl(e.currentTarget.value)} placeholder="https://store.example/hooks/sbg" autocapitalize="none" spellcheck={false} />
        </div>
        <div style="margin-top:12px">
          <Button chevron={false} full={false} busy={state.busy === 'callback'} disabled={url === null} onClick={() => void actions.saveCallback((url ?? '').trim())}>
            {t('vendor.store.save')}
          </Button>
        </div>
        {/* CV5 — the code rides along until the store's buyers get it from the Send app instead. A labelled tick
            box: the register kit's Checkbox carries its words only for a screen reader. */}
        <label class="checkline" style="margin-top:14px">
          <input
            type="checkbox"
            checked={codeOn ?? v?.callbackCarriesCode !== false}
            disabled={!v || state.busy === 'callback-code'}
            onChange={(e) => {
              setCodeOn(e.currentTarget.checked);
              void actions.setCallbackCode(e.currentTarget.checked);
            }}
          />
          <span>{t('vendor.store.callbackCode')}</span>
        </label>
        <p class="hint">{t('vendor.store.callbackCodeNote')}</p>
        {v?.callbackUrl ? (
          <div style="margin-top:12px">
            <Button variant="outline" chevron={false} full={false} busy={state.busy === 'callback-test'} onClick={() => void actions.sendCallback()}>
              {t('vendor.store.sendTest')}
            </Button>
          </div>
        ) : null}
        {state.callbacks.length ? (
          <div style="margin-top:8px">
            {/* Whether each one ARRIVED, and if not why — the store could see what was sent and not what became of it. */}
            {(allMessages ? state.callbacks : state.callbacks.slice(0, 6)).map((c) => {
              const line = callbackLine(c, t);
              return (
                <div key={c.id} style="margin-top:10px">
                  <div class="kv">
                    <span>{c.event}</span>
                    <b>{new Date(c.at).toLocaleString()}</b>
                  </div>
                  {line.warn ? <Note tone="warn" icon="warning" title={line.text} /> : <p class="hint">{line.text}</p>}
                  {v?.callbackUrl ? (
                    <Button variant="link" full={false} busy={state.busy === `callback-resend:${c.id}`} onClick={() => void actions.sendCallback(c.id)}>
                      {t('vendor.store.sendAgain')}
                    </Button>
                  ) : null}
                </div>
              );
            })}
            {!allMessages && state.callbacks.length > 6 ? (
              <Button variant="link" full={false} onClick={() => setAllMessages(true)}>
                {t('vendor.store.showAllMessages', { n: state.callbacks.length })}
              </Button>
            ) : null}
          </div>
        ) : (
          <p class="hint" style="margin-top:8px">
            {t('vendor.store.nothingSent')}
          </p>
        )}
      </Card>

      <KeysCard state={state} actions={actions} />

      <SecretCard state={state} actions={actions} />

      <Card title={t('vendor.store.settlementTitle')}>
        {state.storeState === 'loading' ? <p class="hint">{t('vendor.store.gettingBooks')}</p> : null}
        {state.settlement.length === 0 && state.storeState === 'ready' ? <p class="hint">{t('vendor.noEntriesYet')}</p> : null}
        {state.settlement.slice(0, 10).map((s) => (
          <div key={s.id} class="kv">
            <span>{`${ledgerTypeWord(s.type, t)}${s.parcelId ? ` · ${s.parcelId}` : ''}`}</span>
            <b>{`${s.sign}${money(s.amount, s.currency ?? v?.currency)}`}</b>
          </div>
        ))}
      </Card>

      <div class="scr__foot">
        <ReadAloud text={() => `${v?.balance === null ? t('vendor.noTillSpoken') : t('vendor.store.balanceSpoken', { balance: money(v?.balance, v?.currency) })}${v ? policyLine(v.shippingPolicy, t, v.currency) : ''}`} label={t('vendor.readAloud')} />
        <Button variant="link" full={false} onClick={actions.signOut}>
          {t('vendor.store.signOut')}
        </Button>
      </div>

      <PolicySheet open={policyOpen} onClose={() => setPolicyOpen(false)} state={state} actions={actions} />
    </div>
  );
}

/**
 * The keys this store calls the shipping API with.
 *
 * The screen's whole job is to make ONE moment unmissable: a secret key exists on screen exactly once and
 * is then gone, because we keep only a hash of it. So the reveal is a sheet the merchant has to close by
 * hand — never a toast, which would take the only copy of a credential away on a timer.
 */
function KeysCard({ state, actions }: { state: VendorState; actions: VendorActions }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<'publishable' | 'secret'>('publishable');
  const [mode, setMode] = useState<'test' | 'live'>('test');
  const [label, setLabel] = useState('');
  const [confirm, setConfirm] = useState<string | null>(null);
  const live = state.apiKeys.filter((k) => !k.revokedAt);

  return (
    <>
      <Card
        title={t('vendor.keys.title')}
        aside={
          <Button variant="link" full={false} onClick={() => setOpen(true)}>
            {t('vendor.keys.new')}
          </Button>
        }
      >
        <p class="card__note">{t('vendor.keys.note')}</p>
        {state.storeState === 'ready' && live.length === 0 ? <p class="hint" style="margin-top:8px">{t('vendor.keys.none')}</p> : null}
        {live.map((k) => (
          <div key={k.keyId}>
            <div class="kv">
              <span>
                {k.label ? `${k.label} · ` : ''}
                {t(k.kind === 'secret' ? 'vendor.keys.kindSecret' : 'vendor.keys.kindPublishable')}
                {' · '}
                {t(k.mode === 'live' ? 'vendor.keys.modeLive' : 'vendor.keys.modeTest')}
              </span>
              <b class="mono-t">{k.value ?? `…${k.hint}`}</b>
            </div>
            {/* A publishable key is public by design; only a secret one has an age worth watching. */}
            {k.kind === 'secret' ? <CredentialAge iso={k.createdAt} machine class="hint" /> : null}
          </div>
        ))}
        {live.length ? (
          <div class="chips" style="margin-top:10px">
            {live.map((k) => (
              <button key={k.keyId} type="button" class="chip chip--tap" onClick={() => setConfirm(k.keyId)}>
                {t('vendor.keys.revokeOne', { key: k.label || `…${k.hint}` })}
              </button>
            ))}
          </div>
        ) : null}
      </Card>

      <Sheet open={open} onClose={() => setOpen(false)} title={t('vendor.keys.newTitle')}>
        <div class="field">
          <label class="field__label" for="key-kind">
            {t('vendor.keys.kind')}
          </label>
          <select id="key-kind" class="input" value={kind} onChange={(e) => setKind(e.currentTarget.value as 'publishable' | 'secret')}>
            <option value="publishable">{t('vendor.keys.kindPublishable')}</option>
            <option value="secret">{t('vendor.keys.kindSecret')}</option>
          </select>
          <p class="card__note">{t(kind === 'secret' ? 'vendor.keys.kindSecretNote' : 'vendor.keys.kindPublishableNote')}</p>
        </div>
        <div class="field" style="margin-top:12px">
          <label class="field__label" for="key-mode">
            {t('vendor.keys.mode')}
          </label>
          <select id="key-mode" class="input" value={mode} onChange={(e) => setMode(e.currentTarget.value as 'test' | 'live')}>
            <option value="test">{t('vendor.keys.modeTest')}</option>
            <option value="live">{t('vendor.keys.modeLive')}</option>
          </select>
          <p class="card__note">{t(mode === 'live' ? 'vendor.keys.modeLiveNote' : 'vendor.keys.modeTestNote')}</p>
        </div>
        <div class="field" style="margin-top:12px">
          <label class="field__label" for="key-label">
            {t('vendor.keys.label')}
          </label>
          <input id="key-label" class="input" value={label} onInput={(e) => setLabel(e.currentTarget.value)} placeholder={t('vendor.keys.labelPh')} />
        </div>
        <Button
          chevron={false}
          busy={state.busy === 'issue-key'}
          onClick={() =>
            void actions.issueApiKey(kind, mode, label).then(() => {
              setOpen(false);
              setLabel('');
            })
          }
        >
          {t('vendor.keys.create')}
        </Button>
      </Sheet>

      {/* The one and only time a secret is on screen. Closed by hand, never on a timer. */}
      <Sheet open={Boolean(state.issuedKey)} onClose={actions.dismissIssuedKey} title={t('vendor.keys.madeTitle')}>
        <p class="t-body">{t(state.issuedKey?.kind === 'secret' ? 'vendor.keys.madeSecret' : 'vendor.keys.madePublishable')}</p>
        <p class="words" style="word-break:break-all">{state.issuedKey?.secret}</p>
        <p class="card__note">{t('vendor.keys.madeWhere')}</p>
        <Button chevron={false} onClick={actions.dismissIssuedKey}>
          {t('vendor.keys.madeDone')}
        </Button>
      </Sheet>

      <Sheet open={Boolean(confirm)} onClose={() => setConfirm(null)} title={t('vendor.keys.revokeTitle')}>
        <p class="t-body">{t('vendor.keys.revokeBody')}</p>
        <Button
          chevron={false}
          busy={state.busy === 'revoke-key'}
          onClick={() =>
            void actions.revokeApiKey(confirm!).then(() => setConfirm(null))
          }
        >
          {t('vendor.keys.revokeConfirm')}
        </Button>
        <Button variant="link" onClick={() => setConfirm(null)}>
          {t('common.cancel')}
        </Button>
      </Sheet>
    </>
  );
}

/**
 * The store's map pin — the thing an address cannot be relied on to provide here. Tap
 * the map to move the pin; the three place words update with it, so the store can SAY
 * where it is (on the phone, in a listing) with no street name at all.
 */
function PinCard({ state, actions }: { state: VendorState; actions: VendorActions }) {
  const t = useT();
  const [draft, setDraft] = useState<GeoPoint | null>(null);
  const [openShop, setOpenShop] = useState<string | null>(null);
  const current = draft ?? state.vendor?.location ?? null;
  const preview = openShop ? state.points.find((p) => p.did === openShop) ?? null : null;

  return (
    <Card title={t('vendor.store.whereTitle')}>
      <p class="card__note">{t('vendor.store.pinNote')}</p>
      <div style="margin-top:10px">
        <PlaceMap
          label={t('vendor.store.pinMapLabel')}
          pins={state.points.filter((p) => p.location).map((p) => ({ id: p.did, label: p.shopName, point: p.location! }))}
          selectedId={openShop}
          onPick={setOpenShop}
          onDrop={setDraft}
          dropped={draft}
          reference={draft ? null : state.vendor?.location ?? null}
        />
      </div>

      {/* G4b — the reference-shop pins are tappable too: an info-only preview, so no pin is a dead tap. */}
      <ShopDetailSheet
        open={!!preview}
        title={preview?.shopName ?? t('vendor.store.shopFallback')}
        subtitle={preview ? [preview.landmark, t('vendor.zone', { zone: preview.zone })].filter(Boolean).join(' · ') : undefined}
        lines={
          preview
            ? [
                t('vendor.shop.handleParcel', { price: money(preview.pricePerParcel, preview.currency) }),
                preview.openState === 'open' ? t('vendor.shop.openNow') : t('vendor.shop.closedNow'),
                ...(preview.rating?.count ? [t('vendor.shop.rated', { avg: preview.rating.average.toFixed(1), count: preview.rating.count })] : []),
              ]
            : []
        }
        location={preview?.location ?? null}
        onClose={() => setOpenShop(null)}
      />
      {current ? (
        <>
          <p class="words" style="margin-top:10px">
            {toPlaceWords(current)}
          </p>
          <ReadAloud text={() => t('vendor.store.wordsSpoken', { words: toPlaceWords(current).split(' ').join(', ') })} label={t('vendor.store.sayWords')} />
        </>
      ) : (
        <p class="hint" style="margin-top:10px">
          {t('vendor.store.noPin')}
        </p>
      )}
      {draft ? (
        <div style="margin-top:10px">
          <Button chevron={false} full={false} busy={state.busy === 'location'} onClick={() => void actions.saveLocation(draft).then(() => setDraft(null))}>
            {t('vendor.store.savePin')}
          </Button>
          <Button variant="link" full={false} onClick={() => setDraft(null)}>
            {t('vendor.store.undo')}
          </Button>
        </div>
      ) : null}
    </Card>
  );
}

function PolicySheet({ open, onClose, state, actions }: { open: boolean; onClose: () => void; state: VendorState; actions: VendorActions }) {
  const t = useT();
  const p = state.vendor?.shippingPolicy;
  const [mode, setMode] = useState<'full' | 'capped'>(p?.mode ?? 'capped');
  const [cap, setCap] = useState(String(p?.buyerContributionCap ?? 3));
  const [freeOver, setFreeOver] = useState(String(p?.freeOverSubtotal ?? 50));
  const [freightCap, setFreightCap] = useState(p?.maxTransportSpend != null ? String(p.maxTransportSpend) : '');
  const [insurerName, setInsurerName] = useState(p?.insurer?.name ?? '');
  const [insurerEmail, setInsurerEmail] = useState(p?.insurer?.email ?? '');
  // Half an insurer is none: a name with nowhere to send to, or an address with nobody to address.
  const insurerHalf = (insurerName.trim() === '') !== (insurerEmail.trim() === '');
  const insurerBad = insurerEmail.trim() !== '' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(insurerEmail.trim());

  return (
    <Sheet open={open} onClose={onClose} title={t('vendor.store.buyerPaysTitle')}>
      <div class="field">
        <label class="field__label" for="p-mode">
          {t('vendor.store.split')}
        </label>
        <select id="p-mode" class="select" value={mode} onChange={(e) => setMode(e.currentTarget.value as 'full' | 'capped')}>
          <option value="capped">{t('vendor.store.splitCapped')}</option>
          <option value="full">{t('vendor.store.splitFull')}</option>
        </select>
      </div>
      {mode === 'capped' ? (
        <>
          <div class="field" style="margin-top:12px">
            <label class="field__label" for="p-cap">
              {state.vendor?.currency ? t('vendor.store.buyerPaysAtMostIn', { currency: state.vendor.currency }) : t('vendor.store.buyerPaysAtMost')}
            </label>
            <input id="p-cap" class="input" type="number" inputMode="decimal" min="0" step="0.5" value={cap} onInput={(e) => setCap(e.currentTarget.value)} />
          </div>
          <div class="field" style="margin-top:12px">
            <label class="field__label" for="p-free">
              {state.vendor?.currency ? t('vendor.store.freeOverIn', { currency: state.vendor.currency }) : t('vendor.store.freeOver')}
            </label>
            <input id="p-free" class="input" type="number" inputMode="decimal" min="0" step="1" value={freeOver} onInput={(e) => setFreeOver(e.currentTarget.value)} />
          </div>
        </>
      ) : null}
      {/* S34c — the freight-spend cap applies to heavy (dedicated-freight) orders, independent of the buyer split. */}
      <div class="field" style="margin-top:12px">
        <label class="field__label" for="p-freight">
          {state.vendor?.currency ? t('vendor.store.freightCapLabelIn', { currency: state.vendor.currency }) : t('vendor.store.freightCapLabel')}
        </label>
        <input id="p-freight" class="input" type="number" inputMode="decimal" min="0" step="1" placeholder={t('vendor.store.freightCapPh')} value={freightCap} onInput={(e) => setFreightCap(e.currentTarget.value)} />
        <p class="hint" style="margin-top:6px">{t('vendor.store.freightCapHint')}</p>
      </div>
      {/* THE INSURER. The user, 2026-10-12: a damage claim report goes "to an insurer … set by the vendor according to
          their shipping policy" — and sending it is emailing a link. Both fields or neither. */}
      <div class="field" style="margin-top:12px">
        <label class="field__label" for="p-insurer">
          {t('vendor.store.insurerLabel')}
        </label>
        <input id="p-insurer" class="input" type="text" maxLength={80} placeholder={t('vendor.store.insurerPh')} value={insurerName} onInput={(e) => setInsurerName(e.currentTarget.value)} />
      </div>
      <div class="field" style="margin-top:12px">
        <label class="field__label" for="p-insurer-email">
          {t('vendor.store.insurerEmailLabel')}
        </label>
        <input id="p-insurer-email" class="input" type="email" inputMode="email" autocomplete="off" maxLength={254} placeholder={t('vendor.store.insurerEmailPh')} value={insurerEmail} onInput={(e) => setInsurerEmail(e.currentTarget.value)} />
        <p class="hint" style="margin-top:6px">{insurerHalf ? t('vendor.store.insurerHalf') : insurerBad ? t('vendor.store.insurerBad') : t('vendor.store.insurerHint')}</p>
      </div>
      <Button
        chevron={false}
        busy={state.busy === 'policy'}
        disabled={insurerHalf || insurerBad}
        onClick={() => {
          onClose();
          void actions.savePolicy({
            mode,
            buyerContributionCap: Number(cap) || 0,
            freeOverSubtotal: Number(freeOver) || 0,
            maxTransportSpend: freightCap.trim() ? Number(freightCap) || 0 : 0,
            insurer: insurerName.trim() && insurerEmail.trim() ? { name: insurerName.trim(), email: insurerEmail.trim() } : null,
          });
        }}
      >
        {t('vendor.store.savePolicy')}
      </Button>
      <Button variant="link" onClick={onClose}>
        {t('vendor.store.keepPolicy')}
      </Button>
    </Sheet>
  );
}

/**
 * The store's signing secret — it opens this console AND signs every status callback the store receives. Rotating
 * it regularly is good practice; it takes the current secret (an open console is not proof on its own), signs every
 * other session out, and the new secret is on screen exactly once, like the first.
 */
function SecretCard({ state, actions }: { state: VendorState; actions: VendorActions }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [fresh, setFresh] = useState<string | null>(null);
  // What the server refused, said in the sheet it was typed in.
  const [refused, setRefused] = useState<SbgError | null>(null);
  const busy = state.busy === 'rotate-secret';
  // WITH AN ACCOUNT the second proof is the password — so a lost secret can be replaced. Without one yet, it is the
  // current secret, which is also still what opens this console.
  const withAccount = state.vendor?.hasAccount === true;

  return (
    <>
      <Card title={t('vendor.secret.title')}>
        <p class="card__note">{t(withAccount ? 'vendor.secret.body' : 'vendor.secret.bodyNoAccount')}</p>
        <CredentialAge iso={state.vendor?.secretRotatedAt ?? state.vendor?.createdAt} machine />
        <Button
          variant="outline"
          chevron={false}
          onClick={() => {
            setCurrent('');
            setFresh(null);
            setRefused(null);
            setOpen(true);
          }}
        >
          {t('vendor.secret.rotate')}
        </Button>
      </Card>

      <Sheet
        open={open}
        onClose={() => {
          // The new secret is the only copy: the sheet closes by the button that says it was saved, never by a tap outside.
          if (!fresh) setOpen(false);
        }}
        title={t(fresh ? 'vendor.secret.newTitle' : 'vendor.secret.sheetTitle')}
      >
        {fresh ? (
          <>
            <p class="t-body">{t('vendor.secret.newBody')}</p>
            <p class="mono-t" style="word-break:break-all">
              {fresh}
            </p>
            <Button
              chevron={false}
              onClick={() => {
                setFresh(null);
                setOpen(false);
              }}
            >
              {t('vendor.secret.saved')}
            </Button>
          </>
        ) : (
          <>
            <p class="card__note">{t('vendor.secret.warn')}</p>
            {refused ? <ErrorNote error={refused} /> : null}
            <div class="field">
              <label class="field__label" for="secret-current">
                {t(withAccount ? 'vendor.secret.password' : 'vendor.secret.current')}
              </label>
              <input id="secret-current" class={withAccount ? 'input' : 'input input--mono'} type="password" autocomplete={withAccount ? 'current-password' : 'off'} value={current} onInput={(e) => setCurrent(e.currentTarget.value)} />
            </div>
            <Button
              chevron={false}
              disabled={!current.trim()}
              busy={busy}
              onClick={async () => {
                setRefused(null);
                // A password is sent as it was typed; a pasted secret loses the space a copy picked up.
                const r = await actions.rotateSecret(withAccount ? current : current.trim());
                if (r.error) setRefused(r.error);
                if (r.secret) setFresh(r.secret);
              }}
            >
              {t('vendor.secret.confirm')}
            </Button>
            <Button variant="link" onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </Button>
          </>
        )}
      </Sheet>
    </>
  );
}
