import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { AuthImage, Icon } from '../../../shared/ui';
import { formatDate, useT, type MessageKey, type Translate } from '../../../shared/i18n';
import type { components } from '../../../lib/sbg/schema';
import { ConsoleDetail } from '../ConsoleDetail';
import { initials } from '../ConsoleMenu';
import { DocumentStrip } from './DocumentStrip';
import { TransitPanel } from './TransitPanel';
import { OperatorPapersPanel } from './OperatorPapers';
import { DeclarationsPanel } from './DeclarationsPanel';
import { ShopLicencesPanel } from './ShopLicences';
import { useCountryAtlas } from './CountrySelect';
import { paperDay, paperLine, papersToShow, renewalBlocker } from '../../../shared/papers';
import { isStuck, type CourierContact, type CourierPaperRow, type LooseVehicleRow } from '../papers';
import type { TowerActions, TowerState } from '../useTowerApp';

/**
 * FP4 — the papers only network staff can put right.
 *
 * A fleet records its own renewals in the Fleet app. A courier who rides without a fleet, and a vehicle no
 * fleet owns, have no office to do that for them: a licence that lapses puts them off the road with nobody
 * to tell. This screen is that office. It also runs the six-hourly check by hand and says when it last ran —
 * a check that is silent is indistinguishable from one that is not running.
 *
 * THE COURIERS ARE PEOPLE, NOT A TABLE. Each is a row — a face, a name, the one fact that says whether to
 * open them — and opening one gives the whole person: the card they sent, how to reach them, what they
 * ride. The table this replaced put a "Record licence" button on every line and, behind it, a form that
 * asked for a date while showing no licence at all, because none could ever arrive: a courier without a
 * fleet had no way to send one. They send it from the driver app now, and it is the first thing here.
 */
