import { useEffect, useState } from 'preact/hooks';

/**
 * ONE LIVE VIEW, passed on to the screens (shared/live.ts). The app that holds the stream says here what may have
 * changed; a screen that reads its own data — a list, the bell — takes a number that goes up each time one of the
 * names it cares about is said, and reads again when it does (the number among its effect's inputs). An app with no
 * stream never says anything, and its screens read as they always did.
 */
type Listener = (topics: readonly string[]) => void;
const listeners = new Set<Listener>();

/** Tell the screens that are open what may have changed. */
export function tellScreens(topics: readonly string[]): void {
  if (!topics.length) return;
  for (const listener of [...listeners]) listener(topics);
}

/**
 * Whether a screen that cares about `names` reads again for these topics: when any of them is said (every time, given
 * none). "changed" is a name like the others — what the fleet's own people did — and a screen lists it when what they
 * do shows there; the bell does not, and moves only for its own.
 */
export function concerns(names: readonly string[] | undefined, topics: readonly string[]): boolean {
  if (!names) return true;
  return topics.some((t) => names.includes(t));
}

/** A number that goes up each time something with one of these names may have changed (all of them when none are given). */
export function useLiveTick(names?: readonly string[]): number {
  const [tick, setTick] = useState(0);
  const key = names?.join('|');
  useEffect(() => {
    const wanted = key === undefined ? undefined : key.split('|');
    const listener: Listener = (topics) => {
      if (concerns(wanted, topics)) setTick((n) => n + 1);
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, [key]);
  return tick;
}
