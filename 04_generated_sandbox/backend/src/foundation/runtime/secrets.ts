/**
 * THE SECRETS THIS SERVER SIGNS, SEALS AND HASHES WITH — from the deployment, and outside a sandbox from nowhere else.
 *
 * Each of them has a value printed in this source, so that a laptop works with nothing configured. Printed means
 * known: to everybody who has read the code, and to every tool that has. A server that falls back on one in
 * production is not weakly protected, it is open — whoever holds the printed token secret signs themselves in as
 * staff. Two of the seven refused that already (the vault key, the funding secret) and five did not, the token
 * secret among them; and the two that refused only asked "is it set", which the example environment file answers
 * yes to with the printed value itself.
 *
 * ONE RULE NOW, for all of them, asked where each is read: outside a sandbox the value comes from the deployment,
 * is not anything printed here, is long enough to be random, and is not shared with another. Otherwise the server
 * does not start. Refused at boot rather than warned about: a warning in a deploy log is read after the damage.
 */
export const DEPLOYMENT_SECRETS = {
  GLOS_AUTH_SECRET: 'signs every sign-in token: whoever has it can sign in as anybody, network staff included',
  GLOS_VAULT_KEY: 'seals the identity vault: national ID numbers and the other personal data kept encrypted',
  GLOS_PHONE_PEPPER: 'keys the hash every phone number is stored as: with it, the hashes can be turned back into numbers',
  GLOS_IDENTITY_PEPPER: 'keys the prints that find a second registration of the same national ID',
  GLOS_FUNDING_SECRET: 'signs payment confirmations on the stand-in rail: whoever has it can create money on our books',
  GLOS_LABEL_KEY: 'signs parcel labels',
  GLOS_DISCLOSURE_KEY: 'keys the proofs that disclose one field of a waybill without the rest',
  GLOS_VAPID_PRIVATE: 'signs every push this server sends: whoever has it, and the address of a device, can light that device up in this network’s name',
} as const;

export type DeploymentSecret = keyof typeof DEPLOYMENT_SECRETS;

/** Shorter than this was typed by somebody, not made by a generator. `openssl rand -hex 32` gives sixty-four. */
export const SECRET_MIN_LENGTH = 32;

type Env = Record<string, string | undefined>;
const sandboxOf = (env: Env) => (env.GLOS_ENV ?? '').trim().toLowerCase() !== 'production';

/** What is wrong with a secret as the deployment gave it — null when it will do. */
export function secretProblem(name: DeploymentSecret, printed: string, env: Env = process.env): string | null {
  const value = (env[name] ?? '').trim();
  if (!value) return 'is not set';
  // Any printed value, not only this one's: the example file's, another secret's default, a placeholder.
  if (value === printed || /glos-dev|change-me|changeme/i.test(value)) return 'is a value printed in the source';
  if (value.length < SECRET_MIN_LENGTH) return `is shorter than ${SECRET_MIN_LENGTH} characters`;
  if (new Set(value).size < 8) return 'is not random';
  const twin = (Object.keys(DEPLOYMENT_SECRETS) as DeploymentSecret[]).find((other) => other !== name && (env[other] ?? '').trim() === value);
  if (twin) return `is the same value as ${twin}: each needs its own`;
  return null;
}

/**
 * Read one of the secrets. In a sandbox: the deployment's value, or the printed one. Anywhere else: the deployment's
 * value, or the server does not start — and the refusal names every secret it will ask for, so that the next start
 * is not the next refusal.
 */
export function deploymentSecret(name: DeploymentSecret, printed: string, env: Env = process.env): string {
  const value = (env[name] ?? '').trim();
  if (sandboxOf(env)) return value || printed;
  const problem = secretProblem(name, printed, env);
  if (problem) {
    throw new Error(
      `${name} ${problem}. It ${DEPLOYMENT_SECRETS[name]}. Outside a sandbox (GLOS_ENV=production) this server does not start on a secret anybody could know. ` +
        `Give each of ${Object.keys(DEPLOYMENT_SECRETS).join(', ')} its own random value of ${SECRET_MIN_LENGTH} characters or more, for example from: openssl rand -hex 32`,
    );
  }
  return value;
}
