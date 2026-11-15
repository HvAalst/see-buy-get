import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { t } from '../../shared/i18n';
import { HoldBlock } from './screens/HoldBlock';

/*
 * 2026-11-15 — THE HOLD, AS THE PERSON WHO PAID SEES IT: the driver's pay held until a time, a problem reported within it,
 * and what the protocol decided — always with the page that explains how it is decided.
 */
const upload = async () => ({ failed: 'not here' });
const at = '2026-11-16T10:00:00.000Z';

describe('the hold on a load the person paid for', () => {
  it('held: says until when, offers to report a problem, and links the protocol', () => {
    const html = renderToString(<HoldBlock freightId="f1" hold={{ heldUntil: at, canReport: true }} client={null} upload={upload} />);
    expect(html).toContain(t('send.hold.until', { time: '§' }).split('§')[0]);
    expect(html).toContain(t('send.hold.report'));
    expect(html).toContain('help/when-something-goes-wrong/');
  });

  it('reported: says the pay stays held, and no second report', () => {
    const html = renderToString(<HoldBlock freightId="f1" hold={{ heldUntil: at, reported: true }} client={null} upload={upload} />);
    expect(html).toContain(t('send.hold.reported'));
    expect(html).not.toContain(`>${t('send.hold.report')}<`);
  });

  it('decided: the step that decided, in the words everybody is shown', () => {
    const html = renderToString(<HoldBlock freightId="f1" hold={{ holdWords: 'Step 2: the problem was not noted at the door.' }} client={null} upload={upload} />);
    expect(html).toContain(t('send.hold.decided'));
    expect(html).toContain('Step 2: the problem was not noted at the door.');
  });

  it('released with nothing reported, or never held: nothing at all', () => {
    expect(renderToString(<HoldBlock freightId="f1" hold={{}} client={null} upload={upload} />)).toBe('');
  });

  it('past the 24 hours, held for a report no longer possible: no button', () => {
    const html = renderToString(<HoldBlock freightId="f1" hold={{ heldUntil: at }} client={null} upload={upload} />);
    expect(html).not.toContain(`>${t('send.hold.report')}<`);
  });
});
