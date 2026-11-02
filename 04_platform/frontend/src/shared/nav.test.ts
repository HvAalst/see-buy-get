import { afterEach, describe, expect, it } from 'vitest';
import { BackStack, backOne, browserHistory, launchScreen, moveBetween, nextStack, observe, screensOf, scrollFor, startRun, type HistoryPort, type NavRun, type NavShape } from './nav';

/*
 * 2026-11-02 — BACK, AS AN APP MEANS IT (the owner: "make it as native as today can be"). In an installed app, Android's
 * back gesture closed the whole app — with a sheet open, three screens deep. These say what Back does now: the top
 * sheet closes alone, the screen before comes back, and on the first screen with nothing open the app is left.
 */

type S = 'home' | 'accept' | 'records' | 'consignments' | 'handover' | 'void';
const shape: NavShape<S> = { home: 'home', tabs: ['accept', 'records'] };

describe('the screens Back walks through', () => {
  it('pushes a screen above home, and comes in from the right', () => {
    expect(nextStack(shape, ['home'], 'home', 'handover')).toEqual({ stack: ['home', 'handover'], move: 'push' });
  });

  it('puts a tab straight above home, swapping in place — tabs do not stack', () => {
    expect(nextStack(shape, ['home'], 'home', 'accept')).toEqual({ stack: ['home', 'accept'], move: 'tab' });
    expect(nextStack(shape, ['home', 'accept'], 'accept', 'records')).toEqual({ stack: ['home', 'records'], move: 'tab' });
  });

  it('empties the stack on home: a flow finished comes back from the left; a tab swaps', () => {
    expect(nextStack(shape, ['home', 'records', 'consignments'], 'consignments', 'home')).toEqual({ stack: ['home'], move: 'pop' });
    expect(nextStack(shape, ['home', 'accept'], 'accept', 'home')).toEqual({ stack: ['home'], move: 'tab' });
  });

  it('goes BACK to a screen already in the stack (a "Done" that returns to its list)', () => {
    expect(nextStack(shape, ['home', 'records', 'consignments'], 'consignments', 'records')).toEqual({ stack: ['home', 'records'], move: 'pop' });
    expect(nextStack(shape, ['home', 'handover', 'void'], 'void', 'handover')).toEqual({ stack: ['home', 'handover'], move: 'pop' });
  });

  it('says how a move looks', () => {
    expect(moveBetween(shape, 'home', 'home', false)).toBe('none');
    expect(moveBetween(shape, 'records', 'accept', false)).toBe('tab');
    expect(moveBetween(shape, 'records', 'consignments', false)).toBe('push');
    expect(moveBetween(shape, 'consignments', 'records', true)).toBe('pop');
  });
});

describe('a run through an app, as the shell renders it', () => {
  const see = (run: NavRun<S>, screen: S, ready = true) => observe(run, shape, screen, ready);

  it('nothing moves on the first screen, nor in the sign-in shell', () => {
    let run = see(startRun<S>('home'), 'home', false);
    expect(run.ready).toBe(false);
    run = see(run, 'home');
    expect(run).toMatchObject({ stack: ['home'], move: 'none', ready: true });
  });

  it('a link that opens deep still has home under it', () => {
    const run = see(startRun<S>('home'), 'handover');
    expect(run).toMatchObject({ stack: ['home', 'handover'], move: 'none' });
    expect(backOne(run)?.to).toBe('home');
  });

  it('a re-render on the same screen is the same run: no motion replays, no entry is added', () => {
    const run = see(see(startRun<S>('home'), 'home'), 'handover');
    expect(see(run, 'handover')).toBe(run);
  });

  it('Back pops the stack, and the screen it asked for comes back from the left', () => {
    let run = see(see(see(startRun<S>('home'), 'home'), 'records'), 'consignments');
    expect(run.stack).toEqual(['home', 'records', 'consignments']);
    const b = backOne(run)!;
    expect(b.to).toBe('records');
    run = see(b.run, 'records');
    expect(run).toMatchObject({ stack: ['home', 'records'], move: 'pop', backFrom: null });
    // Back from a tab to home swaps in place.
    run = see(backOne(run)!.run, 'home');
    expect(run).toMatchObject({ stack: ['home'], move: 'tab' });
    expect(backOne(run)).toBeNull();
  });

  it('Back that the app answers somewhere else (an owner screen refused) follows the app', () => {
    const run = see(see(see(startRun<S>('home'), 'home'), 'handover'), 'void');
    const b = backOne(run)!;
    expect(see(b.run, 'home')).toMatchObject({ stack: ['home'], move: 'pop' });
  });

  it('signing out leaves nothing to go back through', () => {
    const run = see(see(see(startRun<S>('home'), 'home'), 'handover'), 'home', false);
    expect(run).toMatchObject({ stack: ['home'], ready: false });
    expect(backOne(run)).toBeNull();
  });

  it('each move has its own key, so a screen arrives afresh exactly once', () => {
    const a = see(see(startRun<S>('home'), 'home'), 'handover');
    const b = see(a, 'void');
    expect(b.seq).toBe(a.seq + 1);
  });
});

