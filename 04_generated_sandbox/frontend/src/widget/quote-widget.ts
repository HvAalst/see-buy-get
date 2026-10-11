import {
  apiBase,
  collectLine,
  headers,
  configProblem,
  errorLine,
  invitationFor,
  parseAreas,
  priceLine,
  quoteRequest,
  readyLine,
  savingLine,
  strings,
  type Destination,
  type Problem,
  type QuoteResponse,
  type Strings,
  type WidgetAttrs,
  siteBase,
} from './logic';

/**
 * `<sbg-shipping-quote>` — the drop-in "calculate your shipping fee" button.
 *
 * One script tag and one element, on any page, with no build step and no framework. Three decisions shape
 * everything below:
 *
 *  - **A custom element, not an iframe and not a script that writes into the page.** An iframe cannot size
 *    itself to its content or inherit the shop's typography; a bare script injecting markup fights the
 *    merchant's CSS in both directions. A custom element with a SHADOW ROOT is the only one of the three
 *    where neither side can break the other by accident.
 *  - **No framework.** A merchant should not pay for a UI runtime to render one price on a product page,
 *    so this is plain DOM. It is the one place in this codebase where that is the right trade.
 *  - **It inherits the page.** `font: inherit` and a single overridable accent, because a widget that
 *    shouts in its own house style looks bolted on. `--sbg-accent`, `--sbg-radius` and `--sbg-fg` pierce
 *    the shadow boundary by design, and are the whole styling contract.
 */

declare const __SBG_API_BASE__: string;
const BAKED_API = typeof __SBG_API_BASE__ === 'string' ? __SBG_API_BASE__ : 'http://localhost:3000/v1';
// The consumer site this build was made for (SBG_PUBLIC_URL), where a buyer signs up. Empty on a laptop build: the
// invitation then shows only where the embed names a `site`.
declare const __SBG_SITE_BASE__: string;
const BAKED_SITE = typeof __SBG_SITE_BASE__ === 'string' ? __SBG_SITE_BASE__ : '';

const CSS = `
:host { display: inline-block; font: inherit; color: var(--sbg-fg, inherit); }
* { box-sizing: border-box; }
button { font: inherit; cursor: pointer; }
.cta {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 10px 16px; border-radius: var(--sbg-radius, 8px);
  border: 1px solid var(--sbg-accent, #4c46e0); background: transparent;
  color: var(--sbg-accent, #4c46e0); font-weight: 600;
}
.cta:hover { background: color-mix(in srgb, var(--sbg-accent, #4c46e0) 8%, transparent); }
.cta:focus-visible, select:focus-visible, .where:focus-visible, .go:focus-visible, .link:focus-visible, .follow a:focus-visible { outline: 2px solid var(--sbg-accent, #4c46e0); outline-offset: 2px; }
.panel {
  margin-top: 10px; padding: 16px; min-width: 260px; max-width: 340px;
  border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
  border-radius: var(--sbg-radius, 8px);
}
.panel[hidden] { display: none; }
h3 { margin: 0 0 12px; font-size: 15px; font-weight: 600; }
label { display: block; font-size: 12px; opacity: .7; margin: 10px 0 4px; }
label:first-of-type { margin-top: 0; }
select, .where {
  width: 100%; font: inherit; padding: 8px 10px; border-radius: var(--sbg-radius, 8px);
  border: 1px solid color-mix(in srgb, currentColor 25%, transparent);
  background: transparent; color: inherit;
}
/* A quiet link, not a second call to action. The button on this panel is the price; sending somebody
   away to read about the shop would be the widget competing with the checkout it sits in. */
.rep {
  display: inline-block;
  margin-top: 10px;
  font-size: 13px;
  color: inherit;
  opacity: .75;
  text-decoration: underline;
}

.rep:hover { opacity: 1; }

.go {
  margin-top: 14px; width: 100%; padding: 10px 14px; border: 0;
  border-radius: var(--sbg-radius, 8px); background: var(--sbg-accent, #4c46e0);
  color: #fff; font-weight: 600;
}
.go[disabled] { opacity: .5; cursor: default; }
.out { margin-top: 14px; font-size: 14px; }
.price { font-size: 24px; font-weight: 700; letter-spacing: -.01em; font-variant-numeric: tabular-nums; }
.sub { opacity: .7; font-size: 13px; margin-top: 2px; }
.row { margin-top: 10px; font-size: 13px; }
.row b { font-weight: 600; }
.hint { margin: 6px 0 0; font-size: 12px; opacity: .6; }
.flag { margin-top: 10px; font-size: 12px; opacity: .75; }
.err { margin-top: 12px; font-size: 13px; color: #a33a3a; }
.link { background: none; border: 0; padding: 0; color: var(--sbg-accent, #4c46e0); text-decoration: underline; font-size: 13px; }
/* The invitation under a price. Outlined, not filled: the filled button on this panel is the price, and this is what
   comes after it — asked for once the buyer has their answer, never before. */
.follow { margin-top: 14px; padding-top: 12px; border-top: 1px solid color-mix(in srgb, currentColor 14%, transparent); }
.follow b { display: block; font-size: 14px; font-weight: 600; }
.follow p { margin: 4px 0 10px; font-size: 13px; opacity: .75; }
.follow a {
  display: block; text-align: center; padding: 9px 14px; border-radius: var(--sbg-radius, 8px);
  border: 1px solid var(--sbg-accent, #4c46e0); color: var(--sbg-accent, #4c46e0);
  font-weight: 600; font-size: 14px; text-decoration: none;
}
.follow a:hover { background: color-mix(in srgb, var(--sbg-accent, #4c46e0) 8%, transparent); }
`;