export function PapersScreen({ state, actions }: { state: TowerState; actions: TowerActions }) {
  const t = useT();
  const r = state.papers;
  const stuckCouriers = r?.couriers.filter(isStuck).length ?? 0;
  const stuckVehicles = r?.vehicles.filter(isStuck).length ?? 0;
  const cards = r?.couriers.filter((c) => c.renewal).length ?? 0;
  const atlas = useCountryAtlas(actions.client()?.api as never);
  const countryName = (code?: string) => (code ? (atlas.find((c) => c.code === code)?.name ?? code) : '');
  // One row open at a time across both lists — the console's own open-row state, keyed by what each is.
  const openCourier = r?.couriers.find((c) => c.did === state.openId) ?? null;
  const openVehicle = r?.vehicles.find((v) => v.vehicleId === state.openId) ?? null;

  return (
    <>
      <header class="cons__head">
        <h1 class="cons__title">{t('tower.papers.title')}</h1>
        <p class="cons__lede">{t('tower.papers.lede')}</p>
      </header>

      {state.done ? (
        <p class="twr-done">
          <Icon name="check" size={16} />
          {state.done}
        </p>
      ) : null}
      {state.queueError ? (
        <p class="cerr" style="margin:0 0 12px">
          <b>{t('tower.papers.refused')}</b> — {state.queueError}
        </p>
      ) : null}
      {state.error ? (
        <p class="cerr" style="margin:0 0 12px">
          <b>{t('tower.papers.failedTitle')}</b> — {state.error.detail || state.error.title}
        </p>
      ) : null}

      {/* BL1 — who may carry uncleared goods. First, because it is the only paper here that fails in
          complete silence: a lapsed one does not ground a truck, it just stops the offers arriving. */}
      <TransitPanel
        transit={r?.transit ?? []}
        carriers={r?.carriers ?? []}
        busyId={state.busyId ?? null}
        atlasApi={actions.client()?.api as never}
        onRecord={(carrier, body) => actions.recordTransitAuthority(carrier.did, body, carrier.name)}
        onWithdraw={(carrierDid, authorityId, reason) => actions.withdrawTransitAuthority(carrierDid, authorityId, reason)}
      />

      {/* Round 39 — the yearly security declarations: who takes on nothing new because theirs is not in force. */}
      <DeclarationsPanel actions={actions} />

      {/* Round 40 — the shops' trading licences: a renewed one sent comes first, then those whose new parcels have stopped. */}
      <ShopLicencesPanel rows={r === null ? null : (r.shops ?? [])} state={state} actions={actions} />

      {/* The check itself — when it last looked, and a way to make it look now. */}
      <section class="cons__panel">
        <div class="cons__panelhead">
          <span class="cons__panelt">{t('tower.papers.sweepTitle')}</span>
          <span class="twr-panelend">
            <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => void actions.runPapersSweep()} disabled={state.busyId === 'sweep' || r === null}>
              <Icon name="refresh" size={16} />
              {t('tower.papers.sweepRun')}
            </button>
          </span>
        </div>
        <p class="cons__empty" style="text-align:left">
          {r === null
            ? t('tower.papers.loading')
            : r.sweep
              ? t('tower.papers.sweepLast', { time: new Date(r.sweep.at).toLocaleString(), shifts: r.sweep.shiftsEnded, told: r.sweep.notified, mails: r.sweep.mails, hours: r.sweepEveryHours })
              : t('tower.papers.sweepNever', { hours: r.sweepEveryHours })}
        </p>
        {r ? (
          <p class="cons__empty" style="text-align:left;padding-top:0">
            {t('tower.papers.fleetsLine', { count: r.fleets.count, withLapsed: r.fleets.withLapsed, lapsed: r.fleets.lapsed, due: r.fleets.due })}
          </p>
        ) : null}
      </section>

      {/* Couriers without a fleet — a card waiting to be read comes first; the server sorts it there. */}
      <section class="cons__panel">
        <div class="cons__panelhead">
          <span class="cons__panelt">{t('tower.papers.couriersTitle', { n: r?.couriers.length ?? 0, stuck: stuckCouriers })}</span>
          {cards ? <span class="ctag ctag--warn">{t('tower.papers.cardsWaiting', { n: cards })}</span> : null}
        </div>
        {r === null ? (
          <p class="cons__empty">{t('tower.papers.loading')}</p>
        ) : r.couriers.length === 0 ? (
          <div class="cons__empty">
            <p class="cons__emptyt">{t('tower.papers.noCouriersTitle')}</p>
            <p>{t('tower.papers.noCouriersBody')}</p>
          </div>
        ) : (
          <div class="crows">
            {r.couriers.map((row) => (
              <CourierRow key={row.did} row={row} on={state.openId === row.did} actions={actions} />
            ))}
          </div>
        )}
      </section>
      {openCourier ? (
        <ConsoleDetail openKey={openCourier.did} title={t('tower.papers.sheetTitle')} onClose={() => actions.open(null)}>
          <CourierSheet row={openCourier} state={state} actions={actions} countryName={countryName} />
        </ConsoleDetail>
      ) : null}

      {/* Vehicles no fleet owns — the same shape: a row per vehicle, its papers behind it. */}
      <section class="cons__panel">
        <div class="cons__panelhead">
          <span class="cons__panelt">{t('tower.papers.vehiclesTitle', { n: r?.vehicles.length ?? 0, stuck: stuckVehicles })}</span>
        </div>
        {r === null ? (
          <p class="cons__empty">{t('tower.papers.loading')}</p>
        ) : r.vehicles.length === 0 ? (
          <div class="cons__empty">
            <p class="cons__emptyt">{t('tower.papers.noVehiclesTitle')}</p>
            <p>{t('tower.papers.noVehiclesBody')}</p>
          </div>
        ) : (
          <div class="crows">
            {r.vehicles.map((row) => (
              <VehicleRow key={row.vehicleId} row={row} on={state.openId === row.vehicleId} actions={actions} />
            ))}
          </div>
        )}
      </section>
      {openVehicle ? (
        <ConsoleDetail openKey={openVehicle.vehicleId} title={t('tower.papers.vehicleSheetTitle')} onClose={() => actions.open(null)}>
          <VehicleSheet row={openVehicle} state={state} actions={actions} />
        </ConsoleDetail>
      ) : null}

      {/* The fleet OPERATORS' own papers — shown whatever any sister enforces. */}
      <OperatorPapersPanel state={state} actions={actions} />
    </>
  );
}

/* ------------------------------------------------------------ vocabulary -- */

type VehicleClass = components['schemas']['RegisterDriverDto']['licenceClasses'];

