import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { narrow, type ConversationsApi } from '../../lib/sbg';
import { formatDate, useT } from '../i18n';
import { AuthImage, Button, Chip, ErrorNote, Icon, Note, Sheet } from '../ui';
import { CameraCapture, canCaptureLive } from '../ui/CameraCapture';
import {
  byKey,
  FILED_AS,
  proofChoices,
  recordKey,
  shortPrint,
  sourceLabel,
  whatKey,
  type FiledPhotoRef,
  type FiledPhotoView,
  type FilingChoice,
  type FilingSubject,
  type PhotoSource,
  type PreparedPhoto,
} from './filedPhotoLogic';

/** A time as a chat says it: the time today, the date and time otherwise. */
export function whenSaid(at: string): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return '';
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString() ? time : `${formatDate(at)} ${time}`;
}

/**
 * 2026-11-02 — THE CARD A FILED PHOTO LEAVES IN THE CHAT (the owner: "Filed: FRT-7781 › Damage · taken 10:42 in the app ·
 * Tsehay · fingerprint 3f9a…c21 · Open in the load's record"). Words only — the picture is in the record, and opens from
 * the card. `who` is the author as the chat already names them: "You", the other side's name, or their part.
 */
export function FiledPhotoCard({ photo, who, onOpen }: { photo: FiledPhotoRef; who: string; onOpen: () => void }) {
  const t = useT();
  const source = sourceLabel(photo, whenSaid);
  return (
    <div class="filedphoto">
      <b class="filedphoto__t">
        <Icon name="camera" size={18} /> {t('common.chat.photo.filedTo', { code: photo.code, what: t(whatKey(photo)) })}
      </b>
      <span class="filedphoto__s">
        {t(source.key, source.params)} · {who} · {t('common.chat.photo.print', { print: shortPrint(photo.fingerprint) })}
      </span>
      <button type="button" class="linkbtn filedphoto__open" onClick={onOpen}>
        {t(recordKey(photo.subject))}
      </button>
    </div>
  );
}

