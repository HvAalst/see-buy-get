import { useCallback, useEffect, useState } from 'preact/hooks';
import { hiddenCount, hide, isHidden, restoreAll, subscribe, type TipId } from './tips';

export interface TipControls {
  /** Whether this person has finished with this explainer. */
  hidden: (id: TipId) => boolean;
  /** Put one away for good. */
  hide: (id: TipId) => void;
  /** Bring every one of them back — the way out of a mis-tap. */
  restore: () => void;
  /** How many are put away. Zero means the restore control has nothing to offer and does not appear. */
  count: number;
}

/**
 * Reading and changing what this person has put away.
 *
 * The subscription is the point: the restore control sits in a screen's footer and the explainers sit at
 * the top, so a tap in one has to reach the other. Without it, restoring would appear to do nothing
 * until the next navigation — which reads as a broken button, and a broken way back is worse than none.
 */
export function useTips(who: string | null | undefined): TipControls {
  const [, bump] = useState(0);

  useEffect(() => subscribe(() => bump((n) => n + 1)), []);

  return {
    hidden: useCallback((id: TipId) => isHidden(who, id), [who]),
    hide: useCallback((id: TipId) => hide(who, id), [who]),
    restore: useCallback(() => restoreAll(who), [who]),
    count: hiddenCount(who),
  };
}
