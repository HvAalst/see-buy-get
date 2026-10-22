import { useEffect, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { Icon, ReadAloud } from '../../../shared/ui';
import { useT, type MessageKey } from '../../../shared/i18n';
import { fetchPulse, type NetworkPulse } from '../api';
import { prerenderedTowns } from '../prerendered';
import { appsOnThisDevice, formatDuration, roleMeta, ROLES, welcomeSpoken, type DeviceApp, type RoleSpec } from '../logic';
import type { HomeActions } from '../useHomeApp';

export interface WelcomeScreenProps {
  actions: HomeActions;
}

const IMG = '/img/landing/';

/**
 * THE FRONT PAGE — for the person deciding, and for the person coming back.
 *
 * The user, 2026-10-03: imagery above a lot of text; prove that it works for the people it is for; optimise for
 * conversion, and give returning users quick access inside. So, top to bottom:
 *
 *  - A RETURNING VISITOR sees their own apps first (whatever this device last signed in to), and "Sign in" sits in
 *    the top bar on every visit. Neither costs a new visitor anything.
 *  - ONE ACTION in the hero — send a parcel — with tracking beside it as a plain form that works before any script
 *    has run, because "where is my parcel" is the other half of everybody who lands here.
 *  - PROOF, MEASURED: the network's own figures and one real recent journey between two public shops, counted by
 *    the server (`/network/pulse`) and shown only where there are enough cases to mean something. No testimonials:
 *    there are none we may print, and an invented one is a lie.
 *  - THEN pictures: how it works in three, who it is for in six, why it is safe in four — each a drawing in the
 *    brand's own illustration style and a sentence, never a paragraph.
 *  - Where it works, and the questions people actually ask — real text, because a search engine and an AI
 *    assistant read words, not pictures. The answers are in the page's HTML from the build (see prerender.tsx).
 *
 * Every card is a real address (`/?join=driver`, `/send/`), so it can be shared, opened in a new tab and followed by
 * a crawler; a tap stays inside the app.
 */
export function WelcomeScreen({ actions }: WelcomeScreenProps) {
  const t = useT();
  const [pulse, setPulse] = useState<NetworkPulse | null>(null);
  // Read after the first paint, never during it: the build renders this page with no device and no network, and
  // the browser's first render must match that exactly before it adds what only the browser knows.
  const [mine, setMine] = useState<DeviceApp[]>([]);

  useEffect(() => {
    setMine(appsOnThisDevice());
    void fetchPulse().then((r) => setPulse(r.error ? null : (r.data ?? null)));
  }, []);

  /** A real link that stays in the app when tapped. */
  const inApp = (go: () => void) => (e: JSX.TargetedMouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return; // a new tab is the visitor's choice
    e.preventDefault();
    go();
  };

  // The same trading shops the figures count, so the list of towns and the number of towns always agree.
  // Before the live figures arrive, the towns the build knew — so the links to every town page are in the HTML a
  // crawler reads, and the browser's first frame matches it.
  const [built] = useState(() => prerenderedTowns().map((p) => ({ town: p.town, slug: p.slug, shops: p.shops.length })));
  const towns = pulse?.townList ?? built;

  return (
    <div class="land">
      {mine.length ? (
        <section class="land__back" aria-label={t('home.landing.backTitle')}>
          <span class="land__backt">{t('home.landing.backTitle')}</span>
          <div class="land__backapps">
            {mine.map((a) => (
              <a key={a.id} class="land__backapp" href={a.href}>
                <Icon name={a.icon} size={18} />
                {t(`home.landing.back.${a.id}` as MessageKey)}
              </a>
            ))}
          </div>
        </section>
      ) : null}

      <section class="land__hero">
        <div class="land__herotext">
          <h1 class="land__title">{t('home.welcome.title')}</h1>
          <p class="land__lede">{t('home.welcome.lede')}</p>
          <div class="land__cta">
            <a class="btn btn--primary land__primary" href="/send/">
              {t('home.landing.send')}
              <Icon name="chevronRight" size={20} class="btn__chev" />
            </a>
          </div>
          {/* A plain GET form: it works before the script has run, and on a phone that never runs it. */}
          <form class="land__track" action="/send/" method="get">
            <label class="land__tracklabel" for="land-track">
              {t('home.landing.trackLabel')}
            </label>
            <div class="land__trackrow">
              <input id="land-track" class="input" name="track" autocomplete="off" autocapitalize="characters" spellcheck={false} placeholder={t('home.landing.trackPh')} required />
              <button type="submit" class="btn btn--outline land__trackgo">
                {t('home.landing.trackGo')}
              </button>
            </div>
          </form>
          <a class="land__earn" href="/?go=roles" onClick={inApp(() => actions.go('roles'))}>
            {t('home.welcome.earn')}
            <Icon name="chevronRight" size={18} />
          </a>
        </div>
        <img class="land__heroimg" src={`${IMG}hero.svg`} width={320} height={200} alt={t('home.landing.heroAlt')} fetchpriority="high" />
      </section>

      {pulse && pulse.shops > 0 ? <Proof pulse={pulse} /> : null}

      <section class="land__sec" aria-labelledby="land-how">
        <h2 class="land__h2" id="land-how">
          {t('home.landing.howTitle')}
        </h2>
        <ol class="land__steps">
          {(
            [
              ['step-price', 'home.landing.step1', 'home.welcome.how1', 'home.landing.step1Alt'],
              ['step-shop', 'home.landing.step2', 'home.welcome.how2', 'home.landing.step2Alt'],
              ['step-collect', 'home.landing.step3', 'home.welcome.how3', 'home.landing.step3Alt'],
            ] as const
          ).map(([img, title, body, alt], i) => (
            <li key={img} class="land__step">
              <img src={`${IMG}${img}.svg`} width={160} height={120} alt={t(alt)} loading="lazy" />
              <span class="land__stepn">{i + 1}</span>
              <h3 class="land__h3">{t(title)}</h3>
              <p class="land__p">{t(body)}</p>
            </li>
          ))}
        </ol>
      </section>

      <section class="land__sec" aria-labelledby="land-for">
        <h2 class="land__h2" id="land-for">
          {t('home.landing.forTitle')}
        </h2>
        <div class="land__cards">
          <a class="land__card" href="/send/">
            <img src={`${IMG}for-sender.svg`} width={160} height={120} alt={t('home.landing.alt.sender')} loading="lazy" />
            <span class="land__cardt">{t('home.landing.forSender')}</span>
            <span class="land__p">{t('home.landing.forSenderPromise')}</span>
            <span class="land__cardgo">
              {t('home.landing.send')}
              <Icon name="chevronRight" size={16} />
            </span>
          </a>
          {ROLES.map((r) => (
            <RoleCard key={r.id} role={r} onGo={inApp(() => actions.startJoin(r.id))} />
          ))}
        </div>
      </section>

      <section class="land__sec" aria-labelledby="land-trust">
        <h2 class="land__h2" id="land-trust">
          {t('home.landing.trustTitle')}
        </h2>
        <ul class="land__trust">
          {(['id', 'code', 'photo', 'note'] as const).map((k) => (
            <li key={k} class="land__trustitem">
              <img src={`${IMG}trust-${k}.svg`} width={96} height={72} alt="" loading="lazy" />
              <span>
                <h3 class="land__h3">{t(`home.landing.trust.${k}` as MessageKey)}</h3>
                <p class="land__p">{t(`home.landing.trust.${k}Body` as MessageKey)}</p>
                {k === 'note' ? (
                  <a class="land__link" href="/?go=verify" onClick={inApp(() => actions.go('verify'))}>
                    {t('home.landing.trust.noteCta')}
                  </a>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {towns.length ? (
        <section class="land__sec" aria-labelledby="land-where">
          <h2 class="land__h2" id="land-where">
            {t('home.landing.whereTitle')}
          </h2>
          <p class="land__p">{t('home.landing.whereLede')}</p>
          <ul class="land__towns">
            {towns.slice(0, 24).map((w) => (
              <li key={w.town}>
                <a class="land__town" href={`/towns/${w.slug}/`}>
                  <span class="land__townname">{w.town}</span>
                  <span class="land__townn">{w.shops === 1 ? t('home.landing.whereShop') : t('home.landing.whereShops', { n: w.shops })}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section class="land__sec" aria-labelledby="land-faq">
        <h2 class="land__h2" id="land-faq">
          {t('home.landing.faqTitle')}
        </h2>
        <div class="land__faq">
          {FAQ.map(([q, a]) => (
            <details key={q} class="land__qa">
              <summary class="land__q">{t(q)}</summary>
              <p class="land__a">{t(a)}</p>
            </details>
          ))}
        </div>
      </section>

      <footer class="land__foot">
        <nav class="land__footnav" aria-label={t('home.landing.footNav')}>
          <a href="/send/">{t('home.landing.footSend')}</a>
          <a href="/?go=roles" onClick={inApp(() => actions.go('roles'))}>
            {t('home.landing.footEarn')}
          </a>
          <a href="/?go=market" onClick={inApp(() => actions.go('market'))}>
            {t('home.landing.footMarket')}
          </a>
          <a href="/?go=agents" onClick={inApp(() => actions.go('agents'))}>
            {t('home.landing.footAgents')}
          </a>
          <a href="/?go=verify" onClick={inApp(() => actions.go('verify'))}>
            {t('home.landing.footVerify')}
          </a>
          <a href="/help.html">{t('home.landing.footHelp')}</a>
          <a href="/?go=signin" onClick={inApp(() => actions.go('signin'))}>
            {t('home.landing.footSignIn')}
          </a>
        </nav>
        <div class="land__footend">
          <span class="land__mark">SeeBuyGet</span>
          {/* Help once, in the links above: a second Help here opened a sheet with less in it than the page. */}
          <ReadAloud text={() => welcomeSpoken(t)} label={t('home.readAloud')} />
        </div>
      </footer>
    </div>
  );
}

/** The questions, in the order people ask them. The same pairs go into the page's FAQ structured data. */
export const FAQ: ReadonlyArray<readonly [MessageKey, MessageKey]> = [
  ['home.landing.faq1q', 'home.landing.faq1a'],
  ['home.landing.faq2q', 'home.landing.faq2a'],
  ['home.landing.faq3q', 'home.landing.faq3a'],
  ['home.landing.faq4q', 'home.landing.faq4a'],
  ['home.landing.faq5q', 'home.landing.faq5a'],
  ['home.landing.faq6q', 'home.landing.faq6a'],
  ['home.landing.faq7q', 'home.landing.faq7a'],
  ['home.landing.faq8q', 'home.landing.faq8a'],
];

/** One way to work with the network: its picture, its promise, and the door. */
function RoleCard({ role, onGo }: { role: RoleSpec; onGo: (e: JSX.TargetedMouseEvent<HTMLAnchorElement>) => void }) {
  const t = useT();
  const meta = roleMeta(role, t);
  return (
    <a class="land__card" href={`/?join=${role.id}`} onClick={onGo}>
      <img src={`${IMG}for-${ROLE_IMG[role.id]}.svg`} width={160} height={120} alt={t(`home.landing.alt.${role.id}` as MessageKey)} loading="lazy" />
      <span class="land__cardt">{meta.label}</span>
      <span class="land__p">{meta.promise}</span>
      <span class="land__cardgo">
        {role.kind === 'invite' ? t('home.landing.joinFleet') : t('home.landing.joinAs', { role: meta.labelLower })}
        <Icon name="chevronRight" size={16} />
      </span>
    </a>
  );
}

const ROLE_IMG: Record<RoleSpec['id'], string> = { pudo: 'shop', driver: 'rider', mdp: 'hub', vendor: 'store', fleet: 'fleet' };

/** The network's own figures, and one real journey. Each tile is there only when the server sent its figure. */
function Proof({ pulse }: { pulse: NetworkPulse }) {
  const t = useT();
  const countries = countryNames(pulse.countries);
  const when = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'long' });
  const j = pulse.journey;
  return (
    <section class="land__proof" aria-labelledby="land-proof">
      <h2 class="land__h2" id="land-proof">
        {t('home.landing.proofTitle')}
      </h2>
      <p class="land__p">{t('home.landing.proofLede')}</p>
      <dl class="land__stats">
        <Stat value={String(pulse.shops)} label={t('home.landing.stat.shops')} sub={t('home.landing.stat.shopsOpen', { n: pulse.shopsOpen })} />
        <Stat value={String(pulse.towns)} label={t('home.landing.stat.towns')} sub={countries ? t('home.landing.stat.countries', { list: countries }) : undefined} />
        {pulse.collected30d > 0 ? <Stat value={pulse.collected30d.toLocaleString()} label={t('home.landing.stat.collected')} /> : null}
        {pulse.medianHoursToReady !== undefined ? <Stat value={formatDuration(pulse.medianHoursToReady * 60, t)} label={t('home.landing.stat.hours')} /> : null}
        {pulse.shopRating ? <Stat value={`${pulse.shopRating.average}★`} label={t('home.landing.stat.rating', { n: pulse.shopRating.count })} /> : null}
      </dl>
      {j ? (
        <figure class="land__journey">
          <figcaption class="land__h3">{t('home.landing.journeyTitle')}</figcaption>
          <ol class="land__legs">
            <li class="land__leg">
              <span class="land__legdot" />
              <span>
                <b>{j.fromShop}</b>, {j.fromTown}
                <small>{t('home.landing.journeyHanded')}</small>
              </span>
            </li>
            <li class="land__leg">
              <span class="land__legdot" />
              <span>
                <b>{j.toShop}</b>, {j.toTown}
                <small>{t('home.landing.journeyReady', { time: formatDuration(j.toReadyMinutes, t) })}</small>
              </span>
            </li>
            <li class="land__leg land__leg--done">
              <span class="land__legdot" />
              <span>
                <Icon name="check" size={16} />
                <small>{t('home.landing.journeyCollected', { time: formatDuration(j.toCollectedMinutes, t) })}</small>
              </span>
            </li>
          </ol>
          <p class="land__fine">{t('home.landing.journeyWhen', { date: when(j.collectedAt) })}</p>
        </figure>
      ) : null}
      <p class="land__fine">{t('home.landing.proofAsOf', { time: new Date(pulse.at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) })}</p>
    </section>
  );
}

function Stat({ value, label, sub }: { value: string; label: string; sub?: string }) {
  return (
    <div class="land__stat">
      <dt class="land__statv">{value}</dt>
      <dd class="land__statl">
        {label}
        {sub ? <span class="land__stats2">{sub}</span> : null}
      </dd>
    </div>
  );
}

/** "Kenya, Uganda" from ["KE", "UG"], in the visitor's own language where the browser knows it. */
function countryNames(codes: string[]): string {
  if (!codes.length) return '';
  try {
    const names = new Intl.DisplayNames(undefined, { type: 'region' });
    return codes.map((c) => names.of(c) ?? c).join(', ');
  } catch {
    return codes.join(', ');
  }
}