describe('where the page is put', () => {
  it('a screen arrived at fresh starts at the top; one come back to, by Back or by its tab, where it was left', () => {
    expect(scrollFor('push', 800)).toBe(0);
    expect(scrollFor('pop', 800)).toBe(800);
    expect(scrollFor('tab', 420)).toBe(420);
    expect(scrollFor('tab', undefined)).toBe(0);
    expect(scrollFor('none', 300)).toBeNull();
  });
});

describe('a shortcut on the app icon', () => {
  it('opens a screen of the app, and nothing else', () => {
    const launch = screensOf<S>({ home: true, accept: true, records: true, consignments: true, handover: true, void: true });
    expect(launch).toContain('accept');
    expect(launchScreen('accept', launch)).toBe('accept');
    expect(launchScreen('admin', launch)).toBeNull();
    expect(launchScreen(undefined, launch)).toBeNull();
    expect(launchScreen('accept', undefined)).toBeNull();
  });
});

/* ------------------------------------------------------------------------------------- the history, as a phone -- */

/** A browser's history, as much as Back needs: entries with their state, where it is, and traversals that land later. */
class Phone {
  entries: Array<number | null> = [null];
  at = 0;
  left = false;
  pushes = 0;
  private landing: Array<() => void> = [];
  private onPop: ((d: number | null) => void) | null = null;
  port: HistoryPort = {
    start: () => {
      const d = this.entries[this.at];
      if (d !== null) return d;
      this.entries[this.at] = 0;
      return 0;
    },
    depth: () => this.entries[this.at],
    push: (d) => {
      this.entries = this.entries.slice(0, this.at + 1);
      this.entries.push(d);
      this.at += 1;
      this.pushes += 1;
    },
    go: (delta) => void this.landing.push(() => this.travel(delta)),
    listen: (cb) => {
      this.onPop = cb;
    },
  };
  private travel(delta: number) {
    const to = this.at + delta;
    if (to < 0) {
      this.left = true;
      return;
    }
    if (to >= this.entries.length) return;
    this.at = to;
    this.onPop?.(this.entries[to]);
  }
  /** A link to a place on the page: an entry of the browser's own, with no state, and a popstate for it. */
  fragment() {
    this.entries = this.entries.slice(0, this.at + 1);
    this.entries.push(null);
    this.at += 1;
    this.onPop?.(null);
  }
  /** The back gesture. On the first entry, the app is left. */
  back() {
    if (this.at === 0) this.left = true;
    else this.travel(-1);
  }
  /** Lands any traversal asked for. */
  land(): boolean {
    const next = this.landing.shift();
    next?.();
    return Boolean(next);
  }
}

function rig(phone = new Phone()) {
  const ticks: Array<() => void> = [];
  const timers: Array<() => void> = [];
  const stack = new BackStack(phone.port, (fn) => void ticks.push(fn), (fn) => void timers.push(fn));
  /** Everything queued runs, as the page would before the next touch. */
  const settle = () => {
    for (let i = 0; i < 100; i++) {
      const t = ticks.shift();
      if (t) {
        t();
        continue;
      }
      if (!phone.land()) return;
    }
    throw new Error('never settled');
  };
  const runTimers = () => timers.splice(0).forEach((f) => f());
  return { phone, stack, settle, runTimers };
}

