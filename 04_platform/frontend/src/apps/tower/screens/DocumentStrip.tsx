import { useCallback, useState } from 'preact/hooks';
import { AuthImage, Icon } from '../../../shared/ui';
import { useT, type MessageKey } from '../../../shared/i18n';
import type { TowerActions, TowerState } from '../useTowerApp';
import { tabAtTheTap } from '../../../shared/openPage';

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
  /*
   * WHICH OF THEM ARE ACTUALLY THERE.
   *
   * The heading counted references, and a reference is a claim about a photograph rather than the
   * photograph — so a row could say "2 attached" and produce neither, which is the same defect as the
   * count that started this component, one layer deeper. An adjudicator reading "2 attached" and seeing
   * two grey squares cannot tell a slow connection from evidence that was never uploaded, and the
   * difference decides whether they wait or decide without it.
   *
   * So the strip now reports the gap, in words, and a missing photograph is itself information: somebody
   * cited evidence that cannot be produced.
   */
  const [missing, setMissing] = useState<string[]>([]);
  const noteMissing = useCallback((id: string) => setMissing((m) => (m.includes(id) ? m : [...m, id])), []);

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
      {/* Said next to the count it contradicts, never instead of it: the record claims this many, and
          this many of them cannot be produced. Both facts matter to the decision. */}
      {missing.length ? (
        <p class="twr-evidence__gap">
          <Icon name="warning" size={16} />
          <span>{t('tower.claims.evidenceMissing', { n: missing.length, of: refs.length })}</span>
        </p>
      ) : null}
      <div class="twr-evidence__strip">
        {refs.map((mediaId, i) => {
          const gone = missing.includes(mediaId);
          return (
            <button
              key={mediaId}
              type="button"
              class="twr-evidence__shot"
              title={gone ? t('tower.claims.evidenceGoneTitle') : t('tower.claims.evidenceOpen')}
              // A tile with nothing behind it is not a control: pressing it used to do nothing at all,
              // silently, which reads as a broken console rather than as missing evidence.
              disabled={!client || gone || state.busyId != null}
              onClick={async () => {
                if (!client) return;
                const tab = tabAtTheTap();
                try {
                  const r = await client.api.mediaBlob(mediaId);
                  const blob = r.error ? null : (r.data as unknown as Blob | null);
                  // Opened, never downloaded: this is somebody's document, and the retention clock owns the copy.
                  if (blob) tab.show(blob);
                } finally {
                  tab.cancel();
                }
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
                  onFailed={noteMissing}
                />
              ) : null}
              {gone ? <span class="twr-evidence__goneline">{t('tower.claims.evidenceGone')}</span> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
