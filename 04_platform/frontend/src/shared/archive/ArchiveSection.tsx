import { useEffect, useState } from 'preact/hooks';
import { Button, Card, Chip, Icon, Note, Pager, SearchInput, Sheet } from '../ui';
import { useT, type Translate } from '../i18n';
import { useDebounced } from '../useDebounced';
import { ARCHIVE_LIMIT, type ArchiveApiState } from './useArchive';
import { day, documentGoingSoon, pathWord, retentionLines, routeLine, shortPrint, stageWord } from './words';
import { linkRowSays, splitLinks } from './documentLink';
import { passOnLink, waysToPassOn, type PassedOn } from './handOver';
import { NoteCheck } from './NoteCheck';
import { DestinationCard } from './DestinationCard';
import type { DestinationApiState } from './useDestination';
import type { ArchiveQuery, ArchivedNoteRow, NoteStage } from '../../lib/sbg/personas/archive';

const STAGES: NoteStage[] = ['taken_over', 'reloaded', 'seal_changed', 'cold_chain_broken', 'delivered', 'not_delivered', 'claimed', 'answered', 'cancelled'];

/**
 * THE SHIPMENT ARCHIVE — every consignment note this account was a party to.
 *
 * One component for every app, because the question is the same one: a shop, a fleet office and an
 * operator all ask "what did I move, and where is the paperwork". The rows are identical, the words are
 * identical, and the route answers for whoever is asking — so three copies of this would only be three
 * chances to drift.
 */
