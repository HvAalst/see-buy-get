import type { ComponentChildren } from 'preact';
import { useT, type MessageKey } from '../i18n';
import { Chip } from '../ui/Chip';
import {
  END_EQUIPMENT,
  EQUIPMENT_LABEL,
  HANDLING_MARKS,
  HANDS_LABEL,
  LOAD_NEEDS,
  MARK_LABEL,
  NEEDS_LABEL,
  SITE_HANDS,
  bringsWords,
  gapAt,
  namesExtraWork,
  workBody,
  type EndForm,
  type LoadWorkForm,
} from '../loadWork';

/** Which app's form it sits in: an app's fields and chips, or the console's (the Business app). */
type Look = 'app' | 'console';
const CLS = {
  app: { field: 'field', label: 'field__label', input: 'input', hint: 'card__note', check: 'checkline' },
  console: { field: 'cfield', label: 'cfield__label', input: 'cinput', hint: 'chint', check: 'cfield--check' },
} as const;

/** One choice — or several — said as chips in an app, as ticks in the console. */
function Pick<V extends string>({ look, label, options, chosen, onPick, multi = false, name }: { look: Look; label: string; options: Array<{ value: V; label: string }>; chosen: V[]; onPick: (v: V) => void; multi?: boolean; name: string }) {
  const c = CLS[look];
  if (look === 'app') {
    return (
      <div class={c.field}>
        <span class={c.label} id={`${name}-label`}>
          {label}
        </span>
        <div class="chiprow" role="group" aria-labelledby={`${name}-label`}>
          {options.map((o) => (
            <Chip key={o.value} label={o.label} active={chosen.includes(o.value)} onClick={() => onPick(o.value)} />
          ))}
        </div>
      </div>
    );
  }
  return (
    <fieldset class={c.field}>
      <legend class={c.label}>{label}</legend>
      {options.map((o) => (
        <label class={c.check} key={o.value}>
          <input type={multi ? 'checkbox' : 'radio'} name={name} checked={chosen.includes(o.value)} onChange={() => onPick(o.value)} />
          <span>{o.label}</span>
        </label>
      ))}
    </fieldset>
  );
}

function NumberField({ look, label, value, onInput, max }: { look: Look; label: string; value: string; onInput: (v: string) => void; max: number }) {
  const c = CLS[look];
  return (
    <label class={c.field}>
      <span class={c.label}>{label}</span>
      <input class={c.input} type="number" inputMode="numeric" min="0" max={max} step="1" value={value} onInput={(e) => onInput((e.target as HTMLInputElement).value)} />
    </label>
  );
}

function Check({ look, label, checked, onChange }: { look: Look; label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label class={CLS[look].check}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange((e.target as HTMLInputElement).checked)} />
      <span>{label}</span>
    </label>
  );
}

/** One end of the load: one tap when the sender loads (or the receiver unloads) it; else who helps, what is there, the access. */
function EndFields({ look, which, end, set, needs, t }: { look: Look; which: 'pickup' | 'delivery'; end: EndForm; set: (patch: Partial<EndForm>) => void; needs: LoadWorkForm['needs']; t: (k: MessageKey, p?: Record<string, string | number>) => string }) {
  const c = CLS[look];
  const body = needs ? workBody({ needs, pickup: end, delivery: end, marks: [] }) : undefined;
  const brings = body && (end.theyDoIt || end.hands) ? bringsWords(gapAt(body.needs, body.pickup), t) : '';
  return (
    <div class="loadwork__end">
      <strong>{t(which === 'pickup' ? 'work.pickup' : 'work.delivery')}</strong>
      <Check look={look} label={t(which === 'pickup' ? 'work.senderLoads' : 'work.receiverUnloads')} checked={end.theyDoIt} onChange={(v) => set({ theyDoIt: v })} />
      {end.theyDoIt ? null : (
        <>
          <Pick
            look={look}
            name={`work-${which}-hands`}
            label={t('work.hands')}
            options={SITE_HANDS.map((h) => ({ value: h, label: t(HANDS_LABEL[h]) }))}
            chosen={end.hands ? [end.hands] : []}
            onPick={(v) => set({ hands: v })}
          />
          <Pick
            look={look}
            multi
            name={`work-${which}-eq`}
            label={t('work.equipment')}
            options={END_EQUIPMENT.map((q) => ({ value: q, label: t(EQUIPMENT_LABEL[q]) }))}
            chosen={end.equipment}
            onPick={(v) => set({ equipment: end.equipment.includes(v) ? end.equipment.filter((q) => q !== v) : [...end.equipment, v] })}
          />
          <NumberField look={look} label={t('work.floor')} value={end.floor} max={60} onInput={(v) => set({ floor: v })} />
          {Number(end.floor) > 0 ? <Check look={look} label={t('work.lift')} checked={end.lift} onChange={(v) => set({ lift: v })} /> : null}
          <NumberField look={look} label={t('work.carry')} value={end.carryM} max={500} onInput={(v) => set({ carryM: v })} />
        </>
      )}
      <NumberField look={look} label={t('work.wait')} value={end.waitMin} max={600} onInput={(v) => set({ waitMin: v })} />
      {needs && (end.theyDoIt || end.hands) ? <p class={c.hint}>{brings ? t('work.brings', { list: brings }) : t('work.bringsNothing')}</p> : null}
    </div>
  );
}

/**
 * 2026-11-13 — WHAT IT TAKES TO MOVE IT (unusual loads, U1–U3): what the load takes to lift and carry; for each end, one tap when
 * the sender loads or the receiver unloads, else who helps there, the equipment, the floor, a lift, the carry, the waiting; how
 * it must be handled. Nothing chosen: the load is posted as before. Each end says, as it is filled in, what the driver will bring.
 */
export function LoadWorkFields({ value, onChange, look = 'app', children }: { value: LoadWorkForm; onChange: (next: LoadWorkForm) => void; look?: Look; children?: ComponentChildren }) {
  const t = useT();
  const c = CLS[look];
  const set = (patch: Partial<LoadWorkForm>) => onChange({ ...value, ...patch });
  return (
    <div class="loadwork">
      <p class={c.hint}>{t('work.lede')}</p>
      <Pick
        look={look}
        name="work-needs"
        label={t('work.needs')}
        options={LOAD_NEEDS.map((n) => ({ value: n, label: t(NEEDS_LABEL[n]) }))}
        chosen={value.needs ? [value.needs] : []}
        onPick={(v) => set({ needs: value.needs === v ? '' : v })}
      />
      {value.needs ? (
        <>
          <EndFields look={look} which="pickup" end={value.pickup} needs={value.needs} t={t} set={(p) => set({ pickup: { ...value.pickup, ...p } })} />
          <EndFields look={look} which="delivery" end={value.delivery} needs={value.needs} t={t} set={(p) => set({ delivery: { ...value.delivery, ...p } })} />
        </>
      ) : null}
      <Pick
        look={look}
        multi
        name="work-marks"
        label={t('work.marks')}
        options={HANDLING_MARKS.map((m) => ({ value: m, label: t(MARK_LABEL[m]) }))}
        chosen={value.marks}
        onPick={(v) => set({ marks: value.marks.includes(v) ? value.marks.filter((m) => m !== v) : [...value.marks, v] })}
      />
      {namesExtraWork(value) ? <p class={c.hint}>{t('work.negotiated')}</p> : null}
      {children}
    </div>
  );
}
