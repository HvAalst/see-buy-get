import { useEffect, useLayoutEffect, useRef } from 'preact/hooks';
import { onLaunch } from './launch';

/**
 * 2026-11-02 — BACK, AS AN APP MEANS IT (the owner: "make it as native as today can be").
 *
 * Every app here moves between its screens by state, and its sheets are state too, so the browser's history had never
 * heard of either: in an installed app, Android's back gesture closed the whole app — with a sheet open, three screens
 * deep. That, more than anything, is what made these apps feel like websites.
 *
 * Now each thing Back can undo — a screen above the app's first, an open sheet, an open menu — holds ONE entry in the
 * history, and Back undoes the top one: the sheet closes, the screen before comes back. On the app's first screen with
 * nothing open there is no entry of ours left, and Back leaves the app as it always did.
 *
 * The entries carry no address and no meaning — only how deep they are. What each one undoes is kept here, in the page,
 * so a reload, or an address passed on, never reopens a sheet nobody asked for.
 *
 * Three parts: the screen stack (pure, below), the history it is mirrored into (`BackStack`, one per page), and the two
 * hooks the apps call — `useScreenNav` in each app's shell, `useBackLayer` in a sheet or a menu.
 */

/* ------------------------------------------------------------------------------------------- the screen stack -- */

/**
 * How a move looks. `push` comes in from the right and starts at the top; `pop` comes back from the left to where it
 * was left; `tab` swaps in place, as a native app's tabs do, and keeps its place too; `none` is the first screen.
 */
export type Move = 'push' | 'pop' | 'tab' | 'none';

/** An app's screens, as Back sees them: the one it opens on, and the ones its tab bar reaches. */
export interface NavShape<S extends string> {
  home: S;
  /** Top-level screens: reaching one never stacks — Back from it is the home screen, as Material's tabs behave. */
  tabs?: readonly S[];
}

const topLevel = <S extends string>(shape: NavShape<S>, s: S): boolean => s === shape.home || (shape.tabs?.includes(s) ?? false);

/** How a move between two screens looks. Between two top-level screens nothing travels: tabs swap in place. */
export function moveBetween<S extends string>(shape: NavShape<S>, from: S, to: S, backwards: boolean): Move {
  if (from === to) return 'none';
  if (topLevel(shape, from) && topLevel(shape, to)) return 'tab';
  return backwards ? 'pop' : 'push';
}

/**
 * The screens Back will walk through after the app moves from `from` to `to` — the first is always home, the last is
 * `to`. Home empties the stack; a tab sits straight above home; a screen already in the stack is gone BACK to (a
 * "Done" that returns to the list it came from); anything else is pushed on top.
 */
export function nextStack<S extends string>(shape: NavShape<S>, stack: readonly S[], from: S, to: S): { stack: S[]; move: Move } {
  if (to === shape.home) return { stack: [shape.home], move: moveBetween(shape, from, to, true) };
  const at = stack.indexOf(to);
  if (shape.tabs?.includes(to)) return { stack: [shape.home, to], move: moveBetween(shape, from, to, at >= 0) };
  if (at >= 0) return { stack: stack.slice(0, at + 1), move: moveBetween(shape, from, to, true) };
  return { stack: [...stack, to], move: moveBetween(shape, from, to, false) };
}

/** One app's walk through its screens, as the shell renders it. */
export interface NavRun<S extends string> {
  /** Home first, the screen showing last. */
  stack: S[];
  /** The screen last drawn. */
  screen: S | null;
  /** Signed in, with screens to walk; false in the sign-in shell, where only sheets go back. */
  ready: boolean;
  /** Changes with every move: the key that makes a screen arrive afresh. */
  seq: number;
  move: Move;
  /** Set by a Back until the screen it asked for is drawn: the screen it left. */
  backFrom: S | null;
}

export const startRun = <S extends string>(home: S): NavRun<S> => ({ stack: [home], screen: null, ready: false, seq: 0, move: 'none', backFrom: null });

