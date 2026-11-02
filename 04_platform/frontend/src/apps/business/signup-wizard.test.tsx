import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { t } from '../../shared/i18n';
import { uploadHint } from '../../shared/upload';
import { SETUP_BAR, SETUP_STEPS, setupBack, setupGaps, setupNext } from './logic';
import { ChooseScreen, SignUpBusiness, type SetupStart } from './screens/ChooseScreen';
import { HomeScreen } from './screens/HomeScreen';
import { SignInScreen } from './screens/SignInScreen';
import type { BusinessView } from './api';

/*
 * THE OWNER, 2026-11-02, signing a business up on a phone: "It says that it works right after it is saved and that SBG
 * staff checks the registration certificate, but there is no image upload (either camera or gallery). Also when it asks
 * for the ID, the steps of registration seem to be a list still but it is not carried to another screen. Can we optimise
 * it still for PWA?"
 */

/** This app's own files, read as written — the tests run from the frontend folder. */
const HERE = 'src/apps/business';

const business = (over: Partial<BusinessView> = {}): BusinessView => ({
  entityId: 'ent_kudu',
  name: 'Kudu Traders Ltd',
  country: 'KE',
  activities: ['shipper', 'importer'],
  registrationNo: 'PVT-2026-0042',
  check: { state: 'unverified', missing: ['certificate_of_incorporation', 'representative_id'] },
  createdAt: '2026-11-02T08:00:00.000Z',
  you: { memberId: 'mem_1', name: 'Amina Odhiambo', role: 'owner', state: 'joined', phoneEnds: '5678', invitedBy: 'Amina Odhiambo', invitedAt: '2026-11-02T08:00:00.000Z', you: true },
  ...over,
});

const baseState = { phase: 'choose', step: 'login', phone: '+254712345678', phoneKnown: true, pin: '', code: '', devCode: '', email: '', emailCode: '', agreement: null, emailReset: false, busy: false, error: null, memberships: [], business: null, settingUp: false, section: 'home', note: null };
const noop = () => undefined;
const actions = { readAgreement: async () => ({ data: { needed: false } }), businessClient: () => ({}), signOut: noop, finishSetup: noop } as never;
const form = { name: 'Kudu Traders Ltd', country: 'KE', registrationNo: 'PVT-2026-0042', taxNo: '', activities: ['shipper' as const], yourName: 'Amina Odhiambo' };

/** The wizard drawn at a step: before the business is saved, or after (it exists, its sign-up still on screen). */
const at = (start: SetupStart, saved: BusinessView | null = null, onCancel?: () => void) =>
  renderToString(<SignUpBusiness state={{ ...baseState, ...(saved ? { phase: 'ready', business: saved, settingUp: true } : {}) } as never} actions={actions} onCancel={onCancel} start={{ form, ...start }} />);

/** The pinned bar's list item of a kind ('done', 'now', 'next') that names this step. */
const item = (html: string, where: string, name: string) => (html.match(new RegExp(`<li[^>]*steps__item--${where}[^>]*>(?:(?!</li>).)*${name}(?:(?!</li>).)*</li>`)) ?? [''])[0];
const inputs = (html: string) => html.match(/<input[^>]*type="file"[^>]*>/g) ?? [];

