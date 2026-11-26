import { NOTICE_AREAS, NOTICE_EN, NOTICE_TRANSLATION_AREAS, NOTICE_TRANSLATIONS, type NoticeKey } from './catalog';
import { at, day, money, month, noticeIn, noticeLangOf, noticeOf, placesOf, said, sayEnglish, sayIn, type NoticeLang } from './say';
import { NotificationService } from '../notification.service';
import { NotificationsController } from '../notifications.controller';
import { OutboxPushSender } from '../push-sender';
import { welcomeNotice } from '../welcome';
import type { IntrospectionResult } from '../../../foundation/auth/auth.types';

/*
 * 2026-11-26 — NOTICES IN THE READER'S LANGUAGE (the owner: "go ahead and translate the notices as well"). Held to here: every
 * phrase is written in every language, with the same places as its English, in one part of the catalogue only; a notice is said
 * in a language only when all of it is written there, else in English; its English is word for word what the sender wrote; a
 * figure is written each language's way; the bell reads in the app's language and a phone is pushed in its app's; and the
 * phrases themselves never leave the server.
 */
const LANGS = ['sw', 'nl', 'am', 'bg'] as const;

describe('the notice catalogue', () => {
  it('a phrase is in one part of the catalogue only', () => {
    const seen = new Map<string, string>();
    for (const [area, words] of Object.entries(NOTICE_AREAS)) {
      for (const key of Object.keys(words)) {
        expect(`${key} in ${seen.get(key) ?? area}`).toBe(`${key} in ${area}`);
        seen.set(key, area);
      }
    }
  });

  it.each(LANGS)('every phrase is written in %s, with the same places as its English, and nothing else is', (lang) => {
    for (const [area, words] of Object.entries(NOTICE_AREAS)) {
      const theirs = NOTICE_TRANSLATION_AREAS[lang][area as keyof typeof NOTICE_AREAS];
      expect(Object.keys(theirs).sort()).toEqual(Object.keys(words).sort());
      for (const [key, english] of Object.entries(words)) {
        const text = theirs[key];
        expect(typeof text === 'string' && text.trim().length > 0 ? key : `${key} empty`).toBe(key);
        expect(`${key}: ${placesOf(text)}`).toBe(`${key}: ${placesOf(english as string)}`);
      }
    }
  });

  it('no phrase leaves a brace open or a place unnamed', () => {
    for (const lang of ['en', ...LANGS] as const) {
      const words = lang === 'en' ? NOTICE_EN : NOTICE_TRANSLATIONS[lang];
      for (const [key, text] of Object.entries(words)) {
        const opens = (text as string).split('{').length;
        expect(`${lang} ${key}: ${opens}`).toBe(`${lang} ${key}: ${(text as string).split('}').length}`);
      }
    }
  });
});

