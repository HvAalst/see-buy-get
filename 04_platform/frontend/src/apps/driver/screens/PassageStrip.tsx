import { useEffect, useState } from 'preact/hooks';
import { Button, Sheet } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import { passageWords, waitWords, type PassageKind } from '../../../shared/passages';
import { nextSteps, passageNow, placeOk } from '../passage';
import type { Claimable } from '../types';
import type { DriverActions, DriverState } from '../useDriverApp';

const clock = (iso: string) => new Date(iso).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });

const SAY: Record<PassageKind, 'driver.passage.say.at_border' | 'driver.passage.say.cleared_border' | 'driver.passage.say.at_hub'> = {
  at_border: 'driver.passage.say.at_border',
  cleared_border: 'driver.passage.say.cleared_border',
  at_hub: 'driver.passage.say.at_hub',
};

/**
 * ROUND 14 — under a load on the road: where it is, as last said, and the steps the driver may say next — at the border,
 * cleared it, at a hub. At a post it says how long the crossing is allowed and what that rests on, so the driver reads
 * the same promise the shipper does.
 */
export function PassageStrip({ claim, state, onSay }: { claim: Claimable; state: DriverState; onSay: (kind: PassageKind) => void }) {
  const t = useT();
  const p = passageNow(claim.passage, state.said[claim.ref]);
  const steps = nextSteps(p);
  if (!p || !steps.length) return null;
  return (
    <div class="passage-strip">
      {p.atPost ? (
        <span class="passage-strip__info">
          <b>{t('driver.passage.atPost', { post: p.atPost.post, when: clock(p.atPost.since) })}</b>
          {p.atPost.wait ? <span>{waitWords(p.atPost.wait, t)}</span> : null}
        </span>
      ) : p.last ? (
        <span class="passage-strip__info">{passageWords(p.last, t, clock)}</span>
      ) : (
        <span class="passage-strip__info">{t(p.crosses ? 'driver.passage.crosses' : 'driver.passage.sayHub')}</span>
      )}
      <span class="passage-strip__acts">
        {steps.map((k) => (
          <Button key={k} variant="link" full={false} disabled={state.busy === `passage:${claim.ref}`} onClick={() => onSay(k)}>
            {t(SAY[k])}
          </Button>
        ))}
      </span>
    </div>
  );
}

/** Saying one step: the post (from those on record, or named), the clearing, or the hub. */
export function PassageSheet({ claim, kind, state, actions, onClose }: { claim: Claimable | null; kind: PassageKind | null; state: DriverState; actions: DriverActions; onClose: () => void }) {
  const t = useT();
  const [place, setPlace] = useState('');
  const p = claim ? passageNow(claim.passage, state.said[claim.ref]) : undefined;
  const posts = p?.posts ?? [];
  useEffect(() => setPlace(kind === 'at_border' && posts.length === 1 ? posts[0] : ''), [claim?.ref, kind]);
  const open = Boolean(claim && kind);
  const ref = claim?.code ?? claim?.ref ?? '';
  const say = () => {
    if (!claim || !kind) return;
    void actions.sayPassage(claim.ref, kind, kind === 'cleared_border' ? undefined : place);
    onClose();
  };
  const title = kind === 'at_border' ? t('driver.passage.borderTitle') : kind === 'cleared_border' ? t('driver.passage.clearedTitle') : t('driver.passage.hubTitle');
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      {open && kind === 'at_border' ? (
        <>
          <p class="t-body">{t('driver.passage.borderBody', { ref })}</p>
          {posts.length ? (
            <div class="chips">
              {posts.map((name) => (
                <button key={name} type="button" class={'chip chip--tap' + (place === name ? ' chip--on' : '')} aria-pressed={place === name} onClick={() => setPlace(name)}>
                  {name}
                </button>
              ))}
            </div>
          ) : null}
          <div class="field" style="margin-top:12px">
            <label class="field__label" for="passage-post">
              {t(posts.length ? 'driver.passage.otherPost' : 'driver.passage.postLabel')}
            </label>
            <input id="passage-post" class="input" maxLength={80} value={posts.includes(place) ? '' : place} onInput={(e) => setPlace(e.currentTarget.value)} />
          </div>
        </>
      ) : null}
      {open && kind === 'cleared_border' ? <p class="t-body">{t('driver.passage.clearedBody', { ref, post: p?.atPost?.post ?? '' })}</p> : null}
      {open && kind === 'at_hub' ? (
        <>
          <p class="t-body">{t('driver.passage.hubBody', { ref })}</p>
          <div class="field">
            <label class="field__label" for="passage-hub">
              {t('driver.passage.hubLabel')}
            </label>
            <input id="passage-hub" class="input" maxLength={80} value={place} placeholder={t('driver.passage.hubPh')} onInput={(e) => setPlace(e.currentTarget.value)} />
          </div>
        </>
      ) : null}
      {open ? (
        <>
          <p class="hint">{t('driver.passage.whoIsTold')}</p>
          <div style="margin-top:14px">
            <Button chevron={false} busy={claim ? state.busy === `passage:${claim.ref}` : false} disabled={kind !== 'cleared_border' && !placeOk(place)} onClick={say}>
              {kind === 'at_border' ? t('driver.passage.sayAt', { place: placeOk(place) ? place.trim() : t('driver.passage.thePost') }) : kind === 'cleared_border' ? t('driver.passage.sayCleared') : t('driver.passage.sayHere')}
            </Button>
          </div>
          <Button variant="link" onClick={onClose}>
            {t('driver.cancel')}
          </Button>
        </>
      ) : null}
    </Sheet>
  );
}
