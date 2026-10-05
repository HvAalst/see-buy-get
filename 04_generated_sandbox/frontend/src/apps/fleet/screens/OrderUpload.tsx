import { useState } from 'preact/hooks';
import { Button, ErrorNote, Note, PlacePicker, Sheet, type PlaceNote } from '../../../shared/ui';
import { useT, type Translate } from '../../../shared/i18n';
import { pinAfterRename, type GeoPoint, type PinSource } from '../../../shared/geo';
import { importVerdictLine, notASheet, type Contract, type ImportResult, type ordersApi } from '../orders';

/** What a placed (or unplaced) collection point means here: every line without its own is collected from it. */
function pickupNote(t: Translate, note: PlaceNote): string {
  switch (note.kind) {
    case 'notFound':
      return t('fleet.upload.geoNotFound');
    case 'pinned':
      return t('fleet.upload.pinned');
    case 'found':
      return note.confidence === 'fallback' ? t('fleet.upload.geoGuess') : t('fleet.upload.geoFound', { where: note.where });
    default:
      return t('fleet.upload.noPin');
  }
}

/**
 * P1b — THE OFFICE UPLOADS A SHEET OF ORDERS for one contract.
 *
 * The user, 2026-10-05: orders also arrive as a spreadsheet the fleet uploads — a webshop's daily export. A sheet is
 * typed by people, so nothing is imported unseen: it is CHECKED first, every line judged in words, and only then
 * imported — the lines that are right, with the others left out and said why. Changing the sheet or the collection
 * point after a check throws the check away: what is imported is always what was last judged.
 */
export function OrderUpload({ contract, api, onClose, onImported }: { contract: Contract; api: ReturnType<typeof ordersApi>; onClose: () => void; onImported: (n: number) => Promise<void> | void }) {
  const t = useT();
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [label, setLabel] = useState(contract.pickup?.label ?? '');
  const [pin, setPin] = useState<GeoPoint | null>(contract.pickup?.location ?? null);
  const [from, setFrom] = useState<PinSource>(contract.pickup ? 'map' : null);
  const [checked, setChecked] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState<'check' | 'import' | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [refused, setRefused] = useState<string | null>(null);

  // Anything that changes what would be imported makes the last check a check of something else.
  const stale = () => {
    setChecked(null);
    setError(null);
  };

  const pick = async (file: File | undefined) => {
    if (!file) return;
    stale();
    const why = notASheet(file.name);
    if (why) {
      setRefused(t(why));
      setFileName(null);
      return;
    }
    setRefused(null);
    setFileName(file.name);
    setText(await file.text());
  };

  const send = async (dryRun: boolean) => {
    setBusy(dryRun ? 'check' : 'import');
    setError(null);
    const r = await api.importOrders(contract.contractId, { text, ...(label.trim() && pin ? { pickupLabel: label.trim(), pickupLat: pin.lat, pickupLng: pin.lng } : {}), dryRun });
    setBusy(null);
    if (r.error || !r.data) return setError(r.error);
    if (dryRun || r.data.refusal) return setChecked(r.data);
    await onImported(r.data.rows.filter((x) => x.code).length);
    onClose();
  };

  const template = async () => {
    const r = await api.template();
    if (r.error || !r.data) return setError(r.error);
    const url = URL.createObjectURL(new Blob([r.data.csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = r.data.fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  const bad = checked?.rows.filter((r) => r.verdict === 'problem') ?? [];

  return (
    <Sheet open onClose={onClose} title={t('fleet.upload.title', { shipper: contract.shipper.name })}>
      <p class="hint">{t('fleet.upload.lede')}</p>

      <PlacePicker
        id="up-pickup"
        fieldLabel={t('fleet.upload.pickup')}
        placeholder={t('fleet.upload.pickupPh')}
        mapLabel={t('fleet.upload.pickupMap')}
        findLabel={t('fleet.upload.find')}
        label={label}
        pin={pin}
        reference={contract.pickup?.location ?? null}
        onLabel={(v) => {
          stale();
          setLabel(v);
          setPin((p) => pinAfterRename(p, from));
        }}
        onPin={(p, src) => {
          stale();
          setPin(p);
          setFrom(src);
        }}
        geocode={async (q) => {
          const r = await api.geocode(q);
          return r.error || !r.data ? null : r.data;
        }}
        noteText={(n) => pickupNote(t, n)}
      />

      <div class="field" style="margin-top:14px">
        <label class="field__label" for="up-file">
          {t('fleet.upload.file')}
        </label>
        <input id="up-file" class="input" type="file" accept=".csv,.tsv,.txt,text/csv,text/plain" onChange={(e) => void pick(e.currentTarget.files?.[0])} />
        {refused ? <p class="hint upload__refused">{refused}</p> : null}
      </div>
      <div class="field" style="margin-top:12px">
        <label class="field__label" for="up-text">
          {t('fleet.upload.paste')}
        </label>
        <textarea
          id="up-text"
          class="input upload__text"
          rows={5}
          spellcheck={false}
          value={text}
          placeholder={t('fleet.upload.pastePh')}
          onInput={(e) => {
            stale();
            setFileName(null);
            setText(e.currentTarget.value);
          }}
        />
        <p class="hint">
          {fileName ? `${t('fleet.upload.fromFile', { name: fileName })} ` : ''}
          {t('fleet.upload.columns')}
        </p>
        <Button variant="link" chevron={false} onClick={() => void template()}>
          {t('fleet.upload.template')}
        </Button>
      </div>

      {error ? <ErrorNote error={error as never} showDetail /> : null}

      {checked?.refusal ? <Note tone="warn" icon="warning" title={t('fleet.upload.refused')} detail={checked.refusal} /> : null}
      {checked && !checked.refusal ? (
        <div class="upload__result" role="status">
          <p class="upload__sum">
            <strong>{t(checked.ok === 1 ? 'fleet.upload.readyOne' : 'fleet.upload.ready', { n: checked.ok })}</strong>
            {checked.duplicates ? <span>{t(checked.duplicates === 1 ? 'fleet.upload.duplicatesOne' : 'fleet.upload.duplicates', { n: checked.duplicates })}</span> : null}
            {checked.problems ? <span class="upload__bad">{t('fleet.upload.problems', { n: checked.problems })}</span> : null}
          </p>
          {checked.unlocated ? <p class="hint">{t(checked.unlocated === 1 ? 'fleet.upload.unlocatedOne' : 'fleet.upload.unlocated', { n: checked.unlocated })}</p> : null}
          {checked.ignored.length ? <p class="hint">{t('fleet.upload.ignored', { columns: checked.ignored.join(', ') })}</p> : null}
          {bad.length ? (
            <ul class="upload__lines">
              {bad.map((r) => (
                <li key={r.line}>{importVerdictLine(r, t)}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <div class="upload__acts">
        {checked && !checked.refusal && checked.ok > 0 ? (
          <Button chevron={false} busy={busy === 'import'} onClick={() => void send(false)}>
            {t(checked.ok === 1 ? 'fleet.upload.importOne' : 'fleet.upload.import', { n: checked.ok })}
          </Button>
        ) : (
          <Button chevron={false} disabled={!text.trim()} busy={busy === 'check'} onClick={() => void send(true)}>
            {t('fleet.upload.check')}
          </Button>
        )}
      </div>
      {checked && !checked.refusal && checked.ok > 0 && bad.length ? <p class="hint">{t('fleet.upload.partial')}</p> : null}
    </Sheet>
  );
}
