import { Abbreviated } from '../../../shared/ui/Abbr';
import { useState } from 'preact/hooks';
import { formatDate, useT } from '../../../shared/i18n';
import type { BusinessClient } from '../api';
import { ConsolePick } from '../../tower/ConsolePick';
import { CLAIM_KINDS, CLAIM_KIND_KEYS, claimLine, claimReady, claimStanding, type ClaimKind, type ClaimSide, type LoadClaim } from '../claim';

/** What the panel reads of a load, from either side of it. */
export interface ClaimableLoad {
  freightId: string;
  code: string;
  status: string;
  claim?: LoadClaim;
  claimant?: 'sender' | 'receiver';
  canClaim?: boolean;
  incoterm?: string;
}

/**
 * A PROBLEM WITH THE GOODS DELIVERED (claim.ts): what the business found, in its own words, with a photo if it has one —
 * where it is the one to claim. SeeBuyGet does not judge it: unless a company of ours stated cover, the consignment note,
 * frozen with the claim on it, is the damage claim report, which the business hands on by a link from the note above.
 */
export function LoadClaimPanel({ row, client, act, onChanged, side = 'sender' }: { row: ClaimableLoad; client: BusinessClient | null; act: boolean; onChanged: (message?: string) => void | Promise<void>; side?: ClaimSide }) {
  const t = useT();
  const standing = claimStanding(row, side);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<{ kind: ClaimKind | ''; text: string; photo: string }>({ kind: '', text: '', photo: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!standing) return null;

  const send = async () => {
    if (!client || !claimReady(form)) return;
    setBusy(true);
    setError(null);
    const r = await client.shipping.openFreightClaim(row.freightId, { kind: form.kind as ClaimKind, description: form.text.trim(), ...(form.photo ? { photoRef: form.photo } : {}) });
    setBusy(false);
    if (r.error) return setError((r.error as { detail?: string; title?: string }).detail || (r.error as { title?: string }).title || '');
    setOpen(false);
    await onChanged(t('business.claim.sent'));
  };

  const photo = async (file: File | undefined) => {
    if (!file || !client) return;
    setBusy(true);
    const id = await client.claimPhoto(file);
    setBusy(false);
    if (!id) return setError(t('business.claim.photoFailed'));
    setForm((f) => ({ ...f, photo: id }));
  };

  return (
    <section class="cons__panel">
      <div class="cons__panelhead">
        <span class="cons__panelt">{t('business.claim.title')}</span>
      </div>
      {standing.kind === 'made' ? (
        <p class="cons__lede">
          {(() => {
            const line = claimLine(standing.claim, side);
            return t(line.key, { kind: t(CLAIM_KIND_KEYS[line.kind]), when: formatDate(standing.claim.decidedAt ?? standing.claim.raisedAt, { day: 'numeric', month: 'short', year: 'numeric' }), note: standing.claim.note ?? '' });
          })()}
        </p>
      ) : standing.kind === 'receiver_claims' ? (
        <p class="cons__lede">{t('business.claim.receiverClaims', { term: row.incoterm ?? '' })}</p>
      ) : standing.kind === 'sender_claims' ? (
        <p class="cons__lede">{row.incoterm ? t('business.claim.senderClaimsTerm', { term: row.incoterm }) : t('business.claim.senderClaims')}</p>
      ) : standing.kind === 'window_closed' ? (
        <p class="cons__lede">{t('business.claim.windowClosed')}</p>
      ) : !act ? (
        <p class="cons__lede">{t('business.claim.mayClaimViewer')}</p>
      ) : !open ? (
        <>
          <p class="cons__lede">{t('business.claim.lede')}</p>
          <div class="twr-panelend">
            <button type="button" class="cbtn cbtn--ghost" onClick={() => setOpen(true)}>
              {t('business.claim.open')}
            </button>
          </div>
        </>
      ) : (
        <>
          <p class="cons__lede">{t('business.claim.body', { code: row.code })}</p>
          <div class="biz-two">
            <ConsolePick
              label={t('business.claim.kindLabel')}
              value={form.kind}
              placeholder={t('business.claim.kindPick')}
              options={CLAIM_KINDS.map((k) => ({ value: k, label: t(CLAIM_KIND_KEYS[k]) }))}
              onChange={(kind) => setForm((f) => ({ ...f, kind: kind as ClaimKind }))}
            />
            <label class="cfield">
              <span class="cfield__label">{t('business.claim.photoLabel')}</span>
              <input class="cinput" type="file" accept="image/*" onChange={(e) => void photo((e.target as HTMLInputElement).files?.[0])} />
              {form.photo ? <span class="chint">{t('business.claim.photoKept')}</span> : null}
            </label>
          </div>
          <label class="cfield">
            <span class="cfield__label">{t('business.claim.textLabel')}</span>
            <textarea class="cinput" rows={3} maxLength={1000} value={form.text} onInput={(e) => setForm((f) => ({ ...f, text: (e.target as HTMLTextAreaElement).value }))} />
          </label>
          {error ? <p class="cerr"><Abbreviated text={error} /></p> : null}
          <div class="twr-panelend">
            <button type="button" class="cbtn cbtn--primary" disabled={busy || !claimReady(form)} onClick={() => void send()}>
              {t('business.claim.send')}
            </button>
            <button type="button" class="cbtn cbtn--ghost" onClick={() => setOpen(false)}>
              {t('business.claim.cancel')}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
