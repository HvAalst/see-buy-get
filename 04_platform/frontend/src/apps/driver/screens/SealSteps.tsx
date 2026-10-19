import { useEffect, useState } from 'preact/hooks';
import { Button, PhotoField, Sheet } from '../../../shared/ui';
import { useT, type MessageKey } from '../../../shared/i18n';
import { readingMatches, SEAL_BREAK_CAUSES, sealWhat, type SealBreakCause, type SealsAtDelivery, type SealToFind } from '../../../shared/seals';
import type { Claimable } from '../types';
import type { DriverActions, DriverState } from '../useDriverApp';
import { atPostBody, atPostReady, EMPTY_AT_POST, pickupSealsReady, sealsOn, type SealRead, type SealsAtPost } from '../seals';

export { atPostBody, atPostReady, EMPTY_AT_POST, pickupSealsReady, type SealRead, type SealsAtPost };

/*
 * ROUND 15 — THE SEALS ON A LOAD, FROM THE CAB. At pickup each seal is read off the door — its number is not on this
 * screen, so it is read, not copied — and checked on the phone against what the shipper wrote, signal or not: a number
 * that is not the one written and the load does not leave. Clearing a border, the driver says whether the seals are as
 * they were. A broken one is reported on the road. At the door, the receiver looks with the driver.
 */

