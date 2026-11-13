import { useState } from 'preact/hooks';
import { Button, Card, ErrorNote } from './ui';
import { formatDate, useT } from './i18n';
import type { SbgError } from '../lib/sbg';

/** 2026-11-13 — a weight found later at a hub, unlike what the sender said (backend weight-check.service.ts). */
export interface WeightFound {
  kg: number;
  at: string;
  siteName: string;
  saidKg: number;
  answer?: { text: string; at: string };
}

/**
 * 2026-11-13 — WHAT A HUB FOUND IT WEIGHS, AND YOUR SIDE (the owner: "shop and hub tools", T2: "recorded with both sides heard, and
 * the sender is told"). For the person who sent it (the Send app) and the store (its order): what was found, where, against what
 * they said; and their answer — once, shown beside it as written.
 */
export function WeightFoundCard({ found, onAnswer }: { found: WeightFound; onAnswer: (text: string) => Promise<SbgError | null> }) {
  const t = useT();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SbgError | null>(null);
  const send = async () => {
    if (!text.trim()) return;
    setBusy(true);
    const failed = await onAnswer(text.trim());
    setBusy(false);
    setError(failed);
    if (!failed) setText('');
  };
  return (
    <Card title={t(found.kg > found.saidKg ? 'common.weight.heavier' : 'common.weight.lighter')}>
      <p class="t-body">{t('common.weight.found', { site: found.siteName, kg: found.kg, said: found.saidKg, date: formatDate(found.at) })}</p>
      {found.answer ? (
        <p class="card__note">{t('common.weight.yourSide', { text: found.answer.text })}</p>
      ) : (
        <>
          <div class="field">
            <label class="field__label" for="weight-answer">
              {t('common.weight.answerLabel')}
            </label>
            <textarea id="weight-answer" class="input" rows={2} maxLength={500} value={text} onInput={(e) => setText(e.currentTarget.value)} />
          </div>
          {error ? <ErrorNote error={error} /> : null}
          <Button chevron={false} busy={busy} disabled={!text.trim()} onClick={() => void send()}>
            {t('common.weight.answer')}
          </Button>
        </>
      )}
    </Card>
  );
}
