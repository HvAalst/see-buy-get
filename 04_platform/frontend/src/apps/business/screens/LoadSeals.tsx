import { useCallback, useEffect, useState } from 'preact/hooks';
import { useT, type MessageKey } from '../../../shared/i18n';
import { SEAL_CLASSES, sealOver, sealStory, sealWhat, type SealClass } from '../../../shared/seals';
import type { BusinessClient, PostedLoad } from '../api';
import { EMPTY_SEAL, SEAL_PHOTOS, sealBody, sealGaps, type SealForm, type SealPhoto, type SealsView } from '../seals';
import { ConsolePick } from '../../tower/ConsolePick';

const onRoad = (iso: string) => new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

const PHOTO_LABEL: Record<SealPhoto, MessageKey> = {
  loadedOpen: 'business.seals.photo.loadedOpen',
  closedWithSeal: 'business.seals.photo.closedWithSeal',
  sealCloseUp: 'business.seals.photo.sealCloseUp',
};
const CLASS_LABEL: Record<SealClass, MessageKey> = { H: 'common.seal.classH', S: 'common.seal.classS', I: 'common.seal.classI' };

/*
 * ROUND 15 — THE SEALS ON A LOAD, as its shipper writes them before pickup and reads what became of each after: found on
 * the door at pickup, opened by customs at a post and sealed again, found broken on the road, looked at with the receiver.
 * Anybody in the business reads them; a member who may act writes one — with its three photographs — or takes it off,
 * until the goods are taken over.
 */