/** A render saw `screen`: the run after it. The same object when nothing moved, so a re-render changes nothing. */
export function observe<S extends string>(run: NavRun<S>, shape: NavShape<S>, screen: S, ready: boolean): NavRun<S> {
  if (!ready) {
    if (!run.ready) return run.screen === screen ? run : { ...run, screen };
    // Signed out: nothing left to go back through.
    return { stack: [shape.home], screen, ready: false, seq: run.seq + 1, move: 'none', backFrom: null };
  }
  // The first screen once signed in (or opened from a link, a notification): home under it, and nothing travels.
  if (!run.ready) return { stack: screen === shape.home ? [shape.home] : [shape.home, screen], screen, ready: true, seq: run.seq + 1, move: 'none', backFrom: null };
  if (screen === run.screen) return run;
  if (run.backFrom !== null && screen === run.stack[run.stack.length - 1]) {
    return { ...run, screen, seq: run.seq + 1, move: moveBetween(shape, run.backFrom, screen, true), backFrom: null };
  }
  const { stack, move } = nextStack(shape, run.stack, run.screen ?? shape.home, screen);
  return { stack, screen, ready: true, seq: run.seq + 1, move, backFrom: null };
}

/** Back, on the run: the screen to go to and the run once it is asked for — or null on the first screen. */
export function backOne<S extends string>(run: NavRun<S>): { run: NavRun<S>; to: S } | null {
  if (!run.ready || run.stack.length < 2) return null;
  const stack = run.stack.slice(0, -1);
  return { run: { ...run, stack, backFrom: run.backFrom ?? run.screen }, to: stack[stack.length - 1] };
}

/** Where the page is put after a move: the top for a screen arriving fresh, where it was left for one come back to. */
export function scrollFor(move: Move, saved: number | undefined): number | null {
  if (move === 'push') return 0;
  if (move === 'pop' || move === 'tab') return saved ?? 0;
  return null;
}

/** A shortcut's key, when it is a screen this app lets a shortcut open; anything else is not a screen and is ignored. */
export function launchScreen<S extends string>(key: string | undefined, launch: readonly S[] | undefined): S | null {
  return key && launch?.includes(key as S) ? (key as S) : null;
}

/** Every screen of an app, written once as a record so the compiler says when one is missing or one is not a screen. */
export function screensOf<S extends string>(all: Record<S, true>): S[] {
  return Object.keys(all) as S[];
}

/* ---------------------------------------------------------------------------------------------- the history -- */

/** The browser's history, as much of it as this needs — a seam, so the tests can be the browser. */
export interface HistoryPort {
  /** Mark the entry the page is on as ours, and say how deep it is (a reload keeps the entries above the first). */
  start(): number;
  /** How deep the entry the page is on is, or null when it is not one of ours. */
  depth(): number | null;
  push(depth: number): void;
  go(delta: number): void;
  listen(onPop: (depth: number | null) => void): void;
}

interface Overlay {
  dismissible: () => boolean;
  close: () => void;
  /** Back has asked it to close; its entry is spent. */
  closing: boolean;
}

/**
 * THE ENTRIES, kept equal to what can be undone. Screens and overlays (sheets, a menu) are counted, the overlays always
 * above the screens — a sheet is drawn over whatever screen is under it, so Back reaches it first. The history is
 * brought level after every change, once per tick, so a sheet closing as the screen changes under it costs nothing.
 */
export class BackStack {
  private overlays: Overlay[] = [];
  private screens = 0;
  private screenBack: (() => void) | null = null;
  /** How deep the entry the page is on is, as far as we know. */
  private actual = 0;
  /** Where a traversal we asked for is going, until it arrives. */
  private target: number | null = null;
  private travels = 0;
  private began = false;
  private queued = false;

  constructor(
    private readonly port: HistoryPort | null,
    private readonly schedule: (fn: () => void) => void = (fn) => queueMicrotask(fn),
    private readonly later: (fn: () => void, ms: number) => void = (fn, ms) => void setTimeout(fn, ms),
  ) {}

