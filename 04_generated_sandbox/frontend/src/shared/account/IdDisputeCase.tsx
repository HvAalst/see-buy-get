import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { Button, CodeCard, Icon, Note, RefusalNote } from '../ui';
import { useT } from '../i18n';
import type { Result, SbgError } from '../../lib/sbg';
import { downscaleImage } from '../media';
import { DISPUTE_PHOTOS, appointmentDays, bringLines, dayChoices, dayLabel, hoursOn, idActions, idStatusSays, readyToAppoint, ticketLines, visitingWords, type DisputePhoto, type DisputeStatus, type IdDisputeApi } from './idDispute';

export interface IdDisputeCaseProps {
  api: IdDisputeApi;
  /** The reader's OWN reference: it is what everything here is read and done with. */
  reference: string;
  /** What the server just answered, where the caller already has it — spares a second asking. */
  initial?: DisputeStatus;
  /**
   * "The number on my record is not mine — this one is." Only a signed-in holder can say it, so only Settings hands
   * this in; at a sign-in screen the reader is told where it is instead.
   */
  ownId?: (nationalId: string) => Promise<Result<{ saved: boolean }>>;
  /** Something changed that the caller's own view should read again (the account, in Settings). */
  onChanged?: () => void;
}

/**
 * ONE PERSON'S SIDE OF A DISPUTE OVER A NATIONAL ID — the same sheet for the one who was refused at registration and
 * for the one who holds the number, each with a reference of their own.
 *
 * The user, 2026-10-08: "keep your ID visible under your chin and take a selfie"; front and back; "someone can take
 * the pic of it to get a stable quality"; still disputed, "an appointment in person" with "a ticket with
 * instructions and what they need to bring".
 *
 * It leads with where things stand and what to do next, then offers only what the server says is still open to
 * this reader: the photographs, taking it back, a day to come in, the ticket.
 */