/** "What is this?" — Damage, A paper, or Proof of one moment. Proof offers only the moments this record has. */
export function WhatIsThis({ subject, choice, onChoose }: { subject: FilingSubject | undefined; choice: FilingChoice | null; onChoose: (choice: FilingChoice | null) => void }) {
  const t = useT();
  const proofs = proofChoices(subject);
  const [proofOpen, setProofOpen] = useState(choice?.as === 'proof');
  return (
    <div class="filedphoto__what">
      <p class="field__label">{t('common.chat.photo.what')}</p>
      <div class="chiprow" role="group" aria-label={t('common.chat.photo.what')}>
        {FILED_AS.map((as) => (
          <Chip
            key={as}
            label={t(`common.chat.photo.as.${as}` as 'common.chat.photo.as.damage')}
            active={as === 'proof' ? proofOpen || choice?.as === 'proof' : choice?.as === as}
            onClick={() => {
              if (as === 'proof') {
                setProofOpen(true);
                onChoose(proofs.length === 1 ? { as: 'proof', proofOf: proofs[0] } : choice?.as === 'proof' ? choice : null);
              } else {
                setProofOpen(false);
                onChoose({ as } as FilingChoice);
              }
            }}
          />
        ))}
      </div>
      {proofOpen ? (
        <>
          <p class="field__label" style="margin-top:8px">
            {t('common.chat.photo.proofOf')}
          </p>
          <div class="chiprow" role="group" aria-label={t('common.chat.photo.proofOf')}>
            {proofs.map((p) => (
              <Chip
                key={p}
                label={t(`common.chat.photo.proof.${p}` as 'common.chat.photo.proof.handover')}
                active={choice?.as === 'proof' && choice.proofOf === p}
                onClick={() => onChoose({ as: 'proof', proofOf: p })}
              />
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

/**
 * THE PHOTO, BEFORE IT IS FILED: what it is, where it came from, and what filing does — then File it, or put it away. Drawn
 * from props alone so a test can hold it to its words.
 */
export function PhotoFilingView({
  photo,
  subject,
  code,
  choice,
  busy,
  failed,
  onChoose,
  onFile,
  onCancel,
}: {
  photo: PreparedPhoto;
  subject: FilingSubject | undefined;
  code: string;
  choice: FilingChoice | null;
  busy: boolean;
  failed: string | null;
  onChoose: (choice: FilingChoice | null) => void;
  onFile: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  const source = sourceLabel(photo);
  return (
    <div class="filedphoto__panel">
      <img class="filedphoto__preview" src={photo.dataUrl} alt={t('common.chat.photo.previewAlt')} />
      <p class="hint">{t(source.key, source.params)}</p>
      <WhatIsThis subject={subject} choice={choice} onChoose={onChoose} />
      <p class="hint" style="margin-top:8px">
        {t('common.chat.photo.lede', { code })}
      </p>
      {failed ? (
        <p class="hint" role="alert">
          {failed}
        </p>
      ) : null}
      <div class="sharedin__acts">
        <Button full={false} chevron={false} busy={busy} disabled={!choice} onClick={onFile}>
          {t('common.chat.photo.file')}
        </Button>
        <Button variant="link" full={false} disabled={busy} onClick={onCancel}>
          {t('common.cancel')}
        </Button>
      </div>
    </div>
  );
}

/**
 * THE TWO WAYS A PHOTO COMES IN: the app's own live camera (where the phone has one the app can open), or the gallery —
 * a plain file picker, with no `capture`, because a file is a file whichever app made it, and is labelled as one.
 */
export function PhotoPicker({ busy, onPicked }: { busy: boolean; onPicked: (file: Blob, source: PhotoSource, takenAt?: string) => void }) {
  const t = useT();
  const [camera, setCamera] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const live = canCaptureLive();
  const gallery = () => {
    setCamera(false);
    input.current?.click();
  };
  return (
    <div class="sharedin__acts" style="margin-top:12px">
      {live ? (
        <Button variant="outline" full={false} chevron={false} busy={busy} onClick={() => setCamera(true)}>
          <Icon name="camera" size={18} /> {t('common.chat.photo.take')}
        </Button>
      ) : null}
      <Button variant={live ? 'link' : 'outline'} full={false} chevron={false} disabled={busy} onClick={gallery}>
        {t('common.chat.photo.gallery')}
      </Button>
      <input
        ref={input}
        type="file"
        accept="image/*"
        data-upload="photo"
        class="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          const file = e.currentTarget.files?.[0];
          e.currentTarget.value = '';
          if (file) onPicked(file, 'gallery');
        }}
      />
      <CameraCapture
        open={camera}
        title={t('common.chat.photo.camera.title')}
        onClose={() => setCamera(false)}
        onUseGallery={gallery}
        onTaken={(blob, takenAt) => {
          setCamera(false);
          onPicked(blob, 'app_camera', takenAt);
        }}
      />
    </div>
  );
}

/**
 * ONE FILED PHOTO, OPENED FROM ITS CARD: the picture, fetched through the chat by somebody who may see it; where it came
 * from; who filed it and when; its fingerprints, whole — and the record's photo file, everything filed to the load or
 * parcel that this reader may see.
 */
export function FiledPhotoSheet({ api, conversationId, photo, onClose }: { api: ConversationsApi | null; conversationId: string | null; photo: FiledPhotoRef | null; onClose: () => void }) {
  const t = useT();
  const [shown, setShown] = useState<FiledPhotoRef | null>(photo);
  const [record, setRecord] = useState<FiledPhotoView[] | null>(null);
  const [recordOpen, setRecordOpen] = useState(false);
  const [error, setError] = useState<Parameters<typeof ErrorNote>[0]['error'] | null>(null);

  useEffect(() => {
    setShown(photo);
    setRecordOpen(false);
    setRecord(null);
  }, [photo]);

  const load = useCallback(
    (variant: 'full' | 'thumb') => async (filingId: string) => {
      if (!api || !conversationId) return { data: null, error: 'no chat' };
      const r = await api.photoBlob(conversationId, filingId, variant);
      return { data: (r.data ?? null) as unknown as Blob | null, error: r.error };
    },
    [api, conversationId],
  );

  const openRecord = async () => {
    setRecordOpen(true);
    if (!api || !conversationId) return;
    const r = await api.recordPhotos(conversationId);
    if (r.error) return setError(r.error);
    setError(null);
    setRecord(narrow<{ items: FiledPhotoView[] }>(r.data)?.items ?? []);
  };

  if (!shown) return null;
  const source = sourceLabel(shown);
  return (
    <Sheet open={Boolean(photo)} onClose={onClose} title={t('common.chat.photo.viewTitle', { code: shown.code, what: t(whatKey(shown)) })}>
      <AuthImage key={shown.filingId} mediaId={shown.filingId} load={load('full')} alt={t(whatKey(shown))} class="filedphoto__full" />
      <p class="t-body" style="margin-top:8px">
        {t(source.key, source.params)}
      </p>
      <p class="hint">{t('common.chat.photo.filedBy', { who: t(byKey(shown.by, shown.subject)), when: whenSaid(shown.filedAt) })}</p>
      {shown.writtenAt ? <p class="hint">{t('common.chat.photo.filedOffline', { when: whenSaid(shown.writtenAt) })}</p> : null}
      <dl class="filedphoto__prints">
        <dt>{t('common.chat.photo.printFiling')}</dt>
        <dd>
          <code>{shown.fingerprint}</code>
        </dd>
        <dt>{t('common.chat.photo.printPhoto')}</dt>
        <dd>
          <code>{shown.sha256}</code>
        </dd>
        {shown.originalSha256 ? (
          <>
            <dt>{t('common.chat.photo.printOriginal')}</dt>
            <dd>
              <code>{shown.originalSha256}</code>
            </dd>
          </>
        ) : null}
      </dl>
      <Note tone="info" icon="info" title={t('common.chat.photo.keptTitle')} detail={t(shown.subject === 'parcel' ? 'common.chat.photo.keptParcel' : 'common.chat.photo.keptFreight')} />
      {recordOpen ? (
        <div style="margin-top:12px">
          <h3 class="scr__section">{t(shown.subject === 'parcel' ? 'common.chat.photo.recordTitle.parcel' : 'common.chat.photo.recordTitle.freight', { code: shown.code })}</h3>
          {error ? (
            <ErrorNote error={error} onRetry={() => void openRecord()} />
          ) : record === null ? (
            <p class="hint">{t('common.loading')}</p>
          ) : (
            <>
              <p class="hint">{t('common.chat.photo.recordLede', { count: record.length })}</p>
              <div class="rows" role="list">
                {record.map((f) => {
                  const s = sourceLabel(f);
                  return (
                    <button key={f.filingId} type="button" class="row" aria-current={f.filingId === shown.filingId} onClick={() => setShown(f)}>
                      <span class="row__ic filedphoto__thumb">
                        <AuthImage mediaId={f.filingId} load={load('thumb')} alt={t(whatKey(f))} />
                      </span>
                      <span class="row__body">
                        <span class="row__t">{t(whatKey(f))}</span>
                        <span class="row__s">
                          {t(s.key, s.params)} · {t(byKey(f.by, f.subject))} · {whenSaid(f.filedAt)}
                          {f.here ? '' : ` · ${t('common.chat.photo.fromOther')}`}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      ) : (
        <div style="margin-top:12px">
          <Button variant="outline" full={false} chevron={false} onClick={() => void openRecord()}>
            {t(recordKey(shown.subject))}
          </Button>
        </div>
      )}
    </Sheet>
  );
}