/**
 * What somebody rides, in words. Keyed by the CONTRACT's own list of classes, so a class added on the
 * server fails the typecheck here instead of printing its code on a screen.
 */
const CLASS_WORDS: Record<VehicleClass, MessageKey> = {
  bike: 'tower.papers.class.bike',
  motorcycle: 'tower.papers.class.motorcycle',
  tuktuk: 'tower.papers.class.tuktuk',
  car: 'tower.papers.class.car',
  van: 'tower.papers.class.van',
  bus: 'tower.papers.class.bus',
  truck: 'tower.papers.class.truck',
};

function classWord(c: string, t: Translate): string {
  return c in CLASS_WORDS ? t(CLASS_WORDS[c as VehicleClass]) : c;
}

function classWords(classes: string[] | undefined, t: Translate): string {
  return (classes ?? []).map((c) => classWord(c, t)).join(', ');
}

/** Where a courier stands with the network, in words. A status this screen does not know is shown as it came. */
function statusWord(status: string, t: Translate): string {
  if (status === 'ACTIVE') return t('tower.papers.statusActive');
  if (status === 'KYC_PENDING') return t('tower.papers.statusVetting');
  if (status === 'DRAFT') return t('tower.papers.statusDraft');
  return status;
}

/** The one state worth a tag on a row: a card to read, off the road, or running out. Quiet otherwise. */
function courierTag(row: CourierPaperRow): { cls: string; key: MessageKey } | null {
  if (row.renewal) return { cls: 'ctag--warn', key: 'tower.papers.tagCard' };
  if (isStuck(row)) return { cls: 'ctag--danger', key: 'tower.papers.tagOffRoad' };
  if (row.papers.some((p) => p.kind === 'licence' && p.state === 'due')) return { cls: 'ctag--warn', key: 'tower.papers.tagDue' };
  return null;
}

function vehicleTag(row: LooseVehicleRow): { cls: string; key: MessageKey } | null {
  if (isStuck(row)) return { cls: 'ctag--danger', key: 'tower.papers.tagOffRoad' };
  if (row.papers.some((p) => p.state === 'due')) return { cls: 'ctag--warn', key: 'tower.papers.tagDue' };
  return null;
}

/* ----------------------------------------------------------------- parts -- */

/** A label over a value — one fact — and, when it needs one, a quiet line under it. */
export function Fig({ label, sub, children }: { label: string; sub?: string; children: ComponentChildren }) {
  return (
    <div class="twr-fig">
      <span class="twr-fig__l">{label}</span>
      <span class="twr-fig__v">{children}</span>
      {sub ? <span class="chint">{sub}</span> : null}
    </div>
  );
}

/** How far a dated paper is from its day, in days — said under the date, never instead of it. */
function daysWord(p: { state: string; daysLeft?: number } | undefined, t: Translate): string | undefined {
  if (!p || p.daysLeft == null) return undefined;
  if (p.state === 'lapsed') return t('tower.papers.lapsedAgo', { n: Math.abs(p.daysLeft) });
  return t('tower.papers.daysLeft', { n: p.daysLeft });
}

/**
 * A person's face: their badge portrait when they have one, their initials when they do not — or when the
 * portrait cannot be produced, which is said by the initials coming back rather than by a broken tile.
 */
function Face({ name, mediaId, actions, large }: { name: string; mediaId?: string; actions: TowerActions; large?: boolean }) {
  const client = actions.client();
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [mediaId]);
  const cls = `cface${large ? ' cface--lg' : ''}`;
  if (mediaId && client && !failed) {
    return (
      <span class={cls} aria-hidden="true">
        <AuthImage
          mediaId={mediaId}
          load={(id) => client.api.mediaBlob(id, 'thumb') as Promise<{ data: Blob | null; error: unknown }>}
          alt=""
          class="cface__img"
          onFailed={() => setFailed(true)}
        />
      </span>
    );
  }
  return (
    <span class={cls} aria-hidden="true">
      {initials(name)}
    </span>
  );
}

/**
 * A CARD TO BE READ. The full image at the width of the sheet — a thumbnail is for recognising a thing,
 * and this is eight small digits somebody is about to put a courier back on the road on. Pressing it
 * opens the photograph at its own size, never downloaded: it is somebody's licence, and the retention
 * clock owns the only copy.
 */