export function LoadSeals({ row, client, act }: { row: PostedLoad; client: BusinessClient | null; act: boolean }) {
  const t = useT();
  const [view, setView] = useState<SealsView | null>(null);
  const [form, setForm] = useState<SealForm | null>(null);
  const [sending, setSending] = useState<SealPhoto | 'seal' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const read = useCallback(async () => {
    if (!client) return;
    const r = await client.seals(row.freightId);
    setView(r.error ? null : (r.data ?? null));
  }, [client, row.freightId]);

  useEffect(() => {
    setForm(null);
    void read();
  }, [read]);

  const photo = async (which: SealPhoto, file: File | undefined) => {
    if (!client || !file || !form) return;
    setSending(which);
    setError(null);
    const id = await client.sealPhoto(file);
    setSending(null);
    if (!id) return setError(t('business.seals.photoFailed'));
    setForm((f) => (f ? { ...f, [which]: id } : f));
  };

  const write = async () => {
    if (!client || !form) return;
    setSending('seal');
    setError(null);
    const r = await client.writeSeal(row.freightId, sealBody(form));
    setSending(null);
    if (r.error) return setError(r.error.detail || r.error.title || null);
    setForm(null);
    await read();
  };

  const remove = async (sealId: string) => {
    if (!client) return;
    setError(null);
    const r = await client.removeSeal(row.freightId, sealId);
    if (r.error) return setError(r.error.detail || r.error.title || null);
    await read();
  };

  if (!view) return null;
  const gaps = form ? sealGaps(form) : [];
  return (
    <section class="cons__panel">
      <div class="cons__panelhead">
        <span class="cons__panelt">{t('business.seals.title')}</span>
        <span class="chint">{t('business.seals.hint')}</span>
      </div>
      {/* Round 38 — whose rule, and what it asks: a required seal not written and the goods are not taken over. */}
      {view.required ? (
        <p class={view.seals.some((s) => s.state === 'on') ? 'chint' : 'chint biz-papers__held'}>
          {t(view.required.why === 'crossBorder' ? 'business.seals.requiredCrossBorder' : view.required.why === 'secured' ? 'business.seals.requiredSecured' : 'business.seals.requiredContainer', { company: view.required.company })}
        </p>
      ) : null}
      {view.seals.length ? (
        <div class="crows">
          {view.seals.map((s) => (
            <div class="crow" key={s.sealId}>
              <span class="crow__body">
                <span class="crow__top">
                  <span class="crow__name biz-seal__num">{s.number}</span>
                  <span class={`ctag ${s.state === 'broken' ? 'ctag--danger' : s.state === 'replaced' ? 'ctag--quiet' : 'ctag--ok'}`}>{t(`business.seals.state.${s.state}` as MessageKey)}</span>
                </span>
                <span class="crow__sub">{sealWhat({ ...s, number: undefined }, t)}</span>
                {sealOver(s, t) ? <span class="crow__sub">{sealOver(s, t)}</span> : null}
                <span class="crow__sub">
                  {sealStory(s, t, onRoad)}
                  {s.state === 'replaced' && s.replaced?.officer ? ` · ${t('business.seals.officer', { officer: s.replaced.officer })}` : ''}
                  {s.state === 'broken' && s.broken?.note ? ` · “${s.broken.note}”` : ''}
                </span>
              </span>
              {act && view.editable ? (
                <span class="crow__tail">
                  <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => void remove(s.sealId)}>
                    {t('business.seals.remove')}
                  </button>
                </span>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <p class="cons__empty">{t(!view.editable ? 'business.seals.none' : view.required ? 'business.seals.noneYetRequired' : 'business.seals.noneYet')}</p>
      )}

      {act && view.editable && !form ? (
        <div class="twr-panelend">
          <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => setForm({ ...EMPTY_SEAL })}>
            {t('business.seals.add')}
          </button>
        </div>
      ) : null}

      {form ? (
        <div class="biz-seal__form">
          <div class="biz-seal__row">
            <label class="cfield">
              <span class="cfield__label">{t('business.seals.number')}</span>
              <input id="seal-number" class="cinput" maxLength={40} value={form.number} onInput={(e) => setForm({ ...form, number: (e.target as HTMLInputElement).value })} />
            </label>
            <ConsolePick
              label={t('business.seals.class')}
              value={form.sealClass}
              placeholder={t('business.seals.classPick')}
              options={SEAL_CLASSES.map((c) => ({ value: c, label: t(CLASS_LABEL[c]) }))}
              onChange={(sealClass) => setForm({ ...form, sealClass: sealClass as SealClass | '' })}
            />
            <label class="cfield">
              <span class="cfield__label">{t('business.seals.maker')}</span>
              <input id="seal-maker" class="cinput" maxLength={60} value={form.maker} onInput={(e) => setForm({ ...form, maker: (e.target as HTMLInputElement).value })} />
            </label>
            <ConsolePick
              label={t('business.seals.appliedBy')}
              value={form.appliedBy}
              options={[
                { value: 'sender', label: t('business.seals.bySender') },
                { value: 'customs', label: t('business.seals.byCustoms') },
              ]}
              onChange={(appliedBy) => setForm({ ...form, appliedBy: appliedBy as 'sender' | 'customs' })}
            />
          </div>
          <p class="chint">{t('business.seals.photosHint')}</p>
          <div class="biz-seal__row">
            {SEAL_PHOTOS.map((p) => (
              <label class="cfield" key={p}>
                <span class="cfield__label">{t(PHOTO_LABEL[p])}</span>
                <input id={`seal-${p}`} class="cinput" type="file" accept="image/*" capture="environment" disabled={sending !== null} onChange={(e) => void photo(p, (e.currentTarget as HTMLInputElement).files?.[0])} />
                <span class="chint">{sending === p ? t('business.seals.sending') : form[p] ? t('business.seals.photoKept') : ''}</span>
              </label>
            ))}
          </div>
          <div class="twr-panelend">
            <button type="button" class="cbtn cbtn--primary cbtn--sm" disabled={sending !== null || gaps.length > 0} onClick={() => void write()}>
              {t('business.seals.write')}
            </button>
            <button type="button" class="cbtn cbtn--ghost cbtn--sm" onClick={() => setForm(null)}>
              {t('business.seals.cancel')}
            </button>
          </div>
        </div>
      ) : null}
      {error ? <p class="cerr">{error}</p> : null}
    </section>
  );
}
