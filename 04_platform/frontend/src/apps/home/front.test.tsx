import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { t } from '../../shared/i18n';
import { enFront } from '../../shared/i18n/catalogs/en.front';
import { PublicShell, Marked } from './screens/PublicShell';
import { WelcomeScreen } from './screens/WelcomeScreen';
import type { HomeActions } from './useHomeApp';
import { RolesScreen } from './screens/RolesScreen';
import { ROLES, roleMeta } from './logic';

/*
 * THE FRONT PAGE, RESTYLED. What is held to here: the page as it is built (no network, no device) states nothing the
 * network did not measure; its examples stay in one country; the foot leads to how SeeBuyGet treats your data and to
 * its cookies; the one orange phrase stays inside its sentence.
 */
const page = () =>
  renderToString(
    <PublicShell readAloud={() => ''}>
      <WelcomeScreen actions={{} as HomeActions} />
    </PublicShell>,
  );

describe('the front page', () => {
  it('says where it is live and what it counted only once the server has said so', () => {
    const html = page();
    expect(html).not.toContain(t('front.live'));
    expect(html).not.toContain('class="fr__stats"');
  });

  it('keeps every example in one country — the label, the steps and the consignment note', () => {
    expect(enFront['front.cmr.senderValue']).toMatch(/, KE$/);
    expect(enFront['front.cmr.consigneeValue']).toMatch(/, KE$/);
    const places = [enFront['front.label.fromPlace'], enFront['front.label.toPlace'], enFront['front.ladder.example']].join(' ');
    for (const elsewhere of ['Kampala', 'Uganda', 'Tanzania', 'Dar es Salaam', 'Lilongwe', 'Kigali', 'Addis', ', UG', ', TZ']) expect(places).not.toContain(elsewhere);
  });

  it('names no towns, and says how it works for everyone who helps it grow — where SeeBuyGet only matches too', () => {
    const html = page();
    expect(html).not.toMatch(/href="\/towns\//);
    expect(html).toContain(t('front.grow.title'));
    expect(html).toContain(t('front.grow.settles'));
    expect(html).toContain(t('front.grow.matches'));
    // Where it only matches, the money is not SeeBuyGet's to set or pay — said here and on the board alike.
    expect(enFront['front.grow.matchesBody']).toMatch(/price and the money stay between you and whoever you carry for/);
    expect(enFront['front.board.foot']).toMatch(/only matches/);
  });

  it('states no figure on who earns what: each country sets its own fees', () => {
    const board = Object.entries(enFront).filter(([k]) => k.startsWith('front.board.') || k.startsWith('front.earn.'));
    for (const [k, v] of board) expect(v, k).not.toMatch(/\d|KES|KSh|%/);
  });

  it('leads from its foot to how SeeBuyGet treats your data and to its cookies', () => {
    const html = page();
    expect(html).toContain(`href="/privacy/">${t('front.foot.data')}<`);
    expect(html).toContain(`href="/cookies/">${t('front.foot.cookies')}<`);
  });

  it('tracks with a plain form that works before any script has run', () => {
    expect(page()).toMatch(/<form class="fr__track" id="track" action="\/send\/" method="get">[\s\S]*name="track"/);
  });

  it('draws the marked phrase in orange without cutting it out of its sentence', () => {
    expect(renderToString(<Marked text="No address. Just a shop, *a code*, and a price." />)).toBe('No address. Just a shop, <em>a code</em>, and a price.');
    expect(enFront['front.title'].match(/\*/g)).toHaveLength(2);
  });
});

/*
 * "WHAT ARE YOU?" — the cards "Sign me up" leads to. What is held to here: every kind of account is offered — each one
 * the front page signs up itself, and a business, which signs up in its own app (2026-10-25: the one kind it left out).
 */
describe('what are you?', () => {
  it('offers every kind of account, and a business opens the Business app to sign up in', () => {
    const html = renderToString(<RolesScreen actions={{} as HomeActions} />);
    for (const r of ROLES) expect(html, r.id).toContain(roleMeta(r, t).label);
    expect(html).toContain(t('home.role.business.label'));
    expect(html).toContain('href="/business/"');
  });
});
