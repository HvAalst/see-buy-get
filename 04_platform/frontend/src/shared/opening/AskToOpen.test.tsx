import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { AskToOpen, askMessage } from './AskToOpen';
import { makeConfig } from '../../lib/sbg';

/*
 * "ASK SEEBUYGET TO OPEN HERE" (the owner, 2026-11-04: "anytime that message is shown the user should be able to request SBG
 * to open in their country like early sign ups can do, explain their type of business and why SBG would be needed there
 * with an auto response email").
 */
describe('asking SeeBuyGet to open in a country', () => {
  it('sends the business and the reason under their own headings, within what the server keeps', () => {
    expect(askMessage('  A phone shop in Rotterdam ', ' Customers order online and collect nearby. ')).toBe(
      'Business: A phone shop in Rotterdam\n\nWhy SeeBuyGet is needed there: Customers order online and collect nearby.',
    );
    expect(askMessage('x'.repeat(200), 'y'.repeat(800)).length).toBe(600);
  });

  it('is offered by the country’s name, and not at all without a country', () => {
    const html = renderToString(<AskToOpen country="nl" kind="shop" config={makeConfig('agent', '1')} />);
    expect(html).toContain('Ask SeeBuyGet to open in Netherlands');
    expect(renderToString(<AskToOpen country={undefined} kind="shop" config={makeConfig('agent', '1')} />)).toBe('');
  });
});
