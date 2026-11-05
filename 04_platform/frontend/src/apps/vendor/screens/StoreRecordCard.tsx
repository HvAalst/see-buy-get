import { useEffect, useState } from 'preact/hooks';
import { Button, Card, ErrorNote, Icon, Sheet } from '../../../shared/ui';
import { formatDate, useT } from '../../../shared/i18n';
import { frontDoorUrl } from '../../../shared/frontDoor';
import { STORE_REPLIES, STORE_REPLY_MAX, WAY_OUT, replyLine, type StoreReplyKind } from '../../../shared/storeReply';
import type { SbgError } from '../../../lib/sbg';
import { fetchStoreRecord, type StoreRecordView } from '../api';

/** Below this many shipments a rate is a headline made of one or two parcels: counted instead (the server's floor of 3). */
const FEW = 3;

/** The store's answer, as its own sign-in sends it (useVendorApp storeReply). */
export interface StoreReplyApi {
  set: (kind: StoreReplyKind, text?: string) => Promise<SbgError | null>;
  clear: () => Promise<SbgError | null>;
}

/**
 * 2026-11-05 — HOW BUYERS SEE YOU: a store's own public record, in its own app.
 *
 * The record had been public since October — measured by us, the same for every store, not the store's to switch off —
 * and the store itself was never shown it. Yet that is the sell the whole idea rests on: a store that ships fast earns
 * a record slow competitors cannot fake, and puts the link beside its shipping price. So the store sees what a buyer
 * sees (the same answer, from the same public door), opens the page itself, and is told the one setting that puts the
 * link at its checkout. Nothing here changes what was measured or what was said: there is nothing on this card that could.
 *
 * WHAT IT MAY DO is answer — once, short (the owner, 2026-11-05: "a standing reply … short and snappy. a few standard
 * replies to choose like 'contact our customer service' and an optional other that opens a text input field").
 */
