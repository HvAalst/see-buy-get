import type { ComponentChildren } from 'preact';
import { useT } from '../i18n';
import { useTips } from '../useTips';
import type { TipId } from '../tips';
import { Icon } from './Icon';

/**
 * A SENTENCE THAT TEACHES, AND CAN BE PUT AWAY ONCE IT HAS.
 *
 * The rule for what belongs in one of these is in `tips.ts`, on `TipId`, and it is short: this teaches
 * how the app works and says the same thing to everybody every day. A live condition never goes in here.
 *
 * QUIET, AND THE DISMISS QUIETER STILL. It reads as the lede it replaces — the cross is a small mark at
 * the end of the line, not a button competing with the screen's real action. Somebody who never notices
 * it has lost nothing; the text is exactly what it was before.
 */
export function Explainer({ who, id, text }: { who: string | null | undefined; id: TipId; text: string }) {
  const t = useT();
  const tips = useTips(who);
  if (tips.hidden(id)) return null;

  return (
    <p class="explain">
      <span class="explain__t">{text}</span>
      <button type="button" class="explain__x" onClick={() => tips.hide(id)} aria-label={t('common.tips.dismiss')} title={t('common.tips.dismiss')}>
        <Icon name="close" size={16} />
      </button>
    </p>
  );
}

/**
 * THE SAME THING AROUND A WHOLE BLOCK — a card of steps rather than a sentence.
 *
 * The dismiss is a line at the end here instead of a mark on the text, because a cross floating at the
 * corner of a card reads as "close this card for now" the way a dialog does. This one is permanent, so
 * it says so in words, and it sits where somebody arrives after actually reading the thing.
 */
export function ExplainerBlock({ who, id, children }: { who: string | null | undefined; id: TipId; children: ComponentChildren }) {
  const t = useT();
  const tips = useTips(who);
  if (tips.hidden(id)) return null;

  return (
    <div class="explainbk">
      {children}
      <button type="button" class="linkbtn explainbk__x" onClick={() => tips.hide(id)}>
        {t('common.tips.dismissBlock')}
      </button>
    </div>
  );
}

/**
 * THE WAY BACK, and the reason dismissing can be permanent at all.
 *
 * Without it a mis-tap deletes information a driver can never get to again, and the honest answer to
 * "how do I see that again" would be "clear your browser storage". It lives in the screen foot beside
 * Help, because that is where somebody already goes when they want the app explained.
 *
 * It appears only when there is something to restore. A control that is always there, permanently
 * offering nothing, is exactly the kind of clutter this whole mechanism exists to remove.
 */
export function ExplainerReset({ who }: { who: string | null | undefined }) {
  const t = useT();
  const tips = useTips(who);
  if (tips.count === 0) return null;

  return (
    <button type="button" class="linkbtn" onClick={tips.restore}>
      {tips.count === 1 ? t('common.tips.restoreOne') : t('common.tips.restore', { count: String(tips.count) })}
    </button>
  );
}
