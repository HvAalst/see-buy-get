import { useEffect, useState } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import { useT } from '../i18n';
import { Icon } from './Icon';
import { BackStep } from './BackStep';
import { useReadAloud } from './ReadAloud';
import { AppsSheet } from './AppLauncher';
import { TroubleSheet } from '../account/TroubleSheet';
import type { RecoveryApi } from '../account/recovery';
import type { GuideApp, GuideArticle } from '../guide/articles';

/** What Help opens: this app's "Trouble signing in?" sheet — or, where the screen has help of its own (the sign-up), that. */
export type SignedOutHelp = { app: GuideApp; api?: RecoveryApi; articles?: GuideArticle[] } | { open: () => void };

export interface SignedOutBarProps {
  /** The step before this one, where the screen has one: the sign-up's previous step, a code step's way back to the number. */
  onBack?: () => void;
  help: SignedOutHelp;
  /** What this screen says aloud — a getter, read at the tap, so it speaks what is on the screen then. */
  aloud?: () => string;
  /** The way to the other apps. Off on the front door, which is where it leads. */
  allApps?: boolean;
  /**
   * In the page's flow instead of pinned: where the bottom of the screen is already the app's own tab bar — the Send app,
   * whose Send and Track are open to everybody — and a second bar pinned over it would take two bars' height of a small phone.
   */
  inline?: boolean;
  /**
   * 2026-11-02 — which step this is, where Back leads through several: the phone's own Back then steps back as the bar's
   * does, one step at a time (shared/ui/BackStep.tsx). Without it, a screen with one step back holds one Back.
   */
  backKey?: string;
}

/**
 * THE BAR BEFORE SIGNING IN (the owner, 2026-11-02: "the footers now in the bottom during the sign up process — we have
 * some text like 'help' and 'read aloud' — that clutter would be better off in a sticky footer for as long as the page
 * goes. It changes after the sign in").
 *
 * Pinned where the tab bar will be once they are signed in, and drawn as it is — an icon over a short word, the bar's
 * full height to tap — with at most four things in it: Back (only where the screen has a step to go back to), Help, Read
 * aloud (where the phone can speak) and All apps. Signed in, the app's own tab bar takes its place: the signed-in shells
 * never draw this.
 *
 * What it took off the screen went where it belongs: a credential's own way round ("Forgot your PIN?") under the field
 * it is about, and "New here? Sign up" with the form, as the call it is. On a sign-in screen Help IS "Trouble signing
 * in?" — the one help a sign-in screen has (2026-10-23) — and its title still says so.
 *
 * It keeps its own room at the end of the screen, so the last field or link always scrolls clear of it; and it steps
 * aside while the on-screen keyboard is up (`useKeyboardUp`), so it never sits over the field being typed in or the
 * keyboard's own Go.
 */