/** A sheet, as Sheet.tsx is to the back stack: open registers it; closing (any way) says so. */
function sheet(stack: BackStack, dismissible = true) {
  const s = { open: true, closes: 0, release: (() => undefined) as () => void };
  s.release = stack.overlay({
    dismissible: () => dismissible,
    close: () => {
      s.closes += 1;
      s.open = false;
      s.release();
    },
  });
  return s;
}

describe('Back closes the sheet', () => {
  it('a sheet opened puts one entry in the history; Back closes it alone, and the app stays', () => {
    const { phone, stack, settle } = rig();
    const s = sheet(stack);
    settle();
    expect(phone.at).toBe(1);
    phone.back();
    settle();
    expect(s.closes).toBe(1);
    expect(phone.at).toBe(0);
    expect(phone.left).toBe(false);
    // Nothing open on the first screen: Back leaves the app, as it always did.
    phone.back();
    expect(phone.left).toBe(true);
  });

  it('closed from the screen (its X, the backdrop), its entry goes quietly — no second close, the app not left', () => {
    const { phone, stack, settle } = rig();
    const s = sheet(stack);
    settle();
    s.release();
    settle();
    expect(phone.at).toBe(0);
    expect(s.closes).toBe(0);
    expect(phone.left).toBe(false);
  });

  it('a sheet over a sheet: Back closes the top one, then the one under it', () => {
    const { phone, stack, settle } = rig();
    const under = sheet(stack);
    const over = sheet(stack);
    settle();
    expect(phone.at).toBe(2);
    phone.back();
    settle();
    expect([under.closes, over.closes]).toEqual([0, 1]);
    phone.back();
    settle();
    expect([under.closes, over.closes]).toEqual([1, 1]);
    expect(phone.at).toBe(0);
  });

  it('a sheet that must be answered is not closed by Back — and the app does not leave from under it', () => {
    const { phone, stack, settle } = rig();
    const must = sheet(stack, false);
    settle();
    phone.back();
    settle();
    expect(must.closes).toBe(0);
    expect(phone.at).toBe(1);
    phone.back();
    settle();
    expect(phone.left).toBe(false);
    expect(must.closes).toBe(0);
  });

  it('a sheet whose owner keeps it open after Back gets its entry back, so Back can reach it again', () => {
    const { phone, stack, settle, runTimers } = rig();
    let closes = 0;
    stack.overlay({ dismissible: () => true, close: () => void (closes += 1) });
    settle();
    phone.back();
    settle();
    expect(closes).toBe(1);
    runTimers();
    settle();
    expect(phone.at).toBe(1);
    phone.back();
    settle();
    expect(closes).toBe(2);
  });

  it('a sheet closing as another opens (one tap) moves nothing in the history', () => {
    const { phone, stack, settle } = rig();
    const first = sheet(stack);
    settle();
    const pushes = phone.pushes;
    first.release();
    sheet(stack);
    settle();
    expect(phone.at).toBe(1);
    expect(phone.pushes).toBe(pushes);
  });

  it('a link to a place on the page (an entry not ours) closes nothing', () => {
    const { phone, stack, settle } = rig();
    const s = sheet(stack);
    settle();
    phone.fragment();
    settle();
    expect(s.closes).toBe(0);
  });
});

/** An app's shell, as useScreenNav drives the back stack: the run, the screen, and its go. */
function shell(stack: BackStack) {
  let run = startRun<S>('home');
  let screen: S = 'home';
  const draw = () => {
    run = observe(run, shape, screen, true);
    stack.setScreens(run.stack.length - 1, stepBack);
  };
  const stepBack = () => {
    const b = backOne(run);
    if (!b) return;
    run = b.run;
    screen = b.to;
    draw();
  };
  draw();
  return {
    go(to: S) {
      screen = to;
      draw();
    },
    get screen() {
      return screen;
    },
    get run() {
      return run;
    },
  };
}

