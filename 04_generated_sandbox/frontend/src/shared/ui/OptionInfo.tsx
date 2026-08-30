import { useEffect, useState } from 'preact/hooks';
import { Icon } from './Icon';
import { ReadAloud } from './ReadAloud';
import { Sheet } from './Sheet';
import { useT } from '../i18n';
import { fetchHelpTopic, helpImageSrc, type HelpOption, type HelpTopic } from '../help';
import type { SbgConfig } from '../../lib/sbg';

/** One choosable option, with the words the calling app has already translated. */
export interface OptionHelpItem {
  /** Must match the backend's key for this option — it is what the illustration is filed under. */
  key: string;
  label: string;
  detail: string;
}

export interface OptionInfoProps {
  /** Which vocabulary — decides where the pictures come from. */
  topic: HelpTopic;
  /** The heading of the sheet: the question the picker is asking. */
  title: string;
  /** Every option, in the order the picker offers them. */
  options: OptionHelpItem[];
  /** What is chosen right now. Empty (or unmatched) means "not sure" — see the note below. */
  selected?: string;
  /** The app's API config, for fetching the pictures. */
  config: SbgConfig;
}

/**
 * The `i` beside a picker, opening a sheet that SHOWS the options rather than describing them.
 *
 * The rule the user set (2026-08-30): *"if one option is 'not sure', then that option gives them all.
 * Otherwise they all get their own image and explanation."* So one pill serves both needs by following the
 * selection — nothing chosen yet opens the whole vocabulary side by side, which is what somebody deciding
 * actually wants; a chosen option opens just that one, which is what somebody checking themselves wants.
 * One control, because a row of seven `i` pills is a worse thing to hand a person than a single one.
 *
 * A picture is never required. Options with no curated illustration render their words alone, and so does
 * the whole sheet when the network is unreachable — help must not be the thing that blocks a booking.
 */
export function OptionInfo({ topic, title, options, selected, config }: OptionInfoProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [images, setImages] = useState<Map<string, HelpOption> | null>(null);

  // Fetched on FIRST OPEN, not on mount: most bookings never open the sheet, and this runs on a connection
  // somebody is paying for by the megabyte. The module-level cache makes every later open free.
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

  const chosen = options.find((o) => o.key === selected);
  const shown = chosen ? [chosen] : options;

  return (
    <>
      <button type="button" class="info" aria-label={t('common.whatIsThis', { title })} aria-expanded={open} onClick={() => setOpen(true)}>
        <Icon name="info" />
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={title}>
        <div class="info__body">
          {shown.map((o) => (
            <OptionHelpRow key={o.key} item={o} image={images?.get(o.key)} config={config} />
          ))}
        </div>
        {/* The whole sheet read aloud, in the order it is shown — the same reason every explanation in this
            product has a ReadAloud: the person who most needs the picture may also not read well. */}
        <ReadAloud text={() => shown.map((o) => `${o.label}. ${o.detail}`).join(' ')} label={t('common.readAloud')} />
      </Sheet>
    </>
  );
}

/**
 * One option: its picture if there is one, its name, its sentence.
 *
 * A picture that fails to load is dropped rather than left as a broken frame — an admin can remove an image
 * at any moment, and a phone can lose signal mid-sheet. Neither should leave a torn icon next to the words
 * that were the point anyway.
 */
function OptionHelpRow({ item, image, config }: { item: OptionHelpItem; image?: HelpOption; config: SbgConfig }) {
  const [broken, setBroken] = useState(false);
  const src = image?.imageUrl && !broken ? helpImageSrc(config, image.imageUrl) : null;
  return (
    <div class="opthelp">
      {src ? (
        <img
          class="opthelp__img"
          src={src}
          // The label, not "illustration of…": a screen reader should hear the option, and the sentence
          // beside it is already the description.
          alt={item.label}
          loading="lazy"
          decoding="async"
          onError={() => setBroken(true)}
        />
      ) : null}
      <div class="opthelp__text">
        <p class="opthelp__label">{item.label}</p>
        <p class="opthelp__detail">{item.detail}</p>
      </div>
    </div>
  );
}
