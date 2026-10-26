import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';
import { createMdpApi, narrow, type SbgClient, type SbgError } from '../../../lib/sbg';
import { openNowLine, type HubReachView } from '../../../shared/hubReach';
import { useT } from '../../../shared/i18n';
import { Button, Card, ErrorNote, Note, Pill, refusalSentence, Sheet } from '../../../shared/ui';
import { hoursLine, weekForm, type SiteWeek, type WeekForm } from '../../fleet/sites';
import { openingHoursProblem } from '../arrivals';
import { WeekRows } from './WeekRows';

/** The hub's own reading of its entry (backend HubContactView). */
export type HubContactView = HubReachView & { phoneAlt?: string; email?: string; publish?: boolean; zoneName?: string; saidAt?: string; saidBy?: string; basis: string };

/**
 * WHEN THE HUB IS OPEN, AND HOW TO REACH IT — on the hub's home (the user, 2026-10-26: "hub has open hours as well? and a
 * contact page for anyone (drivers) wanting to contact the hub"). What drivers and stores working with the hub see in
 * their apps; and on its public page its hours, with its number and gate only where it ticked that. Its owner writes it;
 * its people read it.
 */
export function HubReachCard({ sbg, mdpId, staff }: { sbg: SbgClient | null; mdpId: string | undefined; staff: boolean }) {
  const t = useT();
  const api = useMemo(() => (sbg ? createMdpApi(sbg) : null), [sbg]);
  const [view, setView] = useState<HubContactView | null>(null);
  const [error, setError] = useState<SbgError | null>(null);
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    if (!api || !mdpId) return;
    const r = await api.contact(mdpId);
    if (r.error) return setError(r.error);
    setView(narrow<HubContactView>(r.data));
  }, [api, mdpId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!view) return error ? <ErrorNote error={error} /> : null;
  const hours = hoursLine(view.openingHours as SiteWeek | undefined, t);
  const now = openNowLine(view.openNow, t);
  const page = view.handle && typeof location !== 'undefined' ? `${location.origin}/@${view.handle}` : null;

  return (
    <>
      <Card title={t('mdp.reach.title')} aside={now ? <Pill tone={view.openNow?.open ? 'ok' : 'idle'}>{now}</Pill> : undefined}>
        <p class="card__note">{t('mdp.reach.lede')}</p>
        {saved ? <Note tone="ok" icon="check" title={t('mdp.reach.saved')} /> : null}
        <p class="t-body">{hours ? t('mdp.reach.hours', { hours }) : t('mdp.reach.noHours')}</p>
        {view.askFor ? <p class="card__note">{t('common.hub.askFor', { who: view.askFor })}</p> : null}
        {view.gate ? <p class="card__note">{t('common.hub.gate', { gate: view.gate })}</p> : null}
        <p class="card__note">{view.phone ? t('mdp.reach.hasPhone') : t('mdp.reach.noPhone')}</p>
        <p class="card__note">{view.publish ? t('mdp.reach.pagePublic') : t('mdp.reach.pageHoursOnly')}</p>
        <div class="btnrow">
          {staff ? null : (
            <Button variant="outline" full={false} onClick={() => setEditing(true)}>
              {t(view.saidAt ? 'mdp.reach.change' : 'mdp.reach.set')}
            </Button>
          )}
          {page ? (
            <a class="btn btn--link" href={page} target="_blank" rel="noopener noreferrer">
              {t('mdp.reach.pageLink')}
            </a>
          ) : null}
        </div>
        {staff ? <p class="hint">{t('mdp.reach.ownerDecides')}</p> : null}
      </Card>
      {editing && api && mdpId ? (
        <ReachSheet
          view={view}
          onClose={() => setEditing(false)}
          save={(body) => api.setContact(mdpId, body)}
          onSaved={(next) => {
            setView(next);
            setEditing(false);
            setSaved(true);
          }}
        />
      ) : null}
    </>
  );
}

type SaveBody = Parameters<ReturnType<typeof createMdpApi>['setContact']>[1];

