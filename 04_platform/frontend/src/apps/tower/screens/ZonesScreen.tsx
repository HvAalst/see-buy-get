import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';
import { Abbreviated } from '../../../shared/ui/Abbr';
import { Icon } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import { ConsolePick } from '../ConsolePick';
import { ConsoleFold } from '../ConsoleFold';
import { holds } from '../staffRoles';
import type { TowerActions, TowerState } from '../useTowerApp';
import { ZoneAreaMap } from './ZoneAreaMap';
import {
  EMPTY_AREA_FORM,
  areaFormProblem,
  groupColour,
  groupName,
  groupsProblem,
  publishFrom,
  workingMap,
  zonesHint,
  type AreaForm,
  type ZoneAreaShape,
  type ZoneRow,
  type ZoneSetup,
  type ZoneShapes,
} from '../zones';

type Write = () => Promise<{ error?: { detail?: string; title?: string } | null } | { error?: unknown; data?: unknown }>;

/**
 * A COUNTRY'S ZONES (2026-11-08 — zone pricing, step 1; the owner: "every country ... determine zones for the entire
 * country"). Its company brings in the country's official areas once, groups them into zones in a draft, gives each zone
 * one of its price groups, and publishes the draft from a date. Shops and hubs are never placed by hand: each takes the
 * zone its pin lies in. Nothing is priced by zone yet — the price card (step 2) names the map it was made with.
 *
 * Its own reads, as the company record's: the map's shapes are large and change only when areas move between zones, so a
 * rename or a new group re-reads the zones and not the shapes.
 */
