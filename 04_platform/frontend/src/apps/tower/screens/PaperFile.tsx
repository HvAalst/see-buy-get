import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { Sheet } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import type { CompanyDocument } from '../company';
import { fileSize, paperFileName, paperKindShort } from '../imports';

type Api = { importDocumentFile: (importId: string, documentId: string, entityId?: string) => Promise<{ data?: unknown; error?: unknown }> };

/**
 * A PAPER YOU CAN ACTUALLY HANDLE — open it, save it, and see who else can read it.
 *
 * Until now this register was a list of TITLES. An agent was asked to accept or reject a bill of lading
 * they had no way of looking at, and the importer could see the name of a file and nothing else. The
 * route to the bytes has existed since CL2a; nothing was missing except the asking. Same defect as the
 * claims queue that counted photographs and showed none.
 *
 * The shape is BondBridge's document row, which the user pointed at: a tile, a name, one line of
 * detail, the actions on the right. Two differences, both deliberate —
 *
 *  - THE TILE SAYS "PDF", NOT A PICTURE OF A PAGE. This product uses no emoji as a UI icon (Icon.tsx
 *    says why), and three letters read faster than a glyph anyway.
 *  - SHARING IS NOT COPYING. BondBridge shares inside by reference and grants the recipient access;
 *    here the grant already IS the model, so the sheet SHOWS who can read this paper and says where
 *    that is decided. What it will not do is invent a per-document permission — an importer decides
 *    about a scope, and a second list beside the grants would drift away from them.
 */
export function PaperFile({
  doc,
  importId,
  entityId,
  api,
  readers,
  onError,
}: {
  doc: CompanyDocument;
  importId: string;
  entityId?: string;
  api: Api | null;
  /** Who else can read this one, derived from the grants. Omitted for a reader who is not the owner. */
  readers?: string[];
  onError: (message: string) => void;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [sharing, setSharing] = useState(false);

  const bytes = async (): Promise<Blob | null> => {
    if (!api) return null;
    setBusy(true);
    const r = await api.importDocumentFile(importId, doc.documentId, entityId);
    setBusy(false);
    if (r.error || !r.data) {
      // A paper the grant does not reach answers NOT FOUND, never FORBIDDEN, so the screen cannot tell
      // "gone" from "not yours" — and says both rather than picking one and being wrong.
      onError(t('tower.imports.paper.unreadable', { title: doc.title }));
      return null;
    }
    return r.data as Blob;
  };

  /* Opened in a tab, not rendered inline: a PDF and a photograph both arrive here and the browser
     already knows how to show either. Revoked on the next tick — the tab has the handle by then. */
  const open = async () => {
    const blob = await bytes();
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  const save = async () => {
    const blob = await bytes();
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = paperFileName(doc);
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  /* OUTSIDE THE NETWORK: the phone's own share sheet where there is one, and a download where there is
     not. A link would be no use to a customs officer on WhatsApp — the route is bearer-gated, so what
     has to travel is the bytes. */
  const sendOut = async () => {
    const blob = await bytes();
    if (!blob) return;
    const file = new File([blob], paperFileName(doc), { type: doc.contentType });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: doc.title }).catch(() => {});
      return;
    }
    await save();
  };

  return (
    <div class="cdoc">
      <span class="cdoc__tile" aria-hidden="true">
        {paperKindShort(doc.contentType)}
      </span>
      <span class="cdoc__body">
        <span class="cdoc__name">{doc.title}</span>
        <span class="cdoc__meta">
          {fileSize(doc.size)} · {t('tower.imports.paper.added', { when: doc.uploadedAt.slice(0, 10), who: doc.uploadedBy })}
          {doc.expiresAt ? ` · ${t('tower.imports.paper.expires', { date: doc.expiresAt.slice(0, 10) })}` : ''}
        </span>
      </span>
      <span class="cdoc__acts">
        <button type="button" class="cbtn cbtn--ghost cbtn--sm" disabled={!api || busy} onClick={() => void open()}>
          {t('tower.imports.paper.open')}
        </button>
        <button type="button" class="cbtn cbtn--ghost cbtn--sm" disabled={!api || busy} onClick={() => void save()}>
          {t('tower.imports.paper.save')}
        </button>
        {readers ? (
          <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => setSharing(true)}>
            {/* The COUNT is on the button, so an importer can see at a glance which papers are out. */}
            {readers.length === 0 ? t('tower.imports.paper.shareNone') : t('tower.imports.paper.shareN', { n: readers.length })}
          </button>
        ) : null}
      </span>

      {sharing && readers ? (
        <Sheet open onClose={() => setSharing(false)} title={doc.title}>
          <p class="cons__lede">{doc.relatesTo ? t('tower.imports.paper.scopeConsignment', { code: doc.relatesTo }) : t('tower.imports.paper.scopeCompany')}</p>
          {readers.length === 0 ? (
            <p class="cons__empty">{t('tower.imports.paper.readersNone')}</p>
          ) : (
            <ul class="twr-checklist">
              {readers.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          )}
          {/* Said where somebody is looking at the audience and might expect to change it here. They
              cannot: access is granted over a SCOPE, on the panel above, and this is its consequence. */}
          <p class="chint">{t('tower.imports.paper.shareWhere')}</p>
          <div class="twr-panelend">
            <button type="button" class="cbtn cbtn--primary" disabled={busy} onClick={() => void sendOut()}>
              {t('tower.imports.paper.sendOut')}
            </button>
          </div>
          <p class="chint">{t('tower.imports.paper.sendOutHint')}</p>
        </Sheet>
      ) : null}
    </div>
  );
}

/** The register as a group of rows — bordered once, divided between, the way this console draws facts. */
export function PaperFiles({ children, empty }: { children: ComponentChildren; empty: string }) {
  const any = Array.isArray(children) ? children.flat().filter(Boolean).length > 0 : Boolean(children);
  return any ? <div class="cdocs">{children}</div> : <p class="cons__empty">{empty}</p>;
}
