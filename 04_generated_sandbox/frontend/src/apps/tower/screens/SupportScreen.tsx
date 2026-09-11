import { useState } from 'preact/hooks';
import { Icon } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import type { TowerActions, TowerState } from '../useTowerApp';

/**
 * The screen that answers a phone call.
 *
 * Somebody is standing at a counter, or on the line, and the question is always the same: where is this
 * parcel and what happens next. So it is one box, one lookup, and the parcel's own history — not a
 * search over the whole network, because the caller already knows the number on the sticker.
 *
 * THE RELEASE CODE IS THE POINT OF THE SECOND HALF. A parcel never carries its own release key and the
 * shop that hands it over never learns it; both codes are minted at genesis and the only way back from a
 * burnt one is rotation from here. Which is why this screen can reissue and cannot reveal: what comes
 * back is a NEW code sent to the buyer's app and the store — except for a peer send, where there is no
 * app to send it to and the OTP is returned once for the operator to read down the phone.
 */
export function SupportScreen({ state, actions }: { state: TowerState; actions: TowerActions }) {
  const t = useT();
  const [id, setId] = useState('');
  const p = state.lookup;

  const submit = (e: Event) => {
    e.preventDefault();
    if (id.trim()) void actions.lookupParcel(id.trim());
  };

  return (
    <>
      <header class="cons__head">
        <h1 class="cons__title">{t('tower.support.title')}</h1>
        <p class="cons__lede">{t('tower.support.lede')}</p>
      </header>

      <form class="twr-lookup" onSubmit={submit}>
        <input
          class="cinput"
          value={id}
          placeholder={t('tower.support.placeholder')}
          aria-label={t('tower.support.placeholder')}
          onInput={(e) => setId((e.target as HTMLInputElement).value)}
        />
        <button type="submit" class="cbtn cbtn--primary" disabled={!id.trim() || state.busyId === 'lookup'}>
          {t('tower.support.look')}
        </button>
      </form>

      {state.queueError ? <p class="cerr" style="max-width:96ch">{state.queueError}</p> : null}
      {state.done ? (
        <p class="twr-done" style="margin:0 0 16px">
          <Icon name="check" size={16} />
          {state.done}
        </p>
      ) : null}

      {!p ? (
        <div class="cons__panel">
          <div class="cons__empty">
            <p class="cons__emptyt">{t('tower.support.emptyTitle')}</p>
            <p>{t('tower.support.emptyBody')}</p>
          </div>
        </div>
      ) : (
        <>
          <section class="cons__panel">
            <div class="cons__panelhead">
              <span class="cons__panelt">{p.parcelId}</span>
              <span class="ctbl__sub">
                <span class="ctag ctag--info">{String(p.status).replace(/_/g, ' ')}</span> {p.size ?? '—'} · {p.origin ?? '—'} → {p.destination ?? '—'}
                {/* WHOSE PROMISE. An operator answering the phone about a parcel has to know whether this
                    is ours to answer for or a carrier's — it decides what they may offer the person on
                    the line. Absent on parcels taken in before the question was asked. */}
                {p.takeInPromise ? <span class={p.takeInPromise === 'ours' ? 'ctag ctag--ok' : 'ctag ctag--warn'}>{t(p.takeInPromise === 'ours' ? 'tower.support.promiseOurs' : 'tower.support.promiseTheirs')}</span> : null}
              </span>
            </div>

            {/* The recovery half of the release lockout, and only where a release is still possible. A
                parcel that has been collected has no code left to rotate. */}
            {p.status === 'Ready_For_Pickup' || p.status === 'Unclaimed' ? (
              <div class="twr-release">
                <span class={p.releaseLockedAt ? 'ctag ctag--warn' : 'ctag ctag--ok'}>
                  {p.releaseLockedAt ? t('tower.support.locked') : t('tower.support.live')}
                </span>
                <p class="chint">{t('tower.support.reissueHint')}</p>
                <button
                  type="button"
                  class="cbtn cbtn--ghost"
                  disabled={state.busyId === 'reissue'}
                  onClick={() => void actions.reissueRelease(p.parcelId)}
                >
                  {t('tower.support.reissue')}
                </button>
              </div>
            ) : null}

            {/* The OTP for a peer send comes back ONCE, and it is the only code this screen ever shows.
                Kept until it is dismissed by hand — a toast would take it away mid-sentence. */}
            {state.reissued ? (
              <div class="twr-reveal">
                <p class="twr-clear__t">{state.reissued.otp ? t('tower.support.otpTitle') : t('tower.support.sentTitle')}</p>
                <p class="twr-clear__b">{state.reissued.otp ? t('tower.support.otpBody') : t('tower.support.sentBody')}</p>
                {state.reissued.otp ? <p class="twr-reveal__creds"><span class="ctbl__mono twr-reveal__pw">{state.reissued.otp}</span></p> : null}
                <button type="button" class="cbtn cbtn--primary" onClick={actions.dismissReissued}>
                  {t('tower.support.otpDone')}
                </button>
              </div>
            ) : null}

            {(p.scans ?? []).length === 0 ? (
              <p class="cons__empty">{t('tower.support.noScans')}</p>
            ) : (
              <table class="ctbl">
                <thead>
                  <tr>
                    <th>{t('tower.support.col.step')}</th>
                    <th>{t('tower.support.col.note')}</th>
                    <th>{t('tower.support.col.when')}</th>
                  </tr>
                </thead>
                <tbody>
                  {(p.scans ?? []).map((s, i) => (
                    <tr key={`${s.at}-${i}`}>
                      <td class="ctbl__strong">{String(s.status).replace(/_/g, ' ')}</td>
                      <td class="ctbl__sub">{s.note || '—'}</td>
                      <td class="ctbl__sub">{new Date(s.at).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          {p.dropoffPhotoRef || p.deliveredPhotoRef || p.contentPhotoRef ? (
            <section class="cons__panel" style="margin-top:18px">
              <div class="cons__panelhead">
                <span class="cons__panelt">{t('tower.support.proofTitle')}</span>
                <span class="ctbl__sub">{t('tower.support.proofHint')}</span>
              </div>
              <table class="ctbl">
                <tbody>
                  {[
                    ['tower.support.proof.content', p.contentPhotoRef],
                    ['tower.support.proof.dropoff', p.dropoffPhotoRef],
                    ['tower.support.proof.delivered', p.deliveredPhotoRef],
                  ]
                    .filter(([, ref]) => Boolean(ref))
                    .map(([key, ref]) => (
                      <tr key={key as string}>
                        <td class="ctbl__strong">{t(key as never)}</td>
                        <td class="ctbl__mono">{ref}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </section>
          ) : null}
        </>
      )}
    </>
  );
}