describe('Back goes back a screen', () => {
  it('three screens deep, Back walks back one at a time, and on home leaves the app', () => {
    const { phone, stack, settle } = rig();
    const app = shell(stack);
    app.go('records');
    app.go('consignments');
    settle();
    expect(phone.at).toBe(2);
    phone.back();
    settle();
    expect(app.screen).toBe('records');
    expect(app.run.move).toBe('pop');
    phone.back();
    settle();
    expect(app.screen).toBe('home');
    expect(phone.at).toBe(0);
    phone.back();
    expect(phone.left).toBe(true);
  });

  it('a sheet open over a screen closes before the screen goes back', () => {
    const { phone, stack, settle } = rig();
    const app = shell(stack);
    app.go('handover');
    const s = sheet(stack);
    settle();
    phone.back();
    settle();
    expect(s.closes).toBe(1);
    expect(app.screen).toBe('handover');
    phone.back();
    settle();
    expect(app.screen).toBe('home');
  });

  it('the top bar arrow does what Back does, and the phone Back after it still works', () => {
    const { phone, stack, settle } = rig();
    const app = shell(stack);
    app.go('records');
    app.go('consignments');
    settle();
    expect(stack.backScreen()).toBe(true);
    settle();
    expect(app.screen).toBe('records');
    expect(phone.at).toBe(1);
    phone.back();
    settle();
    expect(app.screen).toBe('home');
    expect(stack.backScreen()).toBe(false);
  });

  it('a flow finished by the app (back to home) takes its entries with it: the next Back leaves', () => {
    const { phone, stack, settle } = rig();
    const app = shell(stack);
    app.go('handover');
    app.go('void');
    settle();
    app.go('home');
    settle();
    expect(phone.at).toBe(0);
    phone.back();
    expect(phone.left).toBe(true);
  });

  it('a tab never stacks: Back from any tab is home', () => {
    const { phone, stack, settle } = rig();
    const app = shell(stack);
    app.go('accept');
    app.go('records');
    settle();
    expect(phone.at).toBe(1);
    phone.back();
    settle();
    expect(app.screen).toBe('home');
  });

  it('a reload deep in the app goes back to the first entry, so Back on home still leaves', () => {
    const phone = new Phone();
    phone.entries = [0, 1, 2];
    phone.at = 2;
    const { stack, settle } = rig(phone);
    shell(stack);
    settle();
    expect(phone.at).toBe(0);
  });
});

/* ------------------------------------------------------------------------------------------- the real history -- */

describe('the browser history', () => {
  const realWindow = (globalThis as { window?: unknown }).window;
  afterEach(() => {
    (globalThis as { window?: unknown }).window = realWindow;
  });

  function fakeWindow() {
    const history = {
      state: null as unknown,
      pushState(s: unknown) {
        this.state = s;
      },
      replaceState(s: unknown) {
        this.state = s;
      },
      go() {
        /* lands later */
      },
    };
    const listeners: Array<(e: { state: unknown }) => void> = [];
    (globalThis as { window?: unknown }).window = { history, addEventListener: (_: string, l: (e: { state: unknown }) => void) => listeners.push(l) };
    return { history, listeners };
  }

  it('marks the entry it opened on, and keeps the mark when something else rewrites the address over it', () => {
    const { history } = fakeWindow();
    const port = browserHistory()!;
    expect(port.start()).toBe(0);
    expect(port.depth()).toBe(0);
    // A link's ?offer= read and taken off: `history.replaceState(null, '', url)`.
    history.replaceState(null);
    expect(port.depth()).toBe(0);
    port.push(1);
    history.replaceState({ other: true });
    expect(history.state).toEqual({ other: true, sbgBack: 1 });
  });

  it('reads a popstate into how deep it landed, and an entry not ours as not ours', () => {
    const { listeners } = fakeWindow();
    const port = browserHistory()!;
    const seen: Array<number | null> = [];
    port.listen((d) => seen.push(d));
    listeners.forEach((l) => l({ state: { sbgBack: 2 } }));
    listeners.forEach((l) => l({ state: null }));
    listeners.forEach((l) => l({ state: { sbgBack: 'x' } }));
    expect(seen).toEqual([2, null, null]);
  });
});
