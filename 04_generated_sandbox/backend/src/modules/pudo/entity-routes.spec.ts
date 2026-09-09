import { SbgController } from './pudo.controller';
import { ROLES_KEY } from '../../foundation/auth/scopes.decorator';
import { IS_PUBLIC_KEY } from '../../foundation/auth/public.decorator';

/**
 * WHO MAY REACH A COMPANY'S TERMS — asserted on the HTTP surface itself.
 *
 * The reach rule lives in EntityService and is tested there. What this file holds is the half a service
 * test structurally cannot see: whether each ROUTE is labelled with the roles that rule expects. A route
 * left `@Roles('operator')` still works perfectly for network staff and is simply invisible to the
 * companies this slice exists for — a failure that looks like a missing feature rather than an error.
 *
 * And the one in the other direction: a route that quietly became @Public would hand a stranger a
 * company's rate card, or its books.
 */
const rolesOf = (method: keyof SbgController): string[] | undefined =>
  Reflect.getMetadata(ROLES_KEY, SbgController.prototype[method] as object);

const isPublic = (method: keyof SbgController): boolean =>
  Reflect.getMetadata(IS_PUBLIC_KEY, SbgController.prototype[method] as object) === true;

describe('a company’s own terms: who may read them, and who may change them', () => {
  const COMPANY_ROUTES: Array<keyof SbgController> = [
    'listEntities',
    'entityPricing',
    'entityChanges',
    'entityBooks',
    'listPayouts',
    'entityRates',
    'setEntityRates',
    'entityTax',
    'setEntityTax',
    'entityInsurance',
    'setEntityInsurance',
    'setEntityFee',
    'entityRateImpact',
    'createEntityAdmin',
    'listEntityAdmins',
    'revokeEntityAdmin',
  ];

  it('opens every one of them to a company’s own administrator, as well as to an operator', () => {
    for (const route of COMPANY_ROUTES) {
      expect({ route, roles: rolesOf(route) }).toEqual({ route, roles: ['operator', 'entity_admin'] });
    }
  });

  it('keeps every one of them off the public internet', () => {
    // A rate card is a commercial document and a set of books is a private one. Neither is a track page.
    for (const route of COMPANY_ROUTES) expect(isPublic(route)).toBe(false);
  });

  it('leaves the ADMIN LOGIN public, because a login cannot require the token it issues', () => {
    expect(isPublic('entityAdminLogin')).toBe(true);
    expect(rolesOf('entityAdminLogin')).toBeUndefined();
  });

  it('keeps OPERATIONAL routes to network staff — a commercial login must not become one', () => {
    // The thing this slice must not do by accident: an administrator of a sister company is not somebody
    // who may take a hazard off every driver's map or decide a KYC case.
    expect(rolesOf('clearConstraint')).toEqual(['operator']);
    expect(rolesOf('disputedConstraints')).toEqual(['operator']);
    expect(rolesOf('kycQueue')).toEqual(['operator']);
    // Reading what you are owed is yours; RAISING a run and telling the network money has left are
    // acts on a payment rail, and they stay with network staff.
    expect(rolesOf('runPayouts')).toEqual(['operator']);
  });
});
