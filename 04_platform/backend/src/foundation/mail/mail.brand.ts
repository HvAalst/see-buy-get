import { readFileSync } from 'fs';
import { join } from 'path';

/*
 * THE HOUSE STYLE'S OWN FILES, as an email carries them (brand/README.md is the rule book; these are its files).
 *
 * THE LOGO travels INSIDE the email, as an inline image the HTML points at by content id. Not as a link to a picture
 * somewhere: that needs somewhere to host it (which does not exist before production), most mail clients hide a
 * remote picture until the reader allows it, and fetching one tells the host that the email was opened — which the
 * emails here deliberately do not do. An inline image is part of the message: it shows, and it tells nobody anything.
 * It is the identity's `logo-horizontal-on-dark` — the header is Deep Navy — and a test holds this copy to that file.
 *
 * THE TYPEFACES are the identity's two: Bricolage Grotesque for what is noticed, Inter for what is read. An email
 * cannot carry a typeface the way it carries a picture, so each email NAMES them first and falls back to the
 * reader's own; and where `MAIL_FONT_URL` says where the files are served, it also says where to fetch them. Apple
 * Mail and a few others do. Gmail and Outlook never load a typeface, whatever an email says — theirs is the fallback,
 * and the layout is made to stand on it. Both are under the SIL Open Font License (the licence texts are beside them).
 */

const ASSETS = join(__dirname, 'assets');

export interface MailImage {
  /** What the HTML calls it: `<img src="cid:…">`. */
  cid: string;
  name: string;
  mimeType: string;
  base64: string;
}

export const LOGO_CID = 'sbg-logo';
/** The logo as drawn (512 × 92) and as shown: a third of that, so it is sharp on a dense screen. */
export const LOGO_SHOWN = { width: 168, height: 30 };

let logo: MailImage | null | undefined;

/**
 * The logo, read once. `undefined` if the file is not there — a build that lost its assets — and then the header
 * falls back to the name in type: an email with no logo still goes, and still says who it is from.
 */
export function brandLogo(): MailImage | undefined {
  if (logo === undefined) {
    try {
      logo = { cid: LOGO_CID, name: 'seebuyget.png', mimeType: 'image/png', base64: readFileSync(join(ASSETS, 'logo-on-dark.png')).toString('base64') };
    } catch {
      logo = null;
    }
  }
  return logo ?? undefined;
}

export const DISPLAY_FACE = 'Bricolage Grotesque';
export const TEXT_FACE = 'Inter';

/** The files a mail client is pointed at, and what each is. Nothing else is ever served from the assets. */
export const MAIL_FONTS: Record<string, { family: string; weight: string }> = {
  'bricolage-grotesque.woff2': { family: DISPLAY_FACE, weight: '200 800' },
  'inter-400.woff2': { family: TEXT_FACE, weight: '400' },
  'inter-600.woff2': { family: TEXT_FACE, weight: '600' },
  'inter-700.woff2': { family: TEXT_FACE, weight: '700' },
};

const fonts = new Map<string, Buffer | null>();

/** One of the typeface files, by its exact name. A name that is not one of them is nothing — never a path. */
export function mailFont(name: string): Buffer | undefined {
  if (!Object.prototype.hasOwnProperty.call(MAIL_FONTS, name)) return undefined;
  if (!fonts.has(name)) {
    try {
      fonts.set(name, readFileSync(join(ASSETS, name)));
    } catch {
      fonts.set(name, null);
    }
  }
  return fonts.get(name) ?? undefined;
}

/**
 * Where the typeface files are served, as an email may name it: https, and nothing in it that could close the
 * stylesheet it is written into. Anything else is no address at all.
 */
export function fontsBase(raw: string | undefined): string | undefined {
  const url = raw?.trim().replace(/\/+$/, '');
  return url && /^https:\/\/[A-Za-z0-9.\-_~:/%[\]@]+$/.test(url) ? url : undefined;
}

/** The `@font-face` rules for a base the files are served under. `base` is trusted: `fontsBase` or the preview's own. */
export function fontFaceCss(base: string): string {
  return Object.entries(MAIL_FONTS)
    .map(([file, f]) => `@font-face{font-family:'${f.family}';font-style:normal;font-weight:${f.weight};font-display:swap;src:url('${base}/${file}') format('woff2');}`)
    .join('');
}
