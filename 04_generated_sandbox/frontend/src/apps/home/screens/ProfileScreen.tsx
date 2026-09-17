import { Card, Note, Pill, ReadAloud } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import type { HomeActions, HomeState } from '../useHomeApp';

export interface ProfileScreenProps {
  state: HomeState;
  actions: HomeActions;
}

/**
 * ONE PARTICIPANT'S PUBLIC PAGE — `seebuyget.com/@fedex`.
 *
 * THE DIRECTORY, AND DELIBERATELY NOT A LIST. Appointing a clearing agent used to mean typing a company id
 * somebody had to send you out of band, which is a poor answer for a network whose promise is that a trader
 * stops chasing people. A ranked list would have been a worse one: it imposes an ordering on people whether
 * or not anything went wrong, and while this network is the party appointing them, publishing that ordering
 * is self-dealing. A page per participant carries the same facts and manufactures no loser out of relative
 * position — which is also exactly the shape the agent-record work requires.
 *
 * WHAT THIS PAGE MAY SAY. It states what we KNOW and never what we vouch for, and the difference is the
 * whole design:
 *
 *   - THE PRESENCE LEVEL TRAVELS WITH THE NAME, spelled out rather than left as a word. A reader has no
 *     other way to learn that `matched` means we hold no money in that country and nothing on this network
 *     can pay a claim there. A page that lets itself be read as an endorsement is the self-dealing above
 *     wearing a new hat.
 *   - VERIFICATIONS ARE NAMED, NOT SCORED. What staff actually checked, with its date, so a reader can
 *     weigh it themselves. An empty list is a real answer and shows as one — it is not a bad mark, it is
 *     the absence of a check.
 *   - NO PERFORMANCE FIGURE YET. The mobilisation record is not built, and a zero would read as a bad
 *     score rather than as an unmeasured one. Silence is the honest placeholder.
 *
 * And nothing here comes out of the identity vault: a trading name, a country, a coarse pin and a date.
 */
export function ProfileScreen({ state }: ProfileScreenProps) {
  const t = useT();
  const p = state.profile;

  if (state.profileState === 'loading') {
    return (
      <Card>
        <p class="card__note">{t('home.profile.loading')}</p>
      </Card>
    );
  }

  if (state.profileState === 'error' || !p) {
    return (
      <Card>
        {/* A handle nobody holds is the ordinary case — somebody mistyped, or read it off a lorry. It is
            not an error to apologise for, and it must not imply the participant was removed. */}
        <Note tone="warn" icon="info" title={t('home.profile.notFoundTitle')} detail={state.profileError ?? t('home.profile.notFoundBody')} />
      </Card>
    );
  }

  return (
    <>
      <Card>
        <h1 class="h1">{p.name}</h1>
        <p class="card__note">
          @{p.handle}
          {p.country ? ` · ${p.country}` : ''}
          {p.area ? ` · ${p.area}` : ''}
        </p>
        {/* A handle does not follow a rename, so when the address and the heading disagree a reader is
            owed both rather than left wondering which is current. */}
        {p.formerly ? <p class="card__note">{t('home.profile.formerly', { name: p.formerly })}</p> : null}
        <p>{p.does}</p>
        <p class="card__note">{t('home.profile.since', { date: new Date(p.since).toLocaleDateString() })}</p>
        {/* A getter, not a string: the component speaks state at the moment of the tap. */}
        <ReadAloud text={() => [p.name + '.', p.does, p.presence?.says].filter(Boolean).join(' ')} />
      </Card>

      {/* WHAT OUR PRESENCE THERE ACTUALLY PROMISES. Not a badge — a sentence. Omitted entirely when no
          country is recorded: the ladder answers 'observed' for an unknown jurisdiction, which would
          render as a confident claim about a country nobody named. */}
      {p.presence ? (
      <Card>
        <h2 class="h2">{t('home.profile.standingTitle')}</h2>
        <p>
          <Pill tone={p.presence.level === 'established' ? 'ok' : p.presence.level === 'observed' ? 'idle' : 'warn'}>{p.presence.level}</Pill>
        </p>
        <p>{p.presence.says}</p>
      </Card>
      ) : null}

      {/* CL4 — THE MOBILISATION RECORD. Public on purpose: an operator-only signal does not remove our
          influence over who gets appointed, it conceals it, and the party sees these exact fields. */}
      {p.moves && p.movesMeasured ? (
        <Card>
          <h2 class="h2">{t('home.profile.movesTitle')}</h2>
          {/* THE SENTENCE COMES FIRST, not in a footnote. This measure's failure mode is being read as a
              general endorsement, and the only defence is saying what it is not before the numbers. */}
          <p class="card__note">{p.movesMeasured}</p>

          <ul class="list">
            <li>{t('home.profile.movesTaken', { n: p.moves.claimed })}</li>
            {/* What happened, including the bad — a record that can only flatter protects nobody. */}
            <li>{t('home.profile.movesGaveBack', { n: p.moves.handedBack })}</li>
            <li>{t('home.profile.movesDelivered', { n: p.moves.delivered })}</li>
            {p.moves.inFlight > 0 ? <li>{t('home.profile.movesRunning', { n: p.moves.inFlight })}</li> : null}
          </ul>

          {/* The question the measure exists for: did they turn up when trucks were scarce? */}
          {p.moves.tightKept > 0 ? (
            <p>{t('home.profile.movesTight', { kept: p.moves.tightKept, delivered: p.moves.tightDelivered })}</p>
          ) : null}

          {/* RATES ONLY WHEN THE RECORD CAN CARRY THEM. Three loads shows three loads and no average:
              hiding it is a polish that flatters, and averaging it is the same untruth wearing the
              opposite sign. A newcomer reads as a newcomer, which is what they are. */}
          {p.moves.thin ? (
            <Note tone="info" icon="info" title={t('home.profile.movesThinTitle')} detail={t('home.profile.movesThinBody', { n: p.moves.ratesNeed })} />
          ) : (
            <p>
              {t('home.profile.movesRates', {
                kept: Math.round((p.moves.keptRate ?? 0) * 100),
                delivered: Math.round((p.moves.deliveredRate ?? 0) * 100),
              })}
            </p>
          )}

          {/* Per lane, because moving dry goods on one corridor is not the same job as three corridors. */}
          {p.moves.lanes.length > 0 ? (
            <>
              <h3 class="h3">{t('home.profile.movesLanes')}</h3>
              <ul class="list">
                {p.moves.lanes.slice(0, 8).map((l) => (
                  <li key={l.key}>{t('home.profile.movesLane', { lane: l.key, taken: l.claimed, delivered: l.delivered })}</li>
                ))}
              </ul>
            </>
          ) : null}
        </Card>
      ) : null}

      <Card>
        <h2 class="h2">{t('home.profile.checkedTitle')}</h2>
        {p.verified.length === 0 ? (
          <Note tone="info" icon="info" title={t('home.profile.nothingCheckedTitle')} detail={t('home.profile.nothingCheckedBody')} />
        ) : (
          <ul class="list">
            {p.verified.map((v) => (
              <li key={`${v.what}-${v.at}`}>
                {v.what} · <span class="card__note">{new Date(v.at).toLocaleDateString()}</span>
              </li>
            ))}
          </ul>
        )}
        {/* Said once, plainly, on every profile: a check is not a recommendation. */}
        <p class="card__note">{t('home.profile.checkedFoot')}</p>
      </Card>
    </>
  );
}
