import { useConnectivity } from '../connectivity';
import { Note } from './ErrorNote';

/**
 * SAID BEFORE THE TAP (the user, 2026-10-18: "queue reports, rest online"). Handing a parcel over, signing in and
 * topping up keep needing a signal, because SeeBuyGet has to answer them; with none, the screen says so before anybody
 * tries — what it needs the signal for, and what still works — rather than after a tap that could not work.
 *
 * Shown only while there is no signal (connectivity.ts, which knows from the first screen when the radio is off).
 */
export function NeedsSignalNote({ title, detail }: { title: string; detail: string }) {
  const { online } = useConnectivity();
  if (online) return null;
  return <Note tone="warn" icon="offline" title={title} detail={detail} />;
}