describe('saying a notice', () => {
  const owed = () =>
    noticeOf(
      said('partner.weekOwed.title', { seller: 'SeeBuyGet Nederland', amount: money('EUR 40.00', 40, 'EUR'), from: day('2026-11-22', '2026-11-22'), to: day('2026-11-28', '2026-11-28') }),
      said('partner.weekOwed.body', { steps: 2 }),
    );

  it('its English is word for word what the sender wrote, figures and all', () => {
    expect(owed().title).toBe('SeeBuyGet Nederland owes you EUR 40.00 for the week of 2026-11-22 to 2026-11-28');
    expect(owed().body).toBe('For 2 steps your people did on parcels it sold. It is paid by bank transfer, and you are told here when.');
    expect(sayEnglish(said('partner.weekOwed.body', { steps: 1 }))).toBe('For 1 step your people did on parcels it sold. It is paid by bank transfer, and you are told here when.');
  });

  it('in another language, each figure written that language’s way', () => {
    const bg = noticeIn('bg', owed());
    expect(bg.title).toBe(`SeeBuyGet Nederland ви дължи ${new Intl.NumberFormat('bg', { style: 'currency', currency: 'EUR' }).format(40)} за седмицата от ${new Intl.DateTimeFormat('bg', { dateStyle: 'medium', timeZone: 'UTC' }).format(Date.UTC(2026, 10, 22))} до ${new Intl.DateTimeFormat('bg', { dateStyle: 'medium', timeZone: 'UTC' }).format(Date.UTC(2026, 10, 28))}`);
    expect(bg.body).toContain('2 стъпки');
    expect(bg).not.toHaveProperty('say');
    expect(sayIn('nl', said('payout.bankChanged.what', { account: 'NL•• 4300', until: at('2026-11-27 07:50 UTC', '2026-11-27T07:50:00.000Z') }))).toBe(
      `Uitbetalingen gaan nu naar de rekening NL•• 4300. Er wordt niets naar betaald vóór ${new Intl.DateTimeFormat('nl', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(new Date('2026-11-27T07:50:00.000Z'))} UTC.`,
    );
  });

  it('a month, and a day whose weekday is the point, each language’s way', () => {
    const nl = (v: Parameters<typeof said>[1]) => sayIn('nl', said('partner.weekPaid.body', v));
    expect(nl({ reference: month('November 2026', '2026-11') })).toBe(`Per bankoverschrijving, kenmerk ${new Intl.DateTimeFormat('nl', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(Date.UTC(2026, 10, 1))}.`);
    expect(nl({ reference: day('Saturday 28 November', '2026-11-28', { weekday: true }) })).toBe(`Per bankoverschrijving, kenmerk ${new Intl.DateTimeFormat('nl', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(Date.UTC(2026, 10, 28))}.`);
    expect(sayEnglish(said('partner.weekPaid.body', { reference: month('November 2026', '2026-11') }))).toBe('By bank transfer, reference November 2026.');
  });

  it('a phrase inside a phrase is said in the same language', () => {
    const n = noticeOf(said('payout.bankChanged.title'), said('bell.twoParts', { what: said('partner.mollie.account.unnamed'), next: said('payout.bankChanged.nextPin') }));
    expect(n.body).toBe('a Mollie account If it was not you, change your PIN straight away, then set your own account again in Settings.');
    expect(noticeIn('sw', n).body).toBe('akaunti ya Mollie Ikiwa si wewe, badilisha PIN yako mara moja, kisha weka tena akaunti yako mwenyewe kwenye Mipangilio.');
  });

  it('a notice not all written in a language is said in English, never half and half', () => {
    const n = noticeOf(said('payout.bankChanged.title'), said('bell.twoParts', { what: said('no.such.phrase' as NoticeKey), next: said('payout.bankChanged.nextPin') }));
    expect(noticeIn('bg', n)).toEqual({ title: n.title, body: n.body });
    expect(noticeIn(undefined, n)).toEqual({ title: n.title, body: n.body });
    expect(noticeIn('en', { title: 'Plain', body: 'English' })).toEqual({ title: 'Plain', body: 'English' });
  });

  it('a value that may be missing is written as the English before it wrote it, never as a gap', () => {
    expect(sayEnglish(said('partner.weekPaid.body', { reference: undefined }))).toBe(`By bank transfer, reference ${String(undefined)}.`);
  });

  it('a figure a language cannot write is the sender’s English', () => {
    expect(sayIn('nl', said('partner.weekPaid.title', { seller: 'X', amount: money('ZZ 1.00', 1, 'not a currency'), from: '1', to: '2' }))).toBe('X heeft je ZZ 1.00 betaald voor de week van 1 tot 2');
  });

  it('the language is the app’s, where notices are written in it', () => {
    expect(noticeLangOf('bg')).toBe('bg');
    expect(noticeLangOf('nl-NL')).toBe('nl');
    expect(noticeLangOf(['sw'])).toBe('sw');
    expect(noticeLangOf('fr')).toBeUndefined();
    expect(noticeLangOf(undefined)).toBeUndefined();
  });
});

