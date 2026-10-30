import { Abbreviated } from '../../../shared/ui/Abbr';
import { useState } from 'preact/hooks';
import { useT } from '../../../shared/i18n';
import { ConsoleDetail } from '../ConsoleDetail';
import { CATEGORY_LABEL, inCategory, waited, type SupportCategory, type SupportMessage, type SupportStatus } from '../messages';
import type { TowerActions, TowerState } from '../useTowerApp';

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/**
 * MESSAGES — what people wrote from the help's "Write to us" (the user, 2026-10-22: "a direct message field that is
 * sorted by category by the system for sbg staff"). Sorted by what it is about, what cannot wait first, then whoever
 * has waited longest. Opening one shows what was written, from where, and what was answered; staff answer by email, to
 * the address the person gave, and close it when it is done.
 */
export function MessagesScreen({ state, actions }: { state: TowerState; actions: TowerActions }) {
  const t = useT();
  const inbox = state.support;
  const [category, setCategory] = useState<SupportCategory | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const rows = inCategory(inbox, category);
  const status = state.supportStatus;

  return (
    <>
      <header class="cons__head">
        <h1 class="cons__title">{t('tower.messages.title')}</h1>
        <p class="cons__lede">{t('tower.messages.lede')}</p>
      </header>
      {state.queueError ? <p class="cerr"><Abbreviated text={state.queueError} /></p> : null}

      <div class="twr-tabs" role="tablist" aria-label={t('tower.messages.statusLabel')}>
        {(['open', 'answered', 'closed'] as SupportStatus[]).map((s) => (
          <button key={s} type="button" role="tab" aria-selected={status === s} class={`cbtn cbtn--sm ${status === s ? 'cbtn--on' : 'cbtn--ghost'}`} onClick={() => void actions.readSupport(s)}>
            {t(`tower.messages.status.${s}`)}
          </button>
        ))}
      </div>

      {status === 'open' && inbox ? (
        <div class="twr-tabs" role="group" aria-label={t('tower.messages.categoryLabel')}>
          <button type="button" class={`cbtn cbtn--sm ${category === null ? 'cbtn--on' : 'cbtn--ghost'}`} aria-pressed={category === null} onClick={() => setCategory(null)}>
            {t('tower.messages.all', { n: inbox.counts.reduce((n, c) => n + c.open, 0) })}
          </button>
          {inbox.counts
            .filter((c) => c.open > 0)
            .map((c) => (
              <button key={c.category} type="button" class={`cbtn cbtn--sm ${category === c.category ? 'cbtn--on' : 'cbtn--ghost'}`} aria-pressed={category === c.category} onClick={() => setCategory(c.category)}>
                {t(CATEGORY_LABEL[c.category])} · {c.open}
              </button>
            ))}
        </div>
      ) : null}

      <section class="cons__panel">
        <div class="cons__panelhead">
          <span class="cons__panelt">{t(`tower.messages.status.${status}`)}</span>
          {inbox ? <span class="chint">{t('tower.messages.count', { n: rows.length })}</span> : null}
        </div>
        {inbox === null ? (
          <p class="cons__empty">{t('tower.queues.loading')}</p>
        ) : rows.length === 0 ? (
          <p class="cons__empty">{t(status === 'open' ? 'tower.messages.noneOpen' : 'tower.messages.none')}</p>
        ) : (
          <div class="crows">
            {rows.map((m) => (
              <button type="button" class="crow" key={m.reference} onClick={() => setOpen(m.reference)}>
                <span class="crow__body">
                  <span class="crow__top">
                    <span class="crow__name">{t(CATEGORY_LABEL[m.category])}</span>
                    {m.urgent ? <span class="ctag ctag--danger">{t('tower.messages.urgent')}</span> : null}
                    <span class="ctag ctag--quiet">{m.reference}</span>
                  </span>
                  <span class="crow__sub">
                    {m.email} · {waitedWords(m.at, t)}
                    {m.others > 0 ? ` · ${t('tower.messages.others', { n: m.others })}` : ''}
                  </span>
                  <span class="crow__sub">{m.message.length > 140 ? `${m.message.slice(0, 140)}…` : m.message}</span>
                </span>
              </button>
            ))}
          </div>
        )}
        <p class="chint">{t('tower.messages.kept', { days: inbox?.keptDays ?? 180 })}</p>
      </section>

      {open ? <MessageDetail message={rows.find((m) => m.reference === open) ?? null} reference={open} actions={actions} onClose={() => setOpen(null)} /> : null}
    </>
  );
}

