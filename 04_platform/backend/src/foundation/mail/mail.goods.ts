import type { MailBlock } from './mail.blocks';
import { appUrl, type MailApp, type MailTemplates } from './mail.kit';
import { money, said, type SayValue } from '../../modules/pudo/notice-words/say';
import type { NoticeKey } from '../../modules/pudo/notice-words/catalog';

/*
 * 2026-11-27 — THE GOODS EMAILS. A country opening, and goods on their way: an order, a load delivered, a damage report, a code to collect. Each email's parameters, and its words.
 */

export interface GoodsMailParams {
  /** Somebody asked to be told when the network reaches their country. Sent the moment they ask. */
  'interest-received': { country: SayValue; kind: string };
  /** Two members of staff switched that country on. Sent by the approval itself, not by anybody remembering. */
  'country-open': { country: SayValue; settles: boolean; company?: string; joinUrl: string };
  /** 2026-10-25 — a country somebody asked about takes sign-ups before it opens: they can sign up now, and start the day it opens. */
  'country-coming': { country: SayValue; joinUrl: string };
  /** 2026-10-25 — a country people signed up in while it was coming is open: each told whether they can start today. */
  'country-opened': { country: SayValue; ready: boolean; company?: string; app: MailApp };
  /** 2026-10-25 — a company of ours switched on in a country people already worked in: who they work with from today. */
  'country-established': { country: SayValue; company: string; asked: boolean; app: MailApp };
  /** 2026-10-25 — the same day, to the people who asked about that country and were told no company of ours was there yet. */
  'country-settles': { country: SayValue; company: string; joinUrl: string };
  /** A country was lowered: what stops there for this participant, what does not, and which app they use. `lost` and `kept` are English our code writes (country-notice.service.ts): phrases, or words said as they are. */
  'country-changed': { country: SayValue; lost: SayValue[]; kept: SayValue[]; app: MailApp };
  'order-on-its-way': { store: string; orderRef?: string; shop: string; trackingUrl: string };
  'freight-delivered': { code: string; description: string; destination: string; deliveredAt: string; carrier: SayValue; driver?: string; receiverName?: string; /** D9 — what the receiver found not as the note says, in words (English our code writes: a phrase, or words said as they are). */ reservations?: SayValue; amount?: number; currency?: string; noteNumber: string; /** A link that opens the note with nobody signed in, and when it stops. */ noteUrl?: string; noteUntil?: string; /** It goes to one of a BUSINESS's people: its name, and whether they posted the load or are an owner told in the poster's place. */ business?: { name: string; as: 'poster' | 'owner' } };
  /**
   * A problem was reported on one of a store's shipments, and the store names an insurer on its shipping policy: the
   * damage claim report, by a link. Sent the moment the report is made. `by`: who reported the problem.
   */
  'damage-report': { number: string; parcelId: string; orderNumber?: string; store: string; insurer: string; reportedAt: string; by: 'receiver' | 'shop'; problem: string; from: string; to: string; url: string; until: string };
  'load-delivery-code': { code: string; load: string; from: string; name?: string; openUrl: string };
  'ready-for-collection': { shop: string; address?: string; collectBy: string; openUrl?: string; code?: string; name?: string; reissued?: boolean };
}

const WOULD_BE: Record<string, NoticeKey> = {
  carrier: 'mail.interest-received.would.carrier',
  shop: 'mail.interest-received.would.shop',
  hub: 'mail.interest-received.would.hub',
  store: 'mail.interest-received.would.store',
  other: 'mail.interest-received.would.other',
};

