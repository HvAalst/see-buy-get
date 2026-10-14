import { useEffect, useState } from 'preact/hooks';
import { useT } from '../../../shared/i18n';
import type { BusinessClient, Client } from '../api';

/**
 * B4 — WHO THIS IS SENT FOR: the business's own goods, or one of its clients, as their agent.
 *
 * Shown only where there is a choice to make — an expeditor, or a business that keeps clients. Choosing a client puts
 * THEM on the consignment note as the sender, with this business named as the one who booked it.
 */
export function SentFor({ client, expeditor, value, onChange }: { client: BusinessClient | null; expeditor: boolean; value: string; onChange: (clientId: string) => void }) {
  const t = useT();
  const [clients, setClients] = useState<Client[] | null>(null);

  useEffect(() => {
    if (!client) return;
    void client.clients().then((r) => setClients(r.data?.items ?? []));
  }, [client]);

  if (!clients || (!expeditor && clients.length === 0)) return null;
  return (
    <label class="cfield">
      <span class="cfield__label">{t('business.sentFor.label')}</span>
      <select class="cinput" value={value} onChange={(e) => onChange((e.target as HTMLSelectElement).value)}>
        <option value="">{t('business.sentFor.own')}</option>
        {clients.map((c) => (
          <option key={c.clientId} value={c.clientId}>
            {c.name}
            {c.country ? ` (${c.country})` : ''}
          </option>
        ))}
      </select>
      <span class="chint">{value ? t('business.sentFor.agentHint') : clients.length ? t('business.sentFor.ownHint') : t('business.sentFor.noClients')}</span>
    </label>
  );
}
