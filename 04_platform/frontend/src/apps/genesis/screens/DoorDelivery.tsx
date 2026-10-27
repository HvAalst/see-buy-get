import { useState } from 'preact/hooks';
import { Button, Note, PhoneField, PlacePicker, Sheet, type PlaceNote } from '../../../shared/ui';
import { formatMoney, useT, type Translate } from '../../../shared/i18n';
import type { ConsumerParcelView, DoorPreview, DoorView } from '../types';
import type { SendActions, SendState } from '../useSendApp';

/** A time of day on this phone's clock — when the payment window closes. */
const clock = (iso?: string) => (iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '');

/** The last digits of the number money goes back to: enough to know it is yours. */
const last = (masked: string) => masked.replace(/\D/g, '').slice(-3);

/** What their door delivery says, by where it stands (the user, 2026-10-27: "Mobile money first"). */
export function doorSays(d: DoorView, t: Translate): { tone: 'info' | 'warn' | 'ok'; title: string; detail: string } {
  const m = (n?: number) => formatMoney(n ?? 0, d.currency);
  switch (d.state) {
    case 'awaiting':
      return { tone: 'warn', title: t('send.door.awaitingTitle', { amount: m(d.maxSpend) }), detail: t('send.door.awaitingDetail', { phone: d.phoneMasked, until: clock(d.until) }) };
    case 'posted':
      return { tone: 'info', title: t('send.door.postedTitle', { amount: m(d.paid) }), detail: t('send.door.postedDetail', { code: d.loadCode ?? '', label: d.label }) };
    case 'taken':
      return { tone: 'info', title: t('send.door.takenTitle'), detail: t('send.door.takenDetail', { code: d.loadCode ?? '', billed: m(d.billed), paid: m(d.paid) }) };
    case 'delivered':
      return { tone: 'ok', title: t('send.door.deliveredTitle'), detail: d.owedBack ? t('send.door.deliveredDetail', { amount: m(d.owedBack), last: last(d.phoneMasked) }) : t('send.door.deliveredNothing') };
    case 'to_shop':
      return { tone: 'info', title: t('send.door.toShopTitle', { shop: d.shopName ?? '' }), detail: t('send.door.toShopDetail', { id: d.shopParcelId ?? '', amount: m(d.owedBack), last: last(d.phoneMasked) }) };
    case 'lapsed':
      return { tone: 'warn', title: t('send.door.lapsedTitle'), detail: t('send.door.lapsedDetail') };
    default:
      return { tone: 'warn', title: t('send.door.reversedTitle'), detail: t('send.door.reversedDetail') };
  }
}

/**
 * A RAISE OF THE MOST (the user, 2026-10-27: "Yes, a second M-Pesa ask"), while their load waits for a driver: the difference
 * to approve on their phone, by when — or that it was not paid, and the most stays as it was. Nothing once it is paid: the
 * load's own line then says the new amount.
 */
export function raiseSays(d: DoorView, t: Translate): { tone: 'warn' | 'info'; title: string; detail: string } | null {
  const r = d.raise;
  if (!r || d.state !== 'posted') return null;
  const m = (n?: number) => formatMoney(n ?? 0, d.currency);
  if (r.state === 'awaiting') return { tone: 'warn', title: t('send.door.raiseAwaitingTitle', { amount: m(r.amount) }), detail: t('send.door.raiseAwaitingDetail', { phone: d.phoneMasked, until: clock(r.until), to: m(r.to) }) };
  if (r.state === 'lapsed') return { tone: 'info', title: t('send.door.raiseLapsedTitle'), detail: t('send.door.raiseLapsedDetail', { to: m(r.to), paid: m(d.paid) }) };
  return null;
}

/** A load to their door is under way (or went to the shop instead): the parcel's own way to the shop no longer applies. */
export function doorUnderWay(p: ConsumerParcelView): boolean {
  return Boolean(p.door && ['awaiting', 'posted', 'taken', 'delivered', 'to_shop'].includes(p.door.state));
}

/** Their door is on offer: goods coming back to them, still at the hub, with no door delivery under way. */
export function doorOnOffer(p: ConsumerParcelView): boolean {
  return Boolean(p.returnOf) && p.relation === 'received' && p.status === 'At_MDP' && (!p.door || p.door.state === 'lapsed' || p.door.state === 'reversed');
}

/**
 * THEIR OWN DOOR, PAID FIRST BY MOBILE MONEY (the user, 2026-10-27: "Mobile money first"), on the parcel bringing their goods
 * back: where it stands, and what they can do next — pay, check again, give it up, or send it to the shop instead.
 */
