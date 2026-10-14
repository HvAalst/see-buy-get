import { useT } from '../../../shared/i18n';
import { expiryTone, INSURANCE_LABEL, LICENCE_LABEL, toldWords, type ExpiringItem } from '../company';
import { CAPABILITY_LABEL } from '../presence';

/**
 * CA5 — LICENCES AND POLICIES THAT ARE RUNNING OUT, one row each: which paper, until when and what it switches off, and
 * what the company's administrators were told about it.
 *
 * Drawn in two places. Across every company somebody reaches (`onOpen`): the row names its company and opens its
 * record. On one company's own record: the paper is the row, and there is nowhere else to go.
 */
export function LapsingPapers({ items, onOpen }: { items: ExpiringItem[]; onOpen?: (entityId: string) => void }) {
  const t = useT();
  const when = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  const kindLabel = (source: string, kind: string) =>
    source === 'licence' ? t(LICENCE_LABEL[kind as keyof typeof LICENCE_LABEL] ?? 'tower.company.licence.other') : t(INSURANCE_LABEL[kind as keyof typeof INSURANCE_LABEL] ?? 'tower.company.insurance.other');

  return (
    <table class="ctbl">
      <tbody>
        {items.map((item) => {
          const tone = expiryTone(item);
          const caps = item.supports.map((c) => t(CAPABILITY_LABEL[c])).join(', ');
          const told = toldWords(item, t, when);
          const paper = `${kindLabel(item.source, item.kind)} · ${item.reference}`;
          return (
            <tr key={`${item.entityId}:${item.source}:${item.reference}`}>
              <td>
                <div class="ctbl__strong">{onOpen ? item.name : paper}</div>
                {onOpen ? <div class="ctbl__sub">{paper}</div> : null}
                {told ? <div class={told.tone === 'warn' ? 'ctbl__sub ctbl__sub--warn' : 'ctbl__sub'}>{told.text}</div> : null}
              </td>
              <td>
                <span class={`ctag ${tone === 'bad' ? 'ctag--warn' : tone === 'warn' ? 'ctag--info' : 'ctag--quiet'}`}>
                  {item.lapsed
                    ? t('tower.companies.expiring.lapsed', { date: item.expiresAt, caps: caps || '—' })
                    : caps
                      ? t('tower.companies.expiring.left', { date: item.expiresAt, days: item.daysLeft, caps })
                      : t('tower.companies.expiring.leftNone', { date: item.expiresAt, days: item.daysLeft })}
                </span>
              </td>
              {onOpen ? (
                <td class="ctbl__num">
                  <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => onOpen(item.entityId)}>
                    {t('tower.companies.openRecord')}
                  </button>
                </td>
              ) : null}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
