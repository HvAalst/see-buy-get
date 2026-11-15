import { useEffect, useState } from 'preact/hooks';
import { Button, Card, Icon, Note, PhotoField, Pill, Sheet } from '../../../shared/ui';
import { frontDoorUrl } from '../../../shared/frontDoor';
import { useT, type MessageKey } from '../../../shared/i18n';
import type { DriverActions, DriverState } from '../useDriverApp';

/** A load this driver carried whose pay is held for a problem the sender reported (2026-11-15, the hold). */
export interface HeldProblem {
  freightId: string;
  code: string;
  description: string;
  heldUntil: string;
  problem: { kind: string; description: string; at: string };
  answered: boolean;
}

const KIND_WORDS: Record<string, MessageKey> = {
  damaged: 'driver.hold.kindDamaged',
  short: 'driver.hold.kindShort',
  not_received: 'driver.hold.kindNotReceived',
  wrong: 'driver.hold.kindWrong',
};

/**
 * 2026-11-15 — PROBLEMS REPORTED (the hold, H5; rule-both-sides-heard): a load the driver delivered, its pay held because the
 * sender reported a problem within 24 hours. The driver reads what was said and answers once, with words and their own photos,
 * shown beside the report to the member of staff who applies the protocol. Nothing where nothing is reported.
 */
export function HeldProblemsCard({ state, actions }: { state: DriverState; actions: DriverActions }) {
  const t = useT();
  const [answering, setAnswering] = useState<HeldProblem | null>(null);
  useEffect(() => {
    void actions.loadHeldProblems();
  }, []);
  const items = state.heldProblems ?? [];
  if (!items.length) return null;
  return (
    <Card title={t('driver.hold.title')}>
      <p class="card__note">{t('driver.hold.lede')}</p>
      <div class="rows" role="list">
        {items.map((p) => (
          <div key={p.freightId} class="row row--static" role="listitem">
            <span class="row__ic">
              <Icon name="warning" size={24} />
            </span>
            <span class="row__body">
              <span class="row__t">
                {p.code} · {p.description}
              </span>
              <span class="row__s">
                {t(KIND_WORDS[p.problem.kind] ?? 'driver.hold.kindDamaged')}: “{p.problem.description}”
              </span>
            </span>
            <span class="row__end">
              {p.answered ? (
                <Pill tone="idle">{t('driver.hold.answered')}</Pill>
              ) : (
                <Button variant="outline" full={false} chevron={false} onClick={() => setAnswering(p)}>
                  {t('driver.hold.answer')}
                </Button>
              )}
            </span>
          </div>
        ))}
      </div>
      <p class="hint">
        <a href={`${frontDoorUrl()}help/when-something-goes-wrong/`} target="_blank" rel="noopener">
          {t('driver.hold.how')}
        </a>
      </p>
      {answering ? <AnswerSheet problem={answering} state={state} actions={actions} onClose={() => setAnswering(null)} /> : null}
    </Card>
  );
}

function AnswerSheet({ problem, state, actions, onClose }: { problem: HeldProblem; state: DriverState; actions: DriverActions; onClose: () => void }) {
  const t = useT();
  const [words, setWords] = useState('');
  const [photo, setPhoto] = useState('');
  const busy = state.busy === `hold-answer:${problem.freightId}`;
  return (
    <Sheet open onClose={onClose} title={t('driver.hold.answerTitle', { code: problem.code })}>
      <Note tone="info" icon="info" title={t(KIND_WORDS[problem.problem.kind] ?? 'driver.hold.kindDamaged')} detail={problem.problem.description} />
      <p class="card__note">{t('driver.hold.answerLede')}</p>
      <div class="field">
        <label class="field__label" for={`hold-answer-${problem.freightId}`}>
          {t('driver.hold.answerWords')}
        </label>
        <textarea id={`hold-answer-${problem.freightId}`} class="input" rows={3} maxLength={1000} value={words} onInput={(e) => setWords(e.currentTarget.value)} />
      </div>
      <PhotoField id={`hold-answer-photo-${problem.freightId}`} value={photo} label={t('driver.hold.answerPhoto')} upload={(file) => actions.uploadPhoto('dispute', file)} onCapture={setPhoto} disabled={busy} />
      <Button chevron={false} disabled={words.trim().length < 3} busy={busy} onClick={() => void actions.answerHeldProblem(problem.freightId, words.trim(), photo ? [photo] : []).then((ok) => ok && onClose())}>
        {t('driver.hold.answerSend')}
      </Button>
      <Button variant="link" onClick={onClose}>
        {t('common.cancel')}
      </Button>
    </Sheet>
  );
}
