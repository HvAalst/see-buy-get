import { useEffect, useState } from 'preact/hooks';
import { Button, Note, PhotoField, Sheet } from './ui';
import { useT, type MessageKey } from './i18n';
import { bagFindings, reportBody, reportReady, type BagClosedWith, type BagCloseForm, type BagFinding, type BagReceiptForm, type BagReportForm } from './bagSeal';

/*
 * ROUND 36 — THE BAG'S SEAL, AT THE COUNTER AND THE HUB (shared/bagSeal.ts). The same three moments in the shop, the hub
 * and the store's dock: closing a bag for the road, receiving one before it is opened, and reporting one that is not as
 * it was closed.
 */

type Upload = (file: File) => Promise<string | null>;

/** The seal's number: digits on the seals we suggest, so the number pad — letters when the seal carries them. */
function SealInput({ id, label, hint, value, onInput, disabled }: { id: string; label: string; hint?: string; value: string; onInput: (v: string) => void; disabled?: boolean }) {
  const t = useT();
  const [letters, setLetters] = useState(false);
  return (
    <div class="field">
      <label class="field__label" for={id}>
        {label}
      </label>
      <input id={id} class="input" inputMode={letters ? 'text' : 'numeric'} autocomplete="off" autocapitalize="characters" maxLength={40} value={value} disabled={disabled} onInput={(e) => onInput(e.currentTarget.value)} />
      {hint ? <p class="hint">{hint}</p> : null}
      <Button variant="link" full={false} onClick={() => setLetters((x) => !x)}>
        {t(letters ? 'common.bag.digitsOnly' : 'common.bag.lettersToo')}
      </Button>
    </div>
  );
}

/** Closing a bag for the road: a coded seal (suggested) with its number and a photograph, or a photograph alone. */
export function BagCloseFields({ id, value, onChange, upload, disabled }: { id: string; value: BagCloseForm; onChange: (v: BagCloseForm) => void; upload: Upload; disabled?: boolean }) {
  const t = useT();
  const chip = (kind: BagClosedWith, key: MessageKey) => (
    <button type="button" class={'chip chip--tap' + (value.kind === kind ? ' chip--on' : '')} aria-pressed={value.kind === kind} disabled={disabled} onClick={() => onChange({ ...value, kind })}>
      {t(key)}
    </button>
  );
  return (
    <div class="bag-seal">
      <p class="field__label">{t('common.bag.closeTitle')}</p>
      <div class="chips">
        {chip('seal', 'common.bag.withSeal')}
        {chip('photo', 'common.bag.withPhoto')}
      </div>
      {value.kind === 'seal' ? (
        <SealInput id={`${id}-seal`} label={t('common.bag.sealLabel')} hint={t('common.bag.sealHint')} value={value.seal} onInput={(seal) => onChange({ ...value, seal })} disabled={disabled} />
      ) : (
        <p class="hint">{t('common.bag.photoOnlyHint')}</p>
      )}
      <div class="field">
        <span class="field__label">{t(value.kind === 'seal' ? 'common.bag.photoSeal' : 'common.bag.photoOnly')}</span>
        <PhotoField id={`${id}-photo`} value={value.photoRef} upload={upload} onCapture={(photoRef) => onChange({ ...value, photoRef })} label={t(value.kind === 'seal' ? 'common.bag.photoSeal' : 'common.bag.photoOnly')} disabled={disabled} />
      </div>
    </div>
  );
}

/**
 * Receiving a bag, before it is opened: on a sealed bag the number read off the seal — never shown here — a photograph
 * as it arrived, and whether it is as it was closed. Not as closed, and it is reported (onReport).
 */
