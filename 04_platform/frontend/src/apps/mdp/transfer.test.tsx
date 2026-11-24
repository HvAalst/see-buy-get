import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { t } from '../../shared/i18n';
import { EMPTY_TRANSFER, crossesBorder, transferBody } from './transfer';
import { TransferFields } from './screens/TransferFields';
import { onwardWords, waitingOf, type HubTransferRow } from './screens/HubTransfersCard';

/*
 * 2026-11-24 — A BAG HANDED OVER AT THE HUB FROM ANOTHER COUNTRY (corridor compliance, slice 4): the pass of the driver who brought
 * it, and what is wrong with it, asked only of a bag from another country; the parcels that still wait for a coded seal said.
 */
describe('a bag from another country at the hub', () => {
  it('is asked of a bag whose country is not the hub’s, and of nothing else', () => {
    expect(crossesBorder('NL', 'BG')).toBe(true);
    expect(crossesBorder('BG', 'BG')).toBe(false);
    expect(crossesBorder(undefined, 'BG')).toBe(false);
    expect(crossesBorder('NL', undefined)).toBe(false);
  });

  it('sends the pass, and each thing wrong in words; an empty line is not sent', () => {
    expect(transferBody(EMPTY_TRANSFER)).toEqual({ error: 'mdp.transfer.err.pass' });
    expect(transferBody({ pass: ' DRV-1-123456 ', exceptions: [{ note: '' }] })).toEqual({ body: { driverBadgeId: 'DRV-1-123456' } });
    expect(transferBody({ pass: 'DRV-1-123456', exceptions: [{ note: '  Corner   torn ', photoRef: 'med_1' }] })).toEqual({ body: { driverBadgeId: 'DRV-1-123456', exceptions: [{ note: 'Corner torn', photoRef: 'med_1' }] } });
    expect(transferBody({ pass: 'DRV-1-123456', exceptions: [{ note: 'ab' }] })).toEqual({ error: 'mdp.transfer.err.note' });
    expect(transferBody({ pass: 'DRV-1-123456', exceptions: [{ note: '', photoRef: 'med_2' }] })).toEqual({ error: 'mdp.transfer.err.note' });
    expect(transferBody({ pass: 'DRV-1-123456', exceptions: Array.from({ length: 6 }, () => ({ note: 'Wet corner' })) })).toEqual({ error: 'mdp.transfer.err.many' });
  });

  it('shows the country, the pass to scan, and a line for each thing wrong; no more than five', () => {
    const html = renderToString(<TransferFields fromCountry="NL" value={{ pass: '', exceptions: [{ note: 'Corner torn' }] }} onChange={() => undefined} upload={async () => ({ failed: 'x' }) as never} />);
    expect(html).toContain(t('mdp.transfer.title', { country: 'NL' }));
    expect(html).toContain('id="drop-pass"');
    expect(html).toContain('Corner torn');
    expect(html).toContain(t('mdp.transfer.addWrong'));
    const full = renderToString(<TransferFields fromCountry="NL" value={{ pass: '', exceptions: Array.from({ length: 5 }, () => ({ note: 'Wet' })) }} onChange={() => undefined} upload={async () => ({ failed: 'x' }) as never} />);
    expect(full).not.toContain(t('mdp.transfer.addWrong'));
  });

  it('the drop screen asks it only of such a bag, and sends it with the receipt', () => {
    const src = readFileSync(join('src/apps/mdp/screens', 'DropScreen.tsx'), 'utf8');
    expect(src).toMatch(/const crossing = looked && crossesBorder\(bag\.fromCountry, state\.hub\?\.country\);/);
    expect(src).toMatch(/actions\.submitDrop\(receiptBody\(receipt\), handover && 'body' in handover \? handover\.body : undefined\)/);
    expect(src).toMatch(/disabled=\{!receiptReady\(receipt, bag\.closedWith\) \|\| Boolean\(handover && 'error' in handover\)\}/);
  });

  it('counts the parcels of a handover still waiting for a bag on a coded seal', () => {
    const row: HubTransferRow = { transferId: 'htr_1', bagCode: 'BAG-1', fromCountry: 'NL', parcels: ['p1', 'p2', 'p3'], released: { at: '' }, received: { by: 'Petar', at: '' }, exceptions: [], passedOnWhole: false, onward: [{ bagCode: 'BAG-9', parcels: ['p1', 'p3'], sealNumber: 'S-1' }] };
    expect(waitingOf(row)).toBe(1);
    expect(waitingOf({ ...row, onward: [] })).toBe(3);
    // 2026-11-24 — one put on this hub's own counter shelf by hand waits no more, and is said so.
    const counter = { kind: 'counter' as const, bagCode: '', parcels: ['p2'], slot: 'B2' };
    expect(waitingOf({ ...row, onward: [...row.onward, counter] })).toBe(0);
    expect(onwardWords(counter, t)).toBe(t('mdp.transfers.counter', { slot: 'B2' }));
    expect(onwardWords(row.onward[0], t)).toBe(t('mdp.transfers.onward', { bag: 'BAG-9', seal: 'S-1', driver: t('mdp.transfers.aDriver') }));
  });
});
