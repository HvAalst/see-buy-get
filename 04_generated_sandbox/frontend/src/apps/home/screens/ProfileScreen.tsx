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
