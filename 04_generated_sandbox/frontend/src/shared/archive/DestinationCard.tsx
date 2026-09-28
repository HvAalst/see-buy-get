import { useState } from 'preact/hooks';
import { Button, Card, Note, Sheet } from '../ui';
import { useT, type Translate } from '../i18n';
import { day } from './words';
import type { DestinationApiState } from './useDestination';
import { DESTINATION_KINDS, type ConnectDestination, type DestinationKind } from '../../lib/sbg/personas/archive';

/**
 * PLUG YOUR OWN STORAGE.
 *
 * We delete the document at twelve months, so the copy that survives has to arrive somewhere by
 * itself: a retention policy that depends on a person remembering to download a ZIP is a policy that
 * destroys evidence. This is where they say where.
 *
 * It offers PROTOCOLS rather than brands, which takes a sentence of explaining and is the honest
 * shape — "any other" was the requirement, and a list of three vendors would have been a list that
 * excludes whoever the reader actually uses. The brand names are in the helper text underneath each
 * one, because "S3-compatible" means nothing to somebody who just wants their files in Nextcloud.
 */
export function DestinationCard({ api }: { api: DestinationApiState }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const d = api.destination;
  const connected = Boolean(d?.connected);

  return (
    <>
      <Card title={t('dest.title')}>
        <p class="hint">{t('dest.lede')}</p>

        {!connected ? (
          <>
            <p class="hint">{t('dest.noneYet')}</p>
            <Button onClick={() => setOpen(true)}>{t('dest.connect')}</Button>
          </>
        ) : (
          <>
            <div class="kv">
              <span>{t('dest.where')}</span>
              <b>{d?.label}</b>
            </div>
            <div class="kv">
              <span>{t('dest.folder')}</span>
              <b class="mono-t">{d?.prefix || '/'}</b>
            </div>
            <div class="kv">
              <span>{t('dest.lastDelivery')}</span>
              {/* Absent is the state worth showing loudest: a destination that has never once worked
                  looks identical to a healthy one until the day somebody needs a document. */}
              <b>{d?.lastOkAt ? day(d.lastOkAt) : t('dest.neverYet')}</b>
            </div>

            {d?.lastError ? <Note tone="warn" icon="warning" title={t('dest.notWorking')} detail={d.lastError} /> : null}
            {api.secret ? <Note tone="info" icon="key" title={t('dest.secretTitle')} detail={`${api.secret} — ${t('dest.secretDetail')}`} /> : null}
            {api.tested ? (
              <Note
                tone={api.tested.ok ? 'ok' : 'danger'}
                icon={api.tested.ok ? 'check' : 'warning'}
                title={api.tested.ok ? t('dest.testOk') : t('dest.testFailed')}
                detail={api.tested.ok ? t('dest.testOkDetail', { key: api.tested.key }) : api.tested.detail}
              />
            ) : null}

            <Button variant="outline" busy={api.busy === 'test'} onClick={() => void api.test()}>
              {t('dest.test')}
            </Button>
            <Button variant="link" full={false} busy={api.busy === 'disconnect'} onClick={() => void api.disconnect()}>
              {t('dest.disconnect')}
            </Button>

            {api.deliveries.length ? <DeliveryLines api={api} /> : null}
          </>
        )}
      </Card>

      <ConnectSheet
        open={open}
        busy={api.busy === 'connect'}
        onClose={() => setOpen(false)}
        onConnect={async (input) => {
          if (await api.connect(input)) setOpen(false);
        }}
      />
    </>
  );
}

/** What has arrived and what has not. Failures first, because they are the only actionable rows. */
function DeliveryLines({ api }: { api: DestinationApiState }) {
  const t = useT();
  const failed = api.deliveries.filter((x) => x.state === 'failed');
  const pending = api.deliveries.filter((x) => x.state === 'pending');
  const done = api.deliveries.filter((x) => x.state === 'delivered');
  return (
    <>
      <h3 class="scr__section">{t('dest.sent')}</h3>
      {failed.length ? (
        <Note
          tone="danger"
          icon="warning"
          title={t('dest.gaveUp', { count: failed.length })}
          detail={`${failed.map((f) => f.number).join(', ')} — ${failed[0].lastError ?? ''}`}
        />
      ) : null}
      <p class="hint">
        {t('dest.counts', { delivered: done.length, pending: pending.length })}
      </p>
    </>
  );
}

/* ------------------------------------------------------------------- connecting -- */

