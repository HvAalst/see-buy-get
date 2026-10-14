import { describe, expect, it } from 'vitest';
import { HELP_TOPICS, illustrationStat, pictureState } from './pictures';

/**
 * The illustration library.
 *
 * One rule, tested from every side: there are THREE states, not two. Collapsing "the network drew this"
 * into "there is a picture" produces a Revert button that would delete something this deployment does
 * not own, and collapsing "nobody drew this" into "the network drew this" produces an Upload button that
 * claims to replace a drawing nobody has.
 */
describe('what a picture is, and whose it is', () => {
  it('knows an operator’s own upload, and offers to take it back', () => {
    const s = pictureState({ key: 'flatbed', imageUrl: '/img', source: 'deployment', updatedAt: '2026-09-01T10:00:00Z' });
    expect(s.owned).toBe(true);
    expect(s.provenanceKey).toBe('tower.pictures.yours');
    expect(s.uploadKey).toBe('tower.pictures.replace');
  });

  it('knows the network’s own drawing, and does NOT offer to delete it', () => {
    // It is not this deployment's to remove — only to override, which is a different promise.
    const s = pictureState({ key: 'flatbed', imageUrl: '/img', source: 'builtin' });
    expect(s.owned).toBe(false);
    expect(s.provenanceKey).toBe('tower.pictures.networks');
    expect(s.uploadKey).toBe('tower.pictures.useOwn');
  });

  it('treats "nobody has drawn this" as a normal state rather than a fault', () => {
    // The picker falls back to the words, and the empty slots are the to-do list.
    const s = pictureState({ key: 'barge' });
    expect(s.owned).toBe(false);
    expect(s.provenanceKey).toBe('tower.pictures.none');
    expect(s.uploadKey).toBe('tower.pictures.upload');
  });

  it('does not mistake a deployment upload with no date for the network’s', () => {
    const s = pictureState({ key: 'flatbed', imageUrl: '/img', source: 'deployment' });
    expect(s.owned).toBe(true);
    expect(s.params?.when).toBe('—');
  });
});

describe('how much of a vocabulary is drawn', () => {
  it('counts what exists and what is ours, as two numbers rather than a score', () => {
    // "17 of 24" is a to-do list; "71%" is a mark out of ten, and nobody can act on a mark.
    const stat = illustrationStat([
      { key: 'a', imageUrl: '/1', source: 'builtin' },
      { key: 'b', imageUrl: '/2', source: 'deployment' },
      { key: 'c' },
    ]);
    expect(stat).toEqual({ total: 3, illustrated: 2, mine: 1 });
  });

  it('says zero of zero for a vocabulary with no options at all', () => {
    expect(illustrationStat([])).toEqual({ total: 0, illustrated: 0, mine: 0 });
  });
});

describe('the vocabularies themselves', () => {
  it('lists the four whose options are recognised rather than known', () => {
    expect(HELP_TOPICS.map((t) => t.key)).toEqual(['packaging', 'body', 'equipment', 'nature']);
    // Every one carries both a name and the sentence that says what it decides.
    for (const t of HELP_TOPICS) expect(t.labelKey && t.hintKey).toBeTruthy();
  });
});
