import { useEffect, useState } from 'preact/hooks';

/**
 * Debounce a fast-changing value (a search box's text) so the register only queries after the user pauses
 * — one request per pause, not per keystroke. Returns the value `ms` after it last changed.
 */
export function useDebounced<T>(value: T, ms = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}