describe('signing a business up, one step per screen', () => {
  it('goes the business, what it does, you, the certificate, your ID, the ask — then done, which the bar does not name', () => {
    expect(SETUP_STEPS).toEqual(['business', 'activities', 'you', 'certificate', 'id', 'ask', 'done']);
    expect(SETUP_BAR).toEqual(['business', 'activities', 'you', 'certificate', 'id', 'ask']);
    const first = at({ step: 'business' });
    expect(first).toContain('Signing up your business');
    expect(first).toContain('step 1 of 6');
    for (const name of ['The business', 'What it does', 'You', 'Registration certificate', 'Your ID', 'Ask for the check']) expect(first).toContain(name);
    const id = at({ step: 'id' }, business());
    expect(id).toContain('step 5 of 6');
    expect(item(id, 'now', 'Your ID')).toContain('aria-current="step"');
    expect(item(id, 'done', 'Registration certificate')).toContain('Registration certificate: done');
  });

  it('shows one step per screen: the first asks only for the business, what it does is the next screen', () => {
    const first = at({ step: 'business' });
    expect(first).toContain(t('business.new.registrationNo'));
    expect(first).not.toContain(t('business.activity.shipper'));
    expect(first).not.toContain(t('business.new.yourName'));
    const acts = at({ step: 'activities' });
    expect(acts).toContain(t('business.activity.shipper'));
    expect(acts).not.toContain(t('business.new.registrationNo'));
    // A step stops only on its own gaps.
    expect(setupGaps('business', { ...form, name: '', activities: [] })).toEqual(['name']);
    expect(setupGaps('activities', { ...form, name: '', activities: [] })).toEqual(['activities']);
  });

  it('pins the step bar at the top of the card, which has no app top bar to sit under', () => {
    expect(at({ step: 'you' })).toContain('steps steps--pinned');
    const css = readFileSync(join(HERE, 'business.css'), 'utf8');
    expect(css).toMatch(/\.twr-signin__card \.steps--pinned \{\s*top: var\(--sa-t\);/);
  });

  it('says the owner’s sentence first: it works once saved, the papers next, and until the check no page and no listing', () => {
    expect(at({ step: 'business' })).toContain('It works as soon as it is saved. Add your registration certificate and your ID next, so SeeBuyGet can check it: until then it has no public page and is not listed.');
  });

  it('goes Back a step at a time; the first step’s way out is the list (or signing out), and done has none', () => {
    expect(setupBack('business')).toBeNull();
    expect(setupBack('activities')).toBe('business');
    expect(setupBack('certificate')).toBe('you');
    expect(setupBack('ask')).toBe('id');
    expect(setupBack('done')).toBeNull();
    expect(at({ step: 'activities' })).toContain(`>${t('common.back')}</button>`);
    expect(at({ step: 'business' })).toContain(t('business.signOut'));
    expect(at({ step: 'business' }, null, noop)).toContain(`>${t('common.back')}</button>`);
    const done = at({ step: 'done' }, business());
    expect(done).not.toContain(`>${t('common.back')}</button>`);
    expect(done).not.toContain('steps--pinned');
    expect(done).toContain('Open Kudu Traders Ltd');
  });
});

describe('the business is created once', () => {
  it('is created leaving “you”, and only while there is none: Back from the papers and forward again moves on', () => {
    expect(setupNext('business', false)).toEqual({ to: 'activities', create: false });
    expect(setupNext('activities', false)).toEqual({ to: 'you', create: false });
    expect(setupNext('you', false)).toEqual({ to: 'certificate', create: true });
    expect(setupNext('you', true)).toEqual({ to: 'certificate', create: false });
  });

  it('shows what was saved, not a form, once it exists — and offers no second sign-up', () => {
    const before = at({ step: 'you' });
    expect(before).toContain(`>${t('business.new.cta')}</button>`);
    expect(before).toContain('autocomplete="name"');
    const after = at({ step: 'you' }, business());
    expect(after).not.toContain(t('business.new.cta'));
    expect(after).not.toContain('autocomplete="name"');
    expect(after).toContain(`>${t('business.setup.next')}</button>`);
    expect(after).toContain('Amina Odhiambo');
    expect(after).toContain(t('business.setup.saved'));
    // Back at the first step, a saved business offers no way off to the list or out: it is there either way.
    const first = at({ step: 'business' }, business());
    expect(first).toContain('PVT-2026-0042');
    expect(first).not.toContain('autocomplete="organization"');
    expect(first).not.toContain(t('business.signOut'));
  });

  it('keeps the sign-up on screen once saved: the app draws the same screen while it is being set up', () => {
    const app = readFileSync(join(HERE, 'app.tsx'), 'utf8');
    expect(app).toMatch(/state\.phase === 'choose' \|\| !state\.business \|\| state\.settingUp\) return <ChooseScreen/);
    const hook = readFileSync(join(HERE, 'useBusinessApp.ts'), 'utf8');
    expect(hook).toMatch(/patch\(\{ settingUp: true \}\);\s*enterBusiness\(r\.data\.business\)/);
    // And ChooseScreen draws the sign-up, not the list, while it is.
    const html = renderToString(<ChooseScreen state={{ ...baseState, phase: 'ready', business: business(), settingUp: true, memberships: [{ memberId: 'm', entityId: 'e', name: 'Other Ltd', role: 'owner', state: 'joined', country: 'KE', checked: 'verified' }] } as never} actions={actions} />);
    expect(html).toContain('steps--pinned');
    expect(html).not.toContain('Other Ltd');
  });
});

