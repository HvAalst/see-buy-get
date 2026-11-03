import { useEffect, useState } from 'preact/hooks';
import { publicRequest, type SbgConfig } from '../lib/sbg';
import type { Translate } from './i18n';

/*
 * 2026-11-03 — THE API'S OWN LIST OF CHANGES, beside a company's keys (the user: "Notice first, build now"; backend
 * api-changes.controller.ts, api-rules.ts): its versions, and every rule a version gained — when it was announced, and from
 * when a system's call that breaks it is refused. Said the same way in the Business app and the Fleet app.
 */

export interface ApiChanges {
  versions: Array<{ version: string; releasedAt: string; announcedAt?: string; retiresAt?: string }>;
  rules: Array<{ id: string; version: string; summary: string; announcedAt: string; enforcedFrom: string; safety: boolean; noticeDays: number; fromRelease: boolean }>;
}

export interface ApiChangeLine {
  key: string;
  title: string;
  detail: string;
  /** A rule still to come: the reader's system may need changing. */
  coming: boolean;
}

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { dateStyle: 'long', timeZone: 'UTC' });

/** The list, in the order a reader needs it: rules still to come first, then the versions, then the rules in force. */
export function apiChangeLines(c: ApiChanges, now: number, t: Translate): ApiChangeLine[] {
  const rules = c.rules.map((r) => {
    const coming = !r.fromRelease && now < Date.parse(r.enforcedFrom);
    const detail = r.fromRelease
      ? t('apiChanges.ruleFromRelease', { date: day(r.enforcedFrom) })
      : coming
        ? t('apiChanges.ruleComing', { announced: day(r.announcedAt), from: day(r.enforcedFrom) })
        : t('apiChanges.ruleInForce', { from: day(r.enforcedFrom), announced: day(r.announcedAt), days: r.noticeDays });
    return { key: `rule:${r.id}`, title: r.summary, detail: `${t('apiChanges.inVersion', { version: r.version })} ${detail}`, coming };
  });
  const versions = c.versions.map((v) => ({
    key: `version:${v.version}`,
    title: t('apiChanges.version', { version: v.version }),
    detail: v.retiresAt ? t('apiChanges.versionStops', { date: day(v.releasedAt), stops: day(v.retiresAt) }) : t('apiChanges.versionSince', { date: day(v.releasedAt) }),
    coming: Boolean(v.retiresAt && now < Date.parse(v.retiresAt)),
  }));
  return [...rules.filter((r) => r.coming), ...versions, ...rules.filter((r) => !r.coming)];
}

/** The list, read once when the keys are shown: `null` while it is coming, `'unavailable'` when it could not be read. */
export function useApiChanges(config: SbgConfig): ApiChanges | null | 'unavailable' {
  const [changes, setChanges] = useState<ApiChanges | null | 'unavailable'>(null);
  useEffect(() => {
    let live = true;
    void publicRequest<ApiChanges>(config, '/v1/sbg/api-changes').then((r) => {
      if (live) setChanges(r.data ?? 'unavailable');
    });
    return () => {
      live = false;
    };
  }, []);
  return changes;
}