export function PickupSeals({
  claim,
  actions,
  busy,
  reads,
  setReads,
}: {
  claim: Claimable;
  actions: DriverActions;
  busy: boolean;
  reads: Record<string, SealRead>;
  setReads: (update: (prev: Record<string, SealRead>) => Record<string, SealRead>) => void;
}) {
  const t = useT();
  const on = sealsOn(claim);
  if (!on.length) return null;
  const set = (sealId: string, patch: Partial<SealRead>) => setReads((prev) => ({ ...prev, [sealId]: { ...(prev[sealId] ?? { number: '', photoRef: '', ok: null }), ...patch } }));
  const read = async (seal: SealToFind, number: string) => {
    set(seal.sealId, { number, ok: null });
    if (!number.trim()) return;
    const ok = await readingMatches(claim.ref, number, seal.check);
    // Only for the number still in the box: a reading typed on since is checked on its own.
    setReads((prev) => (prev[seal.sealId]?.number === number ? { ...prev, [seal.sealId]: { ...prev[seal.sealId], ok } } : prev));
  };
  return (
    <div class="seal-steps">
      <p class="field__label">{t('driver.seal.pickupTitle', { n: on.length })}</p>
      <p class="hint">{t('driver.seal.pickupHint')}</p>
      {on.map((s) => {
        const r = reads[s.sealId];
        return (
          <div class="seal-steps__one" key={s.sealId}>
            <p class="seal-steps__what">{t('driver.seal.which', { no: s.no, what: sealWhat(s, t) })}</p>
            <div class="field">
              <label class="field__label" for={`seal-read-${s.no}`}>
                {t('driver.seal.readLabel')}
              </label>
              <input id={`seal-read-${s.no}`} class="input seal-steps__num" autocomplete="off" autocapitalize="characters" maxLength={40} value={r?.number ?? ''} disabled={busy} onInput={(e) => void read(s, e.currentTarget.value)} />
              {r?.ok === true ? <p class="seal-steps__ok">{t('driver.seal.matches')}</p> : r?.ok === false ? <p class="seal-steps__no">{t('driver.seal.mismatch')}</p> : null}
            </div>
            <div class="field">
              <span class="field__label">{t('driver.seal.closeUp', { no: s.no })}</span>
              <PhotoField id={`seal-photo-${s.no}`} value={r?.photoRef ?? ''} upload={(f) => actions.uploadPhoto('seal', f)} onCapture={(ref) => set(s.sealId, { photoRef: ref })} label={t('driver.seal.closeUp', { no: s.no })} disabled={busy} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** At the door: the receiver looks at the seals with the driver. Asked of every load that has had a seal. */
export function DeliverySeals({ claim, value, onChange, busy }: { claim: Claimable; value: SealsAtDelivery | null; onChange: (v: SealsAtDelivery) => void; busy: boolean }) {
  const t = useT();
  if (!claim.seals?.length) return null;
  return (
    <div class="seal-steps">
      <p class="field__label">{t('driver.seal.doorTitle')}</p>
      <div class="chips">
        {(['as_on_the_note', 'not_as_on_the_note'] as const).map((v) => (
          <button key={v} type="button" class={'chip chip--tap' + (value === v ? ' chip--on' : '')} aria-pressed={value === v} disabled={busy} onClick={() => onChange(v)}>
            {t(v === 'as_on_the_note' ? 'driver.seal.doorAsWritten' : 'driver.seal.doorNot')}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ClearedSeals({ claim, actions, value, onChange, busy }: { claim: Claimable; actions: DriverActions; value: SealsAtPost; onChange: (v: SealsAtPost) => void; busy: boolean }) {
  const t = useT();
  const on = sealsOn(claim);
  if (!on.length) return null;
  const pick = (sealId: string) => {
    const next = { ...value.replaced };
    if (next[sealId]) delete next[sealId];
    else next[sealId] = { newNumber: '', photoRef: '', officer: '' };
    onChange({ ...value, replaced: next });
  };
  const setOne = (sealId: string, patch: Partial<SealsAtPost['replaced'][string]>) => onChange({ ...value, replaced: { ...value.replaced, [sealId]: { ...value.replaced[sealId], ...patch } } });
  return (
    <div class="seal-steps">
      <p class="field__label">{t('driver.seal.postTitle', { n: on.length })}</p>
      <div class="chips">
        <button type="button" class={'chip chip--tap' + (value.asTheyWere === true ? ' chip--on' : '')} aria-pressed={value.asTheyWere === true} disabled={busy} onClick={() => onChange({ asTheyWere: true, replaced: {} })}>
          {t('driver.seal.asTheyWere')}
        </button>
        <button type="button" class={'chip chip--tap' + (value.asTheyWere === false ? ' chip--on' : '')} aria-pressed={value.asTheyWere === false} disabled={busy} onClick={() => onChange({ ...value, asTheyWere: false })}>
          {t('driver.seal.resealed')}
        </button>
      </div>
      {value.asTheyWere === false ? (
        <>
          <p class="hint">{t('driver.seal.whichReplaced')}</p>
          <div class="chips">
            {on.map((s) => (
              <button key={s.sealId} type="button" class={'chip chip--tap' + (value.replaced[s.sealId] ? ' chip--on' : '')} aria-pressed={Boolean(value.replaced[s.sealId])} disabled={busy} onClick={() => pick(s.sealId)}>
                {t('driver.seal.no', { no: s.no })}
              </button>
            ))}
          </div>
          {on
            .filter((s) => value.replaced[s.sealId])
            .map((s) => (
              <div class="seal-steps__one" key={s.sealId}>
                <p class="seal-steps__what">{t('driver.seal.newFor', { no: s.no })}</p>
                <div class="field">
                  <label class="field__label" for={`seal-new-${s.no}`}>
                    {t('driver.seal.newNumber')}
                  </label>
                  <input id={`seal-new-${s.no}`} class="input seal-steps__num" autocomplete="off" autocapitalize="characters" maxLength={40} value={value.replaced[s.sealId].newNumber} disabled={busy} onInput={(e) => setOne(s.sealId, { newNumber: e.currentTarget.value })} />
                </div>
                <div class="field">
                  <span class="field__label">{t('driver.seal.newCloseUp')}</span>
                  <PhotoField id={`seal-new-photo-${s.no}`} value={value.replaced[s.sealId].photoRef} upload={(f) => actions.uploadPhoto('seal', f)} onCapture={(ref) => setOne(s.sealId, { photoRef: ref })} label={t('driver.seal.newCloseUp')} disabled={busy} />
                </div>
                <div class="field">
                  <label class="field__label" for={`seal-officer-${s.no}`}>
                    {t('driver.seal.officer')}
                  </label>
                  <input id={`seal-officer-${s.no}`} class="input" maxLength={80} value={value.replaced[s.sealId].officer} disabled={busy} onInput={(e) => setOne(s.sealId, { officer: e.currentTarget.value })} />
                </div>
              </div>
            ))}
        </>
      ) : null}
    </div>
  );
}

const CAUSE_WORD: Record<SealBreakCause, MessageKey> = {
  police: 'driver.seal.cause.police',
  customs: 'driver.seal.cause.customs',
  repair: 'driver.seal.cause.repair',
  found_broken: 'driver.seal.cause.found_broken',
  other: 'driver.seal.cause.other',
};

/** A seal found broken on the road: which, what broke it, its photograph, any official paper. */
export function BrokenSealSheet({ claim, state, actions, onClose }: { claim: Claimable | null; state: DriverState; actions: DriverActions; onClose: () => void }) {
  const t = useT();
  const [sealId, setSealId] = useState('');
  const [cause, setCause] = useState<SealBreakCause | ''>('');
  const [photo, setPhoto] = useState('');
  const [paper, setPaper] = useState('');
  const [note, setNote] = useState('');
  const on = claim ? sealsOn(claim) : [];
  useEffect(() => {
    setSealId(on.length === 1 ? on[0].sealId : '');
    setCause('');
    setPhoto('');
    setPaper('');
    setNote('');
  }, [claim?.ref]);
  const busy = claim ? state.busy === `seal:${claim.ref}` : false;
  return (
    <Sheet open={!!claim} onClose={onClose} title={t('driver.seal.brokenTitle')}>
      {claim ? (
        <>
          <p class="t-body">{t('driver.seal.brokenBody', { ref: claim.code ?? claim.ref })}</p>
          {on.length > 1 ? (
            <div class="chips">
              {on.map((s) => (
                <button key={s.sealId} type="button" class={'chip chip--tap' + (sealId === s.sealId ? ' chip--on' : '')} aria-pressed={sealId === s.sealId} onClick={() => setSealId(s.sealId)}>
                  {t('driver.seal.which', { no: s.no, what: sealWhat(s, t) })}
                </button>
              ))}
            </div>
          ) : null}
          <p class="field__label" style="margin-top:12px">
            {t('driver.seal.whatBroke')}
          </p>
          <div class="chips">
            {SEAL_BREAK_CAUSES.map((c) => (
              <button key={c} type="button" class={'chip chip--tap' + (cause === c ? ' chip--on' : '')} aria-pressed={cause === c} onClick={() => setCause(c)}>
                {t(CAUSE_WORD[c])}
              </button>
            ))}
          </div>
          <div class="field" style="margin-top:12px">
            <span class="field__label">{t('driver.seal.brokenPhoto')}</span>
            <PhotoField id="seal-broken-photo" value={photo} upload={(f) => actions.uploadPhoto('seal', f)} onCapture={setPhoto} label={t('driver.seal.brokenPhoto')} disabled={busy} />
          </div>
          <div class="field">
            <span class="field__label">{t('driver.seal.paperPhoto')}</span>
            <PhotoField id="seal-paper-photo" value={paper} upload={(f) => actions.uploadPhoto('seal', f)} onCapture={setPaper} label={t('driver.seal.paperPhoto')} disabled={busy} />
          </div>
          <div class="field">
            <label class="field__label" for="seal-broken-note">
              {t('driver.seal.brokenNote')}
            </label>
            <textarea id="seal-broken-note" class="input" rows={2} maxLength={500} value={note} onInput={(e) => setNote(e.currentTarget.value)} disabled={busy} />
          </div>
          <p class="hint">{t('driver.seal.brokenWho')}</p>
          <Button
            chevron={false}
            busy={busy}
            disabled={!sealId || !cause || !photo}
            onClick={() => {
              if (!cause) return;
              void actions.reportBrokenSeal(claim.ref, sealId, { cause, photoRefs: [photo], ...(paper ? { paperRef: paper } : {}), ...(note.trim() ? { note: note.trim() } : {}) });
              onClose();
            }}
          >
            {t('driver.seal.brokenSend')}
          </Button>
          <Button variant="link" onClick={onClose}>
            {t('driver.cancel')}
          </Button>
        </>
      ) : null}
    </Sheet>
  );
}