export function DoorBlock({ parcel, state, actions }: { parcel: ConsumerParcelView; state: SendState; actions: SendActions }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [raising, setRaising] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const d = parcel.door;
  const raised = d ? raiseSays(d, t) : null;
  const act = async (fn: () => Promise<string | null>) => {
    setBusy(true);
    setProblem(await fn());
    setBusy(false);
  };
  const said = d ? doorSays(d, t) : null;
  return (
    <>
      {d && said ? <Note tone={said.tone} icon={d.state === 'awaiting' ? 'phone' : 'truck'} title={said.title} detail={said.detail} /> : null}
      {d?.state === 'awaiting' && d.instructions ? <p class="hint">{d.instructions}</p> : null}
      {/* Where the rail could not ask the phone itself, they pay by paybill and quote this — so it is shown (found walking, 2026-10-27). */}
      {d?.state === 'awaiting' && !d.pushed && d.reference ? <PayReference reference={d.reference} /> : null}
      {problem ? (
        <p class="hint" role="alert">
          {problem}
        </p>
      ) : null}
      {d?.state === 'awaiting' ? (
        <>
          <Button chevron={false} busy={busy} onClick={() => void actions.openParcel(parcel.parcelId)}>
            {t('send.door.checkAgain')}
          </Button>
          <Button variant="link" onClick={() => void act(() => actions.cancelDoor(parcel.parcelId))}>
            {t('send.door.giveUp')}
          </Button>
        </>
      ) : null}
      {/* A raise of the most being paid, or not paid in time (2026-10-27). */}
      {raised ? <Note tone={raised.tone} icon={d?.raise?.state === 'awaiting' ? 'phone' : 'info'} title={raised.title} detail={raised.detail} /> : null}
      {d?.state === 'posted' && d.raise?.state === 'awaiting' ? (
        <>
          {d.raise.instructions ? <p class="hint">{d.raise.instructions}</p> : null}
          {!d.raise.pushed && d.raise.reference ? <PayReference reference={d.raise.reference} /> : null}
          <Button chevron={false} busy={busy} onClick={() => void actions.openParcel(parcel.parcelId)}>
            {t('send.door.checkAgain')}
          </Button>
        </>
      ) : null}
      {d?.state === 'posted' && d.canRaise ? (
        <Button variant="outline" chevron={false} onClick={() => setRaising(true)}>
          {t('send.door.raise')}
        </Button>
      ) : null}
      {d?.state === 'posted' && d.canSendToShop ? (
        <Button variant="link" busy={busy} onClick={() => void act(() => actions.cancelDoor(parcel.parcelId))}>
          {t('send.door.toShop', { shop: d.shopName ?? t('send.door.theShop') })}
        </Button>
      ) : null}
      {doorOnOffer(parcel) ? (
        <>
          <p class="hint">{t('send.door.offerHint')}</p>
          <Button variant="outline" chevron={false} onClick={() => setOpen(true)}>
            {t('send.door.offer')}
          </Button>
        </>
      ) : null}
      {open ? <DoorSheet parcel={parcel} state={state} actions={actions} onClose={() => setOpen(false)} /> : null}
      {raising && d ? <RaiseSheet parcel={parcel} door={d} actions={actions} onClose={() => setRaising(false)} /> : null}
    </>
  );
}

/** The reference to quote when paying by paybill, set apart so it can be read off and typed. */
function PayReference({ reference }: { reference: string }) {
  const t = useT();
  return (
    <p class="hint">
      {t('send.door.reference')} <b class="mono-t">{reference}</b>
    </p>
  );
}