  /** How many entries above the first the page wants: the screens above home and the overlays not yet closing. */
  get wanted(): number {
    return this.screens + this.overlays.filter((o) => !o.closing).length;
  }

  /** An overlay opens: Back closes it (or, when it must be answered, is swallowed). Returns how to say it closed. */
  overlay(o: { dismissible: () => boolean; close: () => void }): () => void {
    this.begin();
    const me: Overlay = { ...o, closing: false };
    this.overlays.push(me);
    this.sync();
    return () => {
      const at = this.overlays.indexOf(me);
      if (at < 0) return;
      this.overlays.splice(at, 1);
      this.sync();
    };
  }

  /** The app's screens above home, and how it goes back one. */
  setScreens(count: number, back: (() => void) | null): void {
    this.begin();
    this.screenBack = back;
    const n = Math.max(0, count);
    if (n === this.screens) return;
    this.screens = n;
    this.sync();
  }

  /** The top bar's arrow: a screen back, as the phone's Back would. False when there is no screen to go back to. */
  backScreen(): boolean {
    if (this.screens <= 0) return false;
    this.screens -= 1;
    this.sync();
    this.screenBack?.();
    return true;
  }

  private begin(): void {
    if (this.began || !this.port) return;
    this.began = true;
    this.actual = this.port.start();
    this.port.listen((d) => this.popped(d));
    // Reloaded deep in the app: it opens on its first screen with nothing open, so the entries above go too — or Back
    // on home would walk through them instead of leaving.
    if (this.actual > 0) this.sync();
  }

  /** The history moved (the phone's Back, the browser's, or a traversal we asked for) to an entry `depth` deep. */
  private popped(depth: number | null): void {
    if (this.target !== null) {
      this.actual = depth ?? this.target;
      this.target = null;
      this.sync();
      return;
    }
    // Not one of ours (a link to a place on the page makes an entry of its own): nothing to undo.
    if (depth === null) return;
    const was = this.actual;
    this.actual = depth;
    for (let n = was - depth; n > 0; n--) this.undoTop();
    // Forward, or a must-answer sheet that stayed: the history is brought level again.
    this.sync();
  }

  private undoTop(): void {
    const open = this.overlays.filter((o) => !o.closing);
    const top = open[open.length - 1];
    if (top) {
      // Must be answered: its entry is put back and the app stays, rather than closing underneath it.
      if (!top.dismissible()) return;
      top.closing = true;
      top.close();
      // A sheet whose owner kept it open (busy, say) gets its entry back, so Back can reach it again.
      this.later(() => {
        if (top.closing && this.overlays.includes(top)) {
          top.closing = false;
          this.sync();
        }
      }, 400);
      return;
    }
    if (this.screens > 0) {
      this.screens -= 1;
      this.screenBack?.();
    }
  }

  private sync(): void {
    if (this.queued || !this.port) return;
    this.queued = true;
    this.schedule(() => {
      this.queued = false;
      this.level();
    });
  }

  private level(): void {
    const port = this.port;
    if (!port || this.target !== null) return;
    const want = this.wanted;
    if (want > this.actual) {
      try {
        while (this.actual < want) {
          port.push(this.actual + 1);
          this.actual += 1;
        }
      } catch {
        /* a history that refuses an entry: Back simply does what it did before */
      }
      return;
    }
    if (want < this.actual) {
      this.target = want;
      const token = ++this.travels;
      // No word back means the history is not what we thought: believe it is level, and never ask again in a loop.
      this.later(() => {
        if (this.travels !== token || this.target === null) return;
        this.actual = this.target;
        this.target = null;
      }, 700);
      try {
        port.go(want - this.actual);
      } catch {
        this.actual = want;
        this.target = null;
      }
    }
  }
}

const KEY = 'sbgBack';

const depthIn = (state: unknown): number | null => {
  if (!state || typeof state !== 'object') return null;
  const d = (state as Record<string, unknown>)[KEY];
  return typeof d === 'number' && Number.isInteger(d) && d >= 0 ? d : null;
};