export function ZonesScreen({ state, actions }: { state: TowerState; actions: TowerActions }) {
  const t = useT();
  const client = actions.client();
  const sisters = (state.entities ?? []).filter((e) => e.kind === 'sister');
  const own = state.who?.entityId && sisters.some((s) => s.entityId === state.who?.entityId) ? state.who.entityId : undefined;
  const [entityId, setEntityId] = useState<string | null>(own ?? sisters[0]?.entityId ?? null);
  useEffect(() => {
    if (!entityId && (own ?? sisters[0]?.entityId)) setEntityId(own ?? sisters[0].entityId);
  }, [own, sisters.length]);
  // A company keeps its own zones; among staff, administration does.
  const writer = state.who?.mode === 'company' || holds(state.who?.roles, 'admin');

  const [setup, setSetup] = useState<ZoneSetup | null>(null);
  const [shapes, setShapes] = useState<ZoneShapes | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [chosenAreas, setChosenAreas] = useState<Set<string>>(new Set());
  const [chosenZones, setChosenZones] = useState<Set<string>>(new Set());
  const [focus, setFocus] = useState<string | undefined>();

  const loadShapes = useCallback(async (s: ZoneSetup | null) => {
    if (!client || !entityId || !(s?.draft || s?.inForce)) {
      setShapes(null);
      return;
    }
    const r = await client.api.zoneShapes(entityId);
    if (!r.error) setShapes(r.data as unknown as ZoneShapes);
  }, [client, entityId]);

  const load = useCallback(async (withShapes: boolean) => {
    if (!client || !entityId) return;
    const r = await client.api.zones(entityId);
    if (r.error) {
      setError(r.error.detail || r.error.title || '');
      return;
    }
    const s = r.data as unknown as ZoneSetup;
    setSetup(s);
    if (withShapes) await loadShapes(s);
  }, [client, entityId, loadShapes]);

  useEffect(() => {
    setSetup(null);
    setShapes(null);
    setError(null);
    setDone(null);
    setChosenAreas(new Set());
    setChosenZones(new Set());
    setFocus(undefined);
    void load(true);
  }, [load]);

  /** Every change: one busy flag, the refusal as the server said it, then the zones read again (and the shapes, when areas moved). */
  const run = async (key: string, write: Write, message: string, opts: { shapes?: boolean } = {}) => {
    setBusy(key);
    setError(null);
    setDone(null);
    const r = (await write()) as { error?: { detail?: string; title?: string } | null };
    setBusy(null);
    if (r.error) {
      setError(r.error.detail || r.error.title || '');
      return false;
    }
    setDone(message);
    setChosenAreas(new Set());
    setChosenZones(new Set());
    await load(Boolean(opts.shapes));
    return true;
  };

  const map = workingMap(setup);
  const editable = writer && Boolean(setup?.draft);
  const groups = setup?.groups ?? [];
  const zoneByCode = useMemo(() => new Map((map?.zones ?? []).map((z) => [z.code, z])), [map]);
  const fillOf = useCallback((a: ZoneAreaShape) => groupColour(groups, zoneByCode.get(a.zone)?.group ?? ''), [groups, zoneByCode]);
  const labelOf = useCallback(
    (a: ZoneAreaShape) => {
      const z = zoneByCode.get(a.zone);
      return t('tower.zones.map.area', { area: a.name, zone: z?.name ?? a.zone, group: z ? groupName(groups, z.group) : '' });
    },
    [zoneByCode, groups, t],
  );
  const toggleArea = (id: string) =>
    setChosenAreas((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <>
      <header class="cons__head">
        <h1 class="cons__title">{t('tower.zones.title')}</h1>
        <p class="cons__lede">{t('tower.zones.lede')}</p>
      </header>

      {sisters.length > 1 ? (
        <section class="cons__panel">
          <div class="twr-corridorform">
            <ConsolePick label={t('tower.zones.choose')} value={entityId ?? ''} onChange={(v) => setEntityId(v || null)} options={sisters.map((c) => ({ value: c.entityId, label: c.name, tag: c.jurisdiction }))} />
          </div>
        </section>
      ) : null}

      {done ? (
        <p class="twr-done">
          <Icon name="check" size={16} />
          {done}
        </p>
      ) : null}
      {error ? (
        <p class="cerr">
          <Abbreviated text={error} />
        </p>
      ) : null}

      {!entityId ? null : !setup ? (
        <p class="cons__empty">{t('tower.zones.loading')}</p>
      ) : (
        <>
          <GroupsFold setup={setup} writer={writer} busy={busy === 'groups'} onSave={(rows) => client && run('groups', () => client.api.setZoneGroups(entityId, rows), t('tower.zones.groups.saved'))} />

          <ConsoleFold title={t('tower.zones.map.title')} hint={zonesHint(setup, t)} defaultOpen>
            <div class="twr-zonestatus">
              {setup.inForce?.effectiveFrom ? <p>{t('tower.zones.status.inForce', { version: setup.inForce.version, date: new Date(setup.inForce.effectiveFrom).toLocaleString() })}</p> : null}
              {setup.scheduled.map((m) => (
                <p key={m.version}>{t('tower.zones.status.scheduled', { version: m.version, date: new Date(m.effectiveFrom ?? '').toLocaleString() })}</p>
              ))}
              {setup.draft ? <p>{t('tower.zones.status.draft', { version: setup.draft.version, who: setup.draft.createdBy })}</p> : null}
              {!setup.draft && !setup.inForce && !setup.scheduled.length ? <p>{t('tower.zones.status.none')}</p> : null}
            </div>

            {writer ? (
              <div class="twr-panelend twr-zoneacts">
                {!setup.draft && (setup.inForce || setup.scheduled.length) ? (
                  <button type="button" class="cbtn cbtn--ghost cbtn--sm" disabled={busy !== null} onClick={() => client && run('start', () => client.api.startZoneDraft(entityId), t('tower.zones.draft.started'), { shapes: true })}>
                    {t('tower.zones.draft.start')}
                  </button>
                ) : null}
                {setup.draft ? <PublishForm busy={busy === 'publish'} onPublish={(from) => client && run('publish', () => client.api.publishZones(entityId, from), t('tower.zones.draft.published', { version: setup.draft!.version }), { shapes: true })} /> : null}
                {setup.draft ? (
                  <button type="button" class="cbtn cbtn--ghost cbtn--sm" disabled={busy !== null} onClick={() => client && run('discard', () => client.api.discardZoneDraft(entityId), t('tower.zones.draft.discarded'), { shapes: true })}>
                    {t('tower.zones.draft.discard')}
                  </button>
                ) : null}
              </div>
            ) : null}

            {map && shapes ? (
              <div class="twr-zonemap">
                <ZoneAreaMap areas={shapes.areas} setId={shapes.setId} fillOf={fillOf} labelOf={labelOf} chosen={chosenAreas} focusZone={focus} onPick={editable ? toggleArea : undefined} />
                <p class="chint">
                  {t('tower.zones.map.legend')}{' '}
                  {groups.map((g) => (
                    <span key={g.key} class="twr-zonekey">
                      <span class="twr-zonekey__swatch" style={{ background: groupColour(groups, g.key) }} aria-hidden="true" />
                      {g.name}
                    </span>
                  ))}
                </p>
                <p class="chint">{t('tower.zones.map.credit', { credit: map.areas.attribution, licence: map.areas.licence })}</p>
                {editable ? <p class="chint">{t('tower.zones.map.tip')}</p> : null}
              </div>
            ) : null}

            {editable && chosenAreas.size && map ? (
              <ChosenAreas
                count={chosenAreas.size}
                zones={map.zones}
                busy={busy === 'move'}
                onMove={(to) => client && run('move', () => client.api.moveZoneAreas(entityId, [...chosenAreas], to), t('tower.zones.moved'), { shapes: true })}
                onNew={(name) => client && run('move', () => client.api.moveZoneAreas(entityId, [...chosenAreas], undefined, name), t('tower.zones.moved'), { shapes: true })}
                onClear={() => setChosenAreas(new Set())}
              />
            ) : null}

            {setup.outside.length ? <p class="cerr">{t('tower.zones.outside', { names: setup.outside.join(', ') })}</p> : null}

            {map ? (
              <ZoneTable
                zones={map.zones}
                setup={setup}
                editable={editable}
                busy={busy}
                chosen={chosenZones}
                focus={focus}
                onFocus={(code) => setFocus((f) => (f === code ? undefined : code))}
                onChoose={(code) =>
                  setChosenZones((s) => {
                    const next = new Set(s);
                    if (next.has(code)) next.delete(code);
                    else next.add(code);
                    return next;
                  })
                }
                onGroup={(z, group) => client && run(`group:${z.code}`, () => client.api.changeZone(entityId, z.code, { group }), t('tower.zones.regrouped', { zone: z.name, group: groupName(groups, group) }))}
                onRename={(z, name) => client && run(`name:${z.code}`, () => client.api.changeZone(entityId, z.code, { name }), t('tower.zones.renamed'))}
                onMerge={(name) => client && run('merge', () => client.api.mergeZones(entityId, [...chosenZones], name), t('tower.zones.merged'), { shapes: true })}
              />
            ) : null}
          </ConsoleFold>

          {writer ? <ImportFold setup={setup} busy={busy === 'import'} onSend={(form) => client && run('import', () => client.api.importZoneAreas(entityId, { geojson: form.text, source: form.source.trim(), licence: form.licence.trim(), attribution: form.attribution.trim(), ...(form.level.trim() ? { level: form.level.trim() } : {}), ...(form.nameField.trim() ? { nameField: form.nameField.trim() } : {}) }), t('tower.zones.import.sent'), { shapes: true })} /> : null}

          <VersionsFold setup={setup} />
        </>
      )}
    </>
  );
}

function GroupsFold({ setup, writer, busy, onSave }: { setup: ZoneSetup; writer: boolean; busy: boolean; onSave: (rows: Array<{ key?: string; name: string }>) => void }) {
  const t = useT();
  const [rows, setRows] = useState<Array<{ key?: string; name: string }>>(setup.groups);
  useEffect(() => setRows(setup.groups), [setup.groups]);
  const problem = groupsProblem(rows);
  const changed = JSON.stringify(rows.map((r) => ({ key: r.key, name: r.name.trim() }))) !== JSON.stringify(setup.groups.map((g) => ({ key: g.key, name: g.name })));
  return (
    <ConsoleFold title={t('tower.zones.groups.title')} hint={setup.groups.map((g) => g.name).join(' · ')}>
      <p class="chint">{t('tower.zones.groups.lede')}</p>
      <fieldset class="twr-zonegroups" disabled={!writer}>
        {rows.map((r, i) => (
          <div key={r.key ?? `new-${i}`} class="twr-zonegroups__row">
            <label class="cfield">
              <span class="cfield__label">{t('tower.zones.groups.name', { n: i + 1 })}</span>
              <input id={`zone-group-${r.key ?? `new-${i}`}`} class="cinput" value={r.name} maxLength={40} onInput={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, name: (e.target as HTMLInputElement).value } : x)))} />
            </label>
            {rows.length > 1 ? (
              <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                {t('tower.zones.groups.remove')}
              </button>
            ) : null}
          </div>
        ))}
        {problem && changed ? <p class="cerr">{t(problem)}</p> : null}
        {writer ? (
          <div class="twr-panelend">
            {rows.length < 8 ? (
              <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => setRows([...rows, { name: '' }])}>
                {t('tower.zones.groups.add')}
              </button>
            ) : null}
            <button type="button" class="cbtn cbtn--primary cbtn--sm" disabled={busy || !changed || Boolean(problem)} onClick={() => onSave(rows.filter((r) => r.name.trim()).map((r) => ({ ...(r.key ? { key: r.key } : {}), name: r.name.trim() })))}>
              {t('tower.zones.groups.save')}
            </button>
          </div>
        ) : null}
      </fieldset>
    </ConsoleFold>
  );
}

