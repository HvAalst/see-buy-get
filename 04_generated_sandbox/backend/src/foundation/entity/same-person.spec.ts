import { samePerson, sameSigner } from './same-person';

/**
 * WHO IS THE SECOND PERSON. Every rule that needs two people asks this, and the answer has to be about people:
 * two colleagues who share a name are two, and one colleague under two spellings is one.
 */
describe('telling two people apart', () => {
  const account = (name: string, id: string) => ({ name, key: `operator:${id}` });

  it('goes by the account where both have one, whatever they are called', () => {
    expect(sameSigner(account('Sam Otieno', 'opr_1'), account('Sam Otieno', 'opr_2'))).toBe(false);
    expect(sameSigner(account('Sam Otieno', 'opr_1'), account('Somebody Else', 'opr_1'))).toBe(true);
    // A company's administrator and a member of staff are never one account.
    expect(sameSigner({ name: 'Amina', key: 'admin:adm_1' }, account('Amina', 'opr_1'))).toBe(false);
  });

  it('goes by the name where there is no account to go by — typed on a laptop, or kept before accounts were', () => {
    expect(sameSigner({ name: ' amina  o ', key: 'typed: amina  o ' }, { name: 'Amina O', key: 'typed:Amina O' })).toBe(true);
    expect(sameSigner({ name: 'Amina' }, { name: 'AMINA' })).toBe(true);
    expect(sameSigner({ name: 'Amina' }, { name: 'Brian' })).toBe(false);
    // One side an account, the other only a name: the name is all the two have in common to compare.
    expect(sameSigner(account('Amina', 'opr_1'), { name: 'amina' })).toBe(true);
    expect(sameSigner(account('Amina', 'opr_1'), { name: 'amina', key: 'typed:amina' })).toBe(true);
    expect(sameSigner(account('Amina', 'opr_1'), { name: 'Brian' })).toBe(false);
  });

  it('never takes two blanks for one person', () => {
    expect(sameSigner({ name: '' }, { name: '' })).toBe(false);
    expect(sameSigner({ name: '  ' }, { name: 'Amina' })).toBe(false);
    expect(samePerson(undefined, undefined)).toBe(false);
  });
});
