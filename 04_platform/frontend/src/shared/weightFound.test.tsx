import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { t } from './i18n';
import { WeightFoundCard } from './WeightFoundCard';

/*
 * 2026-11-13 — A WEIGHT A HUB FOUND, AND THE SENDER'S SIDE (the owner: "shop and hub tools", T2): what was found, where, against
 * what was said; the sender answers once, and the answer is shown beside it as written.
 */
describe('a weight found later', () => {
  const found = { kg: 3.5, at: '2026-11-13T10:00:00Z', siteName: 'Hub Mizani', saidKg: 2 };
  it('says what the hub found and asks the sender’s side', () => {
    const html = renderToString(<WeightFoundCard found={found} onAnswer={async () => null} />);
    expect(html).toContain(t('common.weight.heavier'));
    expect(html).toContain('Hub Mizani weighed it at 3.5 kg');
    expect(html).toContain('you said 2 kg');
    expect(html).toContain(t('common.weight.answer'));
    expect(renderToString(<WeightFoundCard found={{ ...found, kg: 1.2 }} onAnswer={async () => null} />)).toContain(t('common.weight.lighter'));
  });
  it('once answered, shows the side as written and asks nothing more', () => {
    const html = renderToString(<WeightFoundCard found={{ ...found, answer: { text: 'With its box', at: '2026-11-13T11:00:00Z' } }} onAnswer={async () => null} />);
    expect(html).toContain('With its box');
    expect(html).not.toContain(t('common.weight.answer'));
  });
});