export function BagReceiptFields({
  id,
  closedWith,
  value,
  onChange,
  upload,
  onReport,
  disabled,
  take,
}: {
  id: string;
  closedWith: BagClosedWith | undefined;
  value: BagReceiptForm;
  onChange: (v: BagReceiptForm) => void;
  upload: Upload;
  onReport: () => void;
  disabled?: boolean;
  /** Round 37 — the driver taking it, rather than whoever receives it. */
  take?: boolean;
}) {
  const t = useT();
  const photo = t(take ? 'common.bag.photoTaken' : 'common.bag.photoArrived');
  return (
    <div class="bag-seal">
      <p class="field__label">{t(take ? 'common.bag.takeTitle' : 'common.bag.receiveTitle')}</p>
      {closedWith === 'seal' ? (
        <SealInput id={`${id}-read`} label={t('common.bag.readSeal')} hint={t('common.bag.readSealHint')} value={value.sealNumber} onInput={(sealNumber) => onChange({ ...value, sealNumber })} disabled={disabled} />
      ) : closedWith === 'photo' ? (
        <p class="hint">{t('common.bag.unsealed')}</p>
      ) : null}
      <div class="field">
        <span class="field__label">{photo}</span>
        <PhotoField id={`${id}-photo`} value={value.photoRef} upload={upload} onCapture={(photoRef) => onChange({ ...value, photoRef })} label={photo} disabled={disabled} />
      </div>
      <div class="chips">
        <button type="button" class={'chip chip--tap' + (value.asClosed === true ? ' chip--on' : '')} aria-pressed={value.asClosed === true} disabled={disabled} onClick={() => onChange({ ...value, asClosed: true })}>
          {t('common.bag.asClosed')}
        </button>
        <button type="button" class={'chip chip--tap' + (value.asClosed === false ? ' chip--on' : '')} aria-pressed={value.asClosed === false} disabled={disabled} onClick={() => onChange({ ...value, asClosed: false })}>
          {t('common.bag.notAsClosed')}
        </button>
      </div>
      {value.asClosed === false ? (
        <>
          <Note tone="warn" icon="warning" title={t(take ? 'common.bag.notAsClosedTakeTitle' : 'common.bag.notAsClosedTitle')} detail={t(take ? 'common.bag.notAsClosedTakeBody' : 'common.bag.notAsClosedBody')} />
          <Button variant="link" full={false} disabled={disabled} onClick={onReport}>
            {t('common.bag.report')}
          </Button>
        </>
      ) : null}
    </div>
  );
}

const FINDING_KEY: Record<BagFinding, MessageKey> = {
  seal_not_as_written: 'common.bag.finding.seal_not_as_written',
  seal_broken: 'common.bag.finding.seal_broken',
  wrap_cut: 'common.bag.finding.wrap_cut',
};

/** Reporting a bag not as it was closed: what was found, its photograph, what is seen. The bag is held. */
export function BagReportSheet({
  code,
  closedWith,
  numberRead,
  upload,
  busy,
  onSend,
  onClose,
}: {
  /** The bag being reported; null when the sheet is closed. */
  code: string | null;
  closedWith: BagClosedWith | undefined;
  /** A number already read off the seal, carried over from a reading that did not match. */
  numberRead?: string;
  upload: Upload;
  busy: boolean;
  onSend: (body: ReturnType<typeof reportBody>) => void;
  onClose: () => void;
}) {
  const t = useT();
  const empty = (): BagReportForm => ({ finding: numberRead ? 'seal_not_as_written' : null, numberRead: numberRead ?? '', photoRef: '', note: '' });
  const [form, setForm] = useState<BagReportForm>(empty);
  useEffect(() => setForm(empty()), [code, numberRead]);
  return (
    <Sheet open={code !== null} onClose={onClose} title={t('common.bag.reportTitle')}>
      {code ? (
        <>
          <p class="t-body">{t('common.bag.reportBody', { code })}</p>
          <div class="chips">
            {bagFindings(closedWith).map((f) => (
              <button key={f} type="button" class={'chip chip--tap' + (form.finding === f ? ' chip--on' : '')} aria-pressed={form.finding === f} onClick={() => setForm({ ...form, finding: f })}>
                {t(FINDING_KEY[f])}
              </button>
            ))}
          </div>
          {form.finding === 'seal_not_as_written' ? (
            <SealInput id="bag-report-read" label={t('common.bag.readSeal')} value={form.numberRead} onInput={(v) => setForm({ ...form, numberRead: v })} disabled={busy} />
          ) : null}
          <div class="field" style="margin-top:12px">
            <span class="field__label">{t('common.bag.reportPhoto')}</span>
            <PhotoField id="bag-report-photo" value={form.photoRef} upload={upload} onCapture={(photoRef) => setForm({ ...form, photoRef })} label={t('common.bag.reportPhoto')} disabled={busy} />
          </div>
          <div class="field">
            <label class="field__label" for="bag-report-note">
              {t('common.bag.reportNote')}
            </label>
            <textarea id="bag-report-note" class="input" rows={2} maxLength={500} value={form.note} disabled={busy} onInput={(e) => setForm({ ...form, note: e.currentTarget.value })} />
          </div>
          <p class="hint">{t('common.bag.reportWho')}</p>
          <Button chevron={false} busy={busy} disabled={!reportReady(form)} onClick={() => onSend(reportBody(form))}>
            {t('common.bag.report')}
          </Button>
          <Button variant="link" onClick={onClose}>
            {t('common.bag.reportCancel')}
          </Button>
        </>
      ) : null}
    </Sheet>
  );
}