const HELP: Record<DestinationKind, { name: (t: Translate) => string; who: (t: Translate) => string }> = {
  s3: { name: (t) => t('dest.kind.s3'), who: (t) => t('dest.kind.s3Who') },
  webdav: { name: (t) => t('dest.kind.webdav'), who: (t) => t('dest.kind.webdavWho') },
  webhook: { name: (t) => t('dest.kind.webhook'), who: (t) => t('dest.kind.webhookWho') },
};

function ConnectSheet({
  open,
  busy,
  onClose,
  onConnect,
}: {
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onConnect: (input: ConnectDestination) => Promise<void>;
}) {
  const t = useT();
  const [kind, setKind] = useState<DestinationKind>('s3');
  const [form, setForm] = useState<Record<string, string>>({ prefix: 'seebuyget/consignment-notes', region: 'us-east-1' });
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const ready =
    Boolean(form.endpoint) &&
    (kind === 's3' ? Boolean(form.bucket && form.accessKeyId && form.secretAccessKey) : kind === 'webdav' ? Boolean(form.username && form.password) : true);

  return (
    <Sheet open={open} onClose={onClose} title={t('dest.connectTitle')}>
      <div class="field">
        <label class="field__label" for="dest-kind">{t('dest.kindLabel')}</label>
        <select id="dest-kind" class="select" value={kind} onChange={(e) => setKind(e.currentTarget.value as DestinationKind)}>
          {DESTINATION_KINDS.map((k) => (
            <option key={k} value={k}>
              {HELP[k].name(t)}
            </option>
          ))}
        </select>
        {/* The brands go here rather than in the option: "S3-compatible" means nothing to somebody
            who simply wants their files to land in Nextcloud. */}
        <p class="hint">{HELP[kind].who(t)}</p>
      </div>

      <div class="field">
        <label class="field__label" for="dest-endpoint">{t(kind === 'webhook' ? 'dest.endpointHook' : 'dest.endpoint')}</label>
        <input
          id="dest-endpoint"
          class="input"
          type="url"
          autocomplete="off"
          spellcheck={false}
          placeholder={t(kind === 's3' ? 'dest.endpointPhS3' : kind === 'webdav' ? 'dest.endpointPhDav' : 'dest.endpointPhHook')}
          value={form.endpoint ?? ''}
          onInput={(e) => set('endpoint', e.currentTarget.value)}
        />
      </div>

      {kind === 's3' ? (
        <>
          <Field id="dest-bucket" label={t('dest.bucket')} value={form.bucket} onInput={(v) => set('bucket', v)} />
          <Field id="dest-region" label={t('dest.region')} value={form.region} onInput={(v) => set('region', v)} />
          <Field id="dest-key" label={t('dest.accessKey')} value={form.accessKeyId} onInput={(v) => set('accessKeyId', v)} />
          <Field id="dest-secret" label={t('dest.secretKey')} value={form.secretAccessKey} onInput={(v) => set('secretAccessKey', v)} password />
        </>
      ) : null}

      {kind === 'webdav' ? (
        <>
          <Field id="dest-user" label={t('dest.username')} value={form.username} onInput={(v) => set('username', v)} />
          <Field id="dest-pass" label={t('dest.password')} value={form.password} onInput={(v) => set('password', v)} password />
        </>
      ) : null}

      {kind !== 'webhook' ? <Field id="dest-prefix" label={t('dest.prefix')} value={form.prefix} onInput={(v) => set('prefix', v)} /> : null}

      <p class="hint">{t('dest.https')}</p>

      <Button
        busy={busy}
        disabled={!ready}
        onClick={() =>
          void onConnect({
            kind,
            endpoint: form.endpoint,
            ...(form.bucket ? { bucket: form.bucket } : {}),
            ...(form.region ? { region: form.region } : {}),
            ...(form.prefix ? { prefix: form.prefix } : {}),
            ...(form.accessKeyId ? { accessKeyId: form.accessKeyId } : {}),
            ...(form.secretAccessKey ? { secretAccessKey: form.secretAccessKey } : {}),
            ...(form.username ? { username: form.username } : {}),
            ...(form.password ? { password: form.password } : {}),
          })
        }
      >
        {t('dest.connectAndTest')}
      </Button>
    </Sheet>
  );
}

function Field({ id, label, value, onInput, password }: { id: string; label: string; value?: string; onInput: (v: string) => void; password?: boolean }) {
  return (
    <div class="field">
      <label class="field__label" for={id}>{label}</label>
      <input
        id={id}
        class="input"
        type={password ? 'password' : 'text'}
        autocomplete="off"
        spellcheck={false}
        value={value ?? ''}
        onInput={(e) => onInput(e.currentTarget.value)}
      />
    </div>
  );
}