function PublishForm({ busy, onPublish }: { busy: boolean; onPublish: (from?: string) => void }) {
  const t = useT();
  const today = new Date().toISOString().slice(0, 10);
  const [day, setDay] = useState(today);
  return (
    <div class="twr-zonepublish">
      <label class="cfield">
        <span class="cfield__label">{t('tower.zones.draft.from')}</span>
        <input id="zone-publish-from" class="cinput" type="date" min={today} value={day} onInput={(e) => setDay((e.target as HTMLInputElement).value)} />
      </label>
      <button type="button" class="cbtn cbtn--primary cbtn--sm" disabled={busy} onClick={() => onPublish(publishFrom(day, today))}>
        {t('tower.zones.draft.publish')}
      </button>
      <p class="chint">{t('tower.zones.draft.fromHint')}</p>
    </div>
  );
}

function ChosenAreas({ count, zones, busy, onMove, onNew, onClear }: { count: number; zones: ZoneRow[]; busy: boolean; onMove: (to: string) => void; onNew: (name?: string) => void; onClear: () => void }) {
  const t = useT();
  const [to, setTo] = useState('');
  const [name, setName] = useState('');
  return (
    <section class="cons__panel twr-zonechosen">
      <p class="twr-clear__t">{t('tower.zones.chosen', { n: count })}</p>
      <div class="twr-zonechosen__row">
        <ConsolePick label={t('tower.zones.chosen.moveTo')} value={to} onChange={setTo} small options={zones.map((z) => ({ value: z.code, label: z.name, tag: z.code }))} />
        <button type="button" class="cbtn cbtn--primary cbtn--sm" disabled={busy || !to} onClick={() => onMove(to)}>
          {t('tower.zones.chosen.move')}
        </button>
      </div>
      <div class="twr-zonechosen__row">
        <label class="cfield">
          <span class="cfield__label">{t('tower.zones.chosen.newName')}</span>
          <input id="zone-new-name" class="cinput" value={name} maxLength={80} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
        </label>
        <button type="button" class="cbtn cbtn--ghost cbtn--sm" disabled={busy} onClick={() => onNew(name.trim() || undefined)}>
          {t('tower.zones.chosen.newZone')}
        </button>
        <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={onClear}>
          {t('tower.zones.chosen.clear')}
        </button>
      </div>
    </section>
  );
}