describe('each paper, by camera or from the phone', () => {
  for (const step of ['certificate', 'id'] as const) {
    it(`${step}: a camera input and a photo-or-PDF input, both checked as a document, the limit said`, () => {
      const html = at({ step }, business());
      const files = inputs(html);
      expect(files).toHaveLength(2);
      const [camera, gallery] = files;
      expect(camera).toContain('accept="image/*"');
      expect(camera).toContain('capture="environment"');
      expect(camera).toContain('data-upload="document"');
      expect(gallery).toContain('accept="application/pdf,image/*"');
      expect(gallery).not.toContain('capture');
      expect(gallery).toContain('data-upload="document"');
      expect(html).toContain(t('business.paper.takePhoto'));
      expect(html).toContain(t('business.paper.choose'));
      expect(html).toContain(uploadHint('document'));
      // Not added yet: it can wait.
      expect(html).toContain(`>${t('business.setup.later')}</button>`);
    });
  }

  it('says plainly that the ID’s file is deleted the moment staff decide', () => {
    const html = at({ step: 'id' }, business());
    expect(html).toContain('The file of the ID is deleted the moment SeeBuyGet staff decide on it, accepted or not.');
    expect(at({ step: 'certificate' }, business())).not.toContain('deleted the moment');
  });

  it('shows what was added — the photo small, a PDF by its name — and lets it be replaced', () => {
    const photo = at({ step: 'certificate', added: { certificate_of_incorporation: { name: 'IMG_2031.jpg', preview: 'data:image/jpeg;base64,AAAA' } } }, business({ check: { state: 'unverified', missing: ['representative_id'] } }));
    expect(photo).toMatch(/<img src="data:image\/jpeg;base64,AAAA"[^>]*class="biz-added__thumb"/);
    expect(photo).toContain('IMG_2031.jpg');
    expect(photo).toContain(t('business.setup.replace'));
    expect(inputs(photo)).toHaveLength(2);
    expect(photo).toContain(`>${t('business.setup.next')}</button>`);
    expect(photo).not.toContain(t('business.setup.later'));
    const pdf = at({ step: 'id', added: { representative_id: { name: 'passport.pdf', preview: 'data:application/pdf;base64,AAAA' } } }, business({ check: { state: 'unverified', missing: ['certificate_of_incorporation'] } }));
    expect(pdf).toContain('passport.pdf');
    expect(pdf).not.toContain('<img');
    expect(pdf).toMatch(/biz-added__tile[^>]*>\s*PDF/);
  });
});

describe('skipping a paper leads on', () => {
  it('goes from a paper to the next step, and the ask says what is missing and that it can wait', () => {
    expect(setupNext('certificate', true).to).toBe('id');
    expect(setupNext('id', true).to).toBe('ask');
    const ask = at({ step: 'ask' }, business({ check: { state: 'unverified', missing: ['representative_id'] } }));
    expect(ask).toContain(t('business.setup.askMissing'));
    expect(ask).toContain(`>${t('business.setup.askLater')}</button>`);
    expect(ask).not.toContain(`>${t('business.home.ask')}</button>`);
    // Both in: the ask itself, and "not now".
    const ready = at({ step: 'ask' }, business({ check: { state: 'unverified', missing: [] } }));
    expect(ready).toContain(`>${t('business.home.ask')}</button>`);
    expect(ready).toContain(`>${t('business.setup.notNow')}</button>`);
  });

  it('ends saying it works, and what waits for the check: no public page, not listed', () => {
    const later = at({ step: 'done' }, business());
    expect(later).toContain('Your business is signed up');
    expect(later).toContain('it has no public page and is not listed');
    const asked = at({ step: 'done', asked: true }, business({ check: { state: 'asked', missing: [] } }));
    expect(asked).toContain('SeeBuyGet has your papers');
  });
});

describe('the start screen keeps the check for later', () => {
  it('offers each paper by camera, or a photo or PDF — not one small “Add”', () => {
    const html = renderToString(<HomeScreen business={business()} actions={actions} client={null} />);
    const files = inputs(html);
    expect(files).toHaveLength(4);
    expect(files.filter((i) => i.includes('capture="environment"') && i.includes('accept="image/*"'))).toHaveLength(2);
    expect(files.filter((i) => i.includes('accept="application/pdf,image/*"') && !i.includes('capture'))).toHaveLength(2);
    expect(files.every((i) => i.includes('data-upload="document"'))).toBe(true);
    expect(html.split(`<span>${t('business.paper.takePhoto')}</span>`).length - 1).toBe(2);
    expect(html).toContain(uploadHint('document'));
  });
});

describe('setting up a sign-in on a phone', () => {
  const render = (step: string, narrow?: boolean) =>
    renderToString(<SignInScreen narrow={narrow} state={{ ...baseState, phase: 'signin', phoneKnown: false, step } as never} actions={{ set: noop, setStep: noop } as never} />);

  it('pins the step bar, on a phone and at a desk', () => {
    expect(render('code')).toContain('steps steps--pinned');
    expect(render('code', true)).toContain('steps steps--pinned');
  });

  it('puts Back, Help and the other apps in the bar pinned to the bottom on a phone; the card keeps them at a desk', () => {
    const phone = render('pin', true);
    expect(phone).toContain('bnav sobar');
    expect(phone).not.toContain('twr-signin__foot');
    const desk = render('pin');
    expect(desk).toContain('twr-signin__foot');
    expect(desk).not.toContain('sobar');
  });
});