export function IdDisputeCase({ api, reference, initial, ownId, onChanged }: IdDisputeCaseProps) {
  const t = useT();
  const [status, setStatus] = useState<DisputeStatus | null>(initial ?? null);
  const [error, setError] = useState<SbgError | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [date, setDate] = useState('');
  const [at, setAt] = useState('');
  const [number, setNumber] = useState('');
  const [correcting, setCorrecting] = useState(false);

  const take = useCallback(
    (r: Result<DisputeStatus>) => {
      setError(r.error ?? null);
      if (!r.error && r.data) setStatus(r.data);
      return !r.error;
    },
    [setStatus],
  );
  const load = useCallback(async () => take(await api.status(reference)), [api, reference, take]);
  useEffect(() => {
    if (!initial) void load();
  }, [reference]);

  const act = async (key: string, fn: () => Promise<Result<DisputeStatus>>) => {
    setBusy(key);
    const ok = take(await fn());
    setBusy(null);
    if (ok) onChanged?.();
    return ok;
  };

  if (!status) return error ? <RefusalNote error={error} /> : <p class="hint">{t('account.id.loading')}</p>;

  const says = idStatusSays(status, t as never);
  const can = idActions(status);
  const days = appointmentDays();
  // The days — and hours — the SERVER says there are: the company's visiting days, without the dates it is closed
  // and the hours that are full. Offered as they are, and nothing else is.
  const choices = dayChoices(status);
  const hours = date ? hoursOn(status, date) : null;
  const ticket = status.ticket;

  return (
    <div class="idcase">
      <Note tone={says.tone} icon={says.icon} title={says.title} detail={says.lines.join(' ')} />

      {can.photos ? (
        <>
          {/* Written by hand and held in the picture: it is what makes the photograph one taken for THIS. */}
          <CodeCard label={t('account.id.reference')} code={status.reference} sayLabel={t('account.move.hear')} long />
          <ol class="idsteps">
            <li>{t('account.id.step.write')}</li>
            <li>{t('account.id.step.face')}</li>
            <li>{t('account.id.step.card')}</li>
          </ol>
          <p class="hint">{t('account.id.step.helper')}</p>
          {DISPUTE_PHOTOS.map((which) => (
            <Shot
              key={which}
              which={which}
              done={status.photos.includes(which)}
              disabled={busy !== null}
              upload={async (file) => {
                const img = await downscaleImage(file, { maxEdge: 1600, quality: 0.8 }).catch(() => null);
                if (!img) return false;
                return take(await api.photo(status.reference, which, img.dataUrl, img.thumbDataUrl));
              }}
            />
          ))}
          <p class="hint">{t('account.id.privacy')}</p>
          <Button chevron={false} disabled={status.photos.length < DISPUTE_PHOTOS.length} busy={busy === 'send'} onClick={() => void act('send', () => api.send(status.reference))}>
            {t('account.id.sendCta')}
          </Button>
        </>
      ) : null}

      {ticket ? (
        <section class="idticket" aria-label={t('account.id.ticket.title')}>
          <div class="idticket__head">
            <Icon name="clock" size={20} />
            <span>{t('account.id.ticket.title')}</span>
          </div>
          <CodeCard label={t('account.id.reference')} code={ticket.reference} sayLabel={t('account.move.hear')} long />
          <dl class="idticket__facts">
            <dt>{t('account.id.ticket.when')}</dt>
            <dd>{ticketLines(ticket, t as never).when}</dd>
            <dt>{t('account.id.ticket.where')}</dt>
            <dd>
              {ticketLines(ticket, t as never).where.map((line) => (
                <span class="idticket__line" key={line}>
                  {line}
                </span>
              ))}
            </dd>
            <dt>{t('account.id.ticket.bring')}</dt>
            <dd>
              <ul class="idticket__bring">
                {bringLines(ticket, status.register, t as never).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </dd>
          </dl>
          {ticket.offDay ? <Note tone="warn" icon="warning" title={t('account.id.ticket.offDay')} detail={t(ticket.yours ? 'account.id.ticket.offDayYours' : 'account.id.ticket.offDayTheirs')} /> : null}
          <p class="hint">{t(ticket.yours ? 'account.id.ticket.noShow' : 'account.id.ticket.mayCome')}</p>
        </section>
      ) : null}

      {can.appoint || can.changeDay ? (
        <div class="field">
          <label class="field__label" for="id-day">
            {t(can.changeDay ? 'account.id.changeDay' : 'account.id.chooseDay')}
          </label>
          {choices ? (
            <>
              <p class="hint">{t('account.id.chooseDayFrom', { when: visitingWords(status.support, t as never) ?? '' })}</p>
              {choices.length ? (
                <div id="id-day" class="tapset" role="group">
                  {choices.map((c) => (
                    <button
                      type="button"
                      key={c.date}
                      class={`tapset__btn${date === c.date ? ' tapset__btn--on' : ''}`}
                      aria-pressed={date === c.date}
                      disabled={busy !== null}
                      onClick={() => {
                        setDate(c.date);
                        setAt('');
                      }}
                    >
                      {dayLabel(c.date)}
                    </button>
                  ))}
                </div>
              ) : (
                <Note tone="warn" icon="warning" title={t('account.id.noDayFree')} detail={t('account.id.noDayFreeDetail')} />
              )}
              {/* Where the office counts its visitors by the hour: the hours of that day, and which are full. */}
              {hours ? (
                <>
                  <p class="hint">{t('account.id.chooseHour')}</p>
                  <div id="id-hour" class="tapset" role="group">
                    {hours.map((h) => (
                      <button type="button" key={h.at} class={`tapset__btn${at === h.at ? ' tapset__btn--on' : ''}`} aria-pressed={at === h.at} disabled={busy !== null || h.free < 1} onClick={() => setAt(h.at)}>
                        {h.free < 1 ? t('account.id.hourFull', { at: h.at }) : h.at}
                      </button>
                    ))}
                  </div>
                </>
              ) : null}
            </>
          ) : (
            <>
              <input id="id-day" class="input" type="date" min={days.min} max={days.max} value={date} onInput={(e) => setDate(e.currentTarget.value)} disabled={busy !== null} />
              <p class="hint">{t('account.id.chooseDayNoDays')}</p>
            </>
          )}
          <p class="hint">{can.changeDay ? t('account.id.changeDayHint', { n: ticket?.changesLeft ?? 0 }) : t('account.id.chooseDayHint')}</p>
          <Button
            variant={can.changeDay ? 'outline' : undefined}
            chevron={false}
            disabled={!readyToAppoint(status, date, at)}
            busy={busy === 'day'}
            onClick={async () => {
              if (await act('day', () => api.appoint(status.reference, date, at || undefined))) {
                setDate('');
                setAt('');
              }
            }}
          >
            {t(can.changeDay ? 'account.id.changeDayCta' : 'account.id.chooseDayCta')}
          </Button>
        </div>
      ) : null}

      {/* The one thing only the holder can say — and what ends a hold. Offered where they are signed in. */}
      {can.ownId && ownId ? (
        correcting ? (
          <div class="field">
            <label class="field__label" for="id-own">
              {t('account.id.own.label')}
            </label>
            <input id="id-own" class="input input--mono" value={number} onInput={(e) => setNumber(e.currentTarget.value)} spellcheck={false} disabled={busy !== null} />
            <p class="hint">{t(status.held ? 'account.id.own.hintHeld' : 'account.id.own.hint')}</p>
            <Button
              chevron={false}
              disabled={number.trim().length < 3}
              busy={busy === 'own'}
              onClick={async () => {
                setBusy('own');
                const r = await ownId(number.trim());
                setBusy(null);
                setError(r.error ?? null);
                if (r.error) return;
                setCorrecting(false);
                setNumber('');
                await load();
                onChanged?.();
              }}
            >
              {t('account.id.own.cta')}
            </Button>
          </div>
        ) : (
          <Button variant="outline" chevron={false} onClick={() => setCorrecting(true)}>
            {t(status.held ? 'account.id.own.openHeld' : 'account.id.own.open')}
          </Button>
        )
      ) : null}
      {can.ownId && !ownId && status.side === 'holder' ? <p class="hint">{t('account.id.own.signIn')}</p> : null}

      {error ? <RefusalNote error={error} /> : null}

      {can.withdraw ? (
        <Button variant="link" busy={busy === 'withdraw'} onClick={() => void act('withdraw', () => api.withdraw(status.reference))}>
          {t('account.id.withdraw')}
        </Button>
      ) : null}
    </div>
  );
}

/**
 * ONE OF THE THREE PHOTOGRAPHS. The face goes to the front camera, the card to the back one — a hint the phone may
 * ignore, and that somebody taking the picture FOR them simply flips. What was just taken is shown, large enough
 * to see whether the number can be read: that is the check the person is asked to make before sending.
 */
function Shot({ which, done, disabled, upload }: { which: DisputePhoto; done: boolean; disabled: boolean; upload: (file: File) => Promise<boolean> }) {
  const t = useT();
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const pick = async (file: File) => {
    setFailed(false);
    setBusy(true);
    setPreview(URL.createObjectURL(file));
    const ok = await upload(file);
    setBusy(false);
    if (!ok) {
      setFailed(true);
      setPreview(null);
    }
  };
  const taken = done && !busy && !failed;

  return (
    <div class="idshot">
      <input
        ref={input}
        id={`id-shot-${which}`}
        class="idshot__input"
        type="file"
        accept="image/*"
        capture={which === 'face' ? 'user' : 'environment'}
        disabled={disabled || busy}
        onChange={(e) => {
          const f = e.currentTarget.files?.[0];
          e.currentTarget.value = '';
          if (f) void pick(f);
        }}
      />
      {preview ? <img class="idshot__preview" src={preview} alt="" /> : null}
      <button type="button" class={`idshot__btn${taken ? ' idshot__btn--done' : ''}`} disabled={disabled || busy} onClick={() => input.current?.click()}>
        <Icon name={busy ? 'clock' : taken ? 'check' : 'camera'} size={24} />
        <span class="idshot__words">
          <span class="idshot__t">{t(`account.id.shot.${which}` as never)}</span>
          <span class="idshot__s">{t(busy ? 'account.id.shot.sending' : failed ? 'account.id.shot.failed' : taken ? 'account.id.shot.retake' : (`account.id.shot.${which}Hint` as never))}</span>
        </span>
      </button>
    </div>
  );
}