export function CardPhoto({ mediaId, name, actions }: { mediaId: string; name: string; actions: TowerActions }) {
  const t = useT();
  const client = actions.client();
  const [gone, setGone] = useState(false);
  useEffect(() => setGone(false), [mediaId]);
  if (!client) return null;
  if (gone) {
    return (
      <p class="cons__caveat">
        <Icon name="warning" size={16} />
        <span>{t('tower.papers.cardGone')}</span>
      </p>
    );
  }
  return (
    <button
      type="button"
      class="twr-cardphoto"
      title={t('tower.papers.cardOpen')}
      aria-label={t('tower.papers.cardOpen')}
      onClick={async () => {
        const r = await client.api.mediaBlob(mediaId);
        const blob = r.error ? null : (r.data as unknown as Blob | null);
        if (blob) window.open(URL.createObjectURL(blob), '_blank', 'noopener');
      }}
    >
      <AuthImage
        mediaId={mediaId}
        load={(id) => client.api.mediaBlob(id) as Promise<{ data: Blob | null; error: unknown }>}
        alt={t('tower.papers.cardAlt', { name })}
        class="twr-cardphoto__img"
        onFailed={() => setGone(true)}
      />
    </button>
  );
}

/* -------------------------------------------------------------- couriers -- */

function CourierRow({ row, on, actions }: { row: CourierPaperRow; on: boolean; actions: TowerActions }) {
  const t = useT();
  const licence = row.papers.find((p) => p.kind === 'licence');
  const tag = courierTag(row);
  // The subtitle is STATE: the card waiting, or what the licence date is doing today — then what they ride,
  // which is what makes "no date recorded" read as fine for a bicycle and as a gap for a motorcycle.
  const state = row.renewal ? t('tower.papers.cardSentRow', { date: formatDate(row.renewal.sentAt) }) : licence ? paperLine(licence, t) : t('tower.papers.noDate');
  const rides = classWords(row.classes, t);
  return (
    <button type="button" class={`crow${on ? ' crow--on' : ''}`} aria-expanded={on} onClick={() => actions.open(on ? null : row.did)}>
      <Face name={row.displayName} mediaId={row.portraitRef} actions={actions} />
      <span class="crow__body">
        <span class="crow__top">
          <span class="crow__name">{row.displayName}</span>
          {/* Two couriers called "Peer D." are told apart by the badge each carries. */}
          {row.badgeId ? <span class="crow__id">{row.badgeId}</span> : null}
          {tag ? <span class={`ctag ${tag.cls}`}>{t(tag.key)}</span> : null}
        </span>
        <span class="crow__sub">{rides ? `${state} · ${rides}` : state}</span>
      </span>
      <span class="crow__tail">
        <Icon name="chevronRight" size={16} />
      </span>
    </button>
  );
}

/**
 * ONE COURIER, WHOLE: the card first (it is why somebody opens a row that carries a tag), then how to reach
 * them, then what else there is to know.
 *
 * The contact is ASKED FOR HERE, when this sheet opens, and kept only in this component. The server
 * reveals it from the identity vault with a receipt against this staff account — one courier per look —
 * and a phone number copied into the console's state would outlive the look that was receipted for it.
 */
