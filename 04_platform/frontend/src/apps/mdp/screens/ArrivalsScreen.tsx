import { useState } from 'preact/hooks';
import { formatDate, useT } from '../../../shared/i18n';
import { Button, Card, ErrorNote, errorSentence, Explainer, Icon, Note, Pill, Sheet } from '../../../shared/ui';
import { hoursLine, weekForm, type WeekForm } from '../../fleet/sites';
import { arrivalGroups, bulkBody, hubArrivalWord, loadLine, onIt, WORD_TONE, type HubArrival, type HubBulk } from '../arrivals';
import type { MdpActions, MdpState } from '../useMdpApp';
import { WeekRows } from './WeekRows';

/** "Tue 27 Oct" — a day as the hub keeps it, the same date wherever it is read. */
export const dayLabel = (day: string) => formatDate(`${day}T12:00:00Z`, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

/**
 * COMING IN (reading B, arrivals.ts) — what stores bring to this hub in bulk: at the door today (being scanned in, late,
 * due), coming on later days, done this week; each opens to be taken in. Under them the hub's word that it takes stores'
 * parcels in bulk, and when — its owner's to give or change; its people read it.
 */
export function ArrivalsScreen({ state, actions }: { state: MdpState; actions: MdpActions }) {
  const t = useT();
  const view = state.arrivals;
  const [bulkOpen, setBulkOpen] = useState(false);
  const groups = arrivalGroups(view?.arrivals ?? []);

  return (
    <div class="scr">
      <h1 class="scr__title">{t('mdp.arrivals.title')}</h1>
      <Explainer who={state.hub?.did} id="mdp.arrivals.how" text={t('mdp.arrivals.lede')} />
      {state.error ? <ErrorNote error={state.error} onRetry={actions.refresh} /> : null}

      {!view ? (
        state.error ? null : <p class="hint">{t('mdp.arrivals.loading')}</p>
      ) : (
        <>
          <Pile title={t('mdp.arrivals.now')} list={groups.now} onOpen={actions.openArrival} />
          <Pile title={t('mdp.arrivals.coming')} list={groups.coming} onOpen={actions.openArrival} />
          {view.bulk && !groups.now.length && !groups.coming.length ? <p class="hint">{t('mdp.arrivals.none')}</p> : null}
          <BulkCard bulk={view.bulk} staff={Boolean(state.staff)} onEdit={() => setBulkOpen(true)} />
          <Pile title={t('mdp.arrivals.done')} list={groups.done} onOpen={actions.openArrival} />
        </>
      )}

      {bulkOpen ? <BulkSheet bulk={view?.bulk} busy={state.busy === 'bulk'} onClose={() => setBulkOpen(false)} onSave={actions.setBulk} /> : null}
    </div>
  );
}

function Pile({ title, list, onOpen }: { title: string; list: HubArrival[]; onOpen: (arrivalId: string) => void }) {
  if (!list.length) return null;
  return (
    <>
      <h2 class="scr__section">{title}</h2>
      <div class="rows" role="list">
        {list.map((a) => (
          <ArrivalRow key={a.arrivalId} a={a} onOpen={() => onOpen(a.arrivalId)} />
        ))}
      </div>
    </>
  );
}

function ArrivalRow({ a, onOpen }: { a: HubArrival; onOpen: () => void }) {
  const t = useT();
  const word = hubArrivalWord(a);
  return (
    <button type="button" class="row" onClick={onOpen}>
      <span class="row__ic">
        <Icon name="truck" size={24} />
      </span>
      <span class="row__body">
        <span class="row__t">
          {a.storeName}
          {a.reference ? ` · ${a.reference}` : ''}
        </span>
        <span class="row__s">
          {loadLine(a, t)} · {dayLabel(a.expectedOn)}
        </span>
        {a.state === 'receiving' ? (
          <span class="row__s">{t('mdp.arrivals.progress', { done: a.scannedCount, all: onIt(a).length })}</span>
        ) : a.bringer && a.state === 'expected' ? (
          <span class="row__s">{t('mdp.arrivals.bringer', { who: a.bringer })}</span>
        ) : null}
      </span>
      <span class="row__end">
        <Pill tone={WORD_TONE[word]}>{t(`mdp.arrivals.word.${word}` as never)}</Pill>
        <Icon name="chevronRight" size={22} />
      </span>
    </button>
  );
}

/** Whether this hub takes stores' parcels in bulk, and when — with the way to say so, or change it, for its owner. */
function BulkCard({ bulk, staff, onEdit }: { bulk?: HubBulk; staff: boolean; onEdit: () => void }) {
  const t = useT();
  if (!bulk) {
    return (
      <Card title={t('mdp.bulk.title')}>
        <p class="card__note">{t('mdp.bulk.pitch')}</p>
        {staff ? (
          <p class="hint">{t('mdp.bulk.notTakingStaff')}</p>
        ) : (
          <Button variant="outline" onClick={onEdit}>
            {t('mdp.bulk.start')}
          </Button>
        )}
      </Card>
    );
  }
  const hours = hoursLine(bulk.hours, t);
  return (
    <Card title={t('mdp.bulk.title')} aside={<Pill tone="ok">{t('mdp.bulk.taking')}</Pill>}>
      <p class="card__note">{hours ? t('mdp.bulk.hours', { hours }) : t('mdp.bulk.anyHour')}</p>
      {bulk.doors ? <p class="card__note">{t('mdp.bulk.doors', { n: bulk.doors })}</p> : null}
      {bulk.zoneName ? <p class="card__note">{t('mdp.bulk.clock', { zone: bulk.zoneName })}</p> : null}
      {staff ? (
        <p class="hint">{t('mdp.bulk.ownerDecides')}</p>
      ) : (
        <Button variant="link" full={false} onClick={onEdit}>
          {t('mdp.bulk.change')}
        </Button>
      )}
    </Card>
  );
}

/**
 * THE HUB'S WORD, written by its owner: the days and hours it receives — or whenever it is working — and how many vans it
 * can unload at once. Checked as the server checks it before it is sent; the server's refusal is shown here, where it was
 * asked. Stopping asks first: stores can no longer book, and what they booked still comes.
 */
function BulkSheet({ bulk, busy, onClose, onSave }: { bulk?: HubBulk; busy: boolean; onClose: () => void; onSave: MdpActions['setBulk'] }) {
  const t = useT();
  const [keepsHours, setKeepsHours] = useState(bulk ? Boolean(bulk.hours) : true);
  const [week, setWeek] = useState<WeekForm>(weekForm(bulk?.hours));
  const [doors, setDoors] = useState(bulk?.doors ? String(bulk.doors) : '');
  const [stopping, setStopping] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const save = async () => {
    const made = bulkBody(keepsHours, week, doors);
    if ('error' in made) return setProblem(t(made.error));
    setProblem(null);
    const r = await onSave(made.body);
    if (r.error) return setProblem(errorSentence(r.error));
    onClose();
  };

  const stop = async () => {
    setProblem(null);
    const r = await onSave({ open: false });
    if (r.error) return setProblem(errorSentence(r.error));
    onClose();
  };

  return (
    <Sheet open onClose={onClose} title={t(stopping ? 'mdp.bulk.stop' : 'mdp.bulk.sheetTitle')}>
      {stopping ? (
        <>
          <p class="t-body">{t('mdp.bulk.stopBody')}</p>
          {problem ? <Note tone="danger" icon="warning" title={problem} /> : null}
          <Button chevron={false} busy={busy} onClick={() => void stop()}>
            {t('mdp.bulk.stopYes')}
          </Button>
          <Button variant="link" onClick={() => setStopping(false)}>
            {t('mdp.bulk.stopNo')}
          </Button>
        </>
      ) : (
        <>
          <p class="t-body">
            {t('mdp.bulk.sheetBody')}
            {bulk?.zoneName ? ` ${t('mdp.bulk.clock', { zone: bulk.zoneName })}` : ''}
          </p>
          <label class="checkline">
            <input type="checkbox" checked={keepsHours} onChange={(e) => setKeepsHours(e.currentTarget.checked)} />
            <span>{t('mdp.bulk.keepsHours')}</span>
          </label>
          {keepsHours ? (
            <WeekRows week={week} onChange={setWeek} />
          ) : (
            <p class="hint">{t('mdp.bulk.anyHourHint')}</p>
          )}
          <div class="field" style="margin-top:12px">
            <label class="field__label" for="bulk-doors">
              {t('mdp.bulk.doorsLabel')}
            </label>
            <input id="bulk-doors" class="input" inputMode="numeric" maxLength={2} value={doors} onInput={(e) => setDoors(e.currentTarget.value)} />
            <p class="hint">{t('mdp.bulk.doorsHint')}</p>
          </div>
          {problem ? <Note tone="danger" icon="warning" title={problem} /> : null}
          <Button chevron={false} busy={busy} onClick={() => void save()}>
            {t('mdp.bulk.save')}
          </Button>
          {bulk ? (
            <Button variant="link" onClick={() => setStopping(true)}>
              {t('mdp.bulk.stop')}
            </Button>
          ) : null}
          <Button variant="link" onClick={onClose}>
            {t('mdp.bulk.notNow')}
          </Button>
        </>
      )}
    </Sheet>
  );
}
