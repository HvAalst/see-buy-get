import { useEffect, useMemo, useState } from 'preact/hooks';
import { Icon } from './Icon';
import { ReadAloud } from './ReadAloud';
import { SearchInput } from './SearchInput';
import { Sheet } from './Sheet';
import { useT } from '../i18n';
import { fetchHelpTopic, helpImageSrc, type HelpOption, type HelpTopic } from '../help';
import type { SbgConfig } from '../../lib/sbg';

/** One choosable option, with the words the calling app has already translated. */
export interface PickerOption {
  /** Must match the backend's key for this option — it is what the illustration is filed under. */
  key: string;
  label: string;
  /** The sentence under the label: what this option IS, in words somebody would recognise it by. */
  detail: string;
  /** An optional second line of facts (a capacity, a capability list) the caller already computes. */
  meta?: string;
}

export interface OptionPickerProps {
  topic: HelpTopic;
  /** The question being asked — the field label and the sheet's heading. */
  title: string;
  options: PickerOption[];
  value: string;
  onChange: (key: string) => void;
  /** What the closed control reads when nothing is chosen. */
  placeholder: string;
  config: SbgConfig;
  /** Show a filter box inside the sheet once the list is longer than this. */
  searchThreshold?: number;
  id?: string;
  /** The id of the field label. Required in practice: this replaces a `<select>`, and a `<label for>` cannot
   *  name a button, so without it a screen reader announces only the chosen value and never the question. */
  labelledBy?: string;
}

/**
 * A picker that opens as a SHEET showing what each option looks like, instead of a dropdown of words.
 *
 * The user's call, on the 25 truck bodies: *"25 is a pretty big list, it can't just be a dropdown, rather a
 * slide up sheet as well."* A native `<select>` of twenty-five names is the worst possible way to ask this
 * question — it is a scrolling column of jargon on a phone, it shows one line at a time, it cannot carry a
 * picture, and the whole difficulty here is that people RECOGNISE a curtain-side without being able to name
 * one. So the picker and the help are the same surface: you choose by looking.
 *
 * That is also why there is no separate `i` here as there is on the short pickers — the sheet already IS the
 * explanation, and a pill that opened the same thing twice would be furniture.
 */
export function OptionPicker({ topic, title, options, value, onChange, placeholder, config, searchThreshold = 12, id, labelledBy }: OptionPickerProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [images, setImages] = useState<Map<string, HelpOption> | null>(null);

  // Fetched on FIRST OPEN, not on mount — a manager registering a bike never opens this at all, and it runs
  // on a connection somebody pays for by the megabyte. The module-level cache makes every later open free.
  useEffect(() => {
    if (!open || images) return;
    let live = true;
    void fetchHelpTopic(config, topic).then((view) => {
      if (live) setImages(new Map((view?.options ?? []).map((o) => [o.key, o])));
    });
    return () => {
      live = false;
    };
  }, [open, images, config, topic]);

  const chosen = options.find((o) => o.key === value);

  // Matched against the LABEL and the DETAIL, not the key: somebody hunting for "curtain" should find the
  // tautliner, and somebody who only knows "keeps it cold" should find the reefer.
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => `${o.label} ${o.detail} ${o.meta ?? ''}`.toLowerCase().includes(q));
  }, [options, query]);

  return (
    <>
      <button
        type="button"
        id={id}
        class="optpick"
        aria-haspopup="dialog"
        aria-expanded={open}
        // BOTH the field label and the button's own content, in that order — the select-replacement idiom.
        // Pointing at the label alone would REPLACE the accessible name, so a screen reader would announce
        // "Truck body" and never the body actually chosen.
        aria-labelledby={labelledBy && id ? `${labelledBy} ${id}` : labelledBy}
        onClick={() => {
          setQuery(''); // every open starts from the whole list, never somebody's last search
          setOpen(true);
        }}
      >
        <span class={`optpick__value${chosen ? '' : ' optpick__value--empty'}`}>{chosen ? chosen.label : placeholder}</span>
        <Icon name="chevronRight" size={20} />
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title={title}>
        {options.length > searchThreshold ? (
          <div style="margin-bottom:8px">
            <SearchInput value={query} onInput={setQuery} placeholder={t('common.searchOptions')} label={title} />
          </div>
        ) : null}

        {shown.length ? (
          <div class="optpick__list" role="listbox" aria-label={title}>
            {shown.map((o) => (
              <OptionRow key={o.key} option={o} image={images?.get(o.key)} config={config} selected={o.key === value} onPick={() => { onChange(o.key); setOpen(false); }} />
            ))}
          </div>
        ) : (
          <p class="hint">{t('common.noMatches')}</p>
        )}

        <ReadAloud text={() => shown.map((o) => `${o.label}. ${o.detail}`).join(' ')} label={t('common.readAloud')} />
      </Sheet>
    </>
  );
}

/**
 * One row: the picture, the name, the sentence, and whatever facts the caller added.
 *
 * `role="option"` + `aria-selected` rather than the click-toggle `aria-pressed` pattern, because this really
 * is a single-choice list and a screen reader should say "2 of 25, selected" — the reviews' rule is that the
 * pattern must match what the control actually is.
 */
function OptionRow({ option, image, config, selected, onPick }: { option: PickerOption; image?: HelpOption; config: SbgConfig; selected: boolean; onPick: () => void }) {
  const [broken, setBroken] = useState(false);
  const src = image?.imageUrl && !broken ? helpImageSrc(config, image.imageUrl) : null;
  return (
    <button type="button" role="option" aria-selected={selected} class={`optpick__row${selected ? ' optpick__row--on' : ''}`} onClick={onPick}>
      {src ? (
        <img class="opthelp__img" src={src} alt="" loading="lazy" decoding="async" onError={() => setBroken(true)} />
      ) : (
        // A placeholder rather than nothing, so a half-illustrated list stays aligned and the gaps read as
        // "no picture yet" instead of as a broken row.
        <span class="optpick__noimg" aria-hidden="true">
          <Icon name="box" size={20} />
        </span>
      )}
      <span class="opthelp__text">
        <span class="opthelp__label">{option.label}</span>
        <span class="opthelp__detail">{option.detail}</span>
        {option.meta ? <span class="optpick__meta">{option.meta}</span> : null}
      </span>
      {/* Orange, and a TICK — the design contract's mark for the active choice, never a call to action. */}
      {selected ? <Icon name="check" size={20} class="optpick__tick" /> : null}
    </button>
  );
}