function waitedWords(iso: string, t: ReturnType<typeof useT>): string {
  const w = waited(iso);
  return t(`tower.messages.waited.${w.unit}`, { n: w.n });
}

function MessageDetail({ message: m, reference, actions, onClose }: { message: SupportMessage | null; reference: string; actions: TowerActions; onClose: () => void }) {
  const t = useT();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState<'answer' | 'close' | null>(null);
  if (!m) {
    return (
      <ConsoleDetail openKey={reference} title={reference} onClose={onClose}>
        <p class="cons__empty">{t('tower.messages.gone')}</p>
      </ConsoleDetail>
    );
  }
  const answer = async () => {
    setBusy('answer');
    const ok = await actions.answerSupport(m.reference, text.trim());
    setBusy(null);
    if (ok) {
      setText('');
      onClose();
    }
  };
  const close = async () => {
    setBusy('close');
    await actions.closeSupport(m.reference);
    setBusy(null);
    onClose();
  };
  return (
    <ConsoleDetail openKey={m.reference} title={`${t(CATEGORY_LABEL[m.category])} — ${m.reference}`} onClose={onClose}>
      <section class="cons__panel">
        <div class="cons__panelhead">
          <span class="cons__panelt">{t('tower.messages.wroteTitle')}</span>
          {m.urgent ? <span class="ctag ctag--danger">{t('tower.messages.urgent')}</span> : null}
        </div>
        <dl class="cons__facts">
          <Fact k={t('tower.messages.fact.from')} v={m.email} hint={m.others > 0 ? t('tower.messages.others', { n: m.others }) : undefined} />
          <Fact k={t('tower.messages.fact.at')} v={when(m.at)} hint={waitedWords(m.at, t)} />
          {m.from ? <Fact k={t('tower.messages.fact.app')} v={m.from} /> : null}
          {m.about ? <Fact k={t('tower.messages.fact.about')} v={m.about} /> : null}
          {m.locale ? <Fact k={t('tower.messages.fact.locale')} v={m.locale} /> : null}
        </dl>
        <p class="twr-said">{m.message}</p>
      </section>

      {m.answers.length ? (
        <section class="cons__panel">
          <div class="cons__panelhead">
            <span class="cons__panelt">{t('tower.messages.answersTitle')}</span>
          </div>
          {m.answers.map((a) => (
            <div key={a.at} class="twr-said">
              <p class="cfield__label">{t('tower.messages.answeredBy', { by: a.by, at: when(a.at) })}</p>
              <p class="cons__lede">{a.text}</p>
              {a.mailed ? null : <p class="chint">{t('tower.messages.inOutbox')}</p>}
            </div>
          ))}
        </section>
      ) : null}

      {m.status !== 'closed' ? (
        <section class="cons__panel">
          <label class="cfield">
            <span class="cfield__label">{t('tower.messages.answerLabel', { email: m.email })}</span>
            <textarea class="cinput" rows={5} maxLength={4000} value={text} disabled={busy !== null} onInput={(e) => setText((e.target as HTMLTextAreaElement).value)} />
            <span class="chint">{t('tower.messages.answerHint')}</span>
          </label>
          <div class="twr-panelend">
            <button type="button" class="cbtn cbtn--ghost" disabled={busy !== null} onClick={() => void close()}>
              {t('tower.messages.close')}
            </button>
            <button type="button" class="cbtn cbtn--primary" disabled={busy !== null || text.trim().length < 2} onClick={() => void answer()}>
              {t('tower.messages.send')}
            </button>
          </div>
        </section>
      ) : (
        <p class="chint">{t('tower.messages.closedBy', { by: m.closedBy ?? '', at: m.closedAt ? when(m.closedAt) : '' })}</p>
      )}
    </ConsoleDetail>
  );
}

function Fact({ k, v, hint }: { k: string; v: string; hint?: string }) {
  return (
    <div class="cons__fact">
      <dt class="cons__factk">{k}</dt>
      <dd class="cons__factv">
        {v}
        {hint ? <span class="chint">{hint}</span> : null}
      </dd>
    </div>
  );
}