describe('the bell and the phone', () => {
  const driver = { role: 'driver', did: 'did:glos:driver-ivan' } as IntrospectionResult;
  /** A call from an app speaking this language (its x-sbg-lang header). */
  const asked = (lang: string) => ({ headers: { 'x-sbg-lang': lang } });

  it('the inbox keeps the English and is read in the language the app asks in, without the phrases', async () => {
    const notices = new NotificationService(new OutboxPushSender());
    const words = noticeOf(said('payout.bankChanged.title'), said('payout.bankChanged.nextPin'));
    await notices.notify(driver.did!, { kind: 'security', ...words, link: '/?settings=payout' });
    const english = notices.inboxFor(driver.did!)[0];
    expect(english).toMatchObject({ title: 'Your payout bank account was changed', body: words.body });
    expect(english).not.toHaveProperty('say');
    const controller = new NotificationsController(notices);
    const read = controller.inbox(driver, asked('bg')).items.find((n) => n.kind === 'security')!;
    expect(read).toMatchObject({ title: 'Банковата ви сметка за изплащания беше променена', link: '/?settings=payout' });
    expect(read).not.toHaveProperty('say');
    // The welcome too: the first read of a driver's bell, in Kiswahili.
    expect(controller.inbox(driver, asked('sw')).items.find((n) => n.kind === 'welcome')).toMatchObject({ title: 'Taarifa zako zinafika hapa' });
    expect(controller.inbox(driver, asked('fr')).items.find((n) => n.kind === 'welcome')).toMatchObject({ title: welcomeNotice('driver').title });
  });

  it('each phone is pushed in the language its app had when it turned notifications on, and is never given the phrases', async () => {
    const sender = new OutboxPushSender();
    const notices = new NotificationService(sender);
    const controller = new NotificationsController(notices);
    const keys = { p256dh: 'BPk_p256dh_key', auth: 'auth_secret' };
    controller.subscribe({ endpoint: 'https://push/nl', keys }, driver, asked('nl'));
    controller.subscribe({ endpoint: 'https://push/plain', keys }, driver);
    await notices.notify(driver.did!, { kind: 'security', ...noticeOf(said('payout.bankChanged.title'), said('payout.bankChanged.nextPassword')), link: '/' });
    const sent = sender.outboxFor(driver.did!);
    const nl = sent.find((d) => d.endpoint === 'https://push/nl')!.payload;
    const plain = sent.find((d) => d.endpoint === 'https://push/plain')!.payload;
    expect(nl.title).toBe('Je bankrekening voor uitbetalingen is gewijzigd');
    expect(plain.title).toBe('Your payout bank account was changed');
    expect(nl).not.toHaveProperty('say');
    expect(plain).not.toHaveProperty('say');
    // Its app's language changed: given again, the device is pushed in the new one.
    controller.subscribe({ endpoint: 'https://push/nl', keys }, driver, asked('am'));
    expect(notices.subscriptionsFor(driver.did!).find((s) => s.endpoint === 'https://push/nl')?.lang).toBe('am');
    // The test push, too.
    await controller.test(driver);
    expect(sender.outboxFor(driver.did!).find((d) => d.endpoint === 'https://push/nl' && d.payload.kind === 'test')?.payload.title).toBe('ማሳወቂያዎች በርተዋል');
  });

  it('the buttons on a pushed notice are in the phone’s language too, and English with it where it is not all written', async () => {
    const sender = new OutboxPushSender();
    const notices = new NotificationService(sender);
    const keys = { p256dh: 'BPk_p256dh_key', auth: 'auth_secret' };
    notices.subscribe(driver.did!, 'driver', { endpoint: 'https://push/bg', keys }, 'bg');
    notices.subscribe(driver.did!, 'driver', { endpoint: 'https://push/en', keys });
    const buttons = [
      { action: 'take', title: said('bell.button.take') },
      { action: 'no', title: said('bell.button.notNow') },
    ];
    const words = noticeOf(said('bell.test.title'), said('bell.test.body'), buttons);
    expect(words.actions).toEqual([
      { action: 'take', title: 'Take it' },
      { action: 'no', title: 'Not now' },
    ]);
    await notices.notify(driver.did!, { kind: 'load_nearby', ...words, link: '/' });
    const sent = sender.outboxFor(driver.did!);
    expect(sent.find((d) => d.endpoint === 'https://push/bg')!.payload.actions).toEqual([
      { action: 'take', title: 'Вземи го' },
      { action: 'no', title: 'Не сега' },
    ]);
    expect(sent.find((d) => d.endpoint === 'https://push/en')!.payload.actions).toEqual(words.actions);
    const halfWritten = noticeOf(said('bell.test.title'), said('bell.test.body'), [{ action: 'take', title: said('no.such.button' as NoticeKey) }]);
    expect(noticeIn('bg', halfWritten)).toEqual({ title: halfWritten.title, body: halfWritten.body, actions: halfWritten.actions });
  });

  it('a shared inbox is said to each of its people in their own language', async () => {
    const notices = new NotificationService(new OutboxPushSender());
    const words = noticeOf(said('partner.payoutsShort.title'), said('partner.payoutsShort.body', { count: 3, amount: money('EUR 90.00', 90, 'EUR') }));
    await notices.notify('did:glos:partner', { kind: 'partner_money', ...words, link: '/?go=money' });
    const as = (lang: NoticeLang | undefined) => notices.inboxFor('did:glos:partner', 50, lang)[0].title;
    expect(as('bg')).toBe('Изплащанията чакат: в сметката ви за изплащания няма достатъчно пари');
    expect(as('nl')).toBe('Uitbetalingen wachten: je uitbetalingsrekening heeft te weinig saldo');
    expect(as(undefined)).toBe('Payouts wait: your payout account is short');
    expect(words.body).toBe('3 payouts to your people, EUR 90.00 in all, wait until your payout account holds enough. They are tried again every hour.');
  });
});
