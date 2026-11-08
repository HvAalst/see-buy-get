import { useState } from 'preact/hooks';
import { Button, Card, Note } from '../../../shared/ui';
import { useT } from '../../../shared/i18n';
import { geocode, zoneAt, type ZoneAnswer } from '../api';

/**
 * WHICH PRICE ZONE A PLACE IS IN (2026-11-08 — zone pricing, step 3: "a public page to look up a zone"). Each country
 * SeeBuyGet runs in is divided into price zones by its own company, and a parcel's price is read from the two zones it
 * travels between. Anybody may look a place up — by name, or where they stand — with no account: a price is public, and
 * so is the zone it is read from. Nothing is kept: the place goes to the place search and the point to the zone answer.
 */
export function ZonesScreen() {
  const t = useT();
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ where: string; answer: ZoneAnswer } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const look = async (point: { lat: number; lng: number }, where: string) => {
    const r = await zoneAt(point.lat, point.lng);
    setBusy(false);
    if (r.error || !r.data) {
      setProblem(t('home.zones.failed'));
      return;
    }
    setSaid({ where, answer: r.data });
  };

  const find = async () => {
    const query = q.trim();
    if (!query) return;
    setBusy(true);
    setProblem(null);
    setSaid(null);
    const r = await geocode(query);
    // A stand-in point for a name nobody found is not a place.
    if (r.error || !r.data || r.data.confidence === 'fallback') {
      setBusy(false);
      setProblem(t('home.zones.notFound'));
      return;
    }
    await look(r.data.location, r.data.matched ?? query);
  };

  const here = () => {
    setProblem(null);
    setSaid(null);
    if (!globalThis.navigator?.geolocation) {
      setProblem(t('home.zones.hereFailed'));
      return;
    }
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => void look({ lat: pos.coords.latitude, lng: pos.coords.longitude }, t('home.zones.here')),
      () => {
        setBusy(false);
        setProblem(t('home.zones.hereFailed'));
      },
      { enableHighAccuracy: false, timeout: 15_000, maximumAge: 300_000 },
    );
  };

  return (
    <div class="scr">
      <h1 class="scr__title">{t('home.zones.title')}</h1>
      <p class="scr__lede">{t('home.zones.lede')}</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void find();
        }}
      >
        <div class="field">
          <label class="field__label" for="zones-q">
            {t('home.zones.whereLabel')}
          </label>
          <input id="zones-q" class="input" type="search" autocomplete="off" placeholder={t('home.zones.wherePh')} value={q} onInput={(e) => setQ(e.currentTarget.value)} />
        </div>
        <Button type="submit" busy={busy} disabled={!q.trim()}>
          {t('home.zones.look')}
        </Button>
      </form>
      <Button variant="link" onClick={here} disabled={busy}>
        {t('home.zones.useHere')}
      </Button>

      {problem ? <Note tone="warn" icon="pin" title={problem} detail="" /> : null}
      {said ? (
        said.answer.zone ? (
          <Card label={t('home.zones.answerLabel')}>
            <p class="t-body">{t('home.zones.inZone', { where: said.where, zone: said.answer.zone.name, group: said.answer.zone.groupName, country: countryName(said.answer.country ?? '') })}</p>
          </Card>
        ) : (
          <Note tone="info" icon="pin" title={t('home.zones.none', { where: said.where })} detail="" />
        )
      ) : null}

      <p class="hint">{t('home.zones.how')}</p>
      <a class="btn btn--link" href="/send/">
        {t('home.zones.send')}
      </a>
    </div>
  );
}

/** A country's name in the reader's language, or its code where the browser knows none. */
function countryName(code: string): string {
  try {
    return new Intl.DisplayNames([document.documentElement.lang || 'en'], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}