export function ArchiveSection({ archive, destination }: { archive: ArchiveApiState; destination?: DestinationApiState }) {
  const t = useT();
  const [filterOpen, setFilterOpen] = useState(false);
  const [searchText, setSearchText] = useState(archive.query.q ?? '');
  const debounced = useDebounced(searchText, 300);

  useEffect(() => {
    if (debounced !== (archive.query.q ?? '')) archive.setQuery({ q: debounced });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  const chips = queryChips(archive.query, t);
  const filtered = Boolean(archive.query.q) || chips.length > 0;
  const loading = archive.phase === 'loading' || archive.phase === 'idle';
  const resetAll = () => {
    setSearchText('');
    archive.setQuery({ q: '', path: '', stage: '', from: '', to: '' });
  };

  const live = loading
    ? t('archive.loading')
    : archive.phase === 'error'
      ? t('archive.error')
      : archive.total === 0
        ? filtered
          ? t('archive.noMatch')
          : t('archive.empty')
        : archive.total === 1
          ? t('archive.foundOne', { count: archive.total })
          : t('archive.foundMany', { count: archive.total });

  return (
    <>
      <Card title={t('archive.title')} aside={<span class="row__count">{archive.total}</span>}>
        <p class="hint">{t('archive.lede')}</p>

        {/*
          THE ONE LINE SOMEBODY HAS TO SEE. The destination card sits below this register, which is right
          once it is set up and wrong before: a reader who never scrolls past their own notes never learns
          that we delete them. Shown only while nothing is connected, and gone the moment it is.
        */}
        {destination && destination.destination && !destination.destination.connected ? (
          <p class="hint">
            <b>{t('archive.nowhereYet')}</b>{' '}
            <button type="button" class="linkbtn" onClick={() => document.querySelector('.dest-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
              {t('archive.nowhereYetGo')}
            </button>
          </p>
        ) : null}

        <div class="reg__controls">
          <SearchInput value={searchText} onInput={setSearchText} placeholder={t('archive.searchPh')} label={t('archive.searchLabel')} />
          <button type="button" class={`reg__filter${chips.length ? ' reg__filter--on' : ''}`} onClick={() => setFilterOpen(true)}>
            <Icon name="filter" size={20} />
            <span>{chips.length ? t('archive.filtersCount', { count: chips.length }) : t('archive.filters')}</span>
          </button>
        </div>

        {chips.length ? (
          <div class="reg__chips">
            {chips.map((c) => (
              <Chip key={c.key} label={c.label} onRemove={() => archive.setQuery(c.clear)} />
            ))}
          </div>
        ) : null}

        <p class="sr-only" role="status">{live}</p>

        <div class="reg__list" aria-busy={loading}>
          {archive.rows.length === 0 ? (
            loading ? (
              <p class="hint">{t('archive.loadingShort')}</p>
            ) : archive.phase === 'error' ? (
              <p class="hint">
                {t('archive.errorRetry')}{' '}
                <button type="button" class="linkbtn" onClick={() => void archive.load()}>
                  {t('archive.tryAgain')}
                </button>
              </p>
            ) : filtered ? (
              <p class="hint">
                {t('archive.noMatchShort')}{' '}
                <button type="button" class="linkbtn" onClick={resetAll}>
                  {t('archive.clearFilters')}
                </button>
              </p>
            ) : (
              /* Not an error and not a blank panel: an account that has moved nothing has an empty
                 archive, and saying so plainly is the honest answer. */
              <p class="hint">{t('archive.emptyLong')}</p>
            )
          ) : (
            <div class={`rows${archive.phase === 'loading' ? ' rows--loading' : ''}`} role="list">
              {archive.rows.map((row) => (
                <NoteRow key={row.docId} row={row} onOpen={() => void archive.openDoc(row.docId)} />
              ))}
            </div>
          )}
        </div>

        <Pager
          offset={Number(archive.query.offset ?? '0')}
          limit={ARCHIVE_LIMIT}
          total={archive.total}
          busy={archive.phase === 'loading'}
          onOffset={(offset) => archive.setQuery({ offset: String(offset) })}
        />

        {archive.total > 0 ? (
          <div class="reg__export">
            <Button variant="link" full={false} busy={archive.busy === 'csv'} onClick={() => void archive.exportCsv()}>
              {t('archive.exportCsv', { count: archive.total })}
            </Button>
            <Button variant="link" full={false} busy={archive.busy === 'bundles'} onClick={() => void archive.exportAll()}>
              {t('archive.exportAll')}
            </Button>
          </div>
        ) : null}
      </Card>

      {/* Where these go besides here — the reason deleting them at twelve months is defensible. */}
      {destination ? <DestinationCard api={destination} /> : null}

      {/* The other direction: not a note of ours, one somebody handed us. A fleet with a shipper's
          emailed PDF should not have to leave for a web page to find out whether it is real. */}
      <NoteCheck check={archive.verifyNote} />

      <NoteSheet archive={archive} />
      <FilterSheet
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        query={archive.query}
        onApply={(patch) => {
          archive.setQuery(patch);
          setFilterOpen(false);
        }}
        onClearAll={() => {
          resetAll();
          setFilterOpen(false);
        }}
      />
    </>
  );
}

function NoteRow({ row, onOpen }: { row: ArchivedNoteRow; onOpen: () => void }) {
  const t = useT();
  return (
    <button type="button" class="row" onClick={onOpen}>
      <span class="row__ic">
        <Icon name="badge" size={24} />
      </span>
      <span class="row__body">
        <span class="row__t mono-t">{row.number}</span>
        {/* The copies count rides on the line that WRAPS. `.row__meta` is deliberately one line with an
            ellipsis, and "Delivered · 9/25/2026 · 2 c…" is what putting it there actually looks like. */}
        <span class="row__s">{`${routeLine(row)} · ${t(row.copies === 1 ? 'archive.copiesOne' : 'archive.copiesMany', { count: row.copies })}`}</span>
        <span class="row__meta">{[stageWord(row.lastStage, t), day(row.lastAt)].filter(Boolean).join(' · ')}</span>
      </span>
      <Icon name="chevronRight" size={20} />
    </button>
  );
}

/* --------------------------------------------------------------------- one document -- */

/**
 * ONE DOCUMENT AND ITS COPIES.
 *
 * The copies are the point of the sheet. A consignment note is made out in originals that stop changing —
 * the sender's at taking over, the consignee's at delivery — so a reader has to be able to see that there
 * is more than one, which moment each belongs to, and that each has a fingerprint they can compare
 * against a sheet of paper somebody else is holding.
 */
function NoteSheet({ archive }: { archive: ArchiveApiState }) {
  const t = useT();
  const doc = archive.open;
  const open = archive.openPhase !== 'idle';

  return (
    <Sheet open={open} onClose={archive.closeDoc} title={doc?.number ?? t('archive.docTitle')}>
      {archive.openPhase === 'loading' ? <p class="hint">{t('archive.loadingShort')}</p> : null}
      {archive.openPhase === 'error' ? <p class="hint">{t('archive.errorDoc')}</p> : null}
      {doc ? (
        <>
          {/* One `.kv` per fact, the way every other sheet in this product states one. */}
          <div class="kv">
            <span>{t('archive.through')}</span>
            <b>{pathWord(doc.path, t)}</b>
          </div>
          <div class="kv">
            <span>{t('archive.sender')}</span>
            <b>{doc.senderName}</b>
          </div>
          {doc.carrierName ? (
            <div class="kv">
              <span>{t('archive.carrier')}</span>
              <b>{[doc.carrierName, doc.plate].filter(Boolean).join(' · ')}</b>
            </div>
          ) : null}
          <div class="kv">
            <span>{t('archive.journey')}</span>
            <b>{`${doc.from} → ${doc.to}`}</b>
          </div>
          <div class="kv">
            <span>{t('archive.goods')}</span>
            <b>{`${doc.nature} · ${doc.grossKg} kg`}</b>
          </div>

          <h3 class="scr__section">{t('archive.copiesTitle')}</h3>
          <p class="hint">{t('archive.copiesLede')}</p>
          <div class="rows" role="list">
            {doc.versions.map((v) => (
              <div key={v.seq} class="row row--static">
                <span class="row__body">
                  <span class="row__t">{stageWord(v.stage, t)}</span>
                  <span class="row__s">{v.event}</span>
                  <span class="row__meta">
                    {day(v.at)} · <span class="mono-t">{shortPrint(v.sha256)}</span>
                  </span>
                </span>
                <Button variant="link" full={false} busy={archive.busy === 'print'} onClick={() => void archive.printCopy(doc.docId, v.seq)}>
                  {t('archive.openCopy')}
                </Button>
              </div>
            ))}
          </div>

          {/* How long we keep it, where somebody is deciding what to do with it. */}
          <Note
            tone={documentGoingSoon(doc.retention) ? 'warn' : 'info'}
            icon="clock"
            title={t('archive.retention.title')}
            detail={retentionLines(doc.retention, t).join(' ')}
          />

          {/* The OS share sheet where the browser has one — it already lists their Drive, Dropbox and
              mail, and we hold no credential to reach any of them. A download everywhere else. */}
          <Button busy={archive.busy === 'bundle'} onClick={() => void archive.exportBundle(doc.docId, doc.number)}>
            {t(archive.canShareFiles ? 'archive.shareBundle' : 'archive.exportBundle')}
          </Button>
          <p class="hint">{t(archive.canShareFiles ? 'archive.shareBundleHint' : 'archive.exportBundleHint')}</p>

          <NoteLinks archive={archive} />
        </>
      ) : null}
    </Sheet>
  );
}

/* --------------------------------------------------------------------------- links -- */

/**
 * THE LINKS TO THIS NOTE that are this reader's: the one emailed with a receipt when the load was delivered, and the
 * ones this party made itself to pass on.
 *
 * A link opens the note with nobody signed in, so the party it was made for is shown each one: where it came from,
 * how often the file was taken with it, and until when it works. And can stop it now.
 *
 * MAKING ONE is for somebody who should have the note and has no account here — a bookkeeper, an insurer, the
 * other side — sent by the party itself, in a chat, a text or its own mail. Its address is shown ONCE: the server
 * keeps no copy, so there is nothing to show a second time. Lost, it is cancelled and another is made.
 *
 * Cancelling asks once more, in place: it cannot be switched back on, and the button is a finger's width from a
 * row somebody was only reading.
 */
function NoteLinks({ archive }: { archive: ArchiveApiState }) {
  const t = useT();
  const [asking, setAsking] = useState('');
  const [passed, setPassed] = useState<PassedOn | null>(null);
  const [showStopped, setShowStopped] = useState(false);
  const { live, stopped } = splitLinks(archive.links);
  const ways = waysToPassOn();
  const made = archive.made;
  const pass = async (how: 'share' | 'copy') => {
    if (!made || !archive.open) return;
    setPassed(await passOnLink(made.url, archive.open.number, how, ways));
  };
  return (
    <>
      <h3 class="scr__section">{t('archive.links.title')}</h3>
      <p class="hint">{t('archive.links.lede')}</p>

      {made ? (
        <>
          <Note tone="warn" icon="warning" title={t('archive.links.madeTitle')} detail={t('archive.links.madeDetail', { date: day(made.expiresAt) })} />
          <div class="field">
            <label class="field__label" for="made-link">
              {t('archive.links.madeLabel')}
            </label>
            <input id="made-link" class="input mono-t" type="text" readOnly value={made.url} onFocus={(e) => e.currentTarget.select()} />
          </div>
          {ways.share ? (
            <Button onClick={() => void pass('share')}>{t('archive.links.send')}</Button>
          ) : null}
          {ways.copy ? (
            <Button variant={ways.share ? 'outline' : 'primary'} onClick={() => void pass('copy')}>
              {t('archive.links.copy')}
            </Button>
          ) : null}
          {passed === 'shared' || passed === 'copied' || passed === 'shown' ? (
            <p class="hint" role="status">
              {t(passed === 'shared' ? 'archive.links.passedShared' : passed === 'copied' ? 'archive.links.passedCopied' : 'archive.links.passedShown')}
            </p>
          ) : null}
        </>
      ) : (
        <>
          <Button variant="outline" busy={archive.making} onClick={() => void archive.makeLink().then(() => setPassed(null))}>
            {t('archive.links.make')}
          </Button>
          <p class="hint">{t('archive.links.makeHint')}</p>
        </>
      )}
      {archive.makeProblem ? (
        <p class="hint" role="alert">
          {archive.makeProblem}
        </p>
      ) : null}

      {/* The links that still open are the ones that matter, and are what is shown. The ones that have stopped are
          the note's history — who was sent it, and when that ended — and a year of them above the fold would bury the
          one link that is still a way in. They are one tap away, never gone. */}
      {archive.links.length === 0 ? <p class="hint">{t('archive.links.none')}</p> : live.length === 0 ? <p class="hint">{t('archive.links.noneLive')}</p> : null}
      <div class="rows" role="list">
        {(showStopped ? [...live, ...stopped] : live).map((l) => {
          const says = linkRowSays(l, t);
          return (
            <div key={l.linkId} class="row row--static" role="listitem">
              <span class="row__body">
                <span class="row__t">{says.title}</span>
                <span class="row__s">{asking === l.linkId ? t('archive.links.cancelAsk') : says.state}</span>
                <span class="row__meta">{says.used}</span>
              </span>
              {says.canCancel && asking !== l.linkId ? (
                <Button variant="link" danger full={false} onClick={() => setAsking(l.linkId)}>
                  {t('archive.links.cancel')}
                </Button>
              ) : null}
              {says.canCancel && asking === l.linkId ? (
                <span class="row__end">
                  <Button
                    variant="link"
                    danger
                    full={false}
                    busy={archive.cancelling === l.linkId}
                    onClick={() => void archive.cancelLink(l.linkId).then(() => setAsking(''))}
                  >
                    {t('archive.links.cancelYes')}
                  </Button>
                  <Button variant="link" full={false} onClick={() => setAsking('')}>
                    {t('archive.links.cancelNo')}
                  </Button>
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
      {stopped.length > 0 ? (
        <Button variant="link" full={false} onClick={() => setShowStopped((v) => !v)}>
          {showStopped ? t('archive.links.hideStopped') : stopped.length === 1 ? t('archive.links.showStoppedOne') : t('archive.links.showStoppedMany', { n: stopped.length })}
        </Button>
      ) : null}
    </>
  );
}

/* ------------------------------------------------------------------------- filters -- */

function queryChips(q: ArchiveQuery, t: Translate): Array<{ key: string; label: string; clear: Partial<ArchiveQuery> }> {
  const out: Array<{ key: string; label: string; clear: Partial<ArchiveQuery> }> = [];
  if (q.path) out.push({ key: 'path', label: pathWord(q.path, t), clear: { path: '' } });
  if (q.stage) out.push({ key: 'stage', label: stageWord(q.stage, t), clear: { stage: '' } });
  if (q.from || q.to) out.push({ key: 'date', label: `${q.from || '…'} → ${q.to || '…'}`, clear: { from: '', to: '' } });
  return out;
}

function FilterSheet({
  open,
  onClose,
  query,
  onApply,
  onClearAll,
}: {
  open: boolean;
  onClose: () => void;
  query: ArchiveQuery;
  onApply: (patch: Partial<ArchiveQuery>) => void;
  onClearAll: () => void;
}) {
  const t = useT();
  const [draft, setDraft] = useState<ArchiveQuery>(query);
  useEffect(() => {
    if (open) setDraft(query);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const set = (patch: Partial<ArchiveQuery>) => setDraft((d) => ({ ...d, ...patch }));

  return (
    <Sheet open={open} onClose={onClose} title={t('archive.filterTitle')}>
      <div class="field">
        <label class="field__label" for="arc-path">{t('archive.filterPath')}</label>
        <select id="arc-path" class="select" value={draft.path ?? ''} onChange={(e) => set({ path: e.currentTarget.value as ArchiveQuery['path'] })}>
          <option value="">{t('archive.anyPath')}</option>
          <option value="board">{t('archive.path.board')}</option>
          <option value="run">{t('archive.path.run')}</option>
        </select>
      </div>
      <div class="field">
        <label class="field__label" for="arc-stage">{t('archive.filterStage')}</label>
        <select id="arc-stage" class="select" value={draft.stage ?? ''} onChange={(e) => set({ stage: e.currentTarget.value as NoteStage | '' })}>
          <option value="">{t('archive.anyStage')}</option>
          {STAGES.map((s) => (
            <option key={s} value={s}>
              {stageWord(s, t)}
            </option>
          ))}
        </select>
      </div>
      <div class="field">
        <label class="field__label" for="arc-from">{t('archive.filterFrom')}</label>
        <input id="arc-from" class="input" type="date" value={draft.from ?? ''} onInput={(e) => set({ from: e.currentTarget.value })} />
      </div>
      <div class="field">
        <label class="field__label" for="arc-to">{t('archive.filterTo')}</label>
        <input id="arc-to" class="input" type="date" value={draft.to ?? ''} onInput={(e) => set({ to: e.currentTarget.value })} />
      </div>
      <Button onClick={() => onApply({ path: draft.path, stage: draft.stage, from: draft.from, to: draft.to })}>{t('archive.applyFilters')}</Button>
      <Button variant="outline" onClick={onClearAll}>
        {t('archive.clearFilters')}
      </Button>
    </Sheet>
  );
}
