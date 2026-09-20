import { useEffect, useState } from 'preact/hooks';
import { Button, Card, Checkbox, Icon, Note, PhotoField, Pill, Sheet } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import type { DriverActions, DriverState } from '../useDriverApp';

/**
 * CL5 — THE COUNTER: what a driver was actually asked for, typed at the counter rather than that evening.
 *
 * The sister of RoadSection, and for the same reason: nobody publishes what a border post will ask for
 * this month, so the people who cross it build the list. One tap from the cab, while the clerk is still
 * handing the paper back.
 *
 * THREE THINGS HERE ARE NOT COSMETIC.
 *
 * FIRST, THE CAMERA IS NOT OFFERED UNTIL WE HAVE ASKED WHETHER WE MAY KEEP THE PICTURE. The country's
 * gate is read before the form opens, never after a photograph exists. Somebody who has already
 * photographed a customs document and is only then told we cannot hold it has been made to do something
 * they cannot undo — the picture is on their phone either way, and we invited it.
 *
 * SECOND, THE NOTICE IS THE SERVER'S WORDS, not ours. It arrives with the permission and is shown
 * verbatim above the camera, and the version travels back with the consent. A screen keeping its own copy
 * of a consent text is how two versions of it start existing, one of which nobody agreed to.
 *
 * THIRD, THE FORM CANNOT SAY A REQUIREMENT ENDED. There is a box for what you were asked for and no box
 * for what you were not. One person at a counter can witness being asked; nobody there witnesses a rule
 * changing, and a screen that collected it would be publishing our guess at somebody's law.
 */