export const GOODS_MAILS: MailTemplates<keyof GoodsMailParams> = {
  /*
   * THE ONLY THING THIS PROMISES IS THE ONE THE SYSTEM CAN KEEP.
   *
   * "We will get back to you" is a promise a person has to keep, and the first country with three
   * interested people and no plan is where it breaks — leaving a broken promise where an honest "not yet"
   * used to be. So it promises the switch-on itself, which is automatic, and says plainly that it may be
   * a long wait. Nobody is told a decision is coming.
   */
  'interest-received': {
    title: 'Thanks for asking about your country',
    sentWhen: 'Somebody leaves a message from a country the network does not reach yet.',
    wired: true,
    // A thank-you is still one two days on.
    sendLater: 48,
    sample: { country: 'the Netherlands', kind: 'carrier' },
    phrased: true,
    build: (p, w) => ({
      subject: w.say('mail.interest-received.subject', { country: p.country }),
      preheader: w.say('mail.interest-received.preheader', { country: p.country }),
      blocks: [
        { kind: 'heading', text: w.say('mail.interest-received.heading') },
        { kind: 'paragraph', text: w.say('mail.interest-received.told', { what: said(WOULD_BE[p.kind] ?? WOULD_BE.other), country: p.country }) },
        { kind: 'paragraph', text: w.say('mail.interest-received.deliberate') },
        {
          kind: 'paragraph',
          // COMING (2026-10-25): sign-ups may open before the country does — then that is said first, and the opening after.
          text: w.say('mail.interest-received.willWrite', { country: p.country }),
        },
        { kind: 'paragraph', text: w.say('mail.interest-received.nothingElse') },
      ],
      reason: w.say('mail.interest-received.reason'),
    }),
  },
  /*
   * THE PROMISE BEING KEPT — and it names WHICH of the two, because the difference is who handles the
   * money and who carries responsibility for it. Telling somebody "we are live" and letting them find out
   * afterwards that nobody there pays them would be the same false note the join form was just fixed for.
   */
  'country-open': {
    title: 'Your country is switched on',
    sentWhen: 'Two members of staff switch on a country somebody had asked about.',
    wired: true,
    // They asked to be told; late is still told.
    sendLater: 72,
    sample: { country: 'the Netherlands', settles: false, joinUrl: 'https://seebuyget.com/' },
    phrased: true,
    build: (p, w) => {
      const company = p.company ?? said('mail.country-open.aCompany');
      return {
        subject: w.say('mail.country-open.subject', { country: p.country }),
        preheader: p.settles ? w.say('mail.country-open.preheaderSettles', { company }) : w.say('mail.country-open.preheaderMatches'),
        blocks: [
          { kind: 'heading', text: w.say('mail.country-open.heading', { country: p.country }) },
          { kind: 'paragraph', text: w.say('mail.country-open.asked') },
          p.settles
            ? {
                kind: 'paragraph' as const,
                text: w.say('mail.country-open.company', { company }),
              }
            : {
                kind: 'warning' as const,
                title: w.say('mail.country-open.noMoneyTitle'),
                text: w.say('mail.country-open.noMoneyText', { country: p.country }),
              },
          { kind: 'button', label: w.say('mail.country-open.button'), href: p.joinUrl },
        ],
        reason: w.say('mail.country-open.reason'),
      };
    },
  },
  /*
   * COMING (the user, 2026-10-25: "can preregister before a country goes live"). Not "we are here": the country is not
   * open, and the mail says so before it says anything else — what it offers is the sign-up and the check of papers
   * ahead of the day, so they can start on it.
   */
  'country-coming': {
    title: 'Your country takes sign-ups (opening soon)',
    sentWhen: 'Two members of staff mark a country somebody had asked about as coming: it takes sign-ups before it opens.',
    wired: true,
    // They asked to be told; late is still told.
    sendLater: 72,
    sample: { country: 'Uganda', joinUrl: 'https://seebuyget.com/' },
    phrased: true,
    build: (p, w) => ({
      subject: w.say('mail.country-coming.subject', { country: p.country }),
      preheader: w.say('mail.country-coming.preheader'),
      blocks: [
        { kind: 'heading', text: w.say('mail.country-coming.heading', { country: p.country }) },
        { kind: 'paragraph', text: w.say('mail.country-coming.asked') },
        { kind: 'paragraph', text: w.say('mail.country-coming.writeAgain') },
        { kind: 'button', label: w.say('mail.country-coming.button'), href: p.joinUrl },
      ],
      reason: w.say('mail.country-coming.reason'),
    }),
  },
  /*
   * THE DAY IT OPENS, to everybody who signed up while it was coming — whether they can start today, and who they
   * work with there (or that nobody of ours handles the money yet, said as plainly as the waiting list is told).
   */
  'country-opened': {
    title: 'Your country is open (signed up before it opened)',
    sentWhen: 'A country people signed up in while it was coming is switched on — to everybody registered there who gave an email address. The apps say it in their inbox as well.',
    wired: true,
    sendLater: 72,
    sample: { country: 'Uganda', ready: true, company: 'SeeBuyGet Uganda Ltd', app: 'agent' },
    phrased: true,
    build: (p, w) => ({
      subject: w.say('mail.country-opened.subject', { country: p.country }),
      preheader: p.ready ? w.say('mail.country-opened.preheaderReady') : w.say('mail.country-opened.preheaderNotReady'),
      blocks: [
        { kind: 'heading', text: w.say('mail.country-opened.heading', { country: p.country }) },
        {
          kind: 'paragraph',
          text: p.ready ? w.say('mail.country-opened.ready') : w.say('mail.country-opened.notReady'),
        },
        p.company
          ? { kind: 'paragraph' as const, text: w.say('mail.country-opened.company', { company: p.company }) }
          : {
              kind: 'warning' as const,
              title: w.say('mail.country-opened.noMoneyTitle'),
              text: w.say('mail.country-opened.noMoneyText', { country: p.country }),
            },
        { kind: 'button', label: w.say('mail.country-opened.button'), href: appUrl(p.app) },
      ],
      reason: w.say('mail.country-opened.reason', { country: p.country }),
    }),
  },
  /*
   * A COMPANY OF OURS SWITCHED ON where people already worked with nobody of ours behind them (the user, 2026-10-25):
   * the promise the opening made — "when a company is established there, that changes" — kept, by the approval itself.
   */
  'country-established': {
    title: 'A company of ours now runs SeeBuyGet in your country',
    sentWhen: 'Two members of staff switch on a company of ours in a country that was already open — to everybody registered there who gave an email address, with the country’s terms naming it. The apps say it in their inbox as well.',
    wired: true,
    sendLater: 72,
    sample: { country: 'Uganda', company: 'SeeBuyGet Uganda Limited', asked: true, app: 'agent' },
    phrased: true,
    build: (p, w) => ({
      subject: w.say('mail.country-established.subject', { company: p.company, country: p.country }),
      preheader: w.say('mail.country-established.preheader', { country: p.country }),
      blocks: [
        { kind: 'heading', text: w.say('mail.country-established.heading', { company: p.company, country: p.country }) },
        { kind: 'paragraph', text: w.say('mail.country-established.fromToday', { company: p.company, country: p.country }) },
        {
          kind: 'paragraph',
          text: p.asked ? w.say('mail.country-established.termsAsked', { country: p.country }) : w.say('mail.country-established.termsRead', { country: p.country }),
        },
        { kind: 'button', label: w.say('mail.country-established.button'), href: appUrl(p.app) },
      ],
      reason: w.say('mail.country-established.reason', { country: p.country }),
    }),
  },
  /*
   * THE OTHER HALF OF THAT PROMISE: the waiting list was told, the day the country opened with nobody of ours behind the
   * money, "when a company is established there, that changes and we will write again" (country-open). This is that.
   */
  'country-settles': {
    title: 'A company of ours now runs SeeBuyGet in the country you asked about',
    sentWhen: 'Two members of staff switch on a company of ours in a country that opened without one — to the people who asked to be told about it and were told no company of ours was there yet, unless they have signed up there since.',
    wired: true,
    sendLater: 72,
    sample: { country: 'Uganda', company: 'SeeBuyGet Uganda Limited', joinUrl: 'https://seebuyget.com/' },
    phrased: true,
    build: (p, w) => ({
      subject: w.say('mail.country-settles.subject', { company: p.company, country: p.country }),
      preheader: w.say('mail.country-settles.preheader'),
      blocks: [
        { kind: 'heading', text: w.say('mail.country-settles.heading', { company: p.company, country: p.country }) },
        {
          kind: 'paragraph',
          text: w.say('mail.country-settles.body', { company: p.company, country: p.country }),
        },
        { kind: 'paragraph', text: w.say('mail.country-settles.signUp') },
        { kind: 'button', label: w.say('mail.country-settles.button'), href: p.joinUrl },
      ],
      reason: w.say('mail.country-settles.reason'),
    }),
  },
  'country-changed': {
    title: 'What changes in your country (shop, hub, store, fleet)',
    sentWhen: 'A change to a country takes something away — to everybody registered there who gave an email address. The apps say it in their inbox as well.',
    wired: true,
    // Sent once, when the change is made, and nothing sends it again: still worth having three days on.
    sendLater: 72,
    sample: {
      country: 'Uganda',
      lost: ['we no longer charge customers here — a local carrier prices and bills', 'a shop here can no longer keep a float with us', 'we cannot pay out here for now, so what is owed waits'],
      kept: ['Parcels already on a shelf stay there to be collected', 'What is owed to you stays owed'],
      app: 'agent',
    },
    phrased: true,
    build: (p, w) => ({
      subject: w.say('mail.country-changed.subject', { country: p.country }),
      preheader: w.say('mail.country-changed.preheader', { n: p.lost.length }),
      blocks: [
        { kind: 'heading', text: w.say('mail.country-changed.heading', { country: p.country }) },
        { kind: 'paragraph', text: w.say('mail.country-changed.fromToday') },
        // English starts each with a capital; another language writes its own sentence as it is.
        { kind: 'facts', rows: p.lost.map((l, i) => [String(i + 1), w.lang === 'en' ? w.text(l).replace(/^./, (c) => c.toUpperCase()) : w.text(l)] as [string, string]) },
        { kind: 'paragraph', text: w.say('mail.country-changed.unchanged') },
        { kind: 'facts', rows: p.kept.map((k, i) => [String(i + 1), w.text(k)] as [string, string]) },
        { kind: 'button', label: w.say('mail.country-changed.button'), href: appUrl(p.app) },
      ],
      reason: w.say('mail.country-changed.reason', { country: p.country }),
    }),
  },
  'order-on-its-way': {
    title: 'Order on its way (buyer)',
    sentWhen: 'A store hands an order to the network, to the email the buyer gave the store.',
    wired: true,
    // After a day the parcel is likely there, and the next email says so.
    sendLater: 24,
    sample: { store: 'Nairobi Threads', orderRef: '#10482', shop: 'Mama Sarah Shop', trackingUrl: 'http://localhost:5176/send/' },
    phrased: true,
    build: (p, w) => ({
      subject: w.say('mail.order-on-its-way.subject', { store: p.store }),
      preheader: w.say('mail.order-on-its-way.preheader', { shop: p.shop }),
      blocks: [
        { kind: 'heading', text: w.say('mail.order-on-its-way.heading') },
        {
          kind: 'paragraph',
          text: p.orderRef
            ? w.say('mail.order-on-its-way.sentRef', { store: p.store, ref: p.orderRef, shop: p.shop })
            : w.say('mail.order-on-its-way.sent', { store: p.store, shop: p.shop }),
        },
        { kind: 'button', label: w.say('mail.order-on-its-way.button'), href: p.trackingUrl },
        {
          kind: 'paragraph',
          text: w.say('mail.order-on-its-way.signIn'),
        },
        { kind: 'note', text: w.say('mail.order-on-its-way.note') },
      ],
      reason: w.say('mail.order-on-its-way.reason', { store: p.store }),
    }),
  },
  'freight-delivered': {
    title: 'Load delivered — receipt (shipper)',
    sentWhen: 'A driver delivers a load: to the email of the shop that posted it; for a business, to the person who posted it, or to its owners when that person cannot be emailed.',
    wired: true,
    // A receipt is for the books; its link works for a month.
    sendLater: 72,
    sample: { code: 'FRT-010', description: 'Maize, 20 sacks', destination: 'Riverside Corner', deliveredAt: '2026-09-14T12:04:00Z', carrier: 'Kilima Logistics', driver: 'Amos K.', receiverName: 'Wanjiru (Riverside Corner)', amount: 350, currency: 'KES', noteNumber: 'CMR-FRT-010', noteUrl: `${appUrl('home')}#doc=a-sample-key-that-opens-nothing-at-all-0000`, noteUntil: '2026-10-14T12:04:00Z' },
    also: [
      {
        key: 'business',
        label: 'as a business gets it',
        sample: { code: 'FRT-204', description: 'Cement, 12 pallets', destination: 'Thika Road Depot', deliveredAt: '2026-10-07T12:04:00Z', carrier: 'Kilima Logistics', driver: 'Amos K.', receiverName: 'Njeri (Thika Road Depot)', amount: 18500, currency: 'KES', noteNumber: 'CMR-FRT-204', noteUrl: `${appUrl('home')}#doc=a-sample-key-that-opens-nothing-at-all-0000`, noteUntil: '2026-11-06T12:04:00Z', business: { name: 'Abebe Import & Export PLC', as: 'poster' } },
      },
    ],
    phrased: true,
    build: (p, w) => {
      // A sum as English writes it ("350.00 KES"), said in each language's way where a currency is given.
      const price = p.amount != null ? w.text(p.currency ? money(`${p.amount.toFixed(2)} ${p.currency}`.trim(), p.amount, p.currency) : `${p.amount.toFixed(2)}`) : '';
      return {
        subject: w.say('mail.freight-delivered.subject', { code: p.code, description: p.description }),
        preheader: w.say('mail.freight-delivered.preheader', { destination: p.destination, when: w.when(p.deliveredAt) }),
        blocks: [
          { kind: 'heading', text: w.say('mail.freight-delivered.heading') },
          {
            kind: 'paragraph',
            text: p.driver
              ? w.say('mail.freight-delivered.deliveredDriver', { carrier: p.carrier, driver: p.driver, code: p.code, description: p.description, destination: p.destination })
              : w.say('mail.freight-delivered.delivered', { carrier: p.carrier, code: p.code, description: p.description, destination: p.destination }),
          },
          {
            kind: 'facts',
            rows: [
              [w.say('mail.freight-delivered.factLoad'), p.code],
              [w.say('mail.freight-delivered.factDelivered'), w.when(p.deliveredAt)],
              ...(p.receiverName ? [[w.say('mail.freight-delivered.factReceivedBy'), p.receiverName] as [string, string]] : []),
              ...(p.reservations ? [[w.say('mail.freight-delivered.factFound'), w.text(p.reservations)] as [string, string]] : []),
              [w.say('mail.freight-delivered.factCarrier'), w.text(p.carrier)],
              ...(p.amount != null ? [[p.business ? w.say('mail.freight-delivered.factPriceAgreed') : w.say('mail.freight-delivered.factCharges'), price] as [string, string]] : []),
              [w.say('mail.freight-delivered.factNote'), p.noteNumber],
            ],
          },
          ...(p.noteUrl
            ? ([
                { kind: 'paragraph', text: w.say('mail.freight-delivered.noteWithPhotos') },
                { kind: 'button', label: w.say('mail.freight-delivered.getNote'), href: p.noteUrl },
                {
                  kind: 'warning',
                  title: w.say('mail.freight-delivered.linkTitle'),
                  text: w.say('mail.freight-delivered.linkText', {
                    opens: p.noteUntil ? said('mail.freight-delivered.opensUntil', { when: w.when(p.noteUntil) }) : said('mail.freight-delivered.opensNow'),
                    where: p.business ? said('mail.freight-delivered.whereBusiness', { app: w.app('business') }) : said('mail.freight-delivered.whereShop', { app: w.app('agent') }),
                  }),
                },
              ] as MailBlock[])
            : p.business
              ? ([
                  { kind: 'paragraph', text: w.say('mail.freight-delivered.noteInBusiness', { app: w.app('business') }) },
                  { kind: 'button', label: w.say('mail.freight-delivered.openApp', { app: w.app('business') }), href: appUrl('business') },
                ] as MailBlock[])
              : ([
                  { kind: 'paragraph', text: w.say('mail.freight-delivered.noteInShop', { app: w.app('agent') }) },
                  { kind: 'button', label: w.say('mail.freight-delivered.openApp', { app: w.app('agent') }), href: appUrl('agent') },
                ] as MailBlock[])),
          // We never handle a business's payments (the user, 2026-10-04): a figure in a receipt must not read as our bill.
          ...(p.business && p.amount != null
            ? ([{ kind: 'note', text: w.say('mail.freight-delivered.notInvoice', { business: p.business.name }) }] as MailBlock[])
            : []),
          { kind: 'note', text: w.say('mail.freight-delivered.somethingWrong') },
        ],
        reason: !p.business
          ? w.say('mail.freight-delivered.reasonShop')
          : p.business.as === 'poster'
            ? w.say('mail.freight-delivered.reasonPoster', { business: p.business.name })
            : w.say('mail.freight-delivered.reasonOwner', { business: p.business.name }),
      };
    },
  },
  /*
   * TO AN INSURER, who may never have heard of SeeBuyGet. The user, 2026-10-12: the report goes "to an insurer of the
   * claimants choice, to the claimant themselves or one set by the vendor according to their shipping policy" — and
   * 2026-10-13, that sending it is "only emailing a link". So the email says what SeeBuyGet is and is not, what the
   * report holds, and that the claim itself is the store's and theirs: nothing here decides anything or offers to pay.
   */
  'damage-report': {
    title: 'Damage claim report (a store’s insurer)',
    sentWhen: 'A problem is reported on one of a store’s shipments and the store names an insurer on its shipping policy: to that insurer, the moment the report is made.',
    wired: true,
    // The link works for a month; a report three days late is still the report.
    sendLater: 72,
    sample: { number: 'DCR-PUD-40257F1F7F', parcelId: 'PUD-40257F1F7F', orderNumber: 'ORD-20481', store: 'Nairobi Threads', insurer: 'Jubilee Allianz Claims', reportedAt: '2026-10-12T09:30:00Z', by: 'receiver', problem: 'The screen is cracked from corner to corner', from: 'Mama Sarah Shop, Nairobi CBD', to: 'Riverside Corner, Westlands', url: 'https://seebuyget.com/#report=k3ZbQp8vR1tYw0xLm2nHc4dJf6sAe9uGiB7oVzXyT5q', until: '2026-11-11T09:30:00Z' },
    phrased: true,
    build: (p, w) => ({
      subject: p.orderNumber
        ? w.say('mail.damage-report.subjectOrder', { number: p.number, store: p.store, order: p.orderNumber })
        : w.say('mail.damage-report.subject', { number: p.number, store: p.store }),
      preheader: w.say('mail.damage-report.preheader', { store: p.store }),
      reason: w.say('mail.damage-report.reason', { store: p.store, insurer: p.insurer }),
      blocks: [
        { kind: 'heading', text: w.say('mail.damage-report.heading', { store: p.store }) },
        { kind: 'paragraph', text: w.say('mail.damage-report.intro', { store: p.store, insurer: p.insurer }) },
        {
          kind: 'facts',
          rows: [
            [w.say('mail.damage-report.factReport'), p.number],
            [w.say('mail.damage-report.factStore'), p.store],
            ...(p.orderNumber ? [[w.say('mail.damage-report.factOrder'), p.orderNumber] as [string, string]] : []),
            [w.say('mail.damage-report.factParcel'), p.parcelId],
            [w.say('mail.damage-report.factFrom'), p.from],
            [w.say('mail.damage-report.factTo'), p.to],
            [w.say('mail.damage-report.factReported'), w.when(p.reportedAt)],
            [w.say('mail.damage-report.factBy'), p.by === 'shop' ? w.say('mail.damage-report.byShop') : w.say('mail.damage-report.byReceiver')],
            [w.say('mail.damage-report.factWords'), p.problem],
          ],
        },
        { kind: 'paragraph', text: w.say('mail.damage-report.file') },
        { kind: 'button', label: w.say('mail.damage-report.button'), href: p.url },
        { kind: 'warning', title: w.say('mail.damage-report.linkTitle'), text: w.say('mail.damage-report.linkText', { when: w.when(p.until) }) },
        { kind: 'note', text: w.say('mail.damage-report.note', { store: p.store }) },
      ],
    }),
  },
  'load-delivery-code': {
    title: 'A load is coming: its delivery code (receiver)',
    sentWhen: 'A load a person paid for first names who receives it, by email, and that person has no Send app on its number (plan R2, 2026-11-15).',
    wired: true,
    // Wanted until the load arrives, which may be a day or more on the road.
    sendLater: 24,
    sample: { code: '482915', load: 'LD-2041 · A fridge, upright', from: 'Wanjiru K.', name: 'Achieng Otieno', openUrl: 'https://seebuyget.com/send/' },
    phrased: true,
    build: (p, w) => ({
      subject: w.say('mail.load-delivery-code.subject', { code: p.code }),
      preheader: w.say('mail.load-delivery-code.preheader'),
      blocks: [
        { kind: 'heading', text: w.say('mail.load-delivery-code.heading') },
        { kind: 'facts', rows: [[w.say('mail.load-delivery-code.factWhat'), p.load], [w.say('mail.load-delivery-code.factFrom'), p.from], [w.say('mail.load-delivery-code.factCode'), p.code], ...(p.name ? ([[w.say('mail.load-delivery-code.factName'), p.name]] as Array<[string, string]>) : [])] },
        { kind: 'paragraph', text: p.name ? w.say('mail.load-delivery-code.arrivesName', { name: p.name }) : w.say('mail.load-delivery-code.arrives') },
        { kind: 'button', label: w.say('mail.load-delivery-code.button'), href: p.openUrl },
        { kind: 'warning', title: w.say('mail.load-delivery-code.warnTitle'), text: w.say('mail.load-delivery-code.warnText') },
      ],
      reason: w.say('mail.load-delivery-code.reason'),
    }),
  },
  'ready-for-collection': {
    title: 'Ready to collect (buyer)',
    sentWhen: 'A parcel is shelved at the collection shop, to the email the buyer gave the store.',
    wired: true,
    // The parcel waits for days.
    sendLater: 48,
    sample: { shop: 'Mama Sarah Shop', address: 'Biashara St 12, Nairobi', collectBy: '2026-09-20T18:00:00Z' },
    phrased: true,
    build: (p, w) => ({
      // 2026-11-15 — a code reissued after it was emailed: the new one, said as new (the old one no longer works).
      subject: p.reissued ? w.say('mail.ready-for-collection.subjectReissued', { shop: p.shop }) : w.say('mail.ready-for-collection.subject', { shop: p.shop }),
      preheader: w.say('mail.ready-for-collection.preheader', { date: w.date(p.collectBy) }),
      blocks: [
        { kind: 'heading', text: p.reissued ? w.say('mail.ready-for-collection.headingReissued') : w.say('mail.ready-for-collection.heading') },
        ...(p.reissued ? [{ kind: 'paragraph' as const, text: w.say('mail.ready-for-collection.reissued') }] : []),
        { kind: 'facts', rows: [[w.say('mail.ready-for-collection.factWhere'), p.address ? `${p.shop}, ${p.address}` : p.shop], [w.say('mail.ready-for-collection.factBy'), w.date(p.collectBy)]] },
        ...(p.code
          ? // 2026-11-15 — the store chose to email the code (plan R3): with the name the counter checks it against.
            [
              { kind: 'facts' as const, rows: [[w.say('mail.ready-for-collection.factCode'), p.code], [w.say('mail.ready-for-collection.factName'), p.name ?? '']] as Array<[string, string]> },
              { kind: 'paragraph' as const, text: w.say('mail.ready-for-collection.sayCode', { name: p.name ?? said('mail.ready-for-collection.onTheOrder') }) },
              { kind: 'button' as const, label: w.say('mail.ready-for-collection.button'), href: p.openUrl ?? appUrl('send') },
              { kind: 'warning' as const, title: w.say('mail.ready-for-collection.warnTitle'), text: w.say('mail.ready-for-collection.warnText') },
            ]
          : [
              { kind: 'paragraph' as const, text: w.say('mail.ready-for-collection.openApp') },
              { kind: 'button' as const, label: w.say('mail.ready-for-collection.button'), href: p.openUrl ?? appUrl('send') },
              { kind: 'note' as const, text: w.say('mail.ready-for-collection.appOnly') },
            ]),
      ],
      reason: w.say('mail.ready-for-collection.reason'),
    }),
  },
};
