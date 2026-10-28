import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { Choice } from './Choice';
import { sheetStack } from './Sheet';
import { likelyFirst, type CurrencyOption } from '../currencies';

/*
 * ONE CHOICE, NEVER THE PHONE'S OWN LIST (the user, 2026-10-28: "move them both"): a short list tapped as chips where it
 * stands, a long one picked in a sheet; and a sheet opened over a sheet answers its own keys.
 */
const opts = (n: number) => Array.from({ length: n }, (_, i) => ({ value: `v${i}`, label: `Option ${i}` }));

describe('a choice', () => {
  it('a short list is chips in a radio group, named by its label, the chosen one checked', () => {
    const html = renderToString(<Choice id="paid" label="Payment" value="v1" options={opts(3)} onChange={() => undefined} />);
    expect(html).toContain('<span class="field__label" id="paid-label">Payment</span>');
    expect(html).toContain('role="radiogroup" aria-labelledby="paid-label"');
    expect(html).toContain('aria-checked="true" class="chip chip--tap chip--on">Option 1</button>');
    expect(html.match(/role="radio"/g)).toHaveLength(3);
    expect(html).not.toContain('<select');
  });

  it('a long list is one control that opens a sheet, saying the question and then the answer', () => {
    const html = renderToString(<Choice id="status" label="Status" value="v8" options={opts(12)} onChange={() => undefined} />);
    expect(html).toContain('class="optpick"');
    expect(html).toContain('aria-labelledby="status-label status"');
    expect(html).toContain('<span class="optpick__value">Option 8</span>');
    expect(html).not.toContain('role="radio"');
  });

  it('nothing chosen reads as a prompt; the caller may ask for the sheet or for chips', () => {
    const sheet = renderToString(<Choice id="money" as="sheet" label="Money" value="" placeholder="Choose the money…" options={opts(2)} onChange={() => undefined} />);
    expect(sheet).toContain('<span class="optpick__value optpick__value--empty">Choose the money…</span>');
    const chips = renderToString(<Choice id="digit" as="chips" label="Digit" value="v0" options={opts(10)} onChange={() => undefined} />);
    expect(chips.match(/role="radio"/g)).toHaveLength(10);
  });

  it('greyed when it is not to be chosen now', () => {
    expect(renderToString(<Choice id="r" label="Role" value="v0" options={opts(2)} disabled onChange={() => undefined} />)).toContain('disabled');
  });
});

describe('a sheet over a sheet', () => {
  it('the top one answers the keys; closing it gives them back to the one beneath', () => {
    const filters = {};
    const status = {};
    sheetStack.open(filters);
    expect(sheetStack.isTop(filters)).toBe(true);
    sheetStack.open(status);
    expect([sheetStack.isTop(filters), sheetStack.isTop(status)]).toEqual([false, true]);
    sheetStack.close(status);
    expect(sheetStack.isTop(filters)).toBe(true);
    // Closing one already closed takes nothing else with it.
    sheetStack.close(status);
    expect(sheetStack.isTop(filters)).toBe(true);
    sheetStack.close(filters);
    expect(sheetStack.isTop(filters)).toBe(false);
  });
});

describe('the currencies, the likeliest first', () => {
  const all: CurrencyOption[] = [
    { code: 'EUR', name: 'Euro', countries: [{ code: 'NL', name: 'Netherlands' }] },
    { code: 'KES', name: 'Kenyan Shilling', countries: [{ code: 'KE', name: 'Kenya' }] },
    { code: 'UGX', name: 'Ugandan Shilling', countries: [{ code: 'UG', name: 'Uganda' }] },
    { code: 'USD', name: 'US Dollar', countries: [{ code: 'US', name: 'United States' }] },
  ];
  it('those of the countries the money moves between, and any already named, each once', () => {
    const list = likelyFirst(all, ['KE', 'UG'], ['USD', 'KES']);
    expect(list.map((o) => [o.code, o.likely])).toEqual([['KES', true], ['UGX', true], ['USD', true], ['EUR', false]]);
  });
});