function ZoneTable({
  zones,
  setup,
  editable,
  busy,
  chosen,
  focus,
  onFocus,
  onChoose,
  onGroup,
  onRename,
  onMerge,
}: {
  zones: ZoneRow[];
  setup: ZoneSetup;
  editable: boolean;
  busy: string | null;
  chosen: ReadonlySet<string>;
  focus?: string;
  onFocus: (code: string) => void;
  onChoose: (code: string) => void;
  onGroup: (z: ZoneRow, group: string) => void;
  onRename: (z: ZoneRow, name: string) => void;
  onMerge: (name?: string) => void;
}) {
  const t = useT();
  const [renaming, setRenaming] = useState<{ code: string; name: string } | null>(null);
  const [mergeName, setMergeName] = useState('');
  const counted = zones.some((z) => z.shops != null);
  return (
    <>
      {editable && chosen.size >= 2 ? (
        <section class="cons__panel twr-zonechosen">
          <div class="twr-zonechosen__row">
            <label class="cfield">
              <span class="cfield__label">{t('tower.zones.mergeName')}</span>
              <input id="zone-merge-name" class="cinput" value={mergeName} maxLength={80} onInput={(e) => setMergeName((e.target as HTMLInputElement).value)} />
            </label>
            <button type="button" class="cbtn cbtn--primary cbtn--sm" disabled={busy !== null} onClick={() => onMerge(mergeName.trim() || undefined)}>
              {t('tower.zones.merge', { n: chosen.size })}
            </button>
          </div>
        </section>
      ) : null}
      <table class="ctbl ctbl--stack">
        <thead>
          <tr>
            <th>{t('tower.zones.col.zone')}</th>
            <th>{t('tower.zones.col.group')}</th>
            <th>{t('tower.zones.col.areas')}</th>
            <th>{t('tower.zones.col.size')}</th>
            {counted ? <th>{t('tower.zones.col.places')}</th> : null}
          </tr>
        </thead>
        <tbody>
          {zones.map((z) => (
            <tr key={z.code} class={focus === z.code ? 'twr-zonerow--on' : undefined}>
              <td class="ctbl__strong">
                <span class="ctbl__lbl">{t('tower.zones.col.zone')}</span>
                {renaming?.code === z.code ? (
                  <span class="twr-zonerename">
                    <input id={`zone-rename-${z.code}`} class="cinput" value={renaming.name} maxLength={80} onInput={(e) => setRenaming({ code: z.code, name: (e.target as HTMLInputElement).value })} />
                    <button type="button" class="cbtn cbtn--primary cbtn--sm" disabled={busy !== null || !renaming.name.trim()} onClick={() => { onRename(z, renaming.name.trim()); setRenaming(null); }}>
                      {t('tower.zones.renameSave')}
                    </button>
                  </span>
                ) : (
                  <>
                    {z.name} <span class="ctbl__sub">{z.code}</span>
                  </>
                )}
                {z.evidence?.length ? <span class="chint twr-zoneevidence">{t('tower.zones.evidence')} {z.evidence.join(' · ')}</span> : null}
                <span class="twr-zonerowacts">
                  <button type="button" class="cbtn cbtn--ghost cbtn--sm" aria-pressed={focus === z.code} onClick={() => onFocus(z.code)}>
                    {t('tower.zones.show')}
                  </button>
                  {editable ? (
                    <>
                      <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => setRenaming({ code: z.code, name: z.name })}>
                        {t('tower.zones.rename')}
                      </button>
                      <button type="button" class="cbtn cbtn--ghost cbtn--sm" aria-pressed={chosen.has(z.code)} onClick={() => onChoose(z.code)}>
                        {chosen.has(z.code) ? t('tower.zones.picked') : t('tower.zones.pick')}
                      </button>
                    </>
                  ) : null}
                </span>
              </td>
              <td>
                <span class="ctbl__lbl">{t('tower.zones.col.group')}</span>
                {editable ? (
                  <ConsolePick label={t('tower.zones.col.group')} value={z.group} onChange={(g) => g !== z.group && onGroup(z, g)} bare small disabled={busy !== null} options={setup.groups.map((g) => ({ value: g.key, label: g.name }))} />
                ) : (
                  groupName(setup.groups, z.group)
                )}
              </td>
              <td class="ctbl__num">
                <span class="ctbl__lbl">{t('tower.zones.col.areas')}</span>
                {z.areas}
              </td>
              <td class="ctbl__num">
                <span class="ctbl__lbl">{t('tower.zones.col.size')}</span>
                {t('tower.zones.km2', { n: Math.round(z.areaKm2).toLocaleString() })}
              </td>
              {counted ? (
                <td class="ctbl__sub">
                  <span class="ctbl__lbl">{t('tower.zones.col.places')}</span>
                  {t('tower.zones.places', { shops: z.shops ?? 0, hubs: z.hubs ?? 0 })}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function ImportFold({ setup, busy, onSend }: { setup: ZoneSetup; busy: boolean; onSend: (form: AreaForm) => void }) {
  const t = useT();
  const [form, setForm] = useState<AreaForm>(EMPTY_AREA_FORM);
  const [tried, setTried] = useState(false);
  const problem = areaFormProblem(form);
  const set = (k: keyof AreaForm) => (e: Event) => setForm({ ...form, [k]: (e.target as HTMLInputElement).value });
  const readFile = async (e: Event) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    setForm({ ...form, text: await file.text(), fileName: file.name });
  };
  return (
    <ConsoleFold title={t('tower.zones.import.title')} hint={setup.draft ? t('tower.zones.import.draftOpen') : t('tower.zones.import.hint')} defaultOpen={!setup.draft && !setup.inForce && !setup.scheduled.length}>
      <p class="chint">{t('tower.zones.import.lede')}</p>
      <fieldset class="twr-knobs" disabled={Boolean(setup.draft) || busy}>
        <label class="cfield">
          <span class="cfield__label">{t('tower.zones.import.file')}</span>
          <input id="zone-areas-file" class="cinput" type="file" accept=".geojson,.json,application/geo+json,application/json" onChange={(e) => void readFile(e)} />
          {form.fileName ? <span class="chint">{t('tower.zones.import.size', { name: form.fileName, kb: Math.ceil(form.text.length / 1024).toLocaleString() })}</span> : null}
        </label>
        <label class="cfield">
          <span class="cfield__label">{t('tower.zones.import.source')}</span>
          <input id="zone-areas-source" class="cinput" value={form.source} maxLength={300} onInput={set('source')} />
        </label>
        <label class="cfield">
          <span class="cfield__label">{t('tower.zones.import.licence')}</span>
          <input id="zone-areas-licence" class="cinput" value={form.licence} maxLength={300} onInput={set('licence')} />
        </label>
        <label class="cfield">
          <span class="cfield__label">{t('tower.zones.import.credit')}</span>
          <input id="zone-areas-credit" class="cinput" value={form.attribution} maxLength={300} onInput={set('attribution')} />
        </label>
        <label class="cfield">
          <span class="cfield__label">{t('tower.zones.import.level')}</span>
          <input id="zone-areas-level" class="cinput" value={form.level} maxLength={60} onInput={set('level')} />
          <span class="chint">{t('tower.zones.import.levelHint')}</span>
        </label>
        <label class="cfield">
          <span class="cfield__label">{t('tower.zones.import.nameField')}</span>
          <input id="zone-areas-namefield" class="cinput" value={form.nameField} maxLength={60} onInput={set('nameField')} />
        </label>
        {tried && problem ? <p class="cerr">{t(problem)}</p> : null}
        <div class="twr-panelend">
          <button
            type="button"
            class="cbtn cbtn--primary cbtn--sm"
            disabled={busy || Boolean(setup.draft)}
            onClick={() => {
              setTried(true);
              if (!problem) onSend(form);
            }}
          >
            {t('tower.zones.import.send')}
          </button>
        </div>
      </fieldset>
    </ConsoleFold>
  );
}

function VersionsFold({ setup }: { setup: ZoneSetup }) {
  const t = useT();
  return (
    <ConsoleFold title={t('tower.zones.versions.title')} hint={t('tower.zones.versions.hint', { n: setup.versions.length })}>
      {setup.versions.length ? (
        <table class="ctbl ctbl--stack">
          <thead>
            <tr>
              <th>{t('tower.zones.versions.col.version')}</th>
              <th>{t('tower.zones.versions.col.status')}</th>
              <th>{t('tower.zones.versions.col.from')}</th>
              <th>{t('tower.zones.versions.col.by')}</th>
              <th>{t('tower.zones.versions.col.zones')}</th>
            </tr>
          </thead>
          <tbody>
            {setup.versions.map((v) => (
              <tr key={v.version}>
                <td class="ctbl__strong">{v.version}</td>
                <td>
                  <span class="ctbl__lbl">{t('tower.zones.versions.col.status')}</span>
                  <span class={`ctag ${v.status === 'in_force' ? 'ctag--ok' : v.status === 'scheduled' ? 'ctag--info' : 'ctag--quiet'}`}>{t(`tower.zones.st.${v.status}` as never)}</span>
                </td>
                <td class="ctbl__sub">
                  <span class="ctbl__lbl">{t('tower.zones.versions.col.from')}</span>
                  {new Date(v.effectiveFrom).toLocaleString()}
                </td>
                <td>
                  <span class="ctbl__lbl">{t('tower.zones.versions.col.by')}</span>
                  {v.publishedBy}
                </td>
                <td class="ctbl__num">
                  <span class="ctbl__lbl">{t('tower.zones.versions.col.zones')}</span>
                  {v.zones}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p class="cons__empty">{t('tower.zones.versions.none')}</p>
      )}
    </ConsoleFold>
  );
}
