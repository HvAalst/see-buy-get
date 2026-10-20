import { useEffect, useState } from 'preact/hooks';
import { Button, Sheet } from '../../../shared/ui';
import { useT, type MessageKey } from '../../../shared/i18n';
import { EMPTY_HELD, HELD_BY, heldBody, heldByLine, heldReady, type HeldBy, type HeldByAuthorityView, type HeldForm } from '../../../shared/heldByAuthority';
import type { Claimable } from '../types';
import type { DriverActions, DriverState } from '../useDriverApp';

/*
 * A LOAD HELD BY THE POLICE OR CUSTOMS, FROM THE CAB (backend load-detention.types.ts). Under a load on the road: one tap
 * says it is held — by whom, who and where in the driver's own words — and SeeBuyGet operations, the shipper and the
 * fleet's office are told; another says it was let go. Each waits on the phone with no signal, dated when it was said.
 */

const clock = (iso: string) => new Date(iso).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });

const BY_CHIP: Record<HeldBy, MessageKey> = {
  police: 'driver.held.by.police',
  customs: 'driver.held.by.customs',
  other: 'driver.held.by.other',
};

/** Held now, as this phone last said it, or as the server says: what the card shows. */
export function heldNow(claim: Claimable, state: DriverState): HeldByAuthorityView | undefined {
  const local = state.held[claim.ref];
  if (local !== undefined) return local ?? undefined;
  return claim.heldByAuthority;
}

export function HeldStrip({ claim, state, actions, onSay }: { claim: Claimable; state: DriverState; actions: DriverActions; onSay: () => void }) {
  const t = useT();
  const held = heldNow(claim, state);
  const busy = state.busy === `held:${claim.ref}`;
  return (
    <div class={'passage-strip' + (held ? ' passage-strip--held' : '')}>
      {held ? (
        <span class="passage-strip__info">
          <b>{heldByLine(held, t, clock)}</b>
          <span>{t('driver.held.told')}</span>
        </span>
      ) : null}
      <span class="passage-strip__acts">
        {held ? (
          <Button full={false} busy={busy} onClick={() => void actions.sayLetGo(claim.ref)}>
            {t('driver.held.letGo')}
          </Button>
        ) : (
          <Button variant="link" full={false} disabled={busy} onClick={onSay}>
            {t('driver.held.open')}
          </Button>
        )}
      </span>
    </div>
  );
}

/** Saying it is held: by whom, who and where, anything else. */
export function HeldSheet({ claim, state, actions, onClose }: { claim: Claimable | null; state: DriverState; actions: DriverActions; onClose: () => void }) {
  const t = useT();
  const [form, setForm] = useState<HeldForm>(EMPTY_HELD);
  useEffect(() => setForm(EMPTY_HELD), [claim?.ref]);
  const busy = !!claim && state.busy === `held:${claim.ref}`;
  return (
    <Sheet open={!!claim} onClose={onClose} title={t('driver.held.title')}>
      {claim ? (
        <div class="bag-seal">
          <p class="t-body">{t('driver.held.body', { ref: claim.code ?? claim.ref })}</p>
          <p class="field__label">{t('driver.held.whoHolds')}</p>
          <div class="chips">
            {HELD_BY.map((by) => (
              <button key={by} type="button" class={'chip chip--tap' + (form.by === by ? ' chip--on' : '')} aria-pressed={form.by === by} disabled={busy} onClick={() => setForm({ ...form, by })}>
                {t(BY_CHIP[by])}
              </button>
            ))}
          </div>
          <div class="field">
            <label class="field__label" for="held-who">
              {t('driver.held.whoWhere')}
            </label>
            <input id="held-who" class="input" maxLength={120} value={form.who} disabled={busy} placeholder={t('driver.held.whoWherePlaceholder')} onInput={(e) => setForm({ ...form, who: e.currentTarget.value })} />
          </div>
          <div class="field">
            <label class="field__label" for="held-note">
              {t('driver.held.note')}
            </label>
            <textarea id="held-note" class="input" rows={2} maxLength={500} value={form.note} disabled={busy} onInput={(e) => setForm({ ...form, note: e.currentTarget.value })} />
          </div>
          <p class="hint">{t('driver.held.who')}</p>
          <Button
            chevron={false}
            busy={busy}
            disabled={!heldReady(form)}
            onClick={async () => {
              if (await actions.sayHeld(claim.ref, heldBody(form))) onClose();
            }}
          >
            {t('driver.held.send')}
          </Button>
          <Button variant="link" onClick={onClose}>
            {t('driver.notYet')}
          </Button>
        </div>
      ) : null}
    </Sheet>
  );
}
