import { useState } from 'preact/hooks';
import { Button, Note } from '../../../shared/ui';
import { useConnectivity } from '../../../shared/connectivity';
import { useT } from '../../../shared/i18n';

/** Shorter than this and nobody noticed; the note would be noise. */
export const DARK_SPELL_MIN = 3;

/**
 * Told, once, that the phone was out of reach — and what that meant.
 *
 * A driver coming out of a valley does not know what they missed. What they missed is bounded: an offer lives ten
 * minutes and went to somebody else; anything they recorded is on its way. Saying so closes the question rather
 * than leaving a driver wondering whether the fleet has been trying to reach them.
 */
export function DarkSpellNote() {
  const t = useT();
  const c = useConnectivity();
  const [dismissed, setDismissed] = useState<string | null>(null);
  const spell = c.lastDarkSpell;
  if (!spell || dismissed === spell.to) return null;
  const minutes = Math.round((Date.parse(spell.to) - Date.parse(spell.from)) / 60_000);
  if (minutes < DARK_SPELL_MIN) return null;
  const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return (
    <div style="margin-bottom:12px">
      <Note tone="info" icon="offline" title={t('driver.home.darkTitle')} detail={t('driver.home.darkBody', { from: clock(spell.from), to: clock(spell.to) })} />
      <Button variant="link" full={false} onClick={() => setDismissed(spell.to)}>
        {t('driver.home.darkOk')}
      </Button>
    </div>
  );
}
