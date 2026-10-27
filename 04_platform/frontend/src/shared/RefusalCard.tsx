import { useState } from 'preact/hooks';
import { useT } from './i18n';
import { elsewhereBody, refusalSays, type Refusal, type RefusalChoice } from './refusal';
import { Button, Card, Note, PlacePicker, Sheet, type PlaceNote, type PlacePickerProps } from './ui';
import type { GeoPoint } from './geo';

/** What the sender says, as the server takes it (POST dispatch/freight/:id/refusal). */
export type RefusalBody = { choice: RefusalChoice; destLabel?: string; destLocation?: GeoPoint; contactName?: string; contactPhone?: string };

/**
 * REFUSED AT THE DOOR, in a field app (the user, 2026-10-27): what happened, and — while it is the sender's to say — back to
 * where the goods were picked up, to another place, or given up; each asked in a sheet before it is sent. Once said, or once
 * the 48 hours have, what became of them. The Shop app's counter bookings and a store's heavy orders show it alike.
 */
/** `title`: where several are on one screen, which load it is. */
export function RefusalCard({ title, refusal, pickupLabel, canDecide, decide, geocode, near }: { title?: string; refusal: Refusal; pickupLabel: string; canDecide: boolean; decide: (body: RefusalBody) => Promise<string | null>; geocode: PlacePickerProps['geocode']; near?: GeoPoint | null }) {
  const t = useT();
  const [open, setOpen] = useState<RefusalChoice | null>(null);
  return (
    <>
      <Card title={title ?? t(refusal.part ? 'refusal.headPart' : 'refusal.head')}>
        {refusalSays(refusal, pickupLabel, t).map((line) => (
          <p class="card__note" key={line}>
            {line}
          </p>
        ))}
        {canDecide ? (
          <div class="btnrow">
            <Button full={false} chevron={false} onClick={() => setOpen('back')}>
              {t('refusal.back', { pickup: pickupLabel })}
            </Button>
            <Button variant="outline" full={false} onClick={() => setOpen('elsewhere')}>
              {t('refusal.elsewhere')}
            </Button>
            <Button variant="link" full={false} onClick={() => setOpen('give_up')}>
              {t('refusal.giveUp')}
            </Button>
          </div>
        ) : null}
      </Card>
      {open ? <DecideSheet choice={open} pickupLabel={pickupLabel} decide={decide} geocode={geocode} near={near ?? null} onClose={() => setOpen(null)} /> : null}
    </>
  );
}

function DecideSheet({ choice, pickupLabel, decide, geocode, near, onClose }: { choice: RefusalChoice; pickupLabel: string; decide: (body: RefusalBody) => Promise<string | null>; geocode: PlacePickerProps['geocode']; near: GeoPoint | null; onClose: () => void }) {
  const t = useT();
  const [label, setLabel] = useState('');
  const [pin, setPin] = useState<GeoPoint | null>(null);
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const send = async (body: RefusalBody) => {
    setProblem(null);
    setBusy(true);
    const refused = await decide(body);
    setBusy(false);
    if (refused) return setProblem(refused);
    onClose();
  };

  const submit = () => {
    if (choice !== 'elsewhere') return void send({ choice });
    const made = elsewhereBody({ label, pin, contactName, contactPhone });
    if ('error' in made) return setProblem(t(made.error));
    void send(made.body);
  };

  const title = choice === 'back' ? t('refusal.backTitle', { pickup: pickupLabel }) : choice === 'elsewhere' ? t('refusal.elsewhereTitle') : t('refusal.giveUpTitle');
  return (
    <Sheet open onClose={onClose} title={title}>
      <p class="t-body">{t(choice === 'back' ? 'refusal.backBody' : choice === 'elsewhere' ? 'refusal.elsewhereBody' : 'refusal.giveUpBody')}</p>
      {choice === 'elsewhere' ? (
        <>
          <PlacePicker
            id="refusal-place"
            fieldLabel={t('refusal.placeLabel')}
            placeholder={t('refusal.placeHint')}
            mapLabel={t('refusal.mapLabel')}
            findLabel={t('refusal.find')}
            label={label}
            pin={pin}
            reference={near}
            onLabel={setLabel}
            onPin={(point) => setPin(point)}
            geocode={geocode}
            noteText={(n: PlaceNote) => (n.kind === 'found' ? t('refusal.note.found', { where: n.where }) : t(`refusal.note.${n.kind}` as never))}
          />
          <div class="field">
            <label class="field__label" for="refusal-contact">
              {t('refusal.contactName')}
            </label>
            <input id="refusal-contact" class="input" maxLength={80} value={contactName} onInput={(e) => setContactName(e.currentTarget.value)} />
          </div>
          <div class="field">
            <label class="field__label" for="refusal-phone">
              {t('refusal.contactPhone')}
            </label>
            <input id="refusal-phone" class="input" maxLength={32} inputMode="tel" value={contactPhone} onInput={(e) => setContactPhone(e.currentTarget.value)} />
          </div>
        </>
      ) : null}
      {problem ? <Note tone="danger" icon="warning" title={problem} /> : null}
      <Button chevron={false} busy={busy} onClick={submit}>
        {t(choice === 'back' ? 'refusal.backYes' : choice === 'elsewhere' ? 'refusal.send' : 'refusal.giveUpYes')}
      </Button>
      <Button variant="link" onClick={onClose}>
        {t('refusal.notNow')}
      </Button>
    </Sheet>
  );
}
