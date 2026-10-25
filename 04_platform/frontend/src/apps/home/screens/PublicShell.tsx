import type { ComponentChildren } from 'preact';
import { Icon, ReadAloud } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import '../public.css';

/**
 * THE PUBLIC SITE'S FRAME — the front page and the pages written to be quoted (the user, 2026-10-22: the public site
 * and the help in paper and orange, the working apps in blue). Its own top bar — the mark, Send · Track · Earn ·
 * Freight · Help, Sign in — and its own foot, with the ways to every public page and to how SeeBuyGet treats your data.
 * On a phone the top bar keeps Track, Help and Sign in: what somebody stuck looks for.
 */
export function PublicShell({
  children,
  update,
  readAloud,
  help,
  theme,
}: {
  children: ComponentChildren;
  update?: () => void;
  readAloud?: () => string;
  /** A help page: Help is where you are in the top bar, and the reader's light or dark reaches the frame too. */
  help?: boolean;
  theme?: 'light' | 'dark';
}) {
  const t = useT();
  return (
    <div class={`pub${help ? ' pub--help' : ''}`} data-theme={help ? theme ?? 'light' : undefined}>
      <header class="pub__top">
        <div class="pub__in pub__topin">
          <a class="pub__logo" href="/">
            <img src="/img/brand-tile.svg" width={34} height={34} alt="" />
            <span>SeeBuyGet</span>
          </a>
          <nav class="pub__nav" aria-label={t('front.nav.label')}>
            <a class="pub__wide" href="/send/">
              {t('front.nav.send')}
            </a>
            <a href="/#track">{t('front.nav.track')}</a>
            <a class="pub__wide" href="/#earn">
              {t('front.nav.earn')}
            </a>
            <a class="pub__wide" href="/#freight">
              {t('front.nav.freight')}
            </a>
            <a href="/help/" aria-current={help ? 'page' : undefined}>
              {t('front.nav.help')}
            </a>
          </nav>
          {update ? (
            <button type="button" class="pub__update" onClick={update} aria-label={t('front.update')} title={t('front.update')}>
              <Icon name="refresh" size={20} />
            </button>
          ) : null}
          <a class="pub__signin" href="/?go=signin">
            {t('front.nav.signIn')} →
          </a>
        </div>
      </header>

      <main>{children}</main>

      {/* THE FOOT IS THE SITE'S MAP, in three columns with a heading each — every public page once, and the one way to
          write to us, which was in no menu at all. */}
      <footer class="pub__foot">
        <div class="pub__in pub__footin">
          <nav class="pub__footnav" aria-label={t('home.landing.footNav')}>
            <div class="pub__footcol">
              <h2 class="pub__footh">{t('front.foot.colUse')}</h2>
              <a href="/send/">{t('home.landing.footSend')}</a>
              <a href="/#earn">{t('home.landing.footEarn')}</a>
              <a href="/?go=market">{t('home.landing.footMarket')}</a>
              <a href="/?go=agents">{t('home.landing.footAgents')}</a>
              <a href="/?go=verify">{t('home.landing.footVerify')}</a>
              <a href="/?go=signin">{t('home.landing.footSignIn')}</a>
            </div>
            <div class="pub__footcol">
              <h2 class="pub__footh">{t('front.foot.colHelp')}</h2>
              <a href="/help/">{t('home.landing.footHelp')}</a>
              <a href="/help/contact/">{t('front.foot.write')}</a>
              <a href="/about/">{t('pages.about')}</a>
            </div>
            <div class="pub__footcol">
              <h2 class="pub__footh">{t('front.foot.colData')}</h2>
              <a href="/terms/">{t('front.foot.terms')}</a>
              <a href="/privacy/">{t('front.foot.data')}</a>
              <a href="/cookies/">{t('front.foot.cookies')}</a>
            </div>
          </nav>
          <div class="pub__footend">
            <span>{t('front.foot.line')}</span>
            {readAloud ? <ReadAloud text={readAloud} label={t('home.readAloud')} /> : null}
          </div>
        </div>
      </footer>
    </div>
  );
}

/** A sentence with its one marked phrase drawn in orange: *like this*. The sentence stays whole for its translator. */
export function Marked({ text }: { text: string }) {
  const parts = text.split(/\*([^*]+)\*/);
  return <>{parts.map((p, i) => (i % 2 === 1 ? <em key={i}>{p}</em> : p))}</>;
}
