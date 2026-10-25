import { Card, CheckGate, PhotoField } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import { countOf, FOUND_KEYS, FOUND_KINDS, type FoundForm } from '../found';
import type { Claimable } from '../types';
import type { DriverActions } from '../useDriverApp';

/**
 * D9 — WHAT THE RECEIVER FOUND, at the door, with them (found.ts). Closed until the driver says something was not as the
 * note says; then a count for each kind, against the note's own count where it gives one, and a photograph of what is
 * damaged. It goes on the note beside the receiver's name; the delivery still stands and the sender is told.
 */
export function FoundSection({
  claim,
  open,
  setOpen,
  form,
  setForm,
  actions,
  busy,
}: {
  claim: Claimable;
  open: boolean;
  setOpen: (open: boolean) => void;
  form: FoundForm;
  setForm: (update: (form: FoundForm) => FoundForm) => void;
  actions: DriverActions;
  busy: boolean;
}) {
  const t = useT();
  return (
    <div style="margin-top:14px">
      <CheckGate items={[{ key: 'found', label: t('driver.found.toggle') }]} checked={open ? ['found'] : []} onChange={(keys) => setOpen(keys.includes('found'))} disabled={busy} />
      {open ? (
        <Card title={t('driver.found.title')} tone="soft">
          <p class="t-body">{claim.packages ? t('driver.found.against', { n: claim.packages }) : t('driver.found.noCount')}</p>
          {FOUND_KINDS.map((k) => {
            const photo = FOUND_KEYS[k].photo;
            return (
              <div key={k} class="field" style="margin-top:12px">
                <label class="field__label" for={`found-${claim.ref}-${k}`}>
                  {t(FOUND_KEYS[k].label)}
                </label>
                <input
                  id={`found-${claim.ref}-${k}`}
                  class="input"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={1}
                  placeholder="0"
                  value={form.counts[k]}
                  onInput={(e) => {
                    const value = e.currentTarget.value;
                    setForm((f) => ({ ...f, counts: { ...f.counts, [k]: value } }));
                  }}
                  disabled={busy}
                />
                {photo && (countOf(form.counts[k]) ?? 0) > 0 ? (
                  <>
                    <p class="hint">{t(photo)}</p>
                    <PhotoField
                      id={`found-${claim.ref}-${k}-photo`}
                      value={form.photos[k] ?? ''}
                      upload={(f) => actions.uploadPhoto('pod', f)}
                      onCapture={(id) => setForm((x) => ({ ...x, photos: { ...x.photos, [k]: id } }))}
                      label={t(photo)}
                      disabled={busy}
                    />
                  </>
                ) : null}
              </div>
            );
          })}
          <p class="hint" style="margin-top:12px">{t('driver.found.hint')}</p>
        </Card>
      ) : null}
    </div>
  );
}
