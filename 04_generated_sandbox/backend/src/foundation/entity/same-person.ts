/**
 * Two names are one person when they differ only in case and spacing — "Amina  O" cannot second "amina o".
 * Used wherever a rule needs TWO people: switching a country on, verifying a document somebody else uploaded.
 */
export function samePerson(a: string | undefined, b: string | undefined): boolean {
  const n = (s: string | undefined) => (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  return Boolean(n(a)) && n(a) === n(b);
}

/** Somebody a two-person rule has to tell from somebody else: the name for the record, the ACCOUNT for telling apart. */
export interface Signer {
  name: string;
  /** The key their sessions answer to. `typed:…`, or none, where there is no account: only a name to go by. */
  key?: string;
}

/**
 * ARE THESE TWO ONE PERSON.
 *
 * Two ACCOUNTS are two people whatever they are called: two colleagues may share a name, and one of them is not the
 * other. And one account is one person whatever it is called. Only where there is no account to go by — a name typed
 * beside the shared key on a laptop, or a record from before the account was kept — is the name compared, case and
 * spacing aside.
 */
export function sameSigner(a: Signer, b: Signer): boolean {
  const account = (key?: string) => Boolean(key) && !key!.startsWith('typed:');
  if (account(a.key) && account(b.key)) return a.key === b.key;
  return samePerson(a.name, b.name);
}
