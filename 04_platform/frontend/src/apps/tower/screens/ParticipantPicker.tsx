import { useCallback, useEffect, useState } from 'preact/hooks';
import { Icon, Sheet } from '../../../shared/ui';
import { useT, type MessageKey } from '../../../shared/i18n';
import { publicPageUrl } from '../../../lib/sbg/config';

export interface ParticipantRow {
  /** What gets sent when this one is chosen. */
  id: string;
  name: string;
  /** Their public page, where the directory has issued one. */
  handle?: string;
  country?: string;
  /** Their own line, in their words — shown in quotes. Never checked by us. */
  words?: string;
  /** What they SAY they do. Never checked by us. */
  says?: string;
  /** What we have actually SEEN. A pair of counts, never a score and never an ordering. */
  seen?: string;
  /** The papers our staff checked, in a few words. */
  checked?: string;
  /** How to reach them, from their own entry: a Call button once chosen, never a printed number. */
  phone?: string;
}

export interface ParticipantKind {
  key: string;
  labelKey: MessageKey;
  /** Alphabetical, and the caller says so in `basis`. */
  load: () => Promise<{ rows: ParticipantRow[]; basis: string }>;
}

/**
 * PICKING A PARTICIPANT, instead of typing their id.
 *
 * "Appoint a clearing agent" asked for the agent's COMPANY ID. Nobody knows one, and the only way to
 * get it was for the agent to send it to you out of band — which is precisely the gap the public
 * directory was built to close, in `e9bfb0b`. The finder has been there, public and alphabetical, and
 * the console that needs it most was asking people to type a primary key. Fourth time in this project
 * that nothing was missing except the asking.
 *
 * THE TABS APPEAR ONLY WHEN MORE THAN ONE KIND IS A VALID ANSWER, and that is a deliberate departure
 * from the sketch. Appointing a clearing agent accepts exactly one kind of participant: a company that
 * clears. A tab bar offering drivers, shops and fleets beside it presents four wrong answers and one
 * right one — and choosing a wrong one gets a refusal from the server, which is the wall we have just
 * spent two rounds removing. So the component takes the kinds a question actually accepts, and draws no
 * tab bar for a question with one answer.
 *
 * WHAT A ROW SHOWS IS WHAT MAKES IT A CHOICE. A name alone cannot be weighed. Every row carries the
 * pair the finder was built to put side by side: what they CLAIM, and what we have SEEN — because a
 * claim with nothing behind it and a claim with forty containers behind it look identical on a name.
 * Alphabetical, `basis` shown verbatim, and no score anywhere: this network is the party an importer
 * appoints through, so publishing an ordering of them would be self-dealing.
 */
export function ParticipantPicker({
  open,
  kinds,
  title,
  onClose,
  onPick,
  actionLabel,
}: {
  open: boolean;
  kinds: ParticipantKind[];
  title: string;
  onClose: () => void;
  onPick: (row: ParticipantRow) => void;
  actionLabel: string;
}) {
  const t = useT();
  const [kind, setKind] = useState(kinds[0]?.key ?? '');
  const [rows, setRows] = useState<ParticipantRow[] | null>(null);
  const [basis, setBasis] = useState('');
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState<string | null>(null);

  const active = kinds.find((k) => k.key === kind) ?? kinds[0];

  const load = useCallback(async () => {
    if (!open || !active) return;
    setRows(null);
    const got = await active.load();
    setRows(got.rows);
    setBasis(got.basis);
  }, [open, active]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!open) return null;

  // By NAME, here rather than on the server: the finder answers with everybody who claims the
  // specialism asked for, and a directory of a few hundred is a screenful to filter. When it is a few
  // thousand this moves, and the finder already takes the filters to move it with.
  const q = query.trim().toLowerCase();
  const found = (rows ?? []).filter((r) => !q || r.name.toLowerCase().includes(q) || (r.handle ?? '').includes(q));
  const picked = found.find((r) => r.id === chosen) ?? null;

  return (
    <Sheet open onClose={onClose} title={title}>
      <input class="cinput" value={query} onInput={(e) => setQuery((e.target as HTMLInputElement).value)} placeholder={t('tower.pick.byName')} aria-label={t('tower.pick.byName')} />

      {/* Only where the question has more than one kind of answer. */}
      {kinds.length > 1 ? (
        <div class="twr-panelend">
          {kinds.map((k) => (
            <button
              key={k.key}
              type="button"
              class={`cbtn cbtn--ghost cbtn--sm${k.key === active?.key ? ' cbtn--on' : ''}`}
              aria-pressed={k.key === active?.key}
              onClick={() => {
                setKind(k.key);
                setChosen(null);
              }}
            >
              {t(k.labelKey)}
            </button>
          ))}
        </div>
      ) : null}

      {rows === null ? (
        <p class="cons__empty">{t('tower.pick.reading')}</p>
      ) : found.length === 0 ? (
        <p class="cons__empty">{q ? t('tower.pick.noMatch') : t('tower.pick.empty')}</p>
      ) : (
        <div class="crows">
          {found.map((r) => (
            <button key={r.id} type="button" class={`crow${chosen === r.id ? ' crow--on' : ''}`} aria-pressed={chosen === r.id} onClick={() => setChosen(r.id)}>
              <span class="crow__body">
                <span class="crow__top">
                  <span class="crow__name">{r.name}</span>
                  {r.country ? <span class="ctag ctag--quiet">{r.country}</span> : null}
                </span>
                {/* The claim and the record, in that order: what they say, then what we saw, then what our staff checked. */}
                {r.words ? <span class="crow__sub">“{r.words}”</span> : null}
                {r.says ? <span class="crow__sub">{r.says}</span> : null}
                {r.seen ? <span class="chint">{r.seen}</span> : null}
                {r.checked ? <span class="chint">{r.checked}</span> : null}
              </span>
              <span class="crow__tail">{chosen === r.id ? <Icon name="check" size={16} /> : null}</span>
            </button>
          ))}
        </div>
      )}

      {/* Verbatim, and not decoration: a list of people is read as a ranking unless it says otherwise. */}
      {basis ? <p class="chint">{basis}</p> : null}

      <div class="twr-panelend">
        {/* Their page, before appointing them. The whole point of a directory is somewhere to go and
            read the rest before you commit a container to somebody. */}
        {picked?.handle && publicPageUrl(picked.handle) ? (
          <a class="cbtn cbtn--ghost cbtn--sm" href={publicPageUrl(picked.handle) ?? undefined} target="_blank" rel="noopener noreferrer">
            @{picked.handle}
          </a>
        ) : null}
        {/* A number to ring before deciding — a button, never the number printed (the directory's rule, 2026-10-30). */}
        {picked?.phone ? (
          <a class="cbtn cbtn--ghost cbtn--sm" href={`tel:${picked.phone.trim().startsWith('+') ? '+' : ''}${picked.phone.replace(/\D/g, '')}`}>
            {t('tower.pick.call')}
          </a>
        ) : null}
        <button type="button" class="cbtn cbtn--primary" disabled={!picked} onClick={() => picked && onPick(picked)}>
          {actionLabel}
        </button>
      </div>
    </Sheet>
  );
}
