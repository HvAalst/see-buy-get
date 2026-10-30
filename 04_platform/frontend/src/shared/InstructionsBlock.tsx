import { Abbreviated } from './ui/Abbr';
import { formatDate, useT } from './i18n';
import { hasInstructions, telHref, type InstructionsView } from './instructions';

/**
 * FP7 — the sender's instructions, drawn the same way wherever they are read: the delivery window first (it
 * shapes the day), the contact as something to TAP, then the note, then every subsequent instruction with the
 * time it arrived. A driver at a gate does not read a paragraph; they read the next thing to do.
 */
export function InstructionsBlock({ view, compact }: { view: InstructionsView | undefined; compact?: boolean }) {
  const t = useT();
  if (!hasInstructions(view)) return null;
  const tel = telHref(view.contactPhone);
  return (
    <div class={compact ? 'row__s' : undefined} style={compact ? 'white-space:normal' : undefined}>
      {view.deliveryWindow ? <p class={compact ? undefined : 'card__note'} style="margin:0 0 4px;font-weight:600">{t('common.instructions.deliver', { window: view.deliveryWindow })}</p> : null}
      {view.contactName || view.contactPhone ? (
        <p class={compact ? undefined : 'card__note'} style="margin:0 0 4px">
          {view.contactName ? t('common.instructions.contact', { name: view.contactName }) : null}
          {view.contactPhone ? (
            <>
              {view.contactName ? ' · ' : ''}
              {tel && !compact ? (
                <a href={tel} style="font-weight:600">
                  {t('common.instructions.call', { phone: view.contactPhone })}
                </a>
              ) : (
                view.contactPhone
              )}
            </>
          ) : null}
        </p>
      ) : null}
      {view.text ? <p class={compact ? undefined : 'card__note'} style="margin:0 0 4px;white-space:pre-wrap">{compact ? view.text : <Abbreviated text={view.text} />}</p> : null}
      {(view.amendments ?? []).map((a) => (
        <p key={a.at} class={compact ? undefined : 'card__note'} style="margin:0 0 4px;white-space:pre-wrap">
          {t('common.instructions.amended', { when: formatDate(a.at, { dateStyle: 'medium', timeStyle: 'short' }), text: a.text })}
        </p>
      ))}
    </div>
  );
}