function CourierSheet({ row, state, actions, countryName }: { row: CourierPaperRow; state: TowerState; actions: TowerActions; countryName: (code?: string) => string }) {
  const t = useT();
  const tag = courierTag(row);
  const [contact, setContact] = useState<{ contact: CourierContact | null; error: string | null } | null>(null);
  useEffect(() => {
    let live = true;
    setContact(null);
    void actions.courierContact(row.did).then((c) => {
      if (live) setContact(c);
    });
    return () => {
      live = false;
    };
  }, [row.did]);
  const rides = classWords(row.classes, t);

  return (
    <>
      <div class="twr-person">
        <Face name={row.displayName} mediaId={row.portraitRef} actions={actions} large />
        <div class="twr-person__body">
          <p class="twr-person__name">{row.displayName}</p>
          <p class="twr-person__sub">{[row.badgeId ? t('tower.papers.badge', { id: row.badgeId }) : '', rides, countryName(row.jurisdiction)].filter(Boolean).join(' · ')}</p>
        </div>
        {tag ? <span class={`ctag ${tag.cls}`}>{t(tag.key)}</span> : null}
      </div>

      <LicenceSection row={row} state={state} actions={actions} />

      <section class="cons__panel">
        <div class="cons__panelhead">
          <span class="cons__panelt">{t('tower.papers.sec.contact')}</span>
        </div>
        {contact === null ? (
          <p class="chint">{t('tower.papers.loading')}</p>
        ) : contact.error ? (
          <p class="cerr">
            <b>{t('tower.papers.contactFailed')}</b> — {contact.error}
          </p>
        ) : !contact.contact?.held ? (
          <p class="cons__caveat">
            <Icon name="info" size={16} />
            <span>{t('tower.papers.contactNone')}</span>
          </p>
        ) : (
          <>
            <div class="twr-facts">
              {contact.contact.fullName ? <Fig label={t('tower.papers.legalName')}>{contact.contact.fullName}</Fig> : null}
              {contact.contact.phone ? (
                <Fig label={t('tower.papers.phone')}>
                  <a class="twr-link" href={`tel:${contact.contact.phone.replace(/\s+/g, '')}`}>
                    {contact.contact.phone}
                  </a>
                </Fig>
              ) : null}
            </div>
            <p class="chint">{t('tower.papers.contactReceipt')}</p>
          </>
        )}
      </section>

      <section class="cons__panel">
        <div class="cons__panelhead">
          <span class="cons__panelt">{t('tower.papers.sec.details')}</span>
        </div>
        <div class="twr-facts">
          <Fig label={t('tower.papers.rides')}>{rides || t('tower.papers.unknown')}</Fig>
          <Fig label={t('tower.papers.country')}>{countryName(row.jurisdiction) || t('tower.papers.unknown')}</Fig>
          <Fig label={t('tower.papers.status')}>{statusWord(row.status, t)}</Fig>
          <Fig label={t('tower.papers.rightNow')}>{row.onShift ? t('tower.papers.onShiftShort') : t('tower.papers.offShiftShort')}</Fig>
          <Fig label={t('tower.papers.hasDriven')}>{row.drives.length ? row.drives.join(', ') : '—'}</Fig>
        </div>
      </section>
    </>
  );
}

/**
 * THE LICENCE, and what its date was read from.
 *
 * With a card sent: the card, large, what they read off it, and the two decisions — record the date YOU
 * read, or refuse it with a reason they will be shown. The courier's date is shown beside the field and
 * never typed into it: it is their word, and the date is there to replace their word.
 *
 * Without one: what is on record and where it came from, then how a card reaches this screen. Recording a
 * date with no card stays possible — somebody may have the courier in front of them — but it is the
 * smaller control, and it says in the warning colour what it is doing.
 */
