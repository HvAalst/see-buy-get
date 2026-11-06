import { useState } from 'preact/hooks';
import { Button, Icon, Note } from '../../../shared/ui';
import { useT, type Translate } from '../../../shared/i18n';
import { money } from '../logic';
import type { ConsumerParcelView, MoveView, NetworkPoint } from '../types';

/**
 * What dropping it off at another shop would do, in the sender's words (2026-11-06; the owner: "moving needs a re-price, but
 * it's not automated by us so the user is aware of the implication"): the cash the counter will take from there, beside the
 * price it was booked at.
 */
export function moveSaysSend(view: MoveView, t: Translate): string {
  if (!view.canMove) return view.why ?? '';
  const now = money(view.now, view.currency);
  const was = money(view.was, view.currency);
  if (view.difference > 0) return t('send.move.dearer', { shop: view.to.shopName, now, was });
  if (view.difference < 0) return t('send.move.cheaper', { shop: view.to.shopName, now, was });
  return t('send.move.same', { shop: view.to.shopName, now });
}

/** The shops it could be dropped off at instead: open, taking parcels, with room, not the one it is booked at. */
export function shopsToMoveTo(points: readonly NetworkPoint[], from: string, filter: string): NetworkPoint[] {
  const q = filter.trim().toLowerCase();
  return points
    .filter((p) => p.did !== from && p.openState === 'open' && p.takesNew !== false && p.freeSlots !== 0)
    .filter((p) => !q || p.shopName.toLowerCase().includes(q) || p.zone.toLowerCase().includes(q) || (p.landmark ?? '').toLowerCase().includes(q))
    .sort((a, b) => a.shopName.localeCompare(b.shopName))
    .slice(0, 8);
}

/**
 * DROPPING A BOOKED PARCEL OFF AT ANOTHER SHOP, from the sender's own app (2026-11-06): the shop picked, the new price said
 * beside the old, and moved — or kept where it is. Never done for them.
 */
export function MoveDropOff({
  parcel,
  points,
  preview,
  move,
  onOpen,
}: {
  parcel: ConsumerParcelView;
  points: readonly NetworkPoint[];
  preview: (to: string) => Promise<MoveView | null>;
  move: (to: string, expectedTotal: number) => Promise<string | null>;
  onOpen?: () => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [view, setView] = useState<MoveView | null>(null);
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  if (!parcel.dropOff) return null;
  const from = parcel.dropOff;

  if (!open) {
    return (
      <Button
        variant="link"
        onClick={() => {
          setOpen(true);
          onOpen?.();
        }}
      >
        {t('send.move.open', { shop: from.shopName })}
      </Button>
    );
  }
  const keep = (
    <Button
      variant="link"
      onClick={() => {
        setOpen(false);
        setView(null);
        setRefused(null);
      }}
    >
      {t('send.move.keep')}
    </Button>
  );
  if (!view) {
    const shops = shopsToMoveTo(points, from.did, filter);
    return (
      <div class="calloff">
        <Note tone="info" icon="repeat" title={t('send.move.pickTitle')} detail={t('send.move.pickBody', { price: money(from.price, from.currency) })} />
        <div class="field">
          <label class="field__label" for="move-shop">
            {t('send.move.findShop')}
          </label>
          <input id="move-shop" class="input" value={filter} onInput={(e) => setFilter(e.currentTarget.value)} autocomplete="off" />
        </div>
        <div class="rows" role="list">
          {shops.map((p) => (
            <button
              key={p.did}
              type="button"
              class="row"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setRefused(null);
                setView(await preview(p.did));
                setBusy(false);
              }}
            >
              <span class="row__ic">
                <Icon name="home" size={24} />
              </span>
              <span class="row__body">
                <span class="row__t">{p.shopName}</span>
                <span class="row__s">{[p.zone, p.landmark].filter(Boolean).join(' · ')}</span>
              </span>
              <span class="row__end">
                <Icon name="chevronRight" size={22} />
              </span>
            </button>
          ))}
        </div>
        {keep}
      </div>
    );
  }
  return (
    <div class="calloff">
      <Note tone={view.canMove ? 'info' : 'warn'} icon={view.canMove ? 'repeat' : 'block'} title={view.canMove ? t('send.move.title', { shop: view.to.shopName }) : t('send.move.noTitle', { shop: view.to.shopName })} detail={moveSaysSend(view, t)} />
      {refused ? <p class="hint hint--danger">{refused}</p> : null}
      {view.canMove ? (
        <Button
          chevron={false}
          busy={busy}
          onClick={async () => {
            setBusy(true);
            const no = await move(view.to.did, view.now);
            setBusy(false);
            if (no) {
              // The price moved since it was shown: said, and asked again so the new one is seen first.
              setRefused(no);
              setView(await preview(view.to.did));
              return;
            }
            setOpen(false);
            setView(null);
          }}
        >
          {t('send.move.confirm', { shop: view.to.shopName, amount: money(view.now, view.currency) })}
        </Button>
      ) : null}
      <Button variant="link" onClick={() => setView(null)}>
        {t('send.move.pickAgain')}
      </Button>
      {keep}
    </div>
  );
}