const ATTRS = ['api', 'key', 'from-point', 'from-country', 'from-area', 'weight-kg', 'length-cm', 'width-cm', 'height-cm', 'size', 'label', 'locale', 'site', 'store'];

class SbgShippingQuote extends HTMLElement {
  static get observedAttributes(): string[] {
    return ATTRS;
  }

  private root!: ShadowRoot;
  // Locale-aware from the first paint: the CTA is rendered before anything is clicked, so reading the
  // attribute later would show an English button and then swap it under the reader.
  private s: Strings = strings((globalThis as { SBG_QUOTE_STRINGS?: unknown }).SBG_QUOTE_STRINGS, this.getAttribute('locale') ?? undefined);
  private areas: Array<{ country: string; areas: string[] }> = [];
  private open = false;
  private busy = false;
  private quote: QuoteResponse | null = null;
  private error: string | null = null;
  private picked: Partial<Destination> = {};

  connectedCallback(): void {
    if (!this.root) this.root = this.attachShadow({ mode: 'open' });
    const problem = configProblem(this.attrs());
    if (problem) {
      // Shown to the DEVELOPER and nowhere else. A shopper who reads "from-area is missing" learns nothing
      // and trusts the shop less, so a misconfigured widget renders as though it were not on the page.
      console.error(`<sbg-shipping-quote>: ${problem}`);
      return;
    }
    this.render();
  }

  attributeChangedCallback(): void {
    if (this.root) this.render();
  }

  private attrs(): WidgetAttrs {
    const a = (n: string) => this.getAttribute(n);
    return {
      api: a('api'), key: a('key'), fromPoint: a('from-point'), fromCountry: a('from-country'), fromArea: a('from-area'),
      weightKg: a('weight-kg'), lengthCm: a('length-cm'), widthCm: a('width-cm'), heightCm: a('height-cm'), size: a('size'),
      site: a('site'), store: a('store'),
    };
  }

  private get locale(): string | undefined {
    return this.getAttribute('locale') ?? undefined;
  }

  /* ------------------------------------------------------------- network -- */

  private async load(): Promise<void> {
    if (this.areas.length) return;
    try {
      const res = await fetch(`${apiBase(this.attrs(), BAKED_API)}/sbg/shipping/areas`, { headers: headers(this.attrs()) });
      this.areas = parseAreas(await res.json());
      if (this.areas.length === 1) this.picked.country = this.areas[0].country; // one country is not a choice
    } catch {
      this.error = errorLine(null, this.s);
    }
  }