function LicenceSection({ row, state, actions }: { row: CourierPaperRow; state: TowerState; actions: TowerActions }) {
  const t = useT();
  const [mode, setMode] = useState<'view' | 'record' | 'refuse'>('view');
  useEffect(() => setMode('view'), [row.did, row.renewal?.copyRef]);
  const card = row.renewal;
  const licence = row.papers.find((p) => p.kind === 'licence');
  const onRecord = row.licence;
  const provenance = onRecord.recordedAt
    ? t(onRecord.copyRef ? 'tower.papers.readFromCard' : 'tower.papers.readFromWord', { who: onRecord.recordedBy ?? '—', date: formatDate(onRecord.recordedAt) })
    : t('tower.papers.readFromUnknown');

  return (
    <section class="cons__panel">
      <div class="cons__panelhead">
        <span class="cons__panelt">{t(card ? 'tower.papers.sec.card' : 'tower.papers.sec.licence')}</span>
      </div>

      {card ? (
        <>
          {/* What they say first, then the card to check it against. Also the order the section rule wants:
              the first thing under a heading takes its top air as PADDING, which inside a framed photo drew
              a grey band across the top of the card. */}
          <p class="cons__lede">
            {t('tower.papers.cardRead', { date: formatDate(card.sentAt), expires: paperDay(card.expiresAt) })}
            {card.number ? ` ${t('tower.papers.cardNumber', { number: card.number })}` : ''}
          </p>
          <CardPhoto mediaId={card.copyRef} name={row.displayName} actions={actions} />
          {mode === 'refuse' ? (
            <RefuseForm row={row} state={state} actions={actions} onCancel={() => setMode('view')} />
          ) : (
            <RecordForm row={row} state={state} actions={actions} onRefuse={() => setMode('refuse')} />
          )}
        </>
      ) : (
        <>
          <div class="twr-facts">
            <Fig label={t('tower.papers.number')}>{onRecord.number ?? t('tower.papers.unknown')}</Fig>
            <Fig label={t('tower.papers.runsOut')} sub={daysWord(licence, t)}>
              {onRecord.expiresAt ? paperDay(onRecord.expiresAt) : t('tower.papers.unknown')}
            </Fig>
            {onRecord.expiresAt ? <Fig label={t('tower.papers.readFrom')}>{provenance}</Fig> : null}
          </div>
          {onRecord.copyRef ? (
            <DocumentStrip refs={[onRecord.copyRef]} state={state} actions={actions} titleKey="tower.papers.readFromPhoto" emptyKey="tower.papers.licenceNoProof" />
          ) : null}
          {row.renewalRefusal ? (
            <p class="cons__caveat">
              <Icon name="info" size={16} />
              <span>{t('tower.papers.lastRefused', { reason: row.renewalRefusal.reason, who: row.renewalRefusal.by ?? '—', date: formatDate(row.renewalRefusal.at) })}</span>
            </p>
          ) : null}
          {/* Only a date can run out, so only a courier with one can be asked for a renewal. Without one,
              the true sentence is that nothing is being watched — for a bicycle that is fine, for a
              motorcycle it is a gap, and either way it is not "they will send it when it runs out". */}
          <p class="chint">{t(onRecord.expiresAt ? 'tower.papers.nothingSent' : 'tower.papers.noDateWatched')}</p>
          {/* Heavy registry only: the card they were vetted on. Useful to compare a face or a number with,
              and labelled for what it is — it shows the date at vetting, never a renewal. */}
          {row.documents?.licenceCopyRef ? (
            <DocumentStrip refs={[row.documents.licenceCopyRef]} state={state} actions={actions} titleKey="tower.papers.vetted" emptyKey="tower.papers.licenceNoProof" />
          ) : null}
          {mode === 'record' ? (
            <RecordForm row={row} state={state} actions={actions} onCancel={() => setMode('view')} />
          ) : (
            <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => setMode('record')}>
              {t('tower.papers.withoutPhoto')}
            </button>
          )}
        </>
      )}
    </section>
  );
}

/**
 * The date, recorded by staff who have read it. From a card: the field is labelled as YOUR reading, and a
 * date that differs from theirs is pointed out before it is saved — two readings of one photograph that
 * disagree are worth a second look, and neither is assumed to be the right one. Without a card: the
 * warning that this date rests on nobody's photograph, above the fields rather than after the save.
 */
