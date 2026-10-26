import { useState } from 'preact/hooks';
import { useT } from '../../../shared/i18n';
import { Button, Card, ErrorNote, Note, Pill, ScanField, Sheet } from '../../../shared/ui';
import { canSayMissed, hubArrivalWord, loadLine, onIt, stillToScan, unitsLine, unitsOf, WORD_TONE } from '../arrivals';
import type { MdpActions, MdpState } from '../useMdpApp';
import { dayLabel } from './ArrivalsScreen';
import { TamperSheet } from './TamperSheet';

/** How many parcels still to scan the screen lists as chips to tap; the rest are counted. */
const CHIPS = 12;

/**
 * ONE ARRIVAL AT THE DOOR (reading B): what the store booked to come; counted at the door (the units that came, a line of
 * what was seen); then each parcel scanned in off them — the last one ends it, or the hub ends it by hand and what was not
 * there stays the store's. A day gone with nothing at the door: the hub says it did not come. Each step asks the server,
 * and the floor reads its answer.
 */
export function ArrivalScreen({ state, actions }: { state: MdpState; actions: MdpActions }) {
  const t = useT();
  const a = state.arrivals?.arrivals.find((x) => x.arrivalId === state.arrivalId) ?? null;
  const [units, setUnits] = useState(a ? String(a.units) : '');
  const [note, setNote] = useState('');
  const [confirm, setConfirm] = useState<'finish' | 'missed' | null>(null);

  if (!a) {
    return (
      <div class="scr">
        <Note tone="info" icon="info" title={t('mdp.arrival.gone')} />
        <Button variant="outline" onClick={() => actions.openArrival(null)}>
          {t('mdp.backToArrivals')}
        </Button>
      </div>
    );
  }

  const word = hubArrivalWord(a);
  const left = stillToScan(a);
  // What the server will call missing when it is finished: every parcel booked and not scanned in.
  const notIn = a.parcels.filter((p) => !p.scanned).length;
  const counted = unitsOf(units);
  const scan = state.arrivalScan?.arrivalId === a.arrivalId ? state.arrivalScan : null;
  const all = onIt(a).length;
  const pct = all ? Math.round((a.scannedCount / all) * 100) : 0;

  return (
    <div class="scr">
      <h1 class="scr__title">{a.storeName}</h1>
      <p class="scr__lede">{[a.reference, t('mdp.arrival.booked', { load: loadLine(a, t), day: dayLabel(a.expectedOn) })].filter(Boolean).join(' · ')}</p>
      <div class="arrival__meta">
        <Pill tone={WORD_TONE[word]}>{t(`mdp.arrivals.word.${word}` as never)}</Pill>
        {a.bringer ? <span class="hint">{t('mdp.arrivals.bringer', { who: a.bringer })}</span> : null}
      </div>
      {state.error ? <ErrorNote error={state.error} /> : null}

      {a.state === 'expected' ? (
        <>
          {a.late ? <Note tone="warn" icon="clock" title={t('mdp.arrival.lateLine', { day: dayLabel(a.expectedOn) })} /> : null}
          <Card title={t('mdp.arrival.doorTitle')}>
            <p class="card__note">{t('mdp.arrival.doorBody')}</p>
            <div class="field">
              <label class="field__label" for="arrival-units">
                {t(`mdp.arrival.unitsLabel.${a.unitKind}` as never)}
              </label>
              <input id="arrival-units" class="input" type="number" inputMode="numeric" min={1} max={100} value={units} onInput={(e) => setUnits(e.currentTarget.value)} />
              {counted !== null && counted < a.units ? <p class="hint">{t('mdp.arrival.fewer')}</p> : null}
              {counted !== null && counted > a.units ? <p class="hint">{t('mdp.arrival.more')}</p> : null}
            </div>
            <div class="field">
              <label class="field__label" for="arrival-note">
                {t('mdp.arrival.noteLabel')}
              </label>
              <textarea id="arrival-note" class="input" rows={2} maxLength={300} placeholder={t('mdp.arrival.notePlaceholder')} value={note} onInput={(e) => setNote(e.currentTarget.value)} />
            </div>
            <Button chevron={false} busy={state.busy === 'arrival-receive'} disabled={counted === null} onClick={() => counted !== null && void actions.receiveArrival(counted, note)}>
              {t('mdp.arrival.receive')}
            </Button>
          </Card>
          {canSayMissed(a) ? (
            <Button variant="link" onClick={() => setConfirm('missed')}>
              {t('mdp.arrival.missedTitle')}
            </Button>
          ) : null}
        </>
      ) : null}

      {a.state === 'receiving' ? (
        <>
          <div aria-live="polite">
            {scan ? <Note tone={scan.already ? 'warn' : 'ok'} icon="check" title={`${t(scan.already ? 'mdp.arrival.lastAgain' : 'mdp.arrival.lastK')}: ${scan.parcelId}`} detail={t('mdp.arrival.lastDest', { dest: scan.destination })} /> : null}
          </div>
          <Card title={t('mdp.arrival.scanTitle')} aside={<span class="row__count">{t('mdp.arrivals.progress', { done: a.scannedCount, all })}</span>}>
            <span class="fillbar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={t('mdp.arrivals.progress', { done: a.scannedCount, all })}>
              <span style={`width:${pct}%`} />
            </span>
            <div style="margin-top:12px">
              <ScanField
                id="arrival-code"
                label={t('mdp.arrival.scanLabel')}
                value={state.form.arrivalCode}
                onValue={(v) => actions.setForm({ arrivalCode: v })}
                expect="parcel"
                placeholder={t('mdp.arrival.scanPlaceholder')}
                upper
                enterKeyHint="go"
                onScan={(v) => void actions.scanArrival(v)}
              />
            </div>
            <div style="margin-top:12px">
              <Button chevron={false} busy={state.busy === 'arrival-scan'} disabled={!state.form.arrivalCode.trim()} onClick={() => void actions.scanArrival()}>
                {t('mdp.arrival.scanCta')}
              </Button>
            </div>
            <Button variant="link" onClick={() => actions.openTamper(scan && !scan.already ? scan.parcelId : '')}>
              {t('mdp.arrival.tamper')}
            </Button>
            {left.length ? (
              <>
                <p class="hint" style="margin-top:12px">
                  {t('mdp.arrival.toScan', { n: left.length })}
                </p>
                <div class="chips">
                  {left.slice(0, CHIPS).map((p) => (
                    <button key={p.parcelId} type="button" class={`chip chip--tap mono${state.form.arrivalCode === p.parcelId ? ' chip--on' : ''}`} onClick={() => actions.setForm({ arrivalCode: p.parcelId })}>
                      {p.parcelId}
                    </button>
                  ))}
                </div>
                {left.length > CHIPS ? <p class="hint">{t('mdp.arrival.andMore', { n: left.length - CHIPS })}</p> : null}
              </>
            ) : null}
          </Card>
          <Button variant="outline" onClick={() => setConfirm('finish')}>
            {t('mdp.arrival.finish')}
          </Button>
        </>
      ) : null}

      {a.state === 'received' ? (
        <Card>
          {a.finished?.missing.length ? (
            <Note tone="warn" icon="warning" title={t('mdp.arrival.someMissing', { done: a.scannedCount, all: a.parcels.length, ids: a.finished.missing.join(', ') })} />
          ) : (
            <Note tone="ok" icon="check" title={t('mdp.arrival.allIn', { n: a.scannedCount })} />
          )}
          {a.received ? <p class="card__note">{t('mdp.arrival.counted', { units: unitsLine(a.unitKind, a.received.units, t), who: a.received.by })}</p> : null}
          {a.received?.note ? <p class="card__note">{t('mdp.arrival.noted', { note: a.received.note })}</p> : null}
          {a.scannedCount ? (
            <Button chevron={false} onClick={() => actions.go('sort')}>
              {t('mdp.arrival.toSort')}
            </Button>
          ) : null}
        </Card>
      ) : null}

      {a.state === 'withdrawn' ? <Note tone="info" icon="info" title={t('mdp.arrival.withdrawnLine')} /> : null}
      {a.state === 'missed' ? <Note tone="info" icon="info" title={t('mdp.arrival.missedLine')} /> : null}

      <Sheet open={confirm !== null} onClose={() => setConfirm(null)} title={t(confirm === 'missed' ? 'mdp.arrival.missedTitle' : 'mdp.arrival.finish')}>
        {confirm === 'finish' ? (
          <>
            <p class="t-body">{t('mdp.arrival.finishBody', { n: notIn })}</p>
            <Button
              chevron={false}
              busy={state.busy === 'arrival-finish'}
              onClick={async () => {
                await actions.finishArrival();
                setConfirm(null);
              }}
            >
              {t('mdp.arrival.finishYes')}
            </Button>
            <Button variant="link" onClick={() => setConfirm(null)}>
              {t('mdp.arrival.finishNo')}
            </Button>
          </>
        ) : null}
        {confirm === 'missed' ? (
          <>
            <p class="t-body">{t('mdp.arrival.missedBody')}</p>
            <Button
              chevron={false}
              busy={state.busy === 'arrival-missed'}
              onClick={async () => {
                await actions.missedArrival();
                setConfirm(null);
              }}
            >
              {t('mdp.arrival.missedYes')}
            </Button>
            <Button variant="link" onClick={() => setConfirm(null)}>
              {t('mdp.bulk.notNow')}
            </Button>
          </>
        ) : null}
      </Sheet>

      <TamperSheet state={state} actions={actions} />
    </div>
  );
}