function ReachSheet({ view, onClose, save, onSaved }: { view: HubContactView; onClose: () => void; save: (body: SaveBody) => ReturnType<ReturnType<typeof createMdpApi>['setContact']>; onSaved: (next: HubContactView) => void }) {
  const t = useT();
  // The first time, a week to start from: open on set days and hours, as most hubs are.
  const [keepsHours, setKeepsHours] = useState(Boolean(view.openingHours) || !view.saidAt);
  const [week, setWeek] = useState<WeekForm>(weekForm(view.openingHours as SiteWeek | undefined));
  const [phone, setPhone] = useState(view.phone ?? '');
  const [phoneAlt, setPhoneAlt] = useState(view.phoneAlt ?? '');
  const [askFor, setAskFor] = useState(view.askFor ?? '');
  const [gate, setGate] = useState(view.gate ?? '');
  const [publish, setPublish] = useState(Boolean(view.publish));
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const submit = async () => {
    const wrong = openingHoursProblem(keepsHours, week);
    if (wrong) return setProblem(t(wrong));
    setProblem(null);
    setBusy(true);
    const r = await save({ openingHours: keepsHours ? week : null, phone, phoneAlt, askFor, gate, publish });
    setBusy(false);
    if (r.error) return setProblem(refusalSentence(r.error));
    onSaved(narrow<HubContactView>(r.data));
  };

  return (
    <Sheet open onClose={onClose} title={t('mdp.reach.sheetTitle')}>
      <p class="t-body">
        {t('mdp.reach.sheetBody')}
        {view.zoneName ? ` ${t('mdp.bulk.clock', { zone: view.zoneName })}` : ''}
      </p>
      <label class="checkline">
        <input type="checkbox" checked={keepsHours} onChange={(e) => setKeepsHours(e.currentTarget.checked)} />
        <span>{t('mdp.reach.keepsHours')}</span>
      </label>
      {keepsHours ? <WeekRows week={week} onChange={setWeek} /> : <p class="hint">{t('mdp.reach.noHoursHint')}</p>}
      <div class="field" style="margin-top:12px">
        <label class="field__label" for="reach-phone">
          {t('mdp.reach.phoneLabel')}
        </label>
        <input id="reach-phone" class="input" type="tel" inputMode="tel" maxLength={24} value={phone} onInput={(e) => setPhone(e.currentTarget.value)} />
        <p class="hint">{t('mdp.reach.phoneHint')}</p>
      </div>
      <div class="field">
        <label class="field__label" for="reach-phone2">
          {t('mdp.reach.phoneAltLabel')}
        </label>
        <input id="reach-phone2" class="input" type="tel" inputMode="tel" maxLength={24} value={phoneAlt} onInput={(e) => setPhoneAlt(e.currentTarget.value)} />
      </div>
      <div class="field">
        <label class="field__label" for="reach-ask">
          {t('mdp.reach.askForLabel')}
        </label>
        <input id="reach-ask" class="input" maxLength={80} placeholder={t('mdp.reach.askForPh')} value={askFor} onInput={(e) => setAskFor(e.currentTarget.value)} />
      </div>
      <div class="field">
        <label class="field__label" for="reach-gate">
          {t('mdp.reach.gateLabel')}
        </label>
        <input id="reach-gate" class="input" maxLength={160} placeholder={t('mdp.reach.gatePh')} value={gate} onInput={(e) => setGate(e.currentTarget.value)} />
      </div>
      <label class="checkline">
        <input type="checkbox" checked={publish} onChange={(e) => setPublish(e.currentTarget.checked)} />
        <span>{t('mdp.reach.publish')}</span>
      </label>
      <p class="hint">{t('mdp.reach.publishHint')}</p>
      {problem ? <Note tone="danger" icon="warning" title={problem} /> : null}
      <Button chevron={false} busy={busy} onClick={() => void submit()}>
        {t('mdp.reach.save')}
      </Button>
      <Button variant="link" onClick={onClose}>
        {t('mdp.reach.notNow')}
      </Button>
    </Sheet>
  );
}
