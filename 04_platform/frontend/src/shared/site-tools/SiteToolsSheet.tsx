import { useEffect, useState } from 'preact/hooks';
import { Button, ErrorNote, Note, PhotoField, Sheet } from '../ui';
import { formatDate, useT } from '../i18n';
import { paperDay } from '../papers';
import type { SbgError } from '../../lib/sbg';
import type { Uploaded } from '../upload';
import { SITE_EQUIPMENT, limitsLines, stampLine, toolsBody, toolsForm, type SiteToolsView, type ToolsBody, type ToolsForm } from '../siteTools';

type Answer = { data?: unknown; error?: SbgError | null };

/**
 * 2026-11-13 — YOUR TOOLS (the owner: "shop and hub tools"; plan T1–T5), for a shop's counter and a hub's floor alike: its
 * handling equipment, its scale (in Kenya, with the inspector's stamp and certificate), a label printer and CCTV — and what they
 * let it take, as the server says. Opened from the shop's settings and the hub's start screen; said by the owner alone.
 */
export function SiteToolsSheet({ open, onClose, load, save, upload, onSaved }: { open: boolean; onClose: () => void; load: () => Promise<Answer>; save: (body: ToolsBody) => Promise<Answer>; upload: (file: File) => Promise<Uploaded>; onSaved?: (v: SiteToolsView) => void }) {
  const t = useT();
  const [view, setView] = useState<SiteToolsView | null>(null);
  const [form, setForm] = useState<ToolsForm>(toolsForm(null));
  const [error, setError] = useState<SbgError | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    let live = true;
    void load().then((r) => {
      if (!live) return;
      if (r.error) return setError(r.error);
      const v = r.data as SiteToolsView;
      setView(v);
      setForm(toolsForm(v));
    });
    return () => {
      live = false;
    };
  }, [open]);
  if (!open) return null;
  const set = (patch: Partial<ToolsForm>) => setForm((f) => ({ ...f, ...patch }));
  const made = toolsBody(form, Boolean(view?.stampCountry));
  const submit = async () => {
    if (!('body' in made)) return;
    setBusy(true);
    setError(null);
    const r = await save(made.body);
    setBusy(false);
    if (r.error) return setError(r.error);
    const v = r.data as SiteToolsView;
    setView(v);
    onSaved?.(v);
    onClose();
  };
  const stamp = view ? stampLine(view.stamp, t, paperDay) : null;
  const last = view?.tools?.history?.[0];
  return (
    <Sheet open onClose={onClose} title={t('tools.title')}>
      <p class="t-body">{t('tools.body')}</p>
      {view ? <Note tone="info" icon="scale" title={limitsLines(view.limits, t)[0]} detail={limitsLines(view.limits, t).slice(1).join(' ')} /> : null}
      {stamp ? <Note tone={view?.stamp.state === 'lapsed' ? 'warn' : 'info'} icon="clock" title={stamp} /> : null}
      {error ? <ErrorNote error={error} /> : null}

      <div class="field">
        <span class="field__label">{t('tools.handling')}</span>
        <div class="chips">
          {SITE_EQUIPMENT.map((eq) => {
            const on = form.equipment.includes(eq.key);
            return (
              <button key={eq.key} type="button" class={`chip chip--tap${on ? ' chip--on' : ''}`} aria-pressed={on} onClick={() => set({ equipment: on ? form.equipment.filter((e) => e !== eq.key) : [...form.equipment, eq.key] })}>
                {t(eq.label)}
              </button>
            );
          })}
        </div>
      </div>
      {form.equipment.includes('FLT') ? (
        <div class="field">
          <label class="field__label" for="tools-flt">
            {t('tools.forkliftLicence')}
          </label>
          <input id="tools-flt" class="input" autoComplete="off" value={form.forkliftLicence} onInput={(e) => set({ forkliftLicence: e.currentTarget.value })} />
        </div>
      ) : null}

      <div class="field">
        <span class="field__label">{t('tools.others')}</span>
        <div class="chips">
          {(
            [
              ['hasScale', 'tools.scale'],
              ['labelPrinter', 'tools.printer'],
              ['cctv', 'tools.cctv'],
            ] as const
          ).map(([key, label]) => (
            <button key={key} type="button" class={`chip chip--tap${form[key] ? ' chip--on' : ''}`} aria-pressed={form[key]} onClick={() => set({ [key]: !form[key] } as Partial<ToolsForm>)}>
              {t(label)}
            </button>
          ))}
        </div>
      </div>

      {form.hasScale ? (
        <>
          <div class="field">
            <label class="field__label" for="tools-scale-max">
              {t('tools.scaleMax')}
            </label>
            <input id="tools-scale-max" class="input" type="number" inputMode="decimal" min="0.1" step="0.1" value={form.scaleMaxKg} onInput={(e) => set({ scaleMaxKg: e.currentTarget.value })} />
          </div>
          <label class="field" style="display:flex;gap:10px;align-items:center">
            <input id="tools-approved" type="checkbox" checked={form.approved} onChange={(e) => set({ approved: e.currentTarget.checked })} />
            <span>{t(view?.stampCountry ? 'tools.stamped' : 'tools.approved')}</span>
          </label>
          {form.approved && view?.stampCountry ? (
            <>
              <div class="field">
                <label class="field__label" for="tools-stamp">
                  {t('tools.stampedUntil')}
                </label>
                <input id="tools-stamp" class="input" type="date" value={form.stampedUntil} onInput={(e) => set({ stampedUntil: e.currentTarget.value })} />
              </div>
              <PhotoField id="tools-certificate" value={form.certificateRef} label={t('tools.certificate')} upload={upload} onCapture={(certificateRef) => set({ certificateRef })} />
            </>
          ) : null}
        </>
      ) : null}

      {'error' in made ? <p class="hint">{t(made.error)}</p> : null}
      <Button chevron={false} busy={busy} disabled={!view || !('body' in made)} onClick={() => void submit()}>
        {t('tools.save')}
      </Button>
      {last ? <p class="hint">{t('tools.lastChanged', { date: formatDate(last.at), who: last.by })}</p> : null}
    </Sheet>
  );
}
