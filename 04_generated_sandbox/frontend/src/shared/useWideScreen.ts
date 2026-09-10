import { useEffect, useState } from 'preact/hooks';

/**
 * Is there room for a sidebar?
 *
 * CSS can move a menu, but it cannot swap one component for another — and a rail turned sideways is
 * not a phone menu, it is a desktop menu with a scrollbar. The console therefore renders a DIFFERENT
 * navigation below this line (a bottom bar and a slide-up sheet), which means the breakpoint has to be
 * a value JavaScript can read as well as a value the stylesheet honours. Both live at 1100px, and the
 * stylesheet's layout rules and this hook must be changed together.
 *
 * Defaults to WIDE where there is no `matchMedia` to ask (a test in the node environment, a server
 * render): the sidebar degrades to a list of links, while a bottom bar fixed to the bottom of a page
 * nobody can tap is furniture in the way.
 */
export function useWideScreen(minPx = 1100): boolean {
  const query = `(min-width: ${minPx}px)`;
  const [wide, setWide] = useState(() => match(query));

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(query);
    // Read once on subscribe as well: between the first render and this effect the window may already
    // have been dragged across the line, and a resize listener only ever reports the NEXT change.
    setWide(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setWide(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);

  return wide;
}

function match(query: string): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
  return window.matchMedia(query).matches;
}
