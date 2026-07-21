// PII policy — the runtime half of the data firewall (T-003, §3.4).
// The Operational Core must hold ONLY DIDs + pseudonymous attributes. assertNoPii is the
// enforceable guard: any PII-like field reaching the operational store throws, so the
// firewall is independently testable rather than a documentation promise.

/** Field names (normalized: lowercased, separators stripped) that may never appear in the Operational Core. */
export const PII_FIELDS = new Set<string>([
  'name', 'firstname', 'lastname', 'fullname', 'givenname', 'familyname', 'middlename',
  'dob', 'dateofbirth', 'birthdate',
  'governmentid', 'govid', 'idnumber', 'passport', 'passportnumber', 'nationalid', 'ssn', 'taxid',
  'address', 'streetaddress', 'street', 'postalcode', 'zip', 'zipcode', 'city',
  'email', 'emailaddress',
  'phone', 'phonenumber', 'mobile', 'msisdn',
  'latitude', 'longitude', 'geolocation', 'gpscoordinates',
  'iban', 'cardnumber', 'bankaccount', 'accountnumber', 'routingnumber',
  'selfie', 'biometric', 'faceimage', 'photo',
]);

/**
 * High-signal PII *tokens*: if any of these appears as a camelCase/separator-delimited word inside a
 * field name, the field is PII even when the whole name isn't an exact match. This is what catches the
 * compound qualifiers that evade PII_FIELDS today — senderMobile, receiverMobile, buyerEmail,
 * contactPhone, physicalAddress. Deliberately excludes weak tokens (name, photo, city, street) that
 * appear in benign fields (shopName, contentPhotoRef) to avoid false positives.
 */
const PII_TOKENS = new Set<string>([
  'phone', 'mobile', 'msisdn', 'email',
  'address',
  'ssn', 'passport', 'iban', 'bankaccount',
  'latitude', 'longitude', 'geolocation', 'gpscoordinates',
  'selfie', 'biometric',
]);

const EMAIL_RE = /[^@\s]+@[^@\s]+\.[^@\s]+/;

export class DataFirewallViolation extends Error {
  constructor(public readonly field: string) {
    super(`Data firewall violation: PII-like field "${field}" must not enter the Operational Core`);
    this.name = 'DataFirewallViolation';
  }
}

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[_\s-]/g, '');
}

/** Split a field name into lowercase words on camelCase and separator boundaries (senderMobile → [sender, mobile]). */
function keyTokens(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[_\s-]+/)
    .map((t) => t.toLowerCase())
    .filter(Boolean);
}

/**
 * Recursively assert that a value carries no PII-like fields (by name) or email-like
 * string values. Throws DataFirewallViolation on the first offender.
 */
export function assertNoPii(value: unknown, path = ''): void {
  if (value == null) return;

  if (Array.isArray(value)) {
    value.forEach((item, i) => assertNoPii(item, `${path}[${i}]`));
    return;
  }

  if (typeof value === 'object') {
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      const here = path ? `${path}.${key}` : key;
      if (PII_FIELDS.has(normalizeKey(key))) throw new DataFirewallViolation(here);
      if (keyTokens(key).some((t) => PII_TOKENS.has(t))) throw new DataFirewallViolation(here);
      assertNoPii(val, here);
    }
    return;
  }

  if (typeof value === 'string' && EMAIL_RE.test(value)) {
    throw new DataFirewallViolation(`${path || 'value'} (email-like value)`);
  }
}