  private async submit(): Promise<void> {
    const typed = (this.root.getElementById?.('sbg-where') as HTMLInputElement | null)?.value ?? this.picked.where;
    const country = this.picked.country;
    const where = (typed ?? '').trim();
    if (!country || !where || this.busy) return;
    this.picked = { ...this.picked, where };
    this.busy = true;
    this.error = null;
    this.quote = null;
    this.render();
    try {
      const res = await fetch(`${apiBase(this.attrs(), BAKED_API)}/sbg/shipping/quotes`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers(this.attrs()) },
        body: JSON.stringify(quoteRequest(this.attrs(), { country, where })),
      });
      const body = (await res.json()) as QuoteResponse & Problem;
      if (!res.ok) {
        this.error = errorLine(body, this.s);
      } else {
        this.quote = body;
        // The merchant's own page gets the number. This is how a checkout adds it to a total, or a
        // product page caches it — without us guessing what they wanted to do with it.
        this.dispatchEvent(new CustomEvent('sbg:quote', { detail: body, bubbles: true, composed: true }));
      }
    } catch {
      this.error = errorLine(null, this.s);
    } finally {
      this.busy = false;
      this.render();
    }
  }

  /* ------------------------------------------------------------ rendering -- */

  private render(): void {
    this.s = strings((globalThis as { SBG_QUOTE_STRINGS?: unknown }).SBG_QUOTE_STRINGS, this.locale);
    this.root.replaceChildren(this.styles(), this.cta(), this.panel());
  }

  private styles(): HTMLStyleElement {
    const el = document.createElement('style');
    el.textContent = CSS;
    return el;
  }

  private cta(): HTMLButtonElement {
    const b = document.createElement('button');
    b.className = 'cta';
    b.type = 'button';
    b.textContent = this.getAttribute('label') || this.s.cta;
    b.setAttribute('aria-expanded', String(this.open));
    b.addEventListener('click', () => {
      this.open = !this.open;
      this.render();
      if (this.open) void this.load().then(() => this.render());
    });
    return b;
  }

  private panel(): HTMLDivElement {
    const p = document.createElement('div');
    p.className = 'panel';
    p.hidden = !this.open;
    if (!this.open) return p;

    const title = document.createElement('h3');
    title.textContent = this.s.panelTitle;
    p.append(title);

    if (!this.areas.length) {
      p.append(this.message(this.error ?? this.s.noAreas, Boolean(this.error)));
      return p;
    }

    p.append(this.select(this.s.country, this.areas.map((a) => a.country), this.picked.country, (v) => {
      this.picked = { country: v };
      this.quote = null;
      this.render();
    }));

    // TYPE OR PICK, one box. The areas we serve are suggestions on a datalist, not a closed list, because
    // a buyer knows their street and their town — not which of our zones contains them — and a dropdown of
    // our own vocabulary makes them guess at ours. Unrecognised text is placed by the server; text that is
    // an area name still works, so neither kind of answer is the wrong one to give.
    const areas = this.areas.find((a) => a.country === this.picked.country)?.areas ?? [];
    p.append(this.whereBox(areas));

    const go = document.createElement('button');
    go.className = 'go';
    go.type = 'button';
    go.textContent = this.busy ? this.s.working : this.s.submit;
    go.disabled = this.busy || !this.picked.country || !this.picked.where?.trim();
    go.addEventListener('click', () => void this.submit());
    p.append(go);

    // A link to what this store's shipping actually looks like, measured by us.
    //
    // An ATTRIBUTE rather than something resolved from the publishable key, for two reasons. A public
    // "which store is this key" endpoint would let anybody walk keys back to businesses, and the merchant
    // is already writing from-point and key into this tag — one more is the same shape of configuration.
    //
    // A merchant who omits it does not suppress the score: the page is public, at a URL, and reachable
    // without an account. Nobody can be made to put a link on their own website, which is exactly why the
    // rule was always that the profile must not live ONLY in the widget.
    // Both, or nothing. A store id with nowhere to send it produces a link to the merchant's own site,
    // which is a broken link on their checkout — worse than no chip at all. Silent rather than a console
    // error, because omitting the chip is a legitimate choice and not a misconfiguration.
    const store = this.getAttribute('store');
    const site = siteBase(this.attrs());
    if (store && site) {
      const chip = document.createElement('a');
      chip.className = 'rep';
      chip.href = `${site}/?store=${encodeURIComponent(store)}`;
      chip.target = '_blank';
      chip.rel = 'noopener noreferrer';
      chip.textContent = this.s.reputation;
      p.append(chip);
    }

    // One live region for whatever the answer turns out to be, so a screen reader hears the price (or the
    // problem) without the panel having to steal focus back from the button that was just pressed.
    const out = document.createElement('div');
    out.className = 'out';
    out.setAttribute('aria-live', 'polite');
    if (this.error) out.append(this.message(this.error, true));
    else if (this.quote) out.append(...this.answer(this.quote));
    p.append(out);

    // ONCE THE FEE IS ON SCREEN, and not before: the invitation to follow the parcel. Outside the live region on
    // purpose — a screen reader should hear the price it asked for, not the price and then a pitch.
    const follow = invitationFor({ quote: this.quote, error: this.error }, this.attrs(), BAKED_SITE);
    if (follow) p.append(this.follow(follow));
    return p;
  }

  /** "Want to follow your parcel?" — what signing up gets them, and the link that does it. */
  private follow(href: string): HTMLDivElement {
    const box = document.createElement('div');
    box.className = 'follow';
    const title = document.createElement('b');
    title.textContent = this.s.followTitle;
    const body = document.createElement('p');
    body.textContent = this.s.followBody;
    const link = document.createElement('a');
    link.href = href;
    // A NEW TAB, always. The buyer is in the middle of somebody's checkout, and a link that takes them out of it
    // costs the shop the sale it put this button there to make.
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = this.s.follow;
    box.append(title, body, link);
    return box;
  }

  private answer(q: QuoteResponse): Node[] {
    const nodes: Node[] = [];
    const price = document.createElement('div');
    price.className = 'price';
    price.textContent = priceLine(q, this.locale);
    nodes.push(price);

    const saving = savingLine(q, this.s, this.locale);
    if (saving) nodes.push(this.line('sub', saving));

    nodes.push(this.pair(this.s.collectAt, collectLine(q)));
    const ready = readyLine(q, this.locale);
    if (ready) nodes.push(this.pair(this.s.readyBy, ready));
    // Said out loud, because it is a thing the seller will have to do — not a surprise at the counter.
    if (q.route.crossesBorder) nodes.push(this.line('flag', this.s.crossesBorder));
    return nodes;
  }

  private pair(label: string, value: string): HTMLDivElement {
    const row = document.createElement('div');
    row.className = 'row';
    const b = document.createElement('b');
    b.textContent = `${label}: `;
    row.append(b, document.createTextNode(value));
    return row;
  }

  private line(cls: string, text: string): HTMLDivElement {
    const d = document.createElement('div');
    d.className = cls;
    d.textContent = text;
    return d;
  }

  private message(text: string, isError: boolean): HTMLDivElement {
    const d = this.line(isError ? 'err' : 'sub', text);
    if (isError) d.setAttribute('role', 'status');
    return d;
  }

  /** The one box a buyer types where they are into, with the areas we serve offered as suggestions. */
  private whereBox(areas: string[]): DocumentFragment {
    const frag = document.createDocumentFragment();
    const id = 'sbg-where';
    const listId = 'sbg-where-list';
    const l = document.createElement('label');
    l.textContent = this.s.area;
    l.htmlFor = id;
    const input = document.createElement('input');
    input.id = id;
    input.className = 'where';
    input.type = 'text';
    input.autocomplete = 'address-level2';
    input.disabled = !this.picked.country;
    input.value = this.picked.where ?? '';
    if (areas.length) input.setAttribute('list', listId);
    // Re-render on CHANGE, not on every keystroke: rebuilding the panel under somebody's fingers would
    // take the caret with it. The value is read back at submit either way.
    input.addEventListener('change', () => {
      this.picked = { ...this.picked, where: input.value };
      this.quote = null;
    });
    frag.append(l, input);
    if (areas.length) {
      const list = document.createElement('datalist');
      list.id = listId;
      for (const a of areas) {
        const opt = document.createElement('option');
        opt.value = a;
        list.append(opt);
      }
      frag.append(list);
    }
    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent = this.s.areaHint;
    frag.append(hint);
    return frag;
  }

  private select(label: string, options: string[], value: string | undefined, onPick: (v: string) => void, disabled = false): DocumentFragment {
    const frag = document.createDocumentFragment();
    const id = `sbg-${label.toLowerCase().replace(/\W+/g, '-')}`;
    const l = document.createElement('label');
    l.textContent = label;
    l.htmlFor = id;
    const s = document.createElement('select');
    s.id = id;
    s.disabled = disabled || options.length === 0;
    const blank = document.createElement('option');
    blank.value = '';
    blank.textContent = this.s.choose;
    s.append(blank);
    for (const o of options) {
      const opt = document.createElement('option');
      opt.value = o;
      opt.textContent = o;
      opt.selected = o === value;
      s.append(opt);
    }
    s.addEventListener('change', () => onPick(s.value));
    frag.append(l, s);
    return frag;
  }
}

// Defining twice throws, and a merchant with the script on two templates of the same page should get a
// working widget rather than a console full of red.
if (!customElements.get('sbg-shipping-quote')) customElements.define('sbg-shipping-quote', SbgShippingQuote);

export { SbgShippingQuote };
