import type { SbgConfig, SbgError } from '../../lib/sbg';
import { AskToOpen, type AskKind } from './AskToOpen';

/**
 * 2026-11-13 — TEST MODE (T3): somebody whose number is not on the test list of a country being tested. The refusal says it
 * opens to everyone soon; this is the way to be told when — an email, nothing else. Nothing at all for any other refusal.
 */
export function TestingAsk({ error, kind, config }: { error: SbgError | null | undefined; kind: AskKind; config: SbgConfig }) {
  if (error?.code !== 'NOT_A_TESTER') return null;
  const country = typeof error.params?.country === 'string' ? error.params.country : undefined;
  return <AskToOpen country={country} kind={kind} config={config} waiting />;
}