function RecordForm({ row, state, actions, onCancel, onRefuse }: { row: CourierPaperRow; state: TowerState; actions: TowerActions; onCancel?: () => void; onRefuse?: () => void }) {
  const t = useT();
  const card = row.renewal;
  const [number, setNumber] = useState(card?.number ?? row.licence.number ?? '');
  const [expiresAt, setExpiresAt] = useState('');
  const blocker = renewalBlocker(expiresAt);
  const busy = state.busyId === row.did;
  const differs = Boolean(card && expiresAt && !blocker && expiresAt !== card.expiresAt);
  return (
    <div class="twr-clear">
      {!card ? (
        <p class="cons__caveat">
          <Icon name="warning" size={16} />
          <span>{t('tower.papers.licenceNoProof')}</span>
        </p>
      ) : null}
      <div class="twr-facts">
        <label class="cfield">
          <span class="cfield__label">{t('tower.papers.licenceNumber')}</span>
          <input class="cinput" value={number} autoComplete="off" onInput={(e) => setNumber((e.target as HTMLInputElement).value)} />
        </label>
        <label class="cfield">
          <span class="cfield__label">{t(card ? 'tower.papers.readDate' : 'tower.papers.licenceExpires')}</span>
          <input class="cinput" type="date" value={expiresAt} onInput={(e) => setExpiresAt((e.target as HTMLInputElement).value)} />
        </label>
      </div>
      {differs && card ? (
        <p class="cons__caveat">
          <Icon name="warning" size={16} />
          <span>{t('tower.papers.differs', { expires: paperDay(card.expiresAt) })}</span>
        </p>
      ) : null}
      <div class="twr-clear__act">
        <button
          type="button"
          class="cbtn cbtn--primary"
          disabled={blocker !== null || busy}
          onClick={() => {
            const n = number.trim();
            void actions.recordCourierLicence(row.did, { expiresAt, ...(n && n !== row.licence.number ? { number: n } : {}) }, row.displayName);
          }}
        >
          {t('tower.papers.saveLicence')}
        </button>
        {onRefuse ? (
          <button type="button" class="cbtn cbtn--ghost" onClick={onRefuse} disabled={busy}>
            {t('tower.papers.refuseCard')}
          </button>
        ) : null}
        {onCancel ? (
          <button type="button" class="cbtn cbtn--ghost" onClick={onCancel} disabled={busy}>
            {t('tower.papers.cancel')}
          </button>
        ) : null}
        {blocker && expiresAt ? <span class="chint">{t(blocker)}</span> : null}
      </div>
    </div>
  );
}

