import { useRef } from 'preact/hooks';
import { Icon } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import { HELP_TOPICS, illustrationStat, pictureState, type HelpOption, type HelpTopic } from '../pictures';
import type { TowerActions, TowerState } from '../useTowerApp';

/**
 * The illustration library — a picture for every option a person has to choose between.
 *
 * It lives in the operator console because a drawing of "a flatbed" is a claim about what trucks look
 * like HERE, and the deployment is what knows: the vehicle that means flatbed in Nakuru is not the one a
 * European catalogue shows. The network ships the vocabulary; the operator supplies the local truth.
 *
 * The grid shows EVERY option, illustrated or not — the empty slots are the to-do list, and an option
 * with no picture is a normal state rather than a fault: its sheet simply falls back to the words.
 */
export function PicturesScreen({ state, actions }: { state: TowerState; actions: TowerActions }) {
  const t = useT();
  const options = state.help;
  const topic = state.helpTopic;
  // Counted only once there is something to count. "0 of 0 illustrated" over a body that says "reading…"
  // is the same lie as an empty list standing in for an unread one — and this one sat in the panel
  // heading, which is the part somebody reads first.
  const stat = options ? illustrationStat(options) : null;

  return (
    <>
      <header class="cons__head">
        <h1 class="cons__title">{t('tower.pictures.title')}</h1>
        <p class="cons__lede">{t('tower.pictures.lede')}</p>
      </header>

      <nav class="twr-sisters" aria-label={t('tower.pictures.pickTopic')}>
        {HELP_TOPICS.map((tp: HelpTopic) => (
          <button
            key={tp.key}
            type="button"
            class={`twr-sister${topic === tp.key ? ' twr-sister--on' : ''}`}
            aria-pressed={topic === tp.key}
            onClick={() => void actions.chooseHelpTopic(tp.key)}
          >
            <span class="twr-sister__n">{t(tp.labelKey)}</span>
            <span class="twr-sister__m">{t(tp.hintKey)}</span>
          </button>
        ))}
      </nav>

      {state.queueError ? <p class="cerr" style="max-width:96ch">{state.queueError}</p> : null}

      <section class="cons__panel">
        <div class="cons__panelhead">
          <span class="cons__panelt">{stat ? t('tower.pictures.countTitle', { done: stat.illustrated, total: stat.total }) : t('tower.pictures.loading')}</span>
          <span class="ctbl__sub">{stat ? t('tower.pictures.countHint', { mine: stat.mine }) : ''}</span>
        </div>

        {state.done ? (
          <p class="twr-done">
            <Icon name="check" size={16} />
            {state.done}
          </p>
        ) : null}

        {options === null ? (
          <p class="cons__empty">{t('tower.pictures.loading')}</p>
        ) : options.length === 0 ? (
          <div class="cons__empty">
            <p class="cons__emptyt">{t('tower.pictures.emptyTitle')}</p>
            <p>{t('tower.pictures.emptyBody')}</p>
          </div>
        ) : (
          <div class="twr-pics">
            {options.map((o) => (
              <Picture key={o.key} option={o} topic={topic} state={state} actions={actions} />
            ))}
          </div>
        )}
      </section>

      <p class="chint" style="max-width:80ch;margin-top:12px">{t('tower.pictures.footer')}</p>
    </>
  );
}

function Picture({ option, topic, state, actions }: { option: HelpOption; topic: string; state: TowerState; actions: TowerActions }) {
  const t = useT();
  const picker = useRef<HTMLInputElement>(null);
  const busy = state.busyId === `${topic}:${option.key}`;
  const s = pictureState(option);

  return (
    <div class="twr-pic">
      {option.imageUrl ? (
        <img class="twr-pic__img" src={`${state.apiBase}${option.imageUrl}`} alt={option.key} loading="lazy" />
      ) : (
        <div class="twr-pic__none">{t('tower.pictures.noPicture')}</div>
      )}
      <div class="ctbl__mono twr-pic__key">{option.key}</div>
      {/* THREE states, not two, and the difference decides what the buttons can honestly promise: a
          drawing shipped with the build cannot be deleted from here, only overridden; an override CAN be
          taken back, and taking it back reveals the network's drawing again rather than blanking it. */}
      <div class="ctbl__sub">{t(s.provenanceKey, s.params)}</div>
      <div class="twr-clear__act" style="margin-top:8px">
        <input
          ref={picker}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const input = e.target as HTMLInputElement;
            const file = input.files?.[0];
            if (file) void actions.uploadPicture(topic, option.key, file);
            input.value = ''; // so choosing the SAME file twice still fires a change
          }}
        />
        <button type="button" class="cbtn cbtn--ghost cbtn--sm" disabled={busy} onClick={() => picker.current?.click()}>
          {busy ? t('tower.pictures.saving') : t(s.uploadKey)}
        </button>
        {/* Offered only where there is something of the operator's OWN to undo. */}
        {s.owned ? (
          <button type="button" class="cbtn cbtn--ghost cbtn--sm" disabled={busy} onClick={() => void actions.revertPicture(topic, option.key)}>
            {t('tower.pictures.revert')}
          </button>
        ) : null}
      </div>
    </div>
  );
}
