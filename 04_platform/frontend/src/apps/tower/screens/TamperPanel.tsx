import { useEffect, useState } from 'preact/hooks';
import { useT, type MessageKey } from '../../../shared/i18n';
import { findingWords, heldLine, heldWhen, releaseBlocker, type TamperUnit } from '../../../shared/tamper';
import type { TowerActions, TowerState } from '../useTowerApp';
import { DocumentStrip } from './DocumentStrip';
import { TrailPanel } from './TrailPanel';

const BY_KEY: Record<'driver' | 'shop' | 'hub', MessageKey> = {
  driver: 'tower.tamper.byDriver',
  shop: 'tower.tamper.byShop',
  hub: 'tower.tamper.byHub',
};

/**
 * ROUND 35 — A UNIT HELD UNDER THE TAMPER PROTOCOL, in its case. Every exception on it — what was found, where, when,
 * by whom, the photographs, the SSCCs it was logged against, its fingerprint — and the one act this case closes by: the
 * release, with what was found and what was done. Releasing judges nothing; it lets the unit change hands again, and the
 * exception stays on its record.
 */
export function TamperPanel({ subject, live, state, actions, onReleased }: { subject: string; live: boolean; state: TowerState; actions: TowerActions; onReleased: () => void }) {
  const t = useT();
  const [unit, setUnit] = useState<TamperUnit | null | undefined>(undefined);
  const [releasing, setReleasing] = useState(false);
  const [reason, setReason] = useState('');
  useEffect(() => {
    let gone = false;
    setUnit(undefined);
    setReleasing(false);
    setReason('');
    void actions.tamperUnit(subject).then((u) => {
      if (!gone) setUnit(u);
    });
    return () => {
      gone = true;
    };
  }, [subject]);
  const busy = state.caseBusy === subject;
  const blocker = releaseBlocker(reason, t);

  if (unit === undefined) return <p class="chint">{t('tower.tamper.loading')}</p>;
  if (unit === null) return <p class="cerr">{t('tower.tamper.unreadable')}</p>;

  return (
    <>
      <section class="cons__panel">
        <div class="cons__panelhead">
          <span class="cons__panelt">{t(unit.unitType === 'load' ? 'tower.tamper.load' : unit.unitType === 'bag' ? 'tower.tamper.bag' : 'tower.tamper.parcel', { ref: unit.ref })}</span>
        </div>
        <p>{unit.held ? heldLine(unit.held, t) : t('tower.tamper.notHeld')}</p>
        {/* Round 36 — a bag: how it was closed, the number to read beside the number reported. */}
        {unit.closedWith ? (
          <p class="chint">
            {unit.closedWith.number
              ? t('tower.tamper.closedSeal', { number: unit.closedWith.number, place: unit.closedWith.place, when: heldWhen(unit.closedWith.closedAt) })
              : t('tower.tamper.closedPhoto', { place: unit.closedWith.place, when: heldWhen(unit.closedWith.closedAt) })}
          </p>
        ) : null}
        {/* Round 37 — the driver who took it, and the number they read off it. */}
        {unit.closedWith?.taken ? (
          <p class="chint">
            {unit.closedWith.taken.numberRead
              ? t('tower.tamper.takenRead', { by: unit.closedWith.taken.by, number: unit.closedWith.taken.numberRead, when: heldWhen(unit.closedWith.taken.at) })
              : t('tower.tamper.takenPhoto', { by: unit.closedWith.taken.by, when: heldWhen(unit.closedWith.taken.at) })}
            {unit.closedWith.taken.asClosed ? '' : ` ${t('tower.tamper.takenAsFound')}`}
          </p>
        ) : null}
        {unit.exceptions.map((e) => (
          <div key={e.exceptionId} class="cons__panel" style="margin-top:10px">
            <p>
              <b>{findingWords(e.finding, t)}</b> — {e.where}, {heldWhen(e.at)}
              {e.receivedAt ? ` ${t('tower.tamper.late', { when: heldWhen(e.receivedAt) })}` : ''}
            </p>
            <p class="chint">{t(BY_KEY[e.byAs], { name: e.byName ?? '—' })}</p>
            {e.sealNo ? (
              <p class="chint">
                {e.numberRead ? t('tower.tamper.sealRead', { no: e.sealNo, read: e.numberRead }) : e.cause ? t('tower.tamper.sealBroke', { no: e.sealNo, cause: e.cause.replace(/_/g, ' ') }) : t('tower.tamper.sealNo', { no: e.sealNo })}
              </p>
            ) : null}
            {e.note ? <p class="chint">“{e.note}”</p> : null}
            <p class="chint">{e.ssccs.length ? t('tower.tamper.ssccs', { codes: e.ssccs.join(', ') }) : t('tower.tamper.noSscc')}</p>
            <DocumentStrip refs={e.photoRefs} state={state} actions={actions} titleKey="tower.tamper.photos" emptyKey="tower.tamper.noPhotos" />
            <p class="ctbl__sub mono">{t('tower.tamper.fingerprint', { hash: e.fingerprint.slice(0, 16) })}</p>
            {e.release ? <p class="chint">{t('tower.tamper.released', { by: e.release.by, when: heldWhen(e.release.at), reason: e.release.reason })}</p> : null}
          </div>
        ))}
        {live && unit.held ? (
          <div class="twr-panelend">
            <button type="button" class="cbtn cbtn--primary cbtn--sm" disabled={busy} onClick={() => setReleasing((x) => !x)}>
              {t('tower.tamper.releaseCta')}
            </button>
          </div>
        ) : null}
      </section>
      {/* The trail: a load's or a bag's steps, anchored as they were kept, checked now. */}
      {unit.unitType !== 'parcel' ? <TrailPanel unitRef={unit.ref} actions={actions} /> : null}

      {live && unit.held && releasing ? (
        <section class="cons__panel">
          <p class="chint">{t('tower.tamper.releaseLede')}</p>
          <label class="cfield">
            <span class="cfield__label">{t('tower.tamper.reasonLabel')}</span>
            <textarea class="cinput" rows={3} maxLength={500} value={reason} onInput={(e) => setReason((e.target as HTMLTextAreaElement).value)} />
          </label>
          {reason && blocker ? <p class="cerr">{blocker}</p> : null}
          <div class="twr-panelend">
            <button
              type="button"
              class="cbtn cbtn--primary cbtn--sm"
              disabled={busy || Boolean(blocker)}
              onClick={async () => {
                if (await actions.releaseHold(subject, reason.trim())) onReleased();
              }}
            >
              {t('tower.tamper.releaseConfirm')}
            </button>
          </div>
        </section>
      ) : null}
    </>
  );
}
