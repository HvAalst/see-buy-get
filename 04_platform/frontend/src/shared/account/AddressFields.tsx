import { useEffect, useState } from 'preact/hooks';
import { useT, type MessageKey } from '../i18n';
import type { Result } from '../../lib/sbg';
import type { AddressField, AddressFormat, AddressParts } from './address';

/** Each part's name, as the form asks it. */
const ADDRESS_LABEL: Record<AddressField, MessageKey> = {
  building: 'account.address.building',
  street: 'account.address.street',
  number: 'account.address.number',
  addition: 'account.address.addition',
  line: 'account.address.line',
  area: 'account.address.area',
  poBox: 'account.address.poBox',
  postcode: 'account.address.postcode',
  town: 'account.address.town',
  region: 'account.address.region',
};
/** What the browser may fill each part in from: only where the meaning is the same. */
const ADDRESS_AUTOCOMPLETE: Partial<Record<AddressField, string>> = { line: 'street-address', street: 'address-line1', postcode: 'postal-code', town: 'address-level2', region: 'address-level1' };

/** A part's name, for a line that says which one is missing. */
export function addressPartName(t: (key: MessageKey) => string, key: AddressField): string {
  return t(ADDRESS_LABEL[key]);
}

export interface AddressFieldsProps {
  /** Unique within the screen. */
  id: string;
  value: AddressParts;
  onChange: (next: AddressParts) => void;
  /** The parts this country's addresses have — the server's to say (GET account/address-format/:country). */
  loadFormat: (country: string) => Promise<Result<AddressFormat>>;
  /** Every country, by its name. */
  loadCountries: () => Promise<Result<Array<{ country: string; name: string }>>>;
  /** Told the format once it is known, so the caller can check what is missing and build what it sends. */
  onFormat?: (format: AddressFormat | null) => void;
  /** 'app' for the phone apps' fields, 'console' for the business app's. */
  look?: 'app' | 'console';
}

/**
 * AN ADDRESS IN ITS COUNTRY'S PARTS — the one form wherever an address is asked that goes on paper (the owner,
 * 2026-10-30: "in settings the address field is poor, especially for countries that do have formal physical addresses";
 * 2026-11-01: and the business's, which "goes on invoices"). The country first; then the parts that country's addresses
 * have, as the server says, which checks them too and keeps the one line every paper prints.
 */
export function AddressFields({ id, value, onChange, loadFormat, loadCountries, onFormat, look = 'app' }: AddressFieldsProps) {
  const t = useT();
  const [countries, setCountries] = useState<Array<{ country: string; name: string }>>([]);
  const [format, setFormat] = useState<AddressFormat | null>(null);
  useEffect(() => {
    void loadCountries().then((r) => setCountries((r.data ?? []).map((c) => ({ country: c.country, name: c.name })).sort((a, b) => a.name.localeCompare(b.name))));
  }, []);
  useEffect(() => {
    if (!value.country) {
      setFormat(null);
      onFormat?.(null);
      return;
    }
    let live = true;
    void loadFormat(value.country).then((r) => {
      if (!live) return;
      setFormat(r.data ?? null);
      onFormat?.(r.data ?? null);
    });
    return () => {
      live = false;
    };
  }, [value.country]);
  const cls = look === 'console' ? { field: 'cfield', label: 'cfield__label', input: 'cinput', meta: 'chint' } : { field: 'field', label: 'field__label', input: 'input', meta: 't-meta' };

  return (
    <>
      <div class={cls.field}>
        <label class={cls.label} for={`${id}-country`}>
          {t('account.address.country')}
        </label>
        <select id={`${id}-country`} class={cls.input} value={value.country} onChange={(e) => onChange({ ...value, country: e.currentTarget.value })}>
          <option value="">{t('account.address.chooseCountry')}</option>
          {countries.map((c) => (
            <option key={c.country} value={c.country}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      {format?.fields.map(({ key, required }) => (
        <div class={cls.field} key={key}>
          <label class={cls.label} for={`${id}-${key}`}>
            {t(ADDRESS_LABEL[key])}
            {required ? null : <span class={cls.meta}> {t('account.address.optional')}</span>}
          </label>
          <input
            id={`${id}-${key}`}
            class={cls.input}
            value={value[key] ?? ''}
            onInput={(e) => onChange({ ...value, [key]: e.currentTarget.value })}
            {...(key === 'postcode' && format.postcodeExample ? { placeholder: format.postcodeExample } : {})}
            autocomplete={ADDRESS_AUTOCOMPLETE[key]}
          />
        </div>
      ))}
    </>
  );
}
