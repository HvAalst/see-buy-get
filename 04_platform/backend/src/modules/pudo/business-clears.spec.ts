import { BusinessController } from './business.controller';
import type { BusinessService } from './business.service';
import type { BusinessClientService } from './business-client.service';
import type { BorderRouteService } from './border-route.service';
import type { IntrospectionResult } from '../../foundation/auth/auth.types';

/*
 * 2026-11-19 — A BUSINESS NAMED TO CLEAR CUSTOMS SEES IT (parcels across a border, step 4; the owner: "fix that weakness"). Its
 * view says the arrival countries it is named for, whatever activities it ticked, so its app shows it Customs clearing.
 */
describe('a business named as a clearer', () => {
  const businesses = {
    requireMember: () => ({ entity: { entityId: 'agent-et' }, member: { personDid: 'did:p:hana' } }),
    view: (entityId: string) => ({ entityId, name: 'Addis Clearing Ltd', activities: ['importer'] }),
  } as unknown as BusinessService;
  const actor = { role: 'business', tenant: 'agent-et', personDid: 'did:p:hana' } as IntrospectionResult;

  it('is told where it is named, whatever it said it does; one named nowhere is told nothing', () => {
    const borders = { clearsFor: (id: string) => (id === 'agent-et' ? [{ country: 'ET', name: 'Ethiopia' }] : []) } as unknown as BorderRouteService;
    expect(new BusinessController(businesses, {} as BusinessClientService, undefined, undefined, undefined, borders).me(actor)).toMatchObject({ activities: ['importer'], clearsIn: ['ET'] });
    const nowhere = { clearsFor: () => [] } as unknown as BorderRouteService;
    expect(new BusinessController(businesses, {} as BusinessClientService, undefined, undefined, undefined, nowhere).me(actor).clearsIn).toBeUndefined();
  });
});
