import { useMemo, useState } from 'preact/hooks';
import { createMdpApi, type SbgClient } from '../../../lib/sbg';
import { useT } from '../../../shared/i18n';
import { Button, Card, Note, Pill, refusalSentence, Sheet } from '../../../shared/ui';
import { spaceLines, spaceProblem } from '../logic';
import type { MdpView } from '../types';

/**
 * 2026-11-02 — YOUR FLOOR (the owner: "shouldn't a hub also declare its space?"): on the hub's start screen, the places
 * free of its bag places and its day's sorting — "18 of 40 bag places free · 600 parcels a day" — the parcels sorted today
 * of that, and the one thing to know now: over full in red (every bag a driver brings is still taken), full, the day's
 * sorting full. Read off the hub's own row, so it is as fresh as the floor around it. A hub that has not said is asked to.
 * Its owner says it; its people read it, and are told whose it is to change.
 */
export function HubSpaceCard({ sbg, hub, staff, onSaved }: { sbg: SbgClient | null; hub: MdpView | null; staff: boolean; onSaved: () => void }) {
  const t = useT();
  const api = useMemo(() => (sbg ? createMdpApi(sbg) : null), [sbg]);
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const space = hub?.space;
  const lines = spaceLines(space, t);
  if (!hub || !space || !lines) return null;
  const pillTone = lines.tone === 'danger' ? 'danger' : 'warn';

  return (
    <>
      <Card title={t('mdp.space.title')} aside={lines.pill ? <Pill tone={pillTone}>{lines.pill}</Pill> : undefined}>
        {saved ? <Note tone="ok" icon="check" title={t('mdp.space.saved')} /> : null}
        <p class="t-body" id="hub-space-headline">
          <b>{lines.headline}</b>
        </p>
        {lines.sorted ? <p class="card__note">{lines.sorted}</p> : null}
        {space.declared ? <p class="card__note">{t('mdp.space.onFloor', { inbound: space.inbound, outbound: space.outbound })}</p> : null}
        {space.declared && space.comingIn > 0 ? <p class="card__note">{t('mdp.space.coming', { count: space.comingIn })}</p> : null}
        {lines.note ? <Note tone={lines.tone === 'ok' ? 'info' : lines.tone} icon={lines.tone === 'danger' ? 'warning' : lines.tone === 'info' ? 'clock' : 'bag'} title={lines.note} /> : null}
        {staff ? (
          <p class="hint">{t('mdp.space.ownerDecides')}</p>
        ) : (
          <div class="btnrow">
            <Button variant="outline" full={false} onClick={() => setEditing(true)}>
              {t(space.declared ? 'mdp.space.change' : 'mdp.space.set')}
            </Button>
          </div>
        )}
      </Card>
      {editing && api ? (
        <SpaceSheet
          bagPlaces={space.bagPlaces}
          sortPerDay={space.sortPerDay}
          onClose={() => setEditing(false)}
          save={(body) => api.setSpace(hub.mdpId, body)}
          onSaved={() => {
            setEditing(false);
            setSaved(true);
            onSaved();
          }}
        />
      ) : null}
    </>
  );
}

type Save = (body: { bagPlaces: number; sortPerDay: number }) => ReturnType<ReturnType<typeof createMdpApi>['setSpace']>;

/** The owner's two numbers, each said plainly: what counts as a bag place, and a normal day's sorting. */
export function SpaceSheet({ bagPlaces, sortPerDay, onClose, save, onSaved }: { bagPlaces?: number; sortPerDay?: number; onClose: () => void; save: Save; onSaved: () => void }) {
  const t = useT();
  const [places, setPlaces] = useState(bagPlaces != null ? String(bagPlaces) : '');
  const [perDay, setPerDay] = useState(sortPerDay != null ? String(sortPerDay) : '');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const submit = async () => {
    const wrong = spaceProblem(places, perDay);
    if (wrong) return setProblem(t(wrong));
    setProblem(null);
    setBusy(true);
    const r = await save({ bagPlaces: Number(places), sortPerDay: Number(perDay) });
    setBusy(false);
    if (r.error) return setProblem(refusalSentence(r.error));
    onSaved();
  };

  return (
    <Sheet open onClose={onClose} title={t('mdp.space.sheetTitle')}>
      <p class="t-body">{t('mdp.space.sheetBody')}</p>
      <div class="field">
        <label class="field__label" for="space-places">
          {t('mdp.space.placesLabel')}
        </label>
        <input id="space-places" class="input" type="number" inputMode="numeric" min="1" step="1" value={places} onInput={(e) => setPlaces(e.currentTarget.value)} />
        <p class="hint">{t('mdp.space.placesHint')}</p>
      </div>
      <div class="field">
        <label class="field__label" for="space-per-day">
          {t('mdp.space.perDayLabel')}
        </label>
        <input id="space-per-day" class="input" type="number" inputMode="numeric" min="1" step="1" value={perDay} onInput={(e) => setPerDay(e.currentTarget.value)} />
        <p class="hint">{t('mdp.space.perDayHint')}</p>
      </div>
      {problem ? <Note tone="danger" icon="warning" title={problem} /> : null}
      <Button chevron={false} busy={busy} onClick={() => void submit()}>
        {t('mdp.space.save')}
      </Button>
      <Button variant="link" onClick={onClose}>
        {t('mdp.space.notNow')}
      </Button>
    </Sheet>
  );
}