export function CounterSection({ state, actions }: { state: DriverState; actions: DriverActions }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ place: '', subject: '', note: '', happenedOn: today(), firstHand: false });
  const [photo, setPhoto] = useState('');
  const [agreed, setAgreed] = useState(false);

  /*
   * WHICH COUNTRY'S COUNTER — asked, never guessed.
   *
   * At a border post this has two plausible answers and they are different jurisdictions: the photograph
   * gate is one country's law, and asking the wrong one would read a permission that was never given.
   * Chosen from the atlas rather than typed as two letters, which is this project's standing rule.
   */
  const [country, setCountry] = useState('');
  const [countryOpen, setCountryOpen] = useState(false);
  const [atlas, setAtlas] = useState<Array<{ code: string; name: string }>>([]);
  const [q, setQ] = useState('');

  useEffect(() => {
    if (!open || atlas.length) return;
    void actions.countries().then(setAtlas);
  }, [open, atlas.length]);

  const chosenCountry = atlas.find((c) => c.code === country);
  const needle = q.trim().toLowerCase();
  const shown = needle ? atlas.filter((c) => c.name.toLowerCase().includes(needle) || c.code.toLowerCase() === needle) : atlas;

  const permission = state.observationNotice;
  const mayPhotograph = Boolean(permission?.mayHoldEvidence);
  const complete = country && form.place.trim() && form.subject.trim() && form.firstHand;

  const reset = () => {
    setForm({ place: '', subject: '', note: '', happenedOn: today(), firstHand: false });
    setPhoto('');
    setAgreed(false);
  };

  return (
    <Card>
      <h2 class="road__h">{t('driver.counter.title')}</h2>
      <p class="card__note">{t('driver.counter.lede')}</p>

      <Button onClick={() => setOpen(true)} variant="outline" full>
        {t('driver.counter.add')}
      </Button>

      {open ? (
        <Sheet open onClose={() => setOpen(false)} title={t('driver.counter.add')}>
          {/* First, because everything below it depends on which country this was. */}
          <div class="field">
            <span class="field__label" id="counter-country-label">
              {t('driver.counter.country')}
            </span>
            <Button variant="outline" full onClick={() => setCountryOpen(true)} aria-labelledby="counter-country-label">
              {chosenCountry ? `${chosenCountry.name} (${chosenCountry.code})` : t('driver.counter.countryPick')}
            </Button>
          </div>

          <label class="field">
            <span class="field__label">{t('driver.counter.place')}</span>
            <input class="input" value={form.place} onInput={(e) => setForm({ ...form, place: (e.target as HTMLInputElement).value })} placeholder={t('driver.counter.placePh')} />
          </label>

          <label class="field">
            <span class="field__label">{t('driver.counter.subject')}</span>
            <input class="input" value={form.subject} onInput={(e) => setForm({ ...form, subject: (e.target as HTMLInputElement).value })} placeholder={t('driver.counter.subjectPh')} />
          </label>

          <label class="field">
            <span class="field__label">{t('driver.counter.when')}</span>
            <input class="input" type="date" value={form.happenedOn} max={today()} onInput={(e) => setForm({ ...form, happenedOn: (e.target as HTMLInputElement).value })} />
          </label>

          <label class="field">
            <span class="field__label">{t('driver.counter.note')}</span>
            <input class="input" value={form.note} onInput={(e) => setForm({ ...form, note: (e.target as HTMLInputElement).value })} />
          </label>

          {/* THE GATE ON THE WHOLE FORM. First-hand or nothing — asked plainly, because a form that does
              not ask cannot refuse the wrong answer, and the server refuses it either way. */}
          <Checkbox checked={form.firstHand} onChange={(firstHand) => setForm({ ...form, firstHand })} label={t('driver.counter.firstHand')} />
          <p class="card__note">{t('driver.counter.firstHandWhy')}</p>

          {/* THE PHOTOGRAPH, and only where the country has been switched on. */}
          {mayPhotograph ? (
            <>
              <Note tone="warn" icon="camera" title={t('driver.counter.before')} detail={permission?.text} />
              <Checkbox checked={agreed} onChange={setAgreed} label={t('driver.counter.consent')} />
              {agreed ? (
                <PhotoField id="counter-photo" value={photo} label={t('driver.counter.photo')} upload={(file) => actions.uploadPhoto('field_evidence', file)} onCapture={setPhoto} />
              ) : null}
            </>
          ) : (
            /* Said as a fact about the law, not as a fault of the person holding the phone — and it says
               the useful half is still wanted, because it is. */
            <Note tone="info" title={t('driver.counter.noPhotoTitle')} detail={t('driver.counter.noPhoto')} />
          )}

          {countryOpen ? (
            <Sheet open onClose={() => setCountryOpen(false)} title={t('driver.counter.country')}>
              <input class="input" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} placeholder={t('driver.counter.countrySearch')} aria-label={t('driver.counter.countrySearch')} />
              <ul class="road__list">
                {shown.slice(0, 60).map((c) => (
                  <li key={c.code}>
                    <Button
                      variant="outline"
                      full
                      onClick={() => {
                        setCountry(c.code);
                        setQ('');
                        setCountryOpen(false);
                        // The permission is a fact about THIS country, so it is re-read the moment the
                        // country changes — never carried over from the last one somebody looked at.
                        void actions.loadObservationNotice(c.code);
                      }}
                    >
                      {c.name} ({c.code})
                    </Button>
                  </li>
                ))}
              </ul>
            </Sheet>
          ) : null}

          <Button
            full
            disabled={!complete || state.busy === 'observation'}
            onClick={async () => {
              const ok = await actions.recordObservation({
                country,
                place: form.place.trim(),
                subject: form.subject.trim(),
                note: form.note.trim() || undefined,
                happenedOn: form.happenedOn,
                firstHand: form.firstHand,
                ...(photo && agreed && permission ? { evidenceMediaId: photo, consentAgreed: true, consentNoticeVersion: permission.version } : {}),
              });
              if (ok) {
                reset();
                setOpen(false);
              }
            }}
          >
            {t('driver.counter.save')}
          </Button>
        </Sheet>
      ) : null}

      {/* What has been said about this country already, newest first by when it HAPPENED — so last year's
          entry reads as last year's without anybody marking it stale. */}
      {state.observations.length ? (
        <ul class="road__list">
          {state.observations.slice(0, 5).map((o) => (
            <li key={o.observationId} class="road__body">
              <p class="road__name">
                {o.subject}
                <Pill tone={o.tier === 'evidenced' ? 'ok' : 'idle'}>{t(o.tier === 'evidenced' ? 'driver.counter.evidenced' : 'driver.counter.told')}</Pill>
              </p>
              {/* The DATE leads the meta line: last year's entry has to read as last year's. */}
              <p class="road__meta">
                {o.happenedOn} · {o.place}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p class="card__note">{t('driver.counter.none')}</p>
      )}
      {/* The caveat that never leaves, exactly as the road map keeps its own: this is what people were
          asked for, not what the border requires. */}
      <p class="road__caveat">
        <Icon name="warning" size={16} />
        {t('driver.counter.basis')}
      </p>
    </Card>
  );
}

/** Today, as the phone reckons it — the default for "when did this happen", because it usually just did. */
function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
