import { describe, expect, it } from 'vitest';
import { phaseAfterFailure } from './useDriverApp';

/**
 * The boot hang, pinned down.
 *
 * `phase: 'boot'` renders a bare spinner — no error, no retry, no sign-out — and nothing in the
 * app ever re-entered `refresh` from there. Any failure of the first `me()` (offline cold start,
 * timeout, 500, 403, a failed mint) left a driver holding a phone that would spin until they
 * killed the app. A failure must always land somewhere that can explain itself.
 */
describe('phaseAfterFailure', () => {
  it('never leaves the app on the boot spinner', () => {
    expect(phaseAfterFailure('boot', 'NETWORK')).toBe('ready');
    expect(phaseAfterFailure('boot', 'TIMEOUT')).toBe('ready');
    expect(phaseAfterFailure('boot', 'INTERNAL')).toBe('ready');
    expect(phaseAfterFailure('boot', 'FORBIDDEN')).toBe('ready');
  });

  it('leaves an already-rendered phase where it is', () => {
    expect(phaseAfterFailure('ready', 'CONFLICT')).toBe('ready');
    expect(phaseAfterFailure('signin', 'NOT_FOUND')).toBe('signin');
  });

  it('sends a 426 to the full-screen update gate from anywhere', () => {
    expect(phaseAfterFailure('boot', 'CLIENT_OUTDATED')).toBe('outdated');
    expect(phaseAfterFailure('ready', 'CLIENT_OUTDATED')).toBe('outdated');
    expect(phaseAfterFailure('signin', 'CLIENT_OUTDATED')).toBe('outdated');
  });

  it('keeps the gate up once it is up', () => {
    expect(phaseAfterFailure('outdated', 'NETWORK')).toBe('outdated');
  });
});
