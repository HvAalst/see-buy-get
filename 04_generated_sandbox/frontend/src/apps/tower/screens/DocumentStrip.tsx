import { AuthImage, Icon } from '../../../shared/ui';
import { useT, type MessageKey } from '../../../shared/i18n';
import type { TowerActions, TowerState } from '../useTowerApp';

/**
 * THE DOCUMENTS THEMSELVES, shown where the decision is taken.
 *
 * Three screens in this console asked somebody to decide on evidence they could not see. The claims queue
 * said "2 photos" and showed none. The driver vetting queue had no screen at all, though the route and the
 * uploads had both been live for months. The papers screen invited an operator to type a new licence expiry
 * under a comment reading "recorded by staff who have seen the paper", while showing them no paper.
 *
 * In every case the refs were already on the row and the media route already allowed an operator through.
 * Nothing was missing except the asking — which is the thing worth remembering: a surface that never asks
 * for what it needs looks complete, because there is no error anywhere.
 *
 * A thumbnail opens the full image in a new tab, since a licence date or a broken pallet is not a thing to
 * judge at 112px. When there are NO refs, the empty message is a warning rather than a blank: the decision
 * is still takeable and it is a different decision, so the screen says which one is being taken.
 */
export function DocumentStrip({
  refs,
  state,
  actions,
  titleKey,
  emptyKey,
}: {
  refs: string[];
  state: TowerState;
  actions: TowerActions;
  titleKey: MessageKey;
  emptyKey: MessageKey;
}) {
  const t = useT();
  const client = actions.client();

  if (!refs.length) {
    return (
      <p class="cons__caveat">
        <Icon name="camera" size={16} />
        <span>{t(emptyKey)}</span>
      </p>
    );
  }

  return (
    <div class="twr-evidence">
      <div class="twr-evidence__head">{t(titleKey, { n: refs.length })}</div>
      <div class="twr-evidence__strip">
        {refs.map((mediaId, i) => (
          <button
            key={mediaId}
            type="button"
            class="twr-evidence__shot"
            title={t('tower.claims.evidenceOpen')}
            disabled={!client || state.busyId != null}
            onClick={async () => {
              if (!client) return;
              const r = await client.api.mediaBlob(mediaId);
              const blob = r.error ? null : (r.data as unknown as Blob | null);
              // Opened, never downloaded: this is somebody's document, and the retention clock owns the copy.
              if (blob) window.open(URL.createObjectURL(blob), '_blank', 'noopener');
            }}
          >
            {/* No client, no loader: AuthImage fetches on mount, so rendering it before sign-in would
                call through a null client rather than simply showing nothing. */}
            {client ? (
              <AuthImage
                mediaId={mediaId}
                load={(id) => client.api.mediaBlob(id, 'thumb') as Promise<{ data: Blob | null; error: unknown }>}
                alt={t('tower.claims.evidenceAlt', { n: i + 1 })}
                class="twr-evidence__img"
              />
            ) : null}
          </button>
        ))}
      </div>
    </div>
  );
}
