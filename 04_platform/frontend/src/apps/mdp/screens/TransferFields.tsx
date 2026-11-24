import { Button, Note, PhotoField, ScanField } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import type { Uploaded } from '../../../shared/upload';
import { MAX_TRANSFER_EXCEPTIONS, type TransferForm } from '../transfer';

export interface TransferFieldsProps {
  fromCountry: string;
  value: TransferForm;
  onChange: (next: TransferForm) => void;
  upload: (file: File) => Promise<Uploaded>;
  disabled?: boolean;
}

/**
 * 2026-11-24 — A BAG FROM ANOTHER COUNTRY, HANDED OVER BY NAME (corridor compliance, slice 4): the pass on the phone of the driver
 * who brought it, scanned; and what is wrong with it, each thing in words with a photograph where one is taken. The person
 * receiving it is whoever is signed in.
 */
export function TransferFields({ fromCountry, value, onChange, upload, disabled }: TransferFieldsProps) {
  const t = useT();
  const set = (i: number, part: Partial<TransferForm['exceptions'][number]>) => onChange({ ...value, exceptions: value.exceptions.map((e, j) => (j === i ? { ...e, ...part } : e)) });
  return (
    <>
      <Note tone="info" icon="info" title={t('mdp.transfer.title', { country: fromCountry })} detail={t('mdp.transfer.lede')} />
      <ScanField id="drop-pass" label={t('mdp.transfer.pass')} value={value.pass} onValue={(v) => onChange({ ...value, pass: v })} expect="badge" placeholder="DRV-000000-000000" upper enterKeyHint="next" />
      {value.exceptions.map((e, i) => (
        <div key={i} class="field" style="margin-top:12px">
          <label class="field__label" for={`drop-wrong-${i}`}>
            {t('mdp.transfer.wrong', { n: i + 1 })}
          </label>
          <textarea id={`drop-wrong-${i}`} class="input" rows={2} maxLength={500} value={e.note} disabled={disabled} onInput={(ev) => set(i, { note: ev.currentTarget.value })} />
          <PhotoField id={`drop-wrong-${i}-photo`} value={e.photoRef ?? ''} upload={upload} onCapture={(photoRef) => set(i, { photoRef })} label={t('mdp.transfer.wrongPhoto')} disabled={disabled} />
          <Button variant="link" full={false} onClick={() => onChange({ ...value, exceptions: value.exceptions.filter((_, j) => j !== i) })} disabled={disabled}>
            {t('mdp.transfer.remove')}
          </Button>
        </div>
      ))}
      {value.exceptions.length < MAX_TRANSFER_EXCEPTIONS ? (
        <div style="margin-top:8px">
          <Button variant="outline" full={false} onClick={() => onChange({ ...value, exceptions: [...value.exceptions, { note: '' }] })} disabled={disabled}>
            {t('mdp.transfer.addWrong')}
          </Button>
        </div>
      ) : null}
    </>
  );
}
