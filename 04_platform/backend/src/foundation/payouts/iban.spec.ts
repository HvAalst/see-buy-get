import { ibanProblem, isBic, maskIban, normaliseIban } from './iban';

describe('a bank account number a partner pays a hand to (route plan part 4)', () => {
  it('takes the registry examples of Bulgaria, the Netherlands and Lithuania, written with spaces or not', () => {
    expect(ibanProblem('BG80 BNBG 9661 1020 3456 78')).toBeUndefined();
    expect(ibanProblem('nl91abna0417164300')).toBeUndefined();
    expect(ibanProblem('LT12 1000 0111 0100 1000')).toBeUndefined();
  });

  it('refuses a slip in one digit, by its check digits', () => {
    expect(ibanProblem('BG80 BNBG 9661 1020 3456 79')).toBe('check');
    expect(ibanProblem('NL91ABNA0417164301')).toBe('check');
  });

  it('refuses the wrong length for its country, a country outside SEPA, and what is not an IBAN at all', () => {
    expect(ibanProblem('BG80BNBG966110203456')).toBe('length');
    expect(ibanProblem('KE12ABCD1234567890123')).toBe('not_sepa');
    expect(ibanProblem('0712345678')).toBe('not_iban');
    expect(ibanProblem('')).toBe('not_iban');
  });

  it('shows only its country and last four characters', () => {
    expect(maskIban('BG80 BNBG 9661 1020 3456 78')).toBe('BG•• •••• 5678');
    expect(normaliseIban(' bg80-bnbg 9661 ')).toBe('BG80BNBG9661');
  });

  it('knows a BIC of eight or eleven characters', () => {
    expect(isBic('BNBGBGSF')).toBe(true);
    expect(isBic('bnbg bgsf xxx')).toBe(true);
    expect(isBic('BNBG12')).toBe(false);
  });
});
