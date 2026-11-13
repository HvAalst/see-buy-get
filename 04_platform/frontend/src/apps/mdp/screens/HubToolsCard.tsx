import { useEffect, useMemo, useState } from 'preact/hooks';
import { createMdpApi, type SbgClient, type SbgError } from '../../../lib/sbg';
import { useT } from '../../../shared/i18n';
import { Button, Card } from '../../../shared/ui';
import type { Uploaded } from '../../../shared/upload';
import { SiteToolsSheet } from '../../../shared/site-tools/SiteToolsSheet';
import { limitsLines, type SiteToolsView, type ToolsBody } from '../../../shared/siteTools';

/**
 * 2026-11-13 — YOUR TOOLS (the owner: "shop and hub tools"): on the hub's start screen, what its equipment and scale let it
 * take — its heaviest parcel, pallets, whether its weights set the price — and the sheet its owner says them in. Its owner's
 * alone: the people on its floor are not shown it.
 */
export function HubToolsCard({ sbg, mdpId, staff, upload }: { sbg: SbgClient | null; mdpId?: string; staff: boolean; upload: (file: File) => Promise<Uploaded> }) {
  const t = useT();
  const api = useMemo(() => (sbg ? createMdpApi(sbg) : null), [sbg]);
  const [view, setView] = useState<SiteToolsView | null>(null);
  const [open, setOpen] = useState(false);
  const load = (): Promise<{ data?: unknown; error?: SbgError | null }> => (api && mdpId ? (api.tools(mdpId) as Promise<{ data?: unknown; error?: SbgError | null }>) : Promise.resolve({}));
  useEffect(() => {
    if (staff) return;
    void load().then((r) => {
      if (!r.error && r.data) setView(r.data as SiteToolsView);
    });
  }, [api, mdpId, staff]);
  if (staff || !api || !mdpId) return null;
  const lines = view ? limitsLines(view.limits, t) : [];
  return (
    <Card title={t('tools.title')}>
      {lines.map((line) => (
        <p key={line} class="t-body">
          {line}
        </p>
      ))}
      <Button variant="outline" onClick={() => setOpen(true)}>
        {t('tools.change')}
      </Button>
      <SiteToolsSheet
        open={open}
        onClose={() => setOpen(false)}
        load={load}
        save={(body: ToolsBody) => api.setTools(mdpId, body) as Promise<{ data?: unknown; error?: SbgError | null }>}
        upload={upload}
        onSaved={setView}
      />
    </Card>
  );
}
