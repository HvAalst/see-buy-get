import { Icon } from '../../../shared/ui';
import { ConsolePick } from '../ConsolePick';
import { useT } from '../../../shared/i18n';
import { corridorBlocker, corridorViews, zoneOptions } from '../corridors';
import type { TowerActions, TowerState } from '../useTowerApp';

/**
 * The corridors: the routes this network runs buses on.
 *
 * It exists because nothing could draw one. A corridor decides what every shop in a zone may take in and
 * what a bus can be handed at a counter, and until now the only way one came into existence was a seed
 * script — so a fleet manager's corridor picker offered whatever a seed happened to write, and a shift
 * started without one failed later, on the shopkeeper's screen.
 *
 * Blocking is the consequential half and is treated as such: the table says how many shifts are running
 * on a corridor before anybody presses it, and a closed corridor stays listed so it can be reopened.
 */
export function CorridorsScreen({ state, actions }: { state: TowerState; actions: TowerActions }) {
  const t = useT();
  const rows = state.corridors ? corridorViews(state.corridors, state.couplings ?? []) : null;
  const zones = zoneOptions(state.agents, state.hubs, state.corridors);
  const form = state.corridorForm;
  const blocker = corridorBlocker(form, state.corridors ?? []);

  return (
    <>
      <header class="cons__head">
        <h1 class="cons__title">{t('tower.corridors.title')}</h1>
        <p class="cons__lede">{t('tower.corridors.lede')}</p>
      </header>

      {/* Not a warning about this screen — a standing statement about what the rows underneath DO. */}
      <p class="cons__caveat">
        <Icon name="info" size={16} />
        <span>
          <b>{t('tower.corridors.caveatT')}</b> {t('tower.corridors.caveat')}
        </span>
      </p>

      <section class="cons__panel">
        <div class="cons__panelhead">
          <span class="cons__panelt">{rows === null ? t('tower.queues.loading') : t('tower.corridors.count', { n: rows.length })}</span>
          <span class="twr-panelend">
            {state.readAt ? <span class="ctbl__sub">{t('tower.hazards.updatedAt', { time: new Date(state.readAt).toLocaleTimeString() })}</span> : null}
            <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => void actions.refresh()} disabled={state.loading}>
              <Icon name="refresh" size={16} />
              {t('tower.hazards.refresh')}
            </button>
          </span>
        </div>

        {state.done ? (
          <p class="twr-done">
            <Icon name="check" size={16} />
            {state.done}
          </p>
        ) : null}

        {state.queueError ? (
          <p class="cerr" style="margin:12px 0">
            {state.queueError}
          </p>
        ) : null}

        {rows === null ? (
          <p class="cons__empty">{t('tower.queues.loading')}</p>
        ) : rows.length === 0 ? (
          <div class="cons__empty">
            <p class="cons__emptyt">{t('tower.corridors.emptyTitle')}</p>
            <p>{t('tower.corridors.emptyBody')}</p>
          </div>
        ) : (
          <table class="ctbl ctbl--stack">
            <thead>
              <tr>
                <th>{t('tower.corridors.col.name')}</th>
                <th>{t('tower.corridors.col.zones')}</th>
                <th>{t('tower.corridors.col.runs')}</th>
                <th class="ctbl__num">{t('tower.corridors.col.shifts')}</th>
                <th>{t('tower.corridors.col.status')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const blocked = row.status === 'blocked';
                const proposed = row.status === 'proposed';
                return (
                  <tr key={row.corridorId}>
                    <td>
                      <div class="ctbl__strong">{row.name}</div>
                      {/* Whose bus — the network's own, or a fleet's line that only its drivers run. */}
                      <div class="ctbl__sub">{row.owner ? t('tower.corridors.ownedBy', { company: row.owner.company }) : t('tower.corridors.network')}</div>
                      {row.note ? <div class="ctbl__sub">{row.note}</div> : null}
                      <div class="ctbl__mono">{row.corridorId}</div>
                    </td>
                    <td><span class="ctbl__lbl">{t('tower.corridors.col.zones')}</span>{`${row.originZone} → ${row.destZone}`}</td>
                    <td class="ctbl__sub"><span class="ctbl__lbl">{t('tower.corridors.col.runs')}</span>
                      {t(row.vehicleType === 'truck' ? 'tower.corridors.truck' : 'tower.corridors.bus')}
                      {row.schedule ? ` · ${row.schedule}` : ''}
                    </td>
                    {/* The number that changes what blocking MEANS. */}
                    <td class="ctbl__num"><span class="ctbl__lbl">{t('tower.corridors.col.shifts')}</span>{row.shifts}</td>
                    <td><span class="ctbl__lbl">{t('tower.corridors.col.status')}</span>
                      {proposed ? (
                        <span class="ctag">{t('tower.corridors.proposed')}</span>
                      ) : blocked ? (
                        <span class="ctag ctag--warn">{t('tower.corridors.blocked')}</span>
                      ) : (
                        <span class="ctag ctag--ok">{t('tower.corridors.active')}</span>
                      )}
                    </td>
                    <td>
                      {proposed ? (
                        <button
                          type="button"
                          class="cbtn cbtn--sm cbtn--primary"
                          disabled={state.busyId === row.corridorId}
                          onClick={() => void actions.publishCorridor(row.corridorId)}
                        >
                          {t('tower.corridors.publish')}
                        </button>
                      ) : (
                      <button
                        type="button"
                        class={`cbtn cbtn--sm ${blocked ? 'cbtn--primary' : 'cbtn--ghost'}`}
                        disabled={state.busyId === row.corridorId}
                        onClick={() => void actions.setCorridorStatus(row.corridorId, blocked ? 'active' : 'blocked')}
                      >
                        {t(blocked ? 'tower.corridors.reopen' : 'tower.corridors.block')}
                      </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <section class="cons__panel twr-corridornew">
        <div class="cons__panelhead">
          <span class="cons__panelt">{t('tower.corridors.newTitle')}</span>
        </div>

        <div class="twr-corridorform">
          {/* Suggestions, never a closed list: the first corridor into a new zone is drawn before any
              shop is there, and this is the screen that plans that — so a zone not on the list is typed and taken. */}
          <ConsolePick
            label={t('tower.corridors.f.origin')}
            value={form.originZone}
            onChange={(v) => actions.setCorridorForm({ originZone: v })}
            options={zones.map((z) => ({ value: z, label: z }))}
            allowFree={(q) => q || null}
          />
          <ConsolePick
            label={t('tower.corridors.f.dest')}
            value={form.destZone}
            onChange={(v) => actions.setCorridorForm({ destZone: v })}
            options={zones.map((z) => ({ value: z, label: z }))}
            allowFree={(q) => q || null}
          />
          <label class="cfield">
            <span class="cfield__label">{t('tower.corridors.f.name')}</span>
            <input
              class="cinput"
              value={form.name}
              placeholder={form.originZone && form.destZone ? `${form.originZone} → ${form.destZone}` : ''}
              onInput={(e) => actions.setCorridorForm({ name: e.currentTarget.value })}
            />
          </label>
          <ConsolePick
            label={t('tower.corridors.f.vehicle')}
            value={form.vehicleType}
            onChange={(v) => actions.setCorridorForm({ vehicleType: v === 'truck' ? 'truck' : 'bus' })}
            options={[
              { value: 'bus', label: t('tower.corridors.bus') },
              { value: 'truck', label: t('tower.corridors.truck') },
            ]}
          />
          <label class="cfield">
            <span class="cfield__label">{t('tower.corridors.f.schedule')}</span>
            <input
              class="cinput"
              value={form.schedule}
              placeholder={t('tower.corridors.f.schedulePlaceholder')}
              onInput={(e) => actions.setCorridorForm({ schedule: e.currentTarget.value })}
            />
          </label>
        </div>

        <div class="twr-corridorsave">
          <button type="button" class="cbtn cbtn--primary" disabled={blocker !== null || state.busyId === 'corridor'} onClick={() => void actions.saveCorridor()}>
            {t('tower.corridors.save')}
          </button>
          {/* Said before the server has to say it — and only where the screen is certain. */}
          {blocker ? <span class="chint">{t(blocker)}</span> : null}
        </div>
      </section>
    </>
  );
}
