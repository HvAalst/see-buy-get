/**
 * Is this a SANDBOX — a developer's machine or a demo — rather than a deployment real people rely on?
 *
 * One answer for the whole backend, from the same switch the development seeds already obey (`GLOS_ENV`). Anything
 * that is a convenience on a laptop and a hole in production asks this: above all, handing a one-time code or a
 * password-reset token back to whoever asked for it, which would let anyone verify anyone's phone or reset anyone's
 * password.
 */
export function isSandbox(): boolean {
  return (process.env.GLOS_ENV ?? '').trim().toLowerCase() !== 'production';
}
