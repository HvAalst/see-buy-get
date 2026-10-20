import { useEffect, useRef, useState } from 'preact/hooks';
import { useT } from '../i18n';
import { useLoadFinder, type LoadFound } from '../loadFinder';
import { loadLookupOf, type ScanKind } from '../scan';
import { primeAudio } from '../feedback';
import { Button } from './Button';
import { Note } from './ErrorNote';
import { Icon } from './Icon';
import { Scanner } from './Scanner';

export interface ScanFieldProps {
  id: string;
  label: string;
  value: string;
  /** Fired for BOTH typing and scanning — the caller normalizes and stores. */
  onValue: (value: string) => void;
  /** The kind of code the camera should accept; a wrong-kind read is rejected. */
  expect: ScanKind;
  placeholder?: string;
  /** Fired ONLY when a value arrives by camera (not typing) — wire to auto-find/submit. */
  onScan?: (value: string) => void;
  /** Uppercase on entry, matching the bag/sort fields' existing normalization. */
  upper?: boolean;
  enterKeyHint?: 'go' | 'search' | 'done' | 'next';
  autocomplete?: string;
  /** Round 19 — a box that looks for LOADS: our label's QR and a load's typed code find it too, not only its SSCC. */
  loads?: boolean;
}

/** A keyboard-wedge scanner types the whole code in a burst: wait this long after the last key before reading it whole. */
const SETTLE_MS = 250;

type Looked = { state: 'looking' } | { state: 'found'; load: LoadFound } | { state: 'none' } | { state: 'here' } | { state: 'error'; detail: string };

/**
 * A code field that can be SCANNED or typed — the WS-UX "show, don't type" default with the
 * keyboard always one tap away behind it. The camera is the fast path; the input is the
 * floor. The same `onValue` handles both, so a screen wires its state once.
 *
 * Round 19 — a load's package met in any box. Its GS1-128 barcode (an SSCC) is never a parcel, a bag or a badge: it is
 * taken out of the box before the screen acts on it, and the load it belongs to is looked up for whoever may open it
 * (shared/loadFinder.ts). Typed, it is read once the scanner's burst has settled or on its Enter — a scanner sends
 * `00` + 18 digits, and the first 18 alone could pass for an SSCC.
 */
export function ScanField({ id, label, value, onValue, expect, placeholder, onScan, upper, enterKeyHint, autocomplete = 'off', loads = false }: ScanFieldProps) {
  const t = useT();
  const finder = useLoadFinder();
  const [scanning, setScanning] = useState(false);
  const [looked, setLooked] = useState<Looked | null>(null);
  const settle = useRef<number | null>(null);
  const norm = (s: string) => (upper ? s.toUpperCase() : s);

  useEffect(() => () => {
    if (settle.current) window.clearTimeout(settle.current);
  }, []);

  /** A load's code: out of the box, and its load looked up — or said, where this app opens no loads. */
  const lookUp = async (scanned: string) => {
    onValue('');
    if (!finder) return setLooked({ state: 'here' });
    setLooked({ state: 'looking' });
    const r = await finder.find(scanned);
    if (r.data) return setLooked({ state: 'found', load: r.data });
    setLooked(r.error?.code === 'NOT_FOUND' ? { state: 'none' } : { state: 'error', detail: r.error?.detail || r.error?.title || t('common.loadScan.failed') });
  };
  const asLoad = (v: string) => loadLookupOf(v, loads);

  return (
    <div class="field">
      <label class="field__label" for={id}>
        {label}
      </label>
      <div class="scanfield">
        <input
          id={id}
          class="input input--mono scanfield__input"
          value={value}
          onInput={(e) => {
            const v = norm(e.currentTarget.value);
            setLooked(null);
            onValue(v);
            if (settle.current) window.clearTimeout(settle.current);
            if (asLoad(v)) settle.current = window.setTimeout(() => void lookUp(v), SETTLE_MS);
          }}
          onKeyDown={(e) => {
            // A scanner's Enter would submit the screen's form with a load's code in a parcel's box: read it here instead.
            if (e.key !== 'Enter') return;
            const v = norm(e.currentTarget.value);
            if (!asLoad(v)) return;
            e.preventDefault();
            e.stopPropagation();
            if (settle.current) window.clearTimeout(settle.current);
            void lookUp(v);
          }}
          placeholder={placeholder}
          autocapitalize={upper ? 'characters' : 'off'}
          autocomplete={autocomplete}
          spellcheck={false}
          enterkeyhint={enterKeyHint}
        />
        <button
          type="button"
          class="scanfield__btn"
          onClick={() => {
            primeAudio(); // resume WebAudio inside this gesture so the decode beep is heard
            setScanning(true);
          }}
          aria-label={`Scan the ${label.toLowerCase()} with the camera`}
        >
          <Icon name="scan" size={22} />
          <span>Scan</span>
        </button>
      </div>
      {looked ? <LoadNote looked={looked} onOpen={finder?.open} canOpen={finder?.canOpen} /> : null}

      <Scanner
        open={scanning}
        expect={expect}
        title={`Scan the ${label.toLowerCase()}`}
        onClose={() => setScanning(false)}
        onResult={(v) => {
          if (asLoad(v)) return void lookUp(v);
          setLooked(null);
          const value = norm(v);
          onValue(value);
          onScan?.(value);
        }}
      />
    </div>
  );
}

/** What a load's code found: its load and which package — or that it is no load this person can open here. */
function LoadNote({ looked, onOpen, canOpen }: { looked: Looked; onOpen?: (found: LoadFound) => void; canOpen?: (found: LoadFound) => boolean }) {
  const t = useT();
  if (looked.state === 'looking') return <p class="hint">{t('common.loadScan.looking')}</p>;
  if (looked.state === 'here') return <Note tone="info" icon="box" title={t('common.loadScan.isPackage')} detail={t('common.loadScan.notHere')} />;
  if (looked.state === 'none') return <Note tone="warn" icon="box" title={t('common.loadScan.isPackage')} detail={t('common.loadScan.none')} />;
  if (looked.state === 'error') return <Note tone="warn" icon="warning" title={looked.detail} />;
  const l = looked.load;
  const which = l.package && l.packages ? t('common.loadScan.package', { no: l.package, of: l.packages, code: l.code }) : t('common.loadScan.load', { code: l.code });
  return (
    <div>
      <Note tone="ok" icon="box" title={which} detail={t('common.loadScan.what', { description: l.description, from: l.pickupLabel, to: l.destLabel })} />
      {onOpen && (!canOpen || canOpen(l)) ? (
        <Button variant="outline" full={false} chevron={false} onClick={() => onOpen(l)}>
          {t('common.loadScan.open', { code: l.code })}
        </Button>
      ) : null}
    </div>
  );
}
