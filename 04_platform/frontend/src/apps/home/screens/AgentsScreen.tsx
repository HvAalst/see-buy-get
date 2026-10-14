import { useState } from 'preact/hooks';
import { Button, Card, Icon, Note } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import { CLEARANCE_SPECIALISMS } from '../api';
import type { HomeActions, HomeState } from '../useHomeApp';

/**
 * FINDING A CLEARING AGENT — the market dynamic a page-per-participant could not supply on its own.
 *
 * The directory decision was a page each and never a ranked list, and that holds. But a page closes the
 * findability gap only for somebody who already has the handle; an importer looking for an agent who
 * clears vehicles at Mombasa had nowhere to start, and "ask around" is the out-of-band chasing this whole
 * epic exists to end. So this searches, and answers with pages.
 *
 * THREE THINGS ON THIS SCREEN ARE NOT COSMETIC.
 *
 * FIRST, THE ORDER IS ALPHABETICAL AND THE SCREEN SAYS SO. A list of people is read as a ranking unless it
 * tells you otherwise, and this network is the party an importer appoints an agent through — publishing an
 * ordering of them would be self-dealing. There is no relevance score either, because a relevance score is
 * the same league table under a name that hides it.
 *
 * SECOND, WHAT THEY SAY SITS NEXT TO WHAT WE HAVE SEEN, on every row. We do not check a claim, so an agent
 * who claims everything appears in every list — and that is fine, because the record beside the claim is
 * what a shipper actually weighs. Claiming more gets you seen; it does not get you credited.
 *
 * THIRD, AN EMPTY RECORD IS NOT A BAD RECORD, and the row says which it is. We count only consignments
 * that came through this network, and most of an agent's business never did. Letting silence read as
 * incompetence would be advertising our own coverage as somebody else's quality.
 */
export function AgentsScreen({ state, actions }: { state: HomeState; actions: HomeActions }) {
  const t = useT();
  const [specialism, setSpecialism] = useState(state.agentQuery.specialism);
  const [place, setPlace] = useState(state.agentQuery.place);
  const [country, setCountry] = useState(state.agentQuery.country);

  const search = () => void actions.findAgentsBy({ specialism, place, country });
  const rows = state.agents ?? [];

  return (
    <>
      <Card>
        <h1 class="h1">{t('home.agents.title')}</h1>
        <p class="card__note">{t('home.agents.lede')}</p>

        <div class="field">
          <label class="field__label" for="agent-specialism">
            {t('home.agents.whatLabel')}
          </label>
          <select id="agent-specialism" class="input" value={specialism} onChange={(e) => setSpecialism((e.target as HTMLSelectElement).value)}>
            <option value="">{t('home.agents.anything')}</option>
            {CLEARANCE_SPECIALISMS.map((s) => (
              <option key={s} value={s}>
                {t(`home.agents.spec.${s}` as never)}
              </option>
            ))}
          </select>
        </div>

        <div class="field">
          <label class="field__label" for="agent-place">
            {t('home.agents.whereLabel')}
          </label>
          <input id="agent-place" class="input" type="text" placeholder={t('home.agents.wherePh')} value={place} onInput={(e) => setPlace(e.currentTarget.value)} />
          <p class="card__note">{t('home.agents.whereHint')}</p>
        </div>

        <div class="field">
          <label class="field__label" for="agent-country">
            {t('home.agents.countryLabel')}
          </label>
          <input id="agent-country" class="input" type="text" maxLength={2} placeholder="KE" value={country} onInput={(e) => setCountry(e.currentTarget.value)} />
        </div>

        <Button busy={state.agentsState === 'loading'} onClick={search}>
          {t('home.agents.search')}
        </Button>
      </Card>

      {state.agentsState === 'error' ? <Note tone="danger" icon="warning" title={t('home.agents.failed')} detail={state.agentsError ?? undefined} /> : null}

      {state.agentsState === 'ready' ? (
        <Card>
          {/* The ordering, said out loud. Not a footnote: a list of people is read as a ranking unless it
              says otherwise, and we are the party an importer appoints through. */}
          <p class="card__note">
            <Icon name="info" size={16} /> {t('home.agents.basis', { n: rows.length })}
          </p>

          {rows.length === 0 ? (
            <Note tone="info" icon="search" title={t('home.agents.noneTitle')} detail={t('home.agents.noneBody')} />
          ) : (
            <ul class="list">
              {rows.map((a) => (
                <li key={a.entityId}>
                  <div>
                    <b>{a.name}</b>
                    {a.country ? <span class="card__note"> · {a.country}</span> : null}
                  </div>

                  {/* WHAT THEY SAY. Marked as their words every time it is shown — this is the one thing
                      on the page we did not derive, and a reader must never take it for a finding. */}
                  {a.offer ? (
                    <div class="card__note">
                      {t('home.agents.says', { what: a.offer.specialisms.map((s) => t(`home.agents.spec.${s}` as never)).join(', ') })}
                      {a.offer.places.length ? ` · ${a.offer.places.join(', ')}` : ''}
                      {a.offer.words ? <div>“{a.offer.words}”</div> : null}
                      <div>{t('home.agents.saidOn', { on: new Date(a.offer.saidAt).toLocaleDateString() })}</div>
                    </div>
                  ) : (
                    <div class="card__note">{t('home.agents.saysNothing')}</div>
                  )}

                  {/* WHAT WE HAVE SEEN, beside it. An empty record says which kind of empty it is. */}
                  <div class="card__note">
                    {a.appointed === 0
                      ? t('home.agents.seenNothing')
                      : t('home.agents.seen', { appointed: a.appointed, cleared: a.cleared })}
                  </div>

                  {a.handle ? (
                    <Button variant="link" full={false} onClick={() => void actions.openProfile(a.handle!)}>
                      {t('home.agents.open', { handle: a.handle })}
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          {/* Said once, under the list, because it applies to every row on it. */}
          <p class="card__note">{t('home.agents.foot')}</p>
        </Card>
      ) : null}

      <Button variant="link" onClick={() => actions.go('welcome')}>
        {t('home.agents.back')}
      </Button>
    </>
  );
}