/** The real history. Null where there is none (the tests, a page rendered ahead of time). */
export function browserHistory(): HistoryPort | null {
  if (typeof window === 'undefined' || !window.history || typeof window.history.pushState !== 'function') return null;
  const h = window.history;
  return {
    start() {
      // Something else rewriting the address (a link's ?offer= read and taken off) writes `null` over the entry's
      // state; the mark of how deep it is is kept through that, or Back would lose count.
      const own = h.replaceState;
      h.replaceState = function (this: History, state: unknown, unused: string, url?: string | URL | null) {
        const d = depthIn(h.state);
        const keep = d !== null && depthIn(state) === null && (state === null || state === undefined || (typeof state === 'object' && !Array.isArray(state)));
        return own.call(this, keep ? { ...((state as object | null) ?? {}), [KEY]: d } : state, unused, url);
      };
      const d = depthIn(h.state);
      if (d !== null) return d;
      try {
        h.replaceState({ ...(h.state && typeof h.state === 'object' ? h.state : {}), [KEY]: 0 }, '');
      } catch {
        /* an entry that cannot be marked still works; Back past it leaves */
      }
      return 0;
    },
    depth: () => depthIn(h.state),
    push: (d) => h.pushState({ [KEY]: d }, ''),
    go: (delta) => h.go(delta),
    listen: (onPop) => window.addEventListener('popstate', (e) => onPop(depthIn(e.state))),
  };
}

let shared: BackStack | null = null;

/** The page's one back stack. */
export function backStack(): BackStack {
  if (!shared) shared = new BackStack(browserHistory());
  return shared;
}

/* ------------------------------------------------------------------------------------------------ the hooks -- */

/**
 * BACK CLOSES IT: a sheet, a menu, a full-screen camera — anything drawn over the screen. While `open`, Back calls
 * `close` (and nothing else happens); closed any other way, its entry goes quietly. One that must be answered
 * (`dismissible` false) is not closed by Back, and the app does not leave from under it either.
 */
export function useBackLayer(open: boolean, close: () => void, dismissible = true): void {
  const latest = useRef({ close, dismissible });
  latest.current = { close, dismissible };
  useEffect(() => {
    if (!open) return;
    return backStack().overlay({ dismissible: () => latest.current.dismissible, close: () => latest.current.close() });
  }, [open]);
}

export interface ScreenNavOptions<S extends string> {
  /** The screen showing. */
  screen: S;
  /** The screen the app opens on: Back there leaves the app. */
  home: S;
  /** Screens the tab bar reaches. */
  tabs?: readonly S[];
  /** False while booting or signing in: no screens to go back through, only sheets. */
  ready: boolean;
  /** How the app moves to a screen (its `actions.go`). */
  go: (to: S) => void;
  /** How it goes BACK to one, where that differs from going to it. Defaults to `go`. */
  back?: (to: S, from: S) => void;
  /** The screens a shortcut on the app's icon may open (`?go=<screen>`); anything else asked for is ignored. */
  launch?: readonly S[];
  /**
   * How a shortcut opens one, where that differs from `go` — as the tab bar opens the same screen (a dispatch with its
   * data, the route's offers while they wait), or not at all where the tab bar would not (off shift). Defaults to `go`.
   */
  open?: (to: S) => void;
}

export interface ScreenNav<S extends string> {
  /** What the phone's Back does, for the top bar's arrow. */
  back: () => void;
  /** Where Back goes from here, or null on the first screen. */
  backTo: S | null;
  /** For `NavScreen`: changes with every move. */
  seq: number;
  /** For `NavScreen`: how the screen arrives. */
  slide: 'push' | 'pop' | 'none';
}

