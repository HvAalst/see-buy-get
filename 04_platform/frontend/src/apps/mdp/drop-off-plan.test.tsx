import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { t } from '../../shared/i18n';
import { DropScreen } from './screens/DropScreen';

/*
 * 2026-11-06 — A HUB TOLD, as it empties a bag, which parcels in it were not planned to come to it, nobody having said why
 * (the owner: "build as you suggest"): not the hub's doing, and planned on from here — sorted as the screen says.
 */
const words = (html: string) => html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&');
const screen = (drop: Record<string, unknown>) =>
  words(renderToString(<DropScreen state={{ form: { dropCode: '' }, drop, queue: ['PUD-1', 'PUD-2'], busy: null, error: null, hub: { did: 'did:hub:1', mdpId: 'mdp_1' } } as never} actions={{} as never} />));

describe('a bag emptied at a hub its parcels were not planned to reach', () => {
  it('says how many, and where they were planned to go — once for each place', () => {
    const text = screen({ offPlan: [{ parcelId: 'PUD-1', planned: 'North Sort' }, { parcelId: 'PUD-2', planned: 'North Sort' }] });
    expect(text).toContain(t('mdp.drop.offPlanTitle'));
    expect(text).toContain(t('mdp.drop.offPlanBody', { count: 2, planned: 'North Sort' }));
    expect(t('mdp.drop.offPlanBody', { count: 1, planned: 'North Sort' })).toContain('1 parcel in this bag was planned to go to North Sort');
  });

  it('says nothing where every parcel came as planned', () => {
    expect(screen({})).not.toContain(t('mdp.drop.offPlanTitle'));
  });
});
