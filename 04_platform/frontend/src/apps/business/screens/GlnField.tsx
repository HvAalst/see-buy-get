import { useState } from 'preact/hooks';
import { Abbreviated } from '../../../shared/ui/Abbr';
import { useT, type MessageKey } from '../../../shared/i18n';

/** What a save answers: nothing, or the server's refusal in words. */
type Saved = { error?: { detail?: string; title?: string } | null };

/**
 * 2026-11-09 — A GLOBAL LOCATION NUMBER (GLN), from GS1: the business's own, a client's, or one of its places'. Shown as
 * it is; whoever may change it gives, changes or removes it. The number is checked by the server (13 digits, its check
 * digit, a range GS1 gives locations from), and its refusal is said here as it is.
 */
export function GlnField({ id, value, may, none, setKey, lede, hint, onSave, onSaved }: {
  id: string;
  value?: string;
  /** Whether the reader may change it; otherwise it is read only. */
  may: boolean;
  /** The sentence where there is none. */
  none: string;
  /** The button that gives one where there is none. */
  setKey: MessageKey;
  lede?: string;
  hint?: string;
  onSave: (gln: string | null) => Promise<Saved>;
  onSaved?: (said: string) => void;
}) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (gln: string | null) => {
    setBusy(true);
    setError(null);
    const r = await onSave(gln);
    setBusy(false);
    if (r.error) return setError(r.error.detail || r.error.title || null);
    setEditing(false);
    onSaved?.(t(gln ? 'business.gln.saved' : 'business.gln.removed'));
  };

  return (
    <div style="margin-top:10px">
      {lede ? <p class="chint"><Abbreviated text={lede} /></p> : null}
      {editing ? (
        <form onSubmit={(e) => { e.preventDefault(); void save(typed.trim() || null); }}>
          <label class="cfield">
            <span class="cfield__label">{t('business.gln.label')}</span>
            <input id={id} class="cinput" inputMode="numeric" maxLength={24} autoComplete="off" value={typed} onInput={(e) => setTyped((e.target as HTMLInputElement).value)} />
            <span class="chint">{hint ?? t('business.gln.hint')}</span>
          </label>
          {error ? <p class="cerr"><Abbreviated text={error} /></p> : null}
          <div class="twr-panelend">
            <button type="button" class="cbtn cbtn--ghost" disabled={busy} onClick={() => setEditing(false)}>
              {t('business.gs1.cancel')}
            </button>
            <button type="submit" class="cbtn cbtn--primary" disabled={busy || !typed.trim()}>
              {t('business.gs1.save')}
            </button>
          </div>
        </form>
      ) : (
        <>
          <p class="crow__sub"><Abbreviated text={value ? t('business.gln.is', { gln: value }) : none} /></p>
          {may ? (
            <div class="twr-panelend">
              {value ? (
                <button type="button" class="cbtn cbtn--ghost" disabled={busy} onClick={() => void save(null)}>
                  {t('business.gln.remove')}
                </button>
              ) : null}
              <button type="button" class={`cbtn ${value ? 'cbtn--ghost' : 'cbtn--primary'}`} disabled={busy} onClick={() => { setTyped(value ?? ''); setError(null); setEditing(true); }}>
                {value ? t('business.gs1.change') : t(setKey)}
              </button>
            </div>
          ) : null}
          {error ? <p class="cerr"><Abbreviated text={error} /></p> : null}
        </>
      )}
    </div>
  );
}
