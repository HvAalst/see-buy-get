import { useEffect, useState } from 'preact/hooks';
import { useT } from '../../../shared/i18n';
import type { BusinessClient, Client } from '../api';
import { countryNameIn } from '../../../shared/documents/documents';
import { ConsolePick } from '../../tower/ConsolePick';

/**
 * B4 — WHO THIS IS SENT FOR: the business's own goods, or one of its clients, as their agent.
 *
 * Shown only where there is a choice to make — an expeditor, or a business that keeps clients. Choosing a client puts
 * THEM on the consignment note as the sender, with this business named as the one who booked it.
 */
export function SentFor({ client, expeditor, value, onChange, items }: { client: BusinessClient | null; expeditor: boolean; value: string; onChange: (clientId: string) => void; items?: Client[] | null }) {
  const t = useT();
  const [read, setRead] = useState<Client[] | null>(null);
  // 2026-11-03 — the clients read already, where the screen had to know first whether there is a choice to ask (posting
  // a load leaves its first step out when there is none): not asked for twice.
  const clients = items !== undefined ? items : read;

  useEffect(() => {
    if (!client || items !== undefined) return;
    void client.clients().then((r) => setRead(r.data?.items ?? []));
  }, [client]);

  if (!clients || (!expeditor && clients.length === 0)) return null;
  return (
    <ConsolePick
      label={t('business.sentFor.label')}
      value={value}
      // A client's country by its name, never its code.
      options={[{ value: '', label: t('business.sentFor.own') }, ...clients.map((c) => ({ value: c.clientId, label: c.name, ...(c.country ? { sub: countryNameIn(c.country, 'en') } : {}) }))]}
      onChange={onChange}
      hint={value ? t('business.sentFor.agentHint') : clients.length ? t('business.sentFor.ownHint') : t('business.sentFor.noClients')}
    />
  );
}