/** A higher most, while no driver has taken it: the difference, asked by M-Pesa from the number they paid from. */
function RaiseSheet({ parcel, door, actions, onClose }: { parcel: ConsumerParcelView; door: DoorView; actions: SendActions; onClose: () => void }) {
  const t = useT();
  const paid = door.paid ?? door.maxSpend;
  const [most, setMost] = useState(String(Math.ceil(paid * 1.25)));
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const amount = Math.ceil(Number(most));
  const diff = Number.isFinite(amount) ? amount - paid : 0;
  const ready = diff >= 1;
  const pay = async () => {
    if (!ready) return;
    setBusy(true);
    setProblem(null);
    const refused = await actions.raiseDoor(parcel.parcelId, amount);
    setBusy(false);
    if (refused) return setProblem(refused);
    onClose();
  };
  return (
    <Sheet open onClose={onClose} title={t('send.door.raiseTitle')}>
      <p class="card__note">{t('send.door.raiseBody', { paid: formatMoney(paid, door.currency), code: door.loadCode ?? '' })}</p>
      <div class="field">
        <label class="field__label" for="door-raise">
          {t('send.door.raiseLabel', { currency: door.currency })}
        </label>
        <input id="door-raise" class="input" type="number" inputMode="numeric" min={Math.floor(paid) + 1} step="1" value={most} onInput={(e) => setMost(e.currentTarget.value)} />
        {ready ? <p class="hint">{t('send.door.raiseDiff', { amount: formatMoney(diff, door.currency), last: last(door.phoneMasked) })}</p> : null}
      </div>
      {problem ? (
        <p class="hint" role="alert">
          {problem}
        </p>
      ) : null}
      <Button chevron={false} busy={busy} disabled={!ready} onClick={() => void pay()}>
        {t('send.door.pay', { amount: formatMoney(ready ? diff : 0, door.currency) })}
      </Button>
      <Button variant="link" onClick={onClose}>
        {t('send.door.notNow')}
      </Button>
    </Sheet>
  );
}

/** Where their door is, the most they allow, the number they pay from — and then M-Pesa asks. */
function DoorSheet({ parcel, state, actions, onClose }: { parcel: ConsumerParcelView; state: SendState; actions: SendActions; onClose: () => void }) {
  const t = useT();
  const [label, setLabel] = useState('');
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null);
  const [preview, setPreview] = useState<DoorPreview | null>(null);
  const [most, setMost] = useState('');
  const [phone, setPhone] = useState(state.authPhone);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const placed = async (point: { lat: number; lng: number }) => {
    setPin(point);
    const said = await actions.doorPreview(parcel.parcelId, point);
    setPreview(said);
    if (said?.outcome === 'door' && said.suggestedMax && !most) setMost(String(said.suggestedMax));
  };
  const amount = Number(most);
  const ready = Boolean(pin && label.trim().length >= 2 && amount >= 1 && phone.trim() && preview?.outcome === 'door');
  const pay = async () => {
    if (!pin || !ready) return;
    setBusy(true);
    setProblem(null);
    const refused = await actions.requestDoor(parcel.parcelId, { lat: pin.lat, lng: pin.lng, label: label.trim(), maxSpend: amount, phone: phone.trim() });
    setBusy(false);
    if (refused) return setProblem(refused);
    onClose();
  };
  const note = (n: PlaceNote) => (n.kind === 'notFound' ? t('send.door.geoNotFound') : n.kind === 'found' ? t('send.door.geoFound', { where: n.where }) : n.kind === 'pinned' ? t('send.door.pinned') : '');
  return (
    <Sheet open onClose={onClose} title={t('send.door.sheetTitle')}>
      <p class="card__note">{t('send.door.offerHint')}</p>
      <PlacePicker
        id="door-place"
        fieldLabel={t('send.door.where')}
        placeholder={t('send.door.wherePh')}
        mapLabel={t('send.door.mapLabel')}
        findLabel={t('send.door.find')}
        label={label}
        pin={pin}
        onLabel={setLabel}
        onPin={(point) => void placed(point)}
        geocode={actions.findPlace}
        noteText={note}
      />
      {preview?.outcome === 'no' ? <Note tone="warn" icon="block" title={t('send.door.no')} detail={preview.why ?? ''} /> : null}
      {preview?.outcome === 'door' ? (
        <>
          <div class="field">
            <label class="field__label" for="door-most">
              {t('send.door.mostLabel', { currency: preview.currency ?? '' })}
            </label>
            <input id="door-most" class="input" type="number" inputMode="numeric" min="1" step="1" value={most} onInput={(e) => setMost(e.currentTarget.value)} />
            {preview.suggestedMax ? <p class="hint">{t('send.door.suggested', { amount: formatMoney(preview.suggestedMax, preview.currency) })}</p> : null}
          </div>
          <div class="field">
            <label class="field__label" for="door-phone">
              {t('send.door.phoneLabel')}
            </label>
            <PhoneField id="door-phone" value={phone} onInput={setPhone} />
          </div>
        </>
      ) : null}
      {problem ? (
        <p class="hint" role="alert">
          {problem}
        </p>
      ) : null}
      <Button chevron={false} busy={busy} disabled={!ready} onClick={() => void pay()}>
        {t('send.door.pay', { amount: formatMoney(amount || 0, preview?.currency) })}
      </Button>
      <Button variant="link" onClick={onClose}>
        {t('send.door.notNow')}
      </Button>
    </Sheet>
  );
}