/** Put the page at `y` after a screen is drawn, and again while its content is still arriving — until a finger moves it. */
function settleScroll(y: number): () => void {
  if (typeof window === 'undefined' || typeof window.scrollTo !== 'function') return () => undefined;
  const to = () => {
    try {
      window.scrollTo(0, y);
    } catch {
      /* nothing to move */
    }
  };
  to();
  if (y <= 0) return () => undefined;
  let moved = false;
  const mine = () => {
    moved = true;
  };
  const kinds = ['touchstart', 'wheel', 'keydown', 'mousedown'];
  kinds.forEach((k) => window.addEventListener(k, mine, { passive: true, capture: true }));
  const timers = [50, 180, 420].map((ms) =>
    window.setTimeout(() => {
      if (!moved && Math.abs(window.scrollY - y) > 1) to();
    }, ms),
  );
  const done = () => {
    timers.forEach((t) => window.clearTimeout(t));
    kinds.forEach((k) => window.removeEventListener(k, mine, { capture: true }));
  };
  timers.push(window.setTimeout(done, 500));
  return done;
}

/**
 * THE SCREENS OF AN APP, AS A PHONE MOVES THROUGH THEM — called once in each app's shell, before its first `return`.
 *
 * Moving to a screen other than home puts an entry in the history, so Back returns to the screen before; on home, Back
 * leaves the app. A screen left keeps its place on the page and gets it back when it is come back to (by Back or by
 * its tab); a screen arrived at fresh starts at the top. A shortcut's screen opens once the person is signed in.
 */
export function useScreenNav<S extends string>(o: ScreenNavOptions<S>): ScreenNav<S> {
  const runRef = useRef<NavRun<S> | null>(null);
  const run = observe(runRef.current ?? startRun(o.home), { home: o.home, tabs: o.tabs }, o.screen, o.ready);
  runRef.current = run;
  const opts = useRef(o);
  opts.current = o;
  const saved = useRef(new Map<S, number>());
  const wanted = useRef<S | null>(null);

  // Stable for the life of the shell: they read the latest options and run through refs.
  const fns = useRef({
    stepBack: () => {
      const r = runRef.current;
      const b = r ? backOne(r) : null;
      if (!b) return;
      runRef.current = b.run;
      const { go, back } = opts.current;
      if (back) back(b.to, b.run.backFrom ?? b.to);
      else go(b.to);
    },
    back: () => {
      if (!backStack().backScreen()) fns.current.stepBack();
    },
    openWanted: () => {
      const to = wanted.current;
      if (!to || !opts.current.ready) return;
      wanted.current = null;
      (opts.current.open ?? opts.current.go)(to);
    },
  });

  // After each move is drawn: the history made level, and the page put where this screen belongs.
  useLayoutEffect(() => {
    const r = runRef.current!;
    backStack().setScreens(r.ready ? r.stack.length - 1 : 0, fns.current.stepBack);
    if (!r.ready || !r.screen) return;
    const y = scrollFor(r.move, saved.current.get(r.screen));
    if (r.move === 'push') saved.current.delete(r.screen);
    return y === null ? undefined : settleScroll(y);
  }, [run.seq]);

  // Where each screen was left, as the person scrolls it. The screen is the one last drawn, so the jump a shorter
  // screen makes as it replaces a long one is counted to the new screen, never the one left.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual';
    } catch {
      /* the browser keeps its own */
    }
    const note = () => {
      const r = runRef.current;
      if (r?.ready && r.screen) saved.current.set(r.screen, window.scrollY);
    };
    window.addEventListener('scroll', note, { passive: true });
    return () => {
      window.removeEventListener('scroll', note);
      backStack().setScreens(0, null);
    };
  }, []);

  // SHORTCUTS (hold the app's icon): `?go=<screen>` opens that screen — once signed in, if they are not yet. One that
  // came before this listened (the app opened from the shortcut) is handed over as it starts to (shared/launch.ts).
  useEffect(
    () =>
      onLaunch('go', (key) => {
        const to = launchScreen(key, opts.current.launch);
        if (!to) return;
        wanted.current = to;
        fns.current.openWanted();
      }),
    [],
  );
  useEffect(() => {
    if (o.ready) fns.current.openWanted();
  }, [o.ready]);

  const backTo = run.ready && run.stack.length > 1 ? run.stack[run.stack.length - 2] : null;
  return { back: fns.current.back, backTo, seq: run.seq, slide: run.move === 'push' || run.move === 'pop' ? run.move : 'none' };
}
