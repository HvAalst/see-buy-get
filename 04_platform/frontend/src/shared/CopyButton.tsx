import { useState } from 'preact/hooks';
import { Button } from './ui';

/**
 * 2026-11-15 — A KEY, AN ID OR A LINK, COPIED IN ONE TAP (the owner: "it also misses a 'copy this key' button"). Copies the
 * text and says so for two seconds; with `share`, a phone that can share opens its share sheet instead (a link to send a
 * developer). Never anything but the text it is given.
 */
export function CopyButton({ text, label, copied, share = false, variant = 'outline' }: { text: string; label: string; copied: string; share?: boolean; variant?: 'outline' | 'link' | 'primary' }) {
  const [done, setDone] = useState(false);
  const run = async () => {
    try {
      const nav = globalThis.navigator as Navigator | undefined;
      if (share && nav?.share) {
        await nav.share({ url: text });
        return;
      }
      await nav?.clipboard?.writeText(text);
      setDone(true);
      setTimeout(() => setDone(false), 2000);
    } catch {
      // Dismissed, or no clipboard here: the text stays on the screen to copy by hand.
    }
  };
  return (
    <Button variant={variant} full={false} chevron={false} onClick={() => void run()}>
      {done ? copied : label}
    </Button>
  );
}
