import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { t } from '../../shared/i18n';
import { CourierCover } from './screens/CourierCover';
import type { CourierPaperRow } from './papers';
import type { TowerActions, TowerState } from './useTowerApp';

/*
 * A COURIER'S OWN COVER, read by staff off the policy they sent (2026-10-28). There is no way here to type cover on
 * somebody's word: with nothing sent, nothing to record.
 */
const row = (cover?: CourierPaperRow['cover']) => ({ did: 'did:drv:1', displayName: 'Rider', status: 'ACTIVE', registry: 'light', classes: [], licence: {}, papers: [], offRoad: [], onShift: false, drives: [], ...(cover ? { cover } : {}) }) as unknown as CourierPaperRow;
const render = (r: CourierPaperRow) => renderToString(<CourierCover row={r} state={{ busyId: null } as unknown as TowerState} actions={{ client: () => null, mediaUrl: () => '', openMedia: () => undefined } as unknown as TowerActions} />);

describe('a courier’s own insurance cover, in the console', () => {
  it('a sent policy is read: the date staff read, what it covers and up to how much', () => {
    const html = render(row({ sent: { copyRef: 'med_1', expiresAt: '2031-10-28', reference: 'GIT-R-9', sentAt: '2026-10-28T10:00:00Z' } }));
    expect(html).toContain(t('tower.courierCover.sentTitle'));
    expect(html).toContain(t('tower.courierCover.record'));
    expect(html).toContain(t('tower.carrierPapers.covers'));
    expect(html).toContain(t('tower.carrierPapers.limit'));
  });

  it('with nothing sent and nothing on record, there is nothing to record', () => {
    expect(render(row())).toBe('');
  });

  it('cover on record says when it was read and by whom', () => {
    expect(render(row({ copyRef: 'med_1', expiresAt: '2031-10-28', policy: 'GIT-R-9', recordedBy: 'ops1@sbg.test', recordedAt: '2026-10-28T11:00:00Z' }))).toContain('ops1@sbg.test');
  });
});
