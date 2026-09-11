import { Icon } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import {
  CAPABILITY_LABEL,
  LEVEL_LABEL,
  PRESENCE_LEVELS,
  PROMISE_LABEL,
  alreadyListed,
  capabilityStates,
  levelBlocker,
  newCountryBlocker,
  levelEffect,
  presenceRows,
  takeInPromise,
  type PresenceLevel,
  type PresenceRow,
} from '../presence';
import type { TowerActions, TowerState } from '../useTowerApp';

/**
 * HOW ESTABLISHED WE ARE, COUNTRY BY COUNTRY.
 *
 * The network can match, carry and prove where it cannot spend a shilling — that is what makes it an
 * operating system rather than one company's software — and this is the screen that decides which is
 * which. Everything here is built so the difference cannot be misread: a country shows what it may do
 * AND what somebody deliberately switched off, a level change shows what it would cost before it is
 * pressed, and "established" cannot be typed at all where no company transacts.
 */
export function PresenceScreen({ state, actions }: { state: TowerState; actions: TowerActions }) {
  const t = useT();
  const rows = state.presence ? presenceRows(state.presence) : null;

  return (
    <>
      <header class="cons__head">
        <h1 class="cons__title">{t('tower.presence.title')}</h1>
        <p class="cons__lede">{t('tower.presence.lede')}</p>
      </header>

      <p class="cons__caveat">
        <Icon name="info" size={16} />
        <span>
          <b>{t('tower.presence.caveatT')}</b> {t('tower.presence.caveat')}
        </span>
      </p>

      <section class="cons__panel">
        <div class="cons__panelhead">
          <span class="cons__panelt">{rows === null ? t('tower.queues.loading') : t('tower.presence.count', { n: rows.length })}</span>
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
          <p class="cerr" style="margin:12px 16px">
            {state.queueError}
          </p>
        ) : null}

        {rows === null ? (
          <p class="cons__empty">{t('tower.queues.loading')}</p>
        ) : (
          <table class="ctbl">
            <thead>
              <tr>
                <th>{t('tower.presence.col.country')}</th>
                <th>{t('tower.presence.col.standing')}</th>
                <th>{t('tower.presence.col.promise')}</th>
                <th>{t('tower.presence.col.may')}</th>
                <th>{t('tower.presence.col.decided')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <PresenceRowView key={row.jurisdiction} row={row} state={state} actions={actions} />
              ))}
            </tbody>
          </table>
        )}
      </section>

      <RecordCountry state={state} actions={actions} />
    </>
  );
}

/**
 * Record a country that is not on the map yet.
 *
 * The table can only show countries that already have a company or a standing, which would make the
 * FIRST country we are not established in impossible to record — and a map of where we operate that
 * cannot describe where we are going is a map of the past.
 */
function RecordCountry({ state, actions }: { state: TowerState; actions: TowerActions }) {
  const t = useT();
  const form = state.countryForm;
  const rows = state.presence ?? [];
  const blocker = newCountryBlocker(form, rows);
  const listed = alreadyListed(form, rows);

  return (
    <section class="cons__panel twr-corridornew">
      <div class="cons__panelhead">
        <span class="cons__panelt">{t('tower.presence.newTitle')}</span>
      </div>

      <div class="twr-corridorform">
        <label class="cfield">
          <span class="cfield__label">{t('tower.presence.f.country')}</span>
          <input
            class="cinput"
            value={form.jurisdiction}
            placeholder={t('tower.presence.f.countryPlaceholder')}
            maxLength={2}
            onInput={(e) => actions.setCountryForm({ jurisdiction: e.currentTarget.value })}
          />
        </label>
        <label class="cfield">
          <span class="cfield__label">{t('tower.presence.f.level')}</span>
          <select class="cinput" value={form.level} onChange={(e) => actions.setCountryForm({ level: e.currentTarget.value as PresenceLevel })}>
            {PRESENCE_LEVELS.map((option) => (
              <option key={option} value={option}>
                {t(LEVEL_LABEL[option])}
              </option>
            ))}
          </select>
        </label>
        <label class="cfield">
          <span class="cfield__label">{t('tower.presence.f.note')}</span>
          <input class="cinput" value={form.note} onInput={(e) => actions.setCountryForm({ note: e.currentTarget.value })} />
        </label>
      </div>

      <div class="twr-corridorsave">
        <button
          type="button"
          class="cbtn cbtn--primary"
          disabled={blocker !== null || state.busyId === 'country'}
          onClick={() => void actions.recordCountry()}
        >
          {t('tower.presence.record')}
        </button>
        {blocker ? <span class="chint">{t(blocker)}</span> : null}
        {/* Typing a country already on the map is an EDIT, and saying so is cheaper than undoing one. */}
        {!blocker && listed ? <span class="chint">{t('tower.presence.wouldChange')}</span> : null}
      </div>
    </section>
  );
}

