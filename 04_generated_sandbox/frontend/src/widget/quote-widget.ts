import {
  apiBase,
  collectLine,
  configProblem,
  errorLine,
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
.cta:focus-visible, select:focus-visible, .go:focus-visible, .link:focus-visible { outline: 2px solid var(--sbg-accent, #4c46e0); outline-offset: 2px; }
.panel {
  margin-top: 10px; padding: 16px; min-width: 260px; max-width: 340px;
  border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
  border-radius: var(--sbg-radius, 8px);
}
.panel[hidden] { display: none; }
h3 { margin: 0 0 12px; font-size: 15px; font-weight: 600; }
label { display: block; font-size: 12px; opacity: .7; margin: 10px 0 4px; }
label:first-of-type { margin-top: 0; }
select {
  width: 100%; font: inherit; padding: 8px 10px; border-radius: var(--sbg-radius, 8px);
  border: 1px solid color-mix(in srgb, currentColor 25%, transparent);
  background: transparent; color: inherit;
}
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
.flag { margin-top: 10px; font-size: 12px; opacity: .75; }
.err { margin-top: 12px; font-size: 13px; color: #a33a3a; }
.link { background: none; border: 0; padding: 0; color: var(--sbg-accent, #4c46e0); text-decoration: underline; font-size: 13px; }
`;

const ATTRS = ['api', 'from-point', 'from-country', 'from-area', 'weight-kg', 'length-cm', 'width-cm', 'height-cm', 'size', 'label', 'locale'];

class SbgShippingQuote extends HTMLElement {
  static get observedAttributes(): string[] {
    return ATTRS;
  }

  private root!: ShadowRoot;
  private s: Strings = strings((globalThis as { SBG_QUOTE_STRINGS?: unknown }).SBG_QUOTE_STRINGS);
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
      api: a('api'), fromPoint: a('from-point'), fromCountry: a('from-country'), fromArea: a('from-area'),
      weightKg: a('weight-kg'), lengthCm: a('length-cm'), widthCm: a('width-cm'), heightCm: a('height-cm'), size: a('size'),
    };
  }

  private get locale(): string | undefined {
    return this.getAttribute('locale') ?? undefined;
  }

  /* ------------------------------------------------------------- network -- */

  private async load(): Promise<void> {
    if (this.areas.length) return;
    try {
      const res = await fetch(`${apiBase(this.attrs(), BAKED_API)}/sbg/shipping/areas`, { headers: { accept: 'application/json' } });
      this.areas = parseAreas(await res.json());
      if (this.areas.length === 1) this.picked.country = this.areas[0].country; // one country is not a choice
    } catch {
      this.error = errorLine(null, this.s);
    }
  }

  private async submit(): Promise<void> {
    const { country, area } = this.picked;
    if (!country || !area || this.busy) return;
    this.busy = true;
    this.error = null;
    this.quote = null;
    this.render();
    try {
      const res = await fetch(`${apiBase(this.attrs(), BAKED_API)}/sbg/shipping/quotes`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(quoteRequest(this.attrs(), { country, area })),
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
    this.s = strings((globalThis as { SBG_QUOTE_STRINGS?: unknown }).SBG_QUOTE_STRINGS);
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

    const areas = this.areas.find((a) => a.country === this.picked.country)?.areas ?? [];
    p.append(this.select(this.s.area, areas, this.picked.area, (v) => {
      this.picked = { ...this.picked, area: v };
      this.quote = null;
      this.render();
    }, !this.picked.country));

    const go = document.createElement('button');
    go.className = 'go';
    go.type = 'button';
    go.textContent = this.busy ? this.s.working : this.s.submit;
    go.disabled = this.busy || !this.picked.country || !this.picked.area;
    go.addEventListener('click', () => void this.submit());
    p.append(go);

    // One live region for whatever the answer turns out to be, so a screen reader hears the price (or the
    // problem) without the panel having to steal focus back from the button that was just pressed.
    const out = document.createElement('div');
    out.className = 'out';
    out.setAttribute('aria-live', 'polite');
    if (this.error) out.append(this.message(this.error, true));
    else if (this.quote) out.append(...this.answer(this.quote));
    p.append(out);
    return p;
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
