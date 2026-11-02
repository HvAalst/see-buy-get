import type { ComponentChildren } from 'preact';
import type { ScreenNav } from '../nav';

export interface NavScreenProps {
  nav: Pick<ScreenNav<string>, 'seq' | 'slide'>;
  children: ComponentChildren;
}

/**
 * 2026-11-02 — A SCREEN ARRIVES AS AN APP'S DOES (the owner: "make it as native as today can be"). Wrapped round an
 * app's screen inside its scroll area: a screen gone forward to comes in from the right, one gone back to from the
 * left, in about a fifth of a second; tabs swap in place, and the first screen just appears. The fixed top bar and tab
 * bar are outside it and stay put. Keyed by the move, so the motion plays once per move and never on a re-render; the
 * motion is CSS (ui.css), so reduced motion takes it away and leaves the screen.
 */
export function NavScreen({ nav, children }: NavScreenProps) {
  return (
    <div key={nav.seq} class={nav.slide === 'none' ? 'navscreen' : `navscreen navscreen--${nav.slide}`}>
      {children}
    </div>
  );
}
