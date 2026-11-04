import { useEffect, useState } from 'preact/hooks';
import { useT } from '../i18n';
import { Note } from '../ui/ErrorNote';
import { countryStanding, type CountryStanding } from './standing';
import type { SbgConfig } from '../../lib/sbg';
import { AskToOpen, type AskKind } from './AskToOpen';

/**
 * "SEEBUYGET IS NOT OPEN IN ZAMBIA YET" — on the home of an account that signed up before its country opened (COMING,
 * 2026-10-25), with what that means for THIS kind of account in `detail`. Nothing at all once the country is open, or
 * while its standing cannot be read: every act it holds back is refused by the server in the same words anyway.
 */
export function OpensSoonNote({ country, detail, ask }: { country: string | undefined; detail: string; ask?: { kind: AskKind; config: SbgConfig } }) {
  const t = useT();
  const [standing, setStanding] = useState<CountryStanding | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void countryStanding(country).then((s) => {
      if (live) setStanding(s);
    });
    return () => {
      live = false;
    };
  }, [country]);
  if (!standing?.coming) return null;
  // 2026-11-04 — and the way to tell SeeBuyGet why it is needed here (AskToOpen): the requests a country opens on.
  return (
    <>
      <Note tone="info" icon="clock" title={t('opening.title', { country: standing.name })} detail={detail} />
      {ask ? <AskToOpen country={country} kind={ask.kind} config={ask.config} /> : null}
    </>
  );
}
