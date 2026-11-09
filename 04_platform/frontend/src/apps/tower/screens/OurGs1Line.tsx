import { useEffect, useState } from 'preact/hooks';
import { useT } from '../../../shared/i18n';
import { Abbreviated } from '../../../shared/ui/Abbr';
import { ourGs1, ourGs1Line, type OurGs1Status, type TowerClient } from '../api';

/**
 * 2026-11-09 — SEEBUYGET'S OWN GS1 PREFIX, as the server has it (the owner writes it in the server's settings; staff read it
 * and change nothing): set or not, and how many location numbers are given under it of how many. Above the shops, whose
 * collection points — and the hubs — carry those numbers.
 */
export function OurGs1Line({ client }: { client: TowerClient | null }) {
  const t = useT();
  const [status, setStatus] = useState<OurGs1Status | null>(null);
  useEffect(() => {
    if (!client) return;
    let live = true;
    void ourGs1(client).then((r) => {
      if (live && r.data) setStatus(r.data);
    });
    return () => {
      live = false;
    };
  }, [client]);
  const line = ourGs1Line(status, t);
  return line ? (
    <p class="chint">
      <Abbreviated text={line} />
    </p>
  ) : null;
}