function PresenceRowView({ row, state, actions }: { row: PresenceRow; state: TowerState; actions: TowerActions }) {
  const t = useT();
  const open = state.openId === row.jurisdiction;
  const promise = takeInPromise(row);
  const granted = capabilityStates(row).filter((s) => s.on);
  const switchedOff = capabilityStates(row).filter((s) => !s.on && s.overridden);

  return (
    <>
      <tr class={open ? 'is-open' : undefined}>
        <td>
          <div class="ctbl__strong">{row.jurisdiction}</div>
          {/* A country listed only because it has a company has had nothing DECIDED about it. */}
          {row.recorded ? null : <div class="ctbl__sub">{t('tower.presence.derived')}</div>}
        </td>
        <td>
          <span class={`ctag ${row.level === 'established' ? 'ctag--ok' : row.level === 'observed' ? 'ctag--quiet' : 'ctag--info'}`}>{t(LEVEL_LABEL[row.level])}</span>
        </td>
        <td class="ctbl__sub">{t(PROMISE_LABEL[promise])}</td>
        <td class="ctbl__sub">
          {granted.length === 0 ? (
            t('tower.presence.nothing')
          ) : (
            <span class="twr-caps">
              {granted.map((s) => (
                <span key={s.capability} class={`ctag ${s.overridden ? 'ctag--warn' : 'ctag--quiet'}`}>
                  {t(CAPABILITY_LABEL[s.capability])}
                </span>
              ))}
            </span>
          )}
          {/* The ones somebody turned OFF against their level — the only absences worth a word. */}
          {switchedOff.length ? (
            <div class="chint">{t('tower.presence.switchedOff', { list: switchedOff.map((s) => t(CAPABILITY_LABEL[s.capability])).join(', ') })}</div>
          ) : null}
        </td>
        <td class="ctbl__sub">
          {row.setBy ? t('tower.presence.by', { who: row.setBy }) : '—'}
          {row.note ? <div class="ctbl__sub">{row.note}</div> : null}
        </td>
        <td class="ctbl__num">
          <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => actions.open(open ? null : row.jurisdiction)}>
            {t(open ? 'tower.presence.close' : 'tower.presence.change')}
          </button>
        </td>
      </tr>

      {open ? (
        <tr class="is-open ctbl__editor">
          <td colSpan={6}>
            <PresenceEditor row={row} state={state} actions={actions} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

/**
 * Moving a country up or down the ladder.
 *
 * The level picker shows what each move would COST — a level is a word, and the word is not the
 * consequence — and `established` is not offered at all where no company transacts, because a flag must
 * never be the thing that conjures a Merchant of Record, a float and a claims provision.
 */
function PresenceEditor({ row, state, actions }: { row: PresenceRow; state: TowerState; actions: TowerActions }) {
  const t = useT();
  const form = state.presenceForm;
  const level = (form.level || row.level) as PresenceLevel;
  const blocker = levelBlocker(row, level);
  const { gained, lost } = levelEffect(row, level);
  const busy = state.busyId === row.jurisdiction;

  return (
    <div class="twr-presedit">
      <label class="cfield">
        <span class="cfield__label">{t('tower.presence.f.level')}</span>
        <select class="cinput" value={level} onChange={(e) => actions.setPresenceForm({ level: e.currentTarget.value as PresenceLevel })}>
          {PRESENCE_LEVELS.map((option) => (
            <option key={option} value={option} disabled={levelBlocker(row, option) !== null}>
              {t(LEVEL_LABEL[option])}
            </option>
          ))}
        </select>
        {blocker ? <span class="chint">{t(blocker)}</span> : null}
      </label>

      <label class="cfield twr-presedit__note">
        <span class="cfield__label">{t('tower.presence.f.note')}</span>
        <input class="cinput" value={form.note} placeholder={t('tower.presence.f.notePlaceholder')} onInput={(e) => actions.setPresenceForm({ note: e.currentTarget.value })} />
      </label>

      <div class="twr-presedit__effect">
        {level === row.level ? (
          <p class="chint">{t('tower.presence.noChange')}</p>
        ) : (
          <>
            {lost.length ? (
              <p class="chint">
                <b>{t('tower.presence.wouldLose')}</b> {lost.map((c) => t(CAPABILITY_LABEL[c])).join(', ')}
              </p>
            ) : null}
            {gained.length ? (
              <p class="chint">
                <b>{t('tower.presence.wouldGain')}</b> {gained.map((c) => t(CAPABILITY_LABEL[c])).join(', ')}
              </p>
            ) : null}
            {!lost.length && !gained.length ? <p class="chint">{t('tower.presence.sameCapabilities')}</p> : null}
          </>
        )}
      </div>

      <div class="twr-presedit__act">
        <button
          type="button"
          class="cbtn cbtn--primary"
          disabled={busy || blocker !== null || level === row.level}
          onClick={() => void actions.savePresence(row.jurisdiction)}
        >
          {t('tower.presence.save')}
        </button>
        <button type="button" class="cbtn cbtn--ghost" onClick={() => actions.open(null)}>
          {t('tower.presence.cancel')}
        </button>
      </div>
    </div>
  );
}