export function StoreRecordCard({ vendorId, reply }: { vendorId?: string; reply?: StoreReplyApi | null }) {
  const t = useT();
  const [record, setRecord] = useState<StoreRecordView | null>(null);
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [reading, setReading] = useState(0);

  useEffect(() => {
    if (!vendorId) return;
    let live = true;
    void fetchStoreRecord(vendorId).then((r) => {
      if (!live) return;
      if (r.error) setFailed(true);
      else setRecord(r.data);
    });
    return () => {
      live = false;
    };
  }, [vendorId, reading]);

  if (!vendorId) return null;
  const page = `${frontDoorUrl()}?store=${encodeURIComponent(vendorId)}`;
  const few = record ? record.shipments > 0 && record.shipments < FEW : false;
  const answer = record?.reply;

  return (
    <Card title={t('vendor.record.title')}>
      <p class="card__note">{t('vendor.record.lede')}</p>
      {failed ? (
        <p class="hint">{t('vendor.record.error')}</p>
      ) : !record ? (
        <p class="hint">{t('vendor.record.loading')}</p>
      ) : record.shipments === 0 ? (
        <p class="t-body">{t('vendor.record.none')}</p>
      ) : (
        <>
          <p class="t-body">
            {few && record.nextDayCount != null
              ? t('vendor.record.nextDayFew', { n: String(record.nextDayCount), m: String(record.shipments) })
              : t('vendor.record.nextDay', { pct: `${Math.round((record.shipsNextDayRate ?? 0) * 100)}%` })}
          </p>
          <p class="card__note">
            {record.rating.isNew
              ? t('vendor.record.ratingNew', { count: record.rating.count })
              : t('vendor.record.rating', { avg: record.rating.average.toFixed(1), count: record.rating.count })}
          </p>
        </>
      )}

      {/* The store's one answer to what was said — shown under the tags on its page, and the store's to change or take back. */}
      {record && reply ? (
        <div class="reply">
          <p class="reply__t">{t('vendor.reply.title')}</p>
          {answer ? (
            <>
              <p class="t-body">{answer.kind === 'OTHER' ? `“${answer.text ?? ''}”` : t(`common.storeReply.${answer.kind}` as 'common.storeReply.CONTACT_US')}</p>
              <p class="card__note">{t('vendor.reply.since', { date: formatDate(answer.at) })}</p>
            </>
          ) : (
            <p class="card__note">{t('vendor.reply.none')}</p>
          )}
          <div class="btnrow">
            <Button variant="outline" full={false} chevron={false} onClick={() => setEditing(true)}>
              {t(answer ? 'vendor.reply.change' : 'vendor.reply.add')}
            </Button>
            {answer ? (
              <Button
                variant="link"
                full={false}
                onClick={() =>
                  void reply.clear().then((e) => {
                    if (!e) setReading((n) => n + 1);
                  })
                }
              >
                {t('vendor.reply.remove')}
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      <a class="btn btn--link" href={page} target="_blank" rel="noopener">
        <span class="btn__row">
          {t('vendor.record.open')}
          <Icon name="chevronRight" size={18} />
        </span>
      </a>
      {/* The one setting that puts the link at the checkout — the widget is the store's to place, the record is not theirs to hide. */}
      <p class="card__note">{t('vendor.record.widgetLead')}</p>
      <p class="mono-t" style="word-break:break-all">{`store="${vendorId}"`}</p>
      <p class="card__note">{t('vendor.record.widgetAfter')}</p>

      {reply ? (
        <ReplySheet
          open={editing}
          current={answer}
          api={reply}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            setReading((n) => n + 1);
          }}
        />
      ) : null}
    </Card>
  );
}

/**
 * Choosing the answer. The standard ones first, as the sentences a buyer will read; "Something else" opens one line of the
 * store's own, counted as it is typed. What the server would refuse — a link, an email address, a phone number — is said
 * before it is sent, and the server says it again if anything gets past.
 */
function ReplySheet({ open, current, api, onClose, onSaved }: { open: boolean; current?: StoreRecordView['reply']; api: StoreReplyApi; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const [kind, setKind] = useState<StoreReplyKind | null>(current?.kind ?? null);
  const [text, setText] = useState(current?.text ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SbgError | null>(null);
  useEffect(() => {
    if (!open) return;
    setKind(current?.kind ?? null);
    setText(current?.text ?? '');
    setError(null);
  }, [open, current?.kind, current?.text]);

  const line = replyLine(text);
  const tooLong = line.length > STORE_REPLY_MAX;
  const wayOut = kind === 'OTHER' && WAY_OUT.test(line);
  const ready = kind !== null && (kind !== 'OTHER' || (line.length > 0 && !tooLong && !wayOut));

  return (
    <Sheet open={open} onClose={onClose} title={t('vendor.reply.title')}>
      <p class="t-body">{t('vendor.reply.lede')}</p>
      <div class="rows" role="group" aria-label={t('vendor.reply.title')}>
        {STORE_REPLIES.map((k) => (
          <button key={k} type="button" class="row" aria-pressed={kind === k} onClick={() => setKind(k)}>
            <span class="row__ic">
              <Icon name={kind === k ? 'check' : k === 'OTHER' ? 'edit' : 'send'} size={22} />
            </span>
            <span class="row__body">
              <span class="row__t">{k === 'OTHER' ? t('vendor.reply.other') : t(`common.storeReply.${k}` as 'common.storeReply.CONTACT_US')}</span>
            </span>
          </button>
        ))}
      </div>
      {kind === 'OTHER' ? (
        <div class="field">
          <label class="field__label" for="store-reply-text">
            {t('vendor.reply.ownLabel')}
          </label>
          <input
            id="store-reply-text"
            class="input"
            value={text}
            maxLength={STORE_REPLY_MAX + 20}
            onInput={(e) => setText(e.currentTarget.value)}
            aria-describedby="store-reply-count"
            aria-invalid={tooLong || wayOut || undefined}
          />
          <p id="store-reply-count" class={tooLong ? 'hint hint--danger' : 'hint'} aria-live="polite">
            {t('vendor.reply.count', { n: String(line.length), max: String(STORE_REPLY_MAX) })}
          </p>
          <p class={wayOut ? 'hint hint--danger' : 'hint'}>{t('vendor.reply.noWayOut')}</p>
        </div>
      ) : null}
      {error ? <ErrorNote error={error} /> : null}
      <Button
        chevron={false}
        disabled={!ready}
        busy={busy}
        onClick={async () => {
          if (!kind) return;
          setBusy(true);
          const e = await api.set(kind, kind === 'OTHER' ? line : undefined);
          setBusy(false);
          if (e) setError(e);
          else onSaved();
        }}
      >
        {t('vendor.reply.save')}
      </Button>
      <p class="card__note">{t('vendor.reply.public')}</p>
    </Sheet>
  );
}
