import { useT } from '../i18n';
import { credentialAge, credentialAgeKey } from './password';

/**
 * "Last changed 12 days ago" under a credential — and, for a MACHINE secret (`machine`), a nudge once it is past
 * ninety days. This is the reminder: it sits where the credential is managed, so it is seen by the person who can act
 * on it, in apps that have no inbox. Renders nothing when there is no date to be honest about.
 */
export function CredentialAge({ iso, machine, class: cls = 'card__note' }: { iso?: string; machine?: boolean; class?: string }) {
  const t = useT();
  const age = credentialAge(iso);
  if (!age) return null;
  const { key, n } = credentialAgeKey(age.days);
  return (
    <p class={cls}>
      {t(key, { n })}
      {machine && age.due ? (
        <>
          {' · '}
          <b>{t('account.age.due')}</b>
        </>
      ) : null}
    </p>
  );
}