/** Not accepted — in a sentence the courier will read, because a refusal they cannot act on is silence. */
function RefuseForm({ row, state, actions, onCancel }: { row: CourierPaperRow; state: TowerState; actions: TowerActions; onCancel: () => void }) {
  const t = useT();
  const [reason, setReason] = useState('');
  const busy = state.busyId === row.did;
  return (
    <div class="twr-clear">
      <label class="cfield">
        <span class="cfield__label">{t('tower.papers.refuseWhy')}</span>
        <textarea class="ctextarea" value={reason} maxLength={500} onInput={(e) => setReason((e.target as HTMLTextAreaElement).value)} />
      </label>
      <div class="twr-clear__act">
        <button type="button" class="cbtn cbtn--danger" disabled={!reason.trim() || busy} onClick={() => void actions.refuseLicenceRenewal(row.did, reason.trim(), row.displayName)}>
          {t('tower.papers.refuseSend')}
        </button>
        <button type="button" class="cbtn cbtn--ghost" onClick={onCancel} disabled={busy}>
          {t('tower.papers.cancel')}
        </button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- vehicles -- */

function VehicleRow({ row, on, actions }: { row: LooseVehicleRow; on: boolean; actions: TowerActions }) {
  const t = useT();
  const tag = vehicleTag(row);
  const shown = papersToShow(row.papers);
  const state = shown.length ? shown.map((p) => paperLine(p, t)).join(' · ') : t('tower.papers.inDate');
  return (
    <button type="button" class={`crow${on ? ' crow--on' : ''}`} aria-expanded={on} onClick={() => actions.open(on ? null : row.vehicleId)}>
      <span class="cface" aria-hidden="true">
        <Icon name="truck" size={18} />
      </span>
      <span class="crow__body">
        <span class="crow__top">
          <span class="crow__name">{row.plate}</span>
          {tag ? <span class={`ctag ${tag.cls}`}>{t(tag.key)}</span> : null}
        </span>
        <span class="crow__sub">{`${state} · ${classWord(row.vehicleClass, t)}`}</span>
      </span>
      <span class="crow__tail">
        <Icon name="chevronRight" size={16} />
      </span>
    </button>
  );
}

function VehicleSheet({ row, state, actions }: { row: LooseVehicleRow; state: TowerState; actions: TowerActions }) {
  const t = useT();
  const tag = vehicleTag(row);
  const [recording, setRecording] = useState(false);
  useEffect(() => setRecording(false), [row.vehicleId]);
  const d = row.documents;
  return (
    <>
      <div class="twr-person">
        <span class="cface cface--lg" aria-hidden="true">
          <Icon name="truck" size={24} />
        </span>
        <div class="twr-person__body">
          <p class="twr-person__name">{row.plate}</p>
          <p class="twr-person__sub">{[classWord(row.vehicleClass, t), row.status.toLowerCase()].join(' · ')}</p>
        </div>
        {tag ? <span class={`ctag ${tag.cls}`}>{t(tag.key)}</span> : null}
      </div>

      <section class="cons__panel">
        <div class="cons__panelhead">
          <span class="cons__panelt">{t('tower.papers.sec.papers')}</span>
        </div>
        <div class="twr-facts">
          <Fig label={t('tower.papers.insurance')} sub={d.insuranceRef ? t('tower.papers.refNo', { ref: d.insuranceRef }) : undefined}>
            {d.insuranceExpiresAt ? paperDay(d.insuranceExpiresAt.slice(0, 10)) : t('tower.papers.unknown')}
          </Fig>
          <Fig label={t('tower.papers.inspection')} sub={d.inspectionRef ? t('tower.papers.refNo', { ref: d.inspectionRef }) : undefined}>
            {d.inspectionExpiresAt ? paperDay(d.inspectionExpiresAt.slice(0, 10)) : t('tower.papers.unknown')}
          </Fig>
          <Fig label={t('tower.papers.rightNow')}>{row.onShiftWith ? t('tower.papers.onShiftWith', { name: row.onShiftWith }) : t('tower.papers.offShiftShort')}</Fig>
        </div>
        {isStuck(row) ? <p class="chint">{t('tower.papers.stuckVehicle')}</p> : null}
        {recording ? (
          <VehicleForm row={row} state={state} actions={actions} onCancel={() => setRecording(false)} />
        ) : (
          <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => setRecording(true)}>
            {t('tower.papers.recordPapers')}
          </button>
        )}
      </section>
    </>
  );
}

function VehicleForm({ row, state, actions, onCancel }: { row: LooseVehicleRow; state: TowerState; actions: TowerActions; onCancel: () => void }) {
  const t = useT();
  const [d, setD] = useState({
    insuranceRef: row.documents.insuranceRef ?? '',
    insuranceExpiresAt: row.documents.insuranceExpiresAt?.slice(0, 10) ?? '',
    inspectionRef: row.documents.inspectionRef ?? '',
    inspectionExpiresAt: row.documents.inspectionExpiresAt?.slice(0, 10) ?? '',
  });
  const [touched, setTouched] = useState(false);
  const patch = (p: Partial<typeof d>) => {
    setD({ ...d, ...p });
    setTouched(true);
  };
  const busy = state.busyId === row.vehicleId;
  const field = (key: keyof typeof d, labelKey: 'tower.papers.insuranceRef' | 'tower.papers.insuranceExpires' | 'tower.papers.inspectionRef' | 'tower.papers.inspectionExpires', date = false) => (
    <label class="cfield">
      <span class="cfield__label">{t(labelKey)}</span>
      <input class="cinput" type={date ? 'date' : 'text'} value={d[key]} onInput={(e) => patch({ [key]: (e.target as HTMLInputElement).value } as Partial<typeof d>)} />
    </label>
  );
  return (
    <div class="twr-clear">
      <p class="twr-clear__b">{t('tower.papers.vehicleBody')}</p>
      <div class="twr-facts">
        {field('insuranceRef', 'tower.papers.insuranceRef')}
        {field('insuranceExpiresAt', 'tower.papers.insuranceExpires', true)}
        {field('inspectionRef', 'tower.papers.inspectionRef')}
        {field('inspectionExpiresAt', 'tower.papers.inspectionExpires', true)}
      </div>
      <div class="twr-clear__act">
        <button
          type="button"
          class="cbtn cbtn--primary"
          disabled={!touched || busy}
          onClick={() =>
            void actions.recordVehiclePapers(
              row.vehicleId,
              {
                insuranceRef: d.insuranceRef.trim() || undefined,
                insuranceExpiresAt: d.insuranceExpiresAt || undefined,
                inspectionRef: d.inspectionRef.trim() || undefined,
                inspectionExpiresAt: d.inspectionExpiresAt || undefined,
              },
              row.plate,
            )
          }
        >
          {t('tower.papers.savePapers')}
        </button>
        <button type="button" class="cbtn cbtn--ghost" onClick={onCancel} disabled={busy}>
          {t('tower.papers.cancel')}
        </button>
      </div>
    </div>
  );
}
