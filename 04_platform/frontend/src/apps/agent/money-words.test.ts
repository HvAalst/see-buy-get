import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A FIGURE OF MONEY SAYS WHICH MONEY. The shop's freight screens wrote a load's budget, the prices offered, the one
 * agreed, a refund and an award as `x.toFixed(2)`: bare numbers, after every other figure in the Shop app had learned
 * its money. A load now carries the money its poster set the budget in (`PostedFreight.currency`), and every figure
 * goes through `money(v, currency)`. This reads the Shop app's screens, and the Business app's loads, the way a
 * reviewer would, so the next figure cannot be written bare beside them.
 */
const here = join('src', 'apps', 'agent');
const shopFiles = [...readdirSync(join(here, 'screens'), { withFileTypes: true }).filter((e) => e.name.endsWith('.tsx')).map((e) => join(here, 'screens', e.name)), join(here, 'useAgentApp.ts')];
const BARE_MONEY = /\b(amount|price|refund|budget|award)\s*:\s*[^,})]*\.toFixed\(/;

describe('the Shop app writes no figure of money bare', () => {
  it('read its screens at all — a guard that saw nothing proves nothing', () => {
    expect(shopFiles.some((f) => f.endsWith('FreightScreen.tsx'))).toBe(true);
    expect(readFileSync(join(here, 'screens', 'FreightScreen.tsx'), 'utf8')).toMatch(/money\(load\.maxSpend, load\.currency\)/);
  });

  it('never hands a sentence an amount made by toFixed', () => {
    const bare = shopFiles.flatMap((f) =>
      readFileSync(f, 'utf8')
        .split(/\r?\n/)
        .map((line, i) => ({ at: `${f.split(/[\\/]/).pop()}:${i + 1}`, line }))
        .filter(({ line }) => BARE_MONEY.test(line))
        .map(({ at, line }) => `${at} ${line.trim()}`),
    );
    expect(bare).toEqual([]);
  });

  it('never calls money() without saying which money — except to fill an input, which takes the bare number', () => {
    const ONE_ARGUMENT = /\bmoney\([^,()]*(\([^()]*\))?[^,()]*\)/;
    const INPUTS = ['HomeScreen.tsx: const [price, setPrice] = useState(money(state.agent?.pricePerParcel));'];
    const moneyless = shopFiles.flatMap((f) =>
      readFileSync(f, 'utf8')
        .split(/\r?\n/)
        .filter((line) => ONE_ARGUMENT.test(line))
        .map((line) => `${f.split(/[\\/]/).pop()}: ${line.trim()}`),
    );
    expect(moneyless.filter((l) => !INPUTS.includes(l))).toEqual([]);
    // The exception still exists, so it is not a reason kept for a line that is gone.
    expect(moneyless).toEqual(INPUTS);
  });

  it('and the Business app writes a load’s prices in the load’s money', () => {
    const loads = readFileSync(join(here, '..', 'business', 'screens', 'LoadsScreen.tsx'), 'utf8');
    expect(loads).not.toMatch(/(agreedPrice|\bp\.price)\.toLocaleString\(\)/);
    expect(loads).toMatch(/priced\(row\.agreedPrice, row\.currency\)/);
  });
});
