import { Icon } from './Icon';

export interface SearchInputProps {
  value: string;
  onInput: (value: string) => void;
  placeholder?: string;
  /** Accessible label (the register says what it searches — buyer, DID, product…). */
  label?: string;
}

/** A register search box: an icon, a text input, and a clear button once there is a query. */
export function SearchInput({ value, onInput, placeholder = 'Search…', label = 'Search' }: SearchInputProps) {
  return (
    <div class="search">
      <Icon name="search" size={20} class="search__ic" />
      <input
        class="search__input"
        type="search"
        value={value}
        placeholder={placeholder}
        aria-label={label}
        autocomplete="off"
        autocapitalize="none"
        spellcheck={false}
        onInput={(e) => onInput(e.currentTarget.value)}
      />
      {value ? (
        <button type="button" class="search__clear" aria-label="Clear search" onClick={() => onInput('')}>
          <Icon name="close" size={18} />
        </button>
      ) : null}
    </div>
  );
}
