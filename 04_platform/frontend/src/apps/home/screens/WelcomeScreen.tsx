import { useEffect, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import { Icon } from '../../../shared/ui';
import { useT, type MessageKey } from '../../../shared/i18n';
import { fetchPulse, type NetworkPulse } from '../api';
import { appsOnThisDevice, formatDuration, roleMeta, ROLES, type DeviceApp, type RoleSpec } from '../logic';
import type { HomeActions } from '../useHomeApp';
import { Marked } from './PublicShell';

export interface WelcomeScreenProps {
  actions: HomeActions;
}

const IMG = '/img/landing/';

/**
 * THE FRONT PAGE — built from the objects a parcel passes through (the user, 2026-10-22: "Build the keep and change";
 * the public site in paper and orange). Top to bottom:
 *
 *  - A RETURNING VISITOR sees their own apps first (whatever this device last signed in to).
 *  - The promise in one line, the price first, tracking as a plain form that works before any script has run — and
 *    beside it a parcel's LABEL: its tracking key public, the receiver's code on a tear-off that is never on the parcel.
 *  - Where it is live, and the network's own figures, ONLY from the server (`/network/pulse`) — never typed. Nothing
 *    shows while there is nothing to show (the user: "the homepage can only reveal the reality as it is").
 *  - The steps a tracking key shows, exactly the parcel's own (Booked → At the shop → On the bus → At the hub → On
 *    the shelf → Collected).
 *  - A shop's painted sign for earning, who earns what in words — no figures, as each country sets its own — and the
 *    way to join each role.
 *  - Freight: the consignment note's boxes, filled from what happened.
 *  - Why it is safe; how it works for everyone who helps it grow — where a SeeBuyGet company runs, and where SeeBuyGet
 *    only matches — never a list of towns (the user: "we should be truthful"); and the questions people ask.
 *
 * Every example is an example: every place in one country, every name invented ("mfano" is "example" in Swahili).
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

  const live = pulse ? countryList(pulse.countries) : [];

  return (
    <div class="fr">
      {mine.length ? (
        <section class="fr__back" aria-label={t('home.landing.backTitle')}>
          <div class="pub__in fr__backin">
            <span class="fr__backt">{t('home.landing.backTitle')}</span>
            {mine.map((a) => (
              <a key={a.id} class="fr__backapp" href={a.href}>
                <Icon name={a.icon} size={18} />
                {t(`home.landing.back.${a.id}` as MessageKey)}
              </a>
            ))}
          </div>
        </section>
      ) : null}

      <section class="fr__hero" id="send">
        <div class="pub__in fr__heroin">
          <div>
            {live.length ? (
              <p class="fr__where">
                <span>{t('front.live')}</span>
                {live.map((name, i) => (
                  <span key={name}>
                    {i > 0 ? <span aria-hidden="true"> · </span> : null}
                    <b>{name}</b>
                  </span>
                ))}
                <a href="/?go=roles">{t('front.notHere')}</a>
              </p>
            ) : null}
            <h1 class="fr__title">
              <Marked text={t('front.title')} />
            </h1>
            <p class="fr__lede">{t('front.lede')}</p>
            <div class="fr__acts">
              <a class="pbtn pbtn--primary" href="/send/">
                {t('front.seePrice')}
              </a>
              <a class="pbtn" href="#earn">
                {t('front.iRun')}
              </a>
            </div>
            {/* A plain GET form: it works before the script has run, and on a phone that never runs it. */}
            <form class="fr__track" id="track" action="/send/" method="get">
              <label for="land-track">{t('front.trackLabel')}</label>
              <div class="fr__trackrow">
                <input id="land-track" name="track" autocomplete="off" autocapitalize="characters" spellcheck={false} placeholder="PUD-7F3A9C21B4" required />
                <button type="submit" class="pbtn">
                  {t('front.trackGo')}
                </button>
              </div>
            </form>
          </div>
          <ExampleLabel />
        </div>
      </section>

      {pulse && pulse.shops > 0 ? <Proof pulse={pulse} /> : null}

      <Ladder />

      <section class="fr__sign" id="earn">
        <div class="pub__in fr__signin">
          <div>
            <p class="fr__big">{t('front.earn.sign')}</p>
            <p class="fr__signlede">{t('front.earn.lede')}</p>
            <div class="fr__joins">
              {ROLES.map((r) => (
                <JoinLink key={r.id} role={r} onGo={inApp(() => actions.startJoin(r.id))} />
              ))}
            </div>
          </div>
          <div class="fr__board" aria-labelledby="fr-board">
            <p class="fr__boardt" id="fr-board">
              {t('front.board.title')}
            </p>
            <dl>
              {(['shop', 'driver', 'hub', 'store'] as const).map((k) => (
                <div key={k} class="fr__line">
                  <dt>{t(`front.board.${k}`)}</dt>
                  <dd>{t(`front.board.${k}How`)}</dd>
                </div>
              ))}
            </dl>
            <p class="fr__boardfoot">
              {t('front.board.foot')}{' '}
              <a href="/help/shop-papers/">{t('front.board.approved')} →</a>
            </p>
          </div>
        </div>
      </section>

      <section class="fr__sec fr__freight" id="freight">
        <div class="pub__in fr__freightin">
          <div>
            <p class="fr__eyebrow">{t('front.freight.eyebrow')}</p>
            <h2 class="fr__h2">{t('front.freight.title')}</h2>
            <p class="fr__p">{t('front.freight.lede')}</p>
            <ul class="fr__boxes">
              {(
                [
                  ['13', 'front.freight.box13', 'front.freight.box13Body'],
                  ['S', 'front.freight.seals', 'front.freight.sealsBody'],
                  ['24', 'front.freight.box24', 'front.freight.box24Body'],
                ] as const
              ).map(([n, title, body]) => (
                <li key={n}>
                  <span class="fr__boxn">{n}</span>
                  <span>
                    <b>{t(title)}</b>
                    <span>{t(body)}</span>
                  </span>
                </li>
              ))}
            </ul>
            <div class="fr__acts fr__acts--grid">
              <a class="pbtn pbtn--primary" href="/business/">
                {t('front.freight.open')}
              </a>
              <a class="pbtn" href="/?go=verify" onClick={inApp(() => actions.go('verify'))}>
                {t('front.freight.check')}
              </a>
              <a class="pbtn" href="/?go=agents" onClick={inApp(() => actions.go('agents'))}>
                {t('front.freight.agents')}
              </a>
            </div>
          </div>
          <ExampleNote />
        </div>
      </section>

      <section class="fr__sec">
        <div class="pub__in">
          <ul class="fr__trust">
            {(['id', 'code', 'photo', 'note'] as const).map((k) => (
              <li key={k}>
                <span class="fr__eyebrow">{t(`front.trust.${k}When`)}</span>
                <h3 class="fr__h3">{t(`home.landing.trust.${k}` as MessageKey)}</h3>
                <p class="fr__p">{t(`home.landing.trust.${k}Body` as MessageKey)}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section class="fr__sec fr__grow" aria-labelledby="fr-grow">
        <div class="pub__in">
          <h2 class="fr__h2" id="fr-grow">
            {t('front.grow.title')}
          </h2>
          <p class="fr__p fr__growlede">{t('front.grow.lede')}</p>
          <div class="fr__ways">
            <div class="fr__way">
              <h3 class="fr__h3">{t('front.grow.settles')}</h3>
              <p class="fr__p">{t('front.grow.settlesBody')}</p>
            </div>
            <div class="fr__way fr__way--match">
              <h3 class="fr__h3">{t('front.grow.matches')}</h3>
              <p class="fr__p">{t('front.grow.matchesBody')}</p>
            </div>
          </div>
          <div class="fr__acts">
            <a class="pbtn pbtn--primary" href="#earn">
              {t('front.grow.join')}
            </a>
          </div>
        </div>
      </section>

      <section class="fr__sec fr__faq" aria-labelledby="land-faq" id="help">
        <div class="pub__in">
          <h2 class="fr__h2" id="land-faq">
            {t('front.faq.title')}
          </h2>
          {FAQ_GROUPS.map((g) => (
            <div key={g.key} class="fr__faqgroup">
              <h3 class="fr__h3">{t(g.title)}</h3>
              <div class="fr__qs">
                {g.items.map(([q, a]) => (
                  <details key={q}>
                    <summary>{t(q)}</summary>
                    <p>{t(a)}</p>
                  </details>
                ))}
              </div>
              <a class="fr__more" href={g.more}>
                {t(g.moreLabel)} →
              </a>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

/** The label a parcel wears: who sends and who collects, its public tracking key, and the receiver's code torn off. */
function ExampleLabel() {
  const t = useT();
  return (
    <figure class="fr__labelwrap" aria-label={t('front.label.aria')}>
      <div class="fr__label">
        <div class="fr__labelhd">
          <b>SeeBuyGet</b>
          <span>{t('front.label.kind')}</span>
        </div>
        <div class="fr__labelgrid">
          <div>
            <small>{t('front.label.from')}</small>
            <b>{t('front.label.fromShop')}</b>
            <span>{t('front.label.fromPlace')}</span>
          </div>
          <div>
            <small>{t('front.label.to')}</small>
            <b>{t('front.label.toShop')}</b>
            <span>{t('front.label.toPlace')}</span>
          </div>
        </div>
        <div class="fr__labelkey">
          <QrMark />
          <div>
            <span class="fr__labelk">PUD-7F3A9C21B4</span>
            <small>{t('front.label.key')}</small>
          </div>
        </div>
        <div class="fr__labelpay">{t('front.label.paid')}</div>
        <span class="fr__stamp">{t('front.label.stamp')}</span>
      </div>
      <div class="fr__tear">
        <small>{t('front.label.tear')}</small>
        <b aria-label="4821">4821</b>
      </div>
    </figure>
  );
}

/** A small square pattern standing for the label's QR code — a picture of one, not one that opens anything. */
function QrMark() {
  return (
    <svg class="fr__qr" viewBox="0 0 21 21" shape-rendering="crispEdges" aria-hidden="true">
      <rect width="21" height="21" fill="#fff" />
      <path
        fill="currentColor"
        d="M0 0h7v7H0zM1 1v5h5V1zM2 2h3v3H2zM14 0h7v7h-7zM15 1v5h5v-5zM16 2h3v3h-3zM0 14h7v7H0zM1 15v5h5v-5zM2 16h3v3H2zM9 0h1v2H9zM11 1h2v1h-2zM8 3h2v1H8zM11 3h1v2h-1zM9 5h3v1H9zM0 9h2v1H0zM3 8h1v3H3zM5 9h3v1H5zM9 8h1v1H9zM11 8h2v2h-2zM14 9h2v1h-2zM17 8h1v2h-1zM19 9h2v1h-2zM1 11h1v2H1zM4 12h2v1H4zM8 11h2v1H8zM12 11h1v3h-1zM15 12h2v1h-2zM18 11h3v1h-3zM9 14h1v2H9zM11 15h2v1h-2zM14 14h2v2h-2zM17 14h1v1h-1zM19 15h2v1h-2zM8 17h3v1H8zM13 17h1v2h-1zM15 18h3v1h-3zM19 17h2v1h-2zM9 19h2v2H9zM12 20h2v1h-2zM16 20h1v1h-1zM18 19h3v2h-3z"
      />
    </svg>
  );
}

/** The steps a tracking key shows — the parcel's own, in order — on one example parcel, three of them done. */
function Ladder() {
  const t = useT();
  const steps = [
    ['booked', 'front.ladder.bookedWhen', 'done'],
    ['atShop', 'front.ladder.atShopWhen', 'done'],
    ['onBus', 'front.ladder.onBusWhen', 'done'],
    ['atHub', 'front.ladder.atHubWhen', 'now'],
    ['onShelf', 'front.ladder.onShelfWhen', ''],
    ['collected', '', ''],
  ] as const;
  return (
    <section class="fr__sec fr__ladder" aria-labelledby="fr-ladder">
      <div class="pub__in">
        <h2 class="fr__h2" id="fr-ladder">
          {t('front.ladder.title')}
        </h2>
        <p class="fr__p">{t('front.ladder.sub')}</p>
        <ol class="fr__rail" aria-label={t('front.ladder.example')}>
          {steps.map(([k, when, state], i) => (
            <li key={k} class={`fr__rung${state ? ` fr__rung--${state}` : ''}`}>
              <span class="fr__dot" aria-hidden="true">
                {state === 'done' ? '✓' : i + 1}
              </span>
              <span class="fr__when">{when ? t(when as MessageKey) : '—'}</span>
              <h3 class="fr__h3">{t(`front.ladder.${k}` as MessageKey)}</h3>
              <p class="fr__p">{t(`front.ladder.${k}Body` as MessageKey)}</p>
            </li>
          ))}
        </ol>
        <p class="fr__fine">{t('front.ladder.example')}</p>
      </div>
    </section>
  );
}

/**
 * One way in for each kind of reader, with its picture: the front door's join. A fleet office's went to the contact
 * form, to write to us and wait; it signs itself up here like everybody else now (the user, 2026-10-23).
 */
function JoinLink({ role, onGo }: { role: RoleSpec; onGo: (e: JSX.TargetedMouseEvent<HTMLAnchorElement>) => void }) {
  const t = useT();
  const meta = roleMeta(role, t);
  const label = t('home.landing.joinAs', { role: meta.labelLower });
  return (
    <a class="fr__join" href={`/?join=${role.id}`} onClick={onGo}>
      <img src={`${IMG}for-${ROLE_IMG[role.id]}.svg`} width={44} height={33} alt="" loading="lazy" />
      <span>{label}</span>
    </a>
  );
}

const ROLE_IMG: Record<RoleSpec['id'], string> = { pudo: 'shop', driver: 'rider', mdp: 'hub', vendor: 'store', fleet: 'fleet' };

/** Part of a consignment note, filled in: two parties in one country, the sender's instructions, a seal, the receipt. */
function ExampleNote() {
  const t = useT();
  return (
    <div class="fr__cmr" role="group" aria-label={t('front.cmr.aria')}>
      <div class="fr__cmrbox">
        <span class="fr__cmrn">
          <b>1</b>
          {t('front.cmr.sender')}
        </span>
        <span>{t('front.cmr.senderValue')}</span>
      </div>
      <div class="fr__cmrbox">
        <span class="fr__cmrn">
          <b>2</b>
          {t('front.cmr.consignee')}
        </span>
        <span>{t('front.cmr.consigneeValue')}</span>
      </div>
      <div class="fr__cmrbox fr__cmrbox--wide">
        <span class="fr__cmrn">
          <b>13</b>
          {t('front.cmr.instructions')}
        </span>
        <span class="fr__hand">{t('front.cmr.instructionsValue')}</span>
      </div>
      <div class="fr__cmrbox">
        <span class="fr__cmrn">
          <b>S</b>
          {t('front.cmr.seals')}
        </span>
        <span>{t('front.cmr.sealsValue')}</span>
      </div>
      <div class="fr__cmrbox">
        <span class="fr__cmrn">
          <b>24</b>
          {t('front.cmr.received')}
        </span>
        <span>
          <span class="fr__photo" aria-hidden="true" />
          {t('front.cmr.receivedValue')}
        </span>
      </div>
    </div>
  );
}

/**
 * The questions, grouped by who asks them (2026-10-22: the FAQ tidied) and in the order they ask. Every answer stands
 * alone — an AI assistant quotes one answer, not the page around it — and each group leads on to that reader's help.
 */
export const FAQ_GROUPS: ReadonlyArray<{ key: string; title: MessageKey; more: string; moreLabel: MessageKey; items: ReadonlyArray<readonly [MessageKey, MessageKey]> }> = [
  {
    key: 'send',
    title: 'home.landing.faqGroup.send',
    more: '/help/?for=send',
    moreLabel: 'home.landing.faqMore.send',
    items: [
      ['home.landing.faq1q', 'home.landing.faq1a'],
      ['home.landing.faq2q', 'home.landing.faq2a'],
      ['home.landing.faq3q', 'home.landing.faq3a'],
      ['home.landing.faq4q', 'home.landing.faq4a'],
      ['home.landing.faq5q', 'home.landing.faq5a'],
      ['home.landing.faq6q', 'home.landing.faq6a'],
    ],
  },
  {
    key: 'earn',
    title: 'home.landing.faqGroup.earn',
    more: '/help/?for=shop',
    moreLabel: 'home.landing.faqMore.earn',
    items: [
      ['home.landing.faq7q', 'home.landing.faq7a'],
      ['home.landing.faq9q', 'home.landing.faq9a'],
    ],
  },
  { key: 'stores', title: 'home.landing.faqGroup.stores', more: '/help/?for=store', moreLabel: 'home.landing.faqMore.stores', items: [['home.landing.faq10q', 'home.landing.faq10a']] },
  {
    key: 'safe',
    title: 'home.landing.faqGroup.safe',
    more: '/help/',
    moreLabel: 'home.landing.faqMore.safe',
    items: [
      ['home.landing.faq8q', 'home.landing.faq8a'],
      ['home.landing.faq11q', 'home.landing.faq11a'],
    ],
  },
];

/** Every question, in that order — what the page's FAQ structured data carries. */
export const FAQ: ReadonlyArray<readonly [MessageKey, MessageKey]> = FAQ_GROUPS.flatMap((g) => g.items);

/** The network's own figures, and one real journey. Each tile is there only when the server sent its figure. */
function Proof({ pulse }: { pulse: NetworkPulse }) {
  const t = useT();
  const countries = countryList(pulse.countries).join(', ');
  const when = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'long' });
  const j = pulse.journey;
  return (
    <section class="fr__sec fr__proof" aria-labelledby="land-proof">
      <div class="pub__in">
        <h2 class="fr__h2" id="land-proof">
          {t('home.landing.proofTitle')}
        </h2>
        <p class="fr__p">{t('home.landing.proofLede')}</p>
        <dl class="fr__stats">
          <Stat value={String(pulse.shops)} label={t('home.landing.stat.shops')} sub={t('home.landing.stat.shopsOpen', { n: pulse.shopsOpen })} />
          <Stat value={String(pulse.towns)} label={t('home.landing.stat.towns')} sub={countries ? t('home.landing.stat.countries', { list: countries }) : undefined} />
          {pulse.collected30d > 0 ? <Stat value={pulse.collected30d.toLocaleString()} label={t('home.landing.stat.collected')} /> : null}
          {pulse.medianHoursToReady !== undefined ? <Stat value={formatDuration(pulse.medianHoursToReady * 60, t)} label={t('home.landing.stat.hours')} /> : null}
          {pulse.shopRating ? <Stat value={`${pulse.shopRating.average}★`} label={t('home.landing.stat.rating', { n: pulse.shopRating.count })} /> : null}
        </dl>
        {j ? (
          <figure class="fr__journey">
            <figcaption class="fr__h3">{t('home.landing.journeyTitle')}</figcaption>
            <ol>
              <li>
                <b>{j.fromShop}</b>, {j.fromTown} — {t('home.landing.journeyHanded')}
              </li>
              <li>
                <b>{j.toShop}</b>, {j.toTown} — {t('home.landing.journeyReady', { time: formatDuration(j.toReadyMinutes, t) })}
              </li>
              <li>{t('home.landing.journeyCollected', { time: formatDuration(j.toCollectedMinutes, t) })}</li>
            </ol>
            <p class="fr__fine">{t('home.landing.journeyWhen', { date: when(j.collectedAt) })}</p>
          </figure>
        ) : null}
        <p class="fr__fine">{t('home.landing.proofAsOf', { time: new Date(pulse.at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) })}</p>
      </div>
    </section>
  );
}

function Stat({ value, label, sub }: { value: string; label: string; sub?: string }) {
  return (
    <div class="fr__stat">
      <dt>{value}</dt>
      <dd>
        {label}
        {sub ? <span>{sub}</span> : null}
      </dd>
    </div>
  );
}

/** ["Kenya", "Uganda"] from ["KE", "UG"], in the visitor's own language where the browser knows it. */
function countryList(codes: string[]): string[] {
  try {
    const names = new Intl.DisplayNames(undefined, { type: 'region' });
    return codes.map((c) => names.of(c) ?? c);
  } catch {
    return codes;
  }
}