export function SignedOutBar({ onBack, help, aloud, allApps = true, inline = false, backKey }: SignedOutBarProps) {
  const t = useT();
  const [helping, setHelping] = useState(false);
  const [apps, setApps] = useState(false);
  const speech = useReadAloud(aloud ?? (() => ''));
  const keyboard = useKeyboardUp();
  const signIn = 'open' in help ? null : help;
  // Into the page, not inside the bar: the bar is fixed, so it makes a layer of its own, and a sheet drawn in it would be
  // painted under everything a sheet should cover (HelpLink.tsx found the same, 2026-10-30).
  const trouble = signIn ? <TroubleSheet open={helping} onClose={() => setHelping(false)} app={signIn.app} api={signIn.api} articles={signIn.articles} /> : null;
  const sheet = trouble || allApps ? (
    <>
      {trouble}
      {allApps ? <AppsSheet open={apps} onClose={() => setApps(false)} /> : null}
    </>
  ) : null;
  const away = keyboard && !inline;

  return (
    <>
      {onBack ? <BackStep key={backKey ?? 'back'} back={onBack} /> : null}
      {inline ? null : <div class="sobar__room" aria-hidden="true" />}
      <nav class={inline ? 'sobar sobar--inline' : `bnav sobar${away ? ' sobar--away' : ''}`} aria-label={t('common.bar.label')}>
        {onBack ? (
          <button type="button" class="bnav__item" onClick={onBack}>
            <Icon name="arrowLeft" size={25} />
            <span class="bnav__label">{t('common.back')}</span>
          </button>
        ) : null}
        <button
          type="button"
          class="bnav__item"
          aria-haspopup="dialog"
          title={signIn ? t('account.trouble.link') : undefined}
          onClick={() => ('open' in help ? help.open() : setHelping(true))}
        >
          <Icon name="help" size={25} />
          <span class="bnav__label">{t('guide.link')}</span>
        </button>
        {aloud && speech.supported ? (
          <button type="button" class={`bnav__item${speech.speaking ? ' bnav__item--on' : ''}`} aria-pressed={speech.speaking} title={t('common.readAloud')} onClick={speech.toggle}>
            <Icon name={speech.speaking ? 'speakerOff' : 'speaker'} size={25} />
            <span class="bnav__label">{speech.speaking ? t('common.stop') : t('common.bar.readAloud')}</span>
          </button>
        ) : null}
        {allApps ? (
          <button type="button" class="bnav__item" aria-haspopup="dialog" title={t('common.allApps')} onClick={() => setApps(true)}>
            <Icon name="grid" size={25} />
            <span class="bnav__label">{t('common.bar.allApps')}</span>
          </button>
        ) : null}
      </nav>
      {sheet ? typeof document === 'undefined' ? sheet : createPortal(sheet, document.body) : null}
    </>
  );
}

/** Taller than any browser's own bar coming and going (about 56 px), shorter than any phone's keyboard. */
const KEYBOARD_MIN = 120;

/** A control the on-screen keyboard comes up for: a box to type in — not a tick box, a button, a picker or a file. */
export function typesText(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'TEXTAREA') return true;
  if (tag === 'INPUT') return !/^(checkbox|radio|button|submit|reset|file|range|color|image|hidden)$/i.test((el as HTMLInputElement).type);
  return (el as HTMLElement).isContentEditable === true;
}

/**
 * IS THE ON-SCREEN KEYBOARD UP? Something to type in has the focus, AND the visible part of the page is shorter than the
 * tallest it has been at this width by more than any browser bar — the keyboard took it. Both, because neither alone is
 * enough: a focused box on a phone whose keyboard was put away with Back is not covered by anything, and a page made
 * shorter by a split screen has no keyboard in it.
 */
export function keyboardUp(typing: boolean, height: number, tallest: number): boolean {
  return typing && tallest - height > KEYBOARD_MIN;
}

/** The tallest the visible page has been, at each width — kept across screens, so a bar drawn while typing still knows. */
const tallestAt = new Map<number, number>();

/**
 * 2026-11-02 — the keyboard, from the VISUAL VIEWPORT (the part of the page on the glass): it shrinks when the keyboard
 * comes up whether the browser shrinks the page under it (older Android, some installed apps) or slides the keyboard over
 * it (Chrome since 108). Measured in the page's own pixels, so a pinch-zoom is not taken for a keyboard. Where a browser
 * has no visualViewport, the window's own height stands in.
 */
function useKeyboardUp(): boolean {
  const [up, setUp] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const vv = window.visualViewport;
    const check = () => {
      const height = vv ? vv.height * (vv.scale || 1) : window.innerHeight;
      const width = window.innerWidth;
      const tallest = Math.max(tallestAt.get(width) ?? 0, height);
      tallestAt.set(width, tallest);
      setUp(keyboardUp(typesText(document.activeElement), height, tallest));
    };
    // Focus moves first and the keyboard follows: look again once it has.
    const soon = () => window.setTimeout(check, 0);
    check();
    vv?.addEventListener('resize', check);
    window.addEventListener('resize', check);
    document.addEventListener('focusin', soon);
    document.addEventListener('focusout', soon);
    return () => {
      vv?.removeEventListener('resize', check);
      window.removeEventListener('resize', check);
      document.removeEventListener('focusin', soon);
      document.removeEventListener('focusout', soon);
    };
  }, []);
  return up;
}
