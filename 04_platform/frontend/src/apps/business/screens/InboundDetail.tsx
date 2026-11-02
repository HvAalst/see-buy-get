import { useState } from 'preact/hooks';
import { foundWords } from '../../../shared/found';
import { formatDate, useT } from '../../../shared/i18n';
import { ConsoleDetail } from '../../tower/ConsoleDetail';
import type { BusinessClient } from '../api';
import { Abbreviated } from '../../../shared/ui/Abbr';
import { abroadLine, inboundTitle, type InboundRow } from '../inbound';
import { LoadClaimPanel } from './LoadClaim';
import { NoteFile, NoteLinksPanel } from './LoadNote';
import { pageGot, PaperSheet, usePaper } from '../../../shared/ui';
import { useNoteLinks } from '../../../shared/archive/useNoteLinks';

/**
 * ONE DELIVERED LOAD, OPENED FROM COMING IN (the user, 2026-10-26: "Its copy, no carriage price"): what came and what
 * was found, the receiver's own copy of the note — the file kept for it, and links to hand it to an insurer — and a
 * problem with the goods, where the agreed term makes the loss on the road the receiver's to claim.
 */
export function InboundDetail({ row, client, act, onClose, onChanged }: { row: InboundRow; client: BusinessClient | null; act: boolean; onClose: () => void; onChanged: (message?: string) => void | Promise<void> }) {
  const t = useT();
  const [error, setError] = useState<string | null>(null);
  const title = inboundTitle(row);
  const name = title.kind === 'order' ? t('business.inbound.order', { ref: title.text }) : title.text;
  const delivered = row.steps.find((s) => s.status === 'delivered')?.at;
  const found = foundWords(row.exceptions, t);
  // 2026-11-02 — the receiver's copy opens in the slide-up, as it will print (the owner: "the print function in slide
  // up"); Share there passes on a link to it, the same links listed below.
  const paper = usePaper();
  const noteLinks = useNoteLinks(client ? client.client.sbg : null, row.noteId);

  const note = () => {
    if (!client) return;
    setError(null);
    paper.show(t('business.inbound.note'), async () => pageGot(await client.shipping.freightNote(row.freightId), t('business.inbound.noteGone')));
  };

  return (
    <ConsoleDetail openKey={row.freightId} title={`${name} · ${row.ref}`} onClose={onClose}>
      <section class="cons__panel">
        <div class="cons__panelhead">
          <span class="cons__panelt">
            {name} · {row.ref}
          </span>
        </div>
        <dl class="cons__facts">
          <div class="cons__fact">
            <dt class="cons__factk">{t('business.inbound.fact.from')}</dt>
            <dd class="cons__factv">{row.from}</dd>
          </div>
          <div class="cons__fact">
            <dt class="cons__factk">{t('business.inbound.fact.goods')}</dt>
            <dd class="cons__factv">
              {row.description}
              {row.packages ? ` · ${t('business.inbound.packages', { n: row.packages })}` : ''} · {row.weightKg.toLocaleString()} kg
            </dd>
          </div>
          <div class="cons__fact">
            <dt class="cons__factk">{t('business.inbound.fact.to')}</dt>
            <dd class="cons__factv">{row.site.name}</dd>
          </div>
          {delivered ? (
            <div class="cons__fact">
              <dt class="cons__factk">{t('business.inbound.fact.delivered')}</dt>
              <dd class="cons__factv">
                {row.receiverName
                  ? t('business.inbound.fact.deliveredValue', { when: formatDate(delivered, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }), who: row.receiverName })
                  : formatDate(delivered, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
              </dd>
            </div>
          ) : null}
          {found ? (
            <div class="cons__fact">
              <dt class="cons__factk">{t('business.inbound.fact.found')}</dt>
              <dd class="cons__factv">{found}</dd>
            </div>
          ) : null}
          {row.incoterm ? (
            <div class="cons__fact">
              <dt class="cons__factk">{t('business.inbound.fact.term')}</dt>
              <dd class="cons__factv">
                <Abbreviated text={row.incoterm} />
              </dd>
            </div>
          ) : null}
          {/* D13 — from abroad: whether it has cleared, as the record has it. */}
          {row.abroad ? (
            <div class="cons__fact">
              <dt class="cons__factk">{t('business.inbound.fact.customs')}</dt>
              <dd class="cons__factv">
                <Abbreviated text={abroadLine(row.abroad, row.incoterm, t) ?? ''} />
              </dd>
            </div>
          ) : null}
        </dl>
        <div class="twr-panelend">
          <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => void note()}>
            {t('business.inbound.note')}
          </button>
          {row.noteId ? <NoteFile client={client} noteId={row.noteId} code={row.ref} /> : null}
        </div>
        <p class="chint">{t('business.inbound.noteCopy')}</p>
        {error ? <p class="cerr"><Abbreviated text={error} /></p> : null}
      </section>

      <LoadClaimPanel row={{ freightId: row.freightId, code: row.ref, status: row.status, claim: row.claim, claimant: row.claimant, canClaim: row.canClaim, incoterm: row.incoterm }} client={client} act={act} onChanged={onChanged} side="receiver" />

      {/* The links to its copy: to hand the note — with a claim on it, the report — to an insurer or the carrier. */}
      {row.noteId ? <NoteLinksPanel client={client} noteId={row.noteId} title={`${name} · ${row.ref}`} act={act} links={noteLinks} /> : null}
      <PaperSheet state={paper} look="console" share={row.noteId && act ? { links: noteLinks, title: `${name} · ${row.ref}` } : undefined} />
    </ConsoleDetail>
  );
}
