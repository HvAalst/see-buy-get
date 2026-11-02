import type { ComponentChildren } from 'preact';

/**
 * The pictures for "Install the app": how to put SeeBuyGet on the home screen, then how to turn its
 * notifications on and keep them coming — on Android, and on an iPhone where that works.
 *
 * The owner, 2026-11-02: "a short introduction with images in a precise way how to set the
 * notification settings for android (or Apple if that works)". The person reading is often on a
 * budget Android phone and has never opened a settings screen, so each picture shows ONE step on a
 * phone, with the one thing to tap in orange and a finger on it.
 *
 * There are no words or letters in any picture — text lines are grey bars, buttons are shapes — so
 * every picture reads the same in every language; the words are the captions beside them, in the
 * catalogue. Drawn in the help drawings' house style (`backend/assets/illustrations/`): navy
 * outlines, white fills, grey for what is secondary, orange for what to tap and for our own icon.
 * Decorative: the caption carries the meaning, so each picture is hidden from screen readers.
 */

const NAVY = '#000963';
const ORANGE = '#FB6200';
const GREY = '#AFAFB0';
const WHITE = '#FFFFFF';

/* ---------- the pieces every picture shares ---------- */

/** The white card each picture sits on, so it reads the same on a light or a dark sheet. */
function Frame({ children }: { children: ComponentChildren }) {
  return (
    <svg
      class="ipic"
      viewBox="0 0 240 180"
      width="240"
      height="180"
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke={NAVY}
      stroke-width="3"
      stroke-linejoin="round"
      stroke-linecap="round"
    >
      <rect x="0" y="0" width="240" height="180" rx="16" fill={WHITE} stroke="none" />
      {children}
    </svg>
  );
}

/*
 * The phone. Body 112 × 164, the screen inside it from (71, 22) to (169, 158). An iPhone has rounder
 * corners, the pill at the top and the bar at the bottom; an Android a camera dot and a short nav bar.
 */
function Phone({ ios = false, children }: { ios?: boolean; children: ComponentChildren }) {
  return (
    <g>
      <rect x="64" y="8" width="112" height="164" rx={ios ? 20 : 15} fill={WHITE} />
      <rect x="71" y="22" width="98" height="136" rx={ios ? 7 : 3} fill={WHITE} stroke={GREY} stroke-width="2" />
      {children}
      {ios ? (
        <>
          <rect x="109" y="12.5" width="22" height="5.5" rx="2.75" fill={NAVY} stroke="none" />
          <path d="M106 165H134" stroke-width="3" />
        </>
      ) : (
        <>
          <circle cx="120" cy="15" r="2.2" fill={NAVY} stroke="none" />
          <path d="M112 165H128" stroke={GREY} stroke-width="3" />
        </>
      )}
    </g>
  );
}

/** A line of text, as a grey bar. */
function Bar({ x, y, w, sw = 4, c = GREY }: { x: number; y: number; w: number; sw?: number; c?: string }) {
  return <path d={`M${x} ${y}H${x + w}`} stroke={c} stroke-width={sw} />;
}

/** Our own icon: the orange tile with a white parcel on it — the same tile the home screen shows. */
function AppIcon({ x, y, s }: { x: number; y: number; s: number }) {
  const b = s * 0.5;
  const bx = x + (s - b) / 2;
  const by = y + (s - b) / 2;
  const sw = Math.max(1.4, s * 0.075);
  return (
    <g>
      <rect x={x} y={y} width={s} height={s} rx={s * 0.26} fill={ORANGE} stroke-width={Math.min(2.5, s * 0.12)} />
      <rect x={bx} y={by} width={b} height={b} rx={b * 0.12} fill={WHITE} stroke-width={sw} />
      <path d={`M${bx} ${by + b * 0.36}H${bx + b}M${bx + b / 2} ${by}V${by + b * 0.36}`} stroke-width={sw} />
    </g>
  );
}

/** The small switch, on: an orange track with the white knob at the right. */
function Toggle({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  const r = h / 2;
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={r} fill={ORANGE} stroke-width={h > 12 ? 2 : 1.8} />
      <circle cx={x + w - r} cy={y + r} r={r - 2.2} fill={WHITE} stroke-width={h > 12 ? 2 : 1.6} />
    </g>
  );
}

/*
 * The hand: a pointing hand, seen from the back, the fingertip on the spot to tap and two orange
 * ripples around it, the wrist running off the edge of the picture. A bare finger read as a pen, so
 * the fist is drawn too; it comes in from the side, where it hides the least of the screen.
 * (x, y) is the spot; `a` turns the hand (negative: from the bottom right); `left` mirrors it, for
 * the screens where a hand from the right would hide what matters; `ra` turns the ripples apart
 * from the hand, where they would otherwise run across the very thing being pressed.
 */
function Finger({ x, y, a = -35, left = false, ra }: { x: number; y: number; a?: number; left?: boolean; ra?: number }) {
  return (
    <g>
      <path
        transform={`translate(${x} ${y}) rotate(${ra ?? a}) scale(0.9)`}
        d="M-10.9 -5.1A12 12 0 0 1 10.9 -5.1M-15.4 -7.2A17 17 0 0 1 15.4 -7.2"
        stroke={ORANGE}
        stroke-width="2.2"
      />
      <g transform={`translate(${x} ${y}) rotate(${a}) scale(${left ? -0.9 : 0.9} 0.9)`}>
        <path
          d="M-7.5 0A7.5 7.5 0 0 1 7.5 0V30C8.5 25.5 17 25.5 17.5 31C19 27.5 26 28 26.5 34C28.5 31.5 34 33.5 33.5 39.5V62C33.5 72 29 80 28 90L27 200H-11V88Q-12 77 -16.5 67Q-21 56 -17 47.5Q-13.5 41 -7.5 39Z"
          fill={WHITE}
          stroke-width="2.6"
        />
        <rect x="-4" y="-4.5" width="8" height="10" rx="4" fill={WHITE} stroke-width="1.8" />
        <path d="M-4 18Q0 20 4 18M-4 22Q0 24 4 22M17.5 31V37M26.5 34V40M-7.5 39Q-6 47 1 49" stroke-width="1.8" />
      </g>
    </g>
  );
}

/* Small line icons, drawn on a 24 grid like `Icon.tsx` and scaled into place. */
type GlyphName =
  | 'bell'
  | 'info'
  | 'battery'
  | 'install'
  | 'plusSquare'
  | 'clock'
  | 'plus'
  | 'download'
  | 'sliders'
  | 'star'
  | 'arrowRight'
  | 'refresh'
  | 'copy'
  | 'book'
  | 'tabs'
  | 'chevronLeft'
  | 'chevronRight'
  | 'arrowLeft'
  | 'shield'
  | 'storage'
  | 'data'
  | 'grid'
  | 'pencil';

const GLYPHS: Record<GlyphName, () => ComponentChildren> = {
  bell: () => <path d="M6.4 10a5.6 5.6 0 0 1 11.2 0c0 4.2 1.4 6 1.4 6H5s1.4-1.8 1.4-6ZM10 19.4a2.2 2.2 0 0 0 4 0" />,
  // The i of "information" as a stem and a dot — a drawing, not a letter.
  info: () => (
    <>
      <circle cx="12" cy="12" r="9.5" />
      <path d="M12 11v6M12 7.2v.1" />
    </>
  ),
  battery: () => (
    <>
      <rect x="2" y="7" width="17.5" height="10" rx="2.5" />
      <path d="M22.5 10.5v3M6 10.5v3M9.5 10.5v3" />
    </>
  ),
  // A phone with an arrow coming down into it: "install".
  install: () => (
    <>
      <rect x="6" y="2" width="12" height="20" rx="2.5" />
      <path d="M12 6.5v8M8.8 11.5l3.2 3.2 3.2-3.2" />
    </>
  ),
  plusSquare: () => (
    <>
      <rect x="3" y="3" width="18" height="18" rx="4.5" />
      <path d="M12 7.8v8.4M7.8 12h8.4" />
    </>
  ),
  clock: () => (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5.2l3.4 2.2" />
    </>
  ),
  plus: () => <path d="M12 5v14M5 12h14" />,
  download: () => <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 20h14" />,
  sliders: () => (
    <>
      <path d="M4 7.5h8.6m4.8 0H20M4 16.5h2.6m4.8 0H20" />
      <circle cx="15" cy="7.5" r="2.4" />
      <circle cx="9" cy="16.5" r="2.4" />
    </>
  ),
  star: () => <path d="m12 4.4 2.3 4.9 5.2.7-3.8 3.7.9 5.3L12 16.5 7.4 19l.9-5.3-3.8-3.7 5.2-.7L12 4.4Z" />,
  arrowRight: () => <path d="M5 12h14M13 6l6 6-6 6" />,
  refresh: () => <path d="M19 12a7 7 0 1 1-2.05-4.95M19 4.5v4h-4" />,
  copy: () => (
    <>
      <rect x="8.5" y="8.5" width="11" height="11" rx="2" />
      <path d="M15.5 8.5v-2a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2" />
    </>
  ),
  book: () => <path d="M12 6.5C10 5 7 4.5 3.5 5v13c3.5-.5 6.5 0 8.5 1.5 2-1.5 5-2 8.5-1.5V5C17 4.5 14 5 12 6.5Zm0 0v13" />,
  tabs: () => (
    <>
      <rect x="7.5" y="7.5" width="12" height="12" rx="2" />
      <path d="M16.5 4.5h-9a3 3 0 0 0-3 3v9" />
    </>
  ),
  chevronLeft: () => <path d="M15 4.5 7.5 12l7.5 7.5" />,
  chevronRight: () => <path d="M9 4.5 16.5 12 9 19.5" />,
  arrowLeft: () => <path d="M19.5 12h-15M11 5.5 4.5 12l6.5 6.5" />,
  shield: () => <path d="M12 3 5 5.8v5.7c0 4.3 3 7.7 7 9.5 4-1.8 7-5.2 7-9.5V5.8L12 3Z" />,
  storage: () => (
    <>
      <ellipse cx="12" cy="6" rx="7" ry="2.8" />
      <path d="M5 6v12c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8V6M5 12c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8" />
    </>
  ),
  data: () => <path d="M8 20V5M4.5 8.5 8 5l3.5 3.5M16 4v15M12.5 15.5 16 19l3.5-3.5" />,
  grid: () => (
    <>
      <rect x="3.6" y="3.6" width="7" height="7" rx="1.5" />
      <rect x="13.4" y="3.6" width="7" height="7" rx="1.5" />
      <rect x="3.6" y="13.4" width="7" height="7" rx="1.5" />
      <rect x="13.4" y="13.4" width="7" height="7" rx="1.5" />
    </>
  ),
  pencil: () => <path d="M5 19l1-4.2L15.8 5l3.2 3.2L9.2 18 5 19ZM13.5 7.3l3.2 3.2" />,
};

/** One small icon, its box `s` wide with the top-left at (x, y), its line `sw` thick whatever its size. */
function Glyph({ name, x, y, s, c = NAVY, sw = 2 }: { name: GlyphName; x: number; y: number; s: number; c?: string; sw?: number }) {
  const k = s / 24;
  return (
    <g transform={`translate(${x} ${y}) scale(${k})`} stroke={c} stroke-width={sw / k} fill="none">
      {GLYPHS[name]()}
    </g>
  );
}

/** A row picked out: the orange band with a white icon and a white line on it. */
function PickedRow({ x, y, w, h, glyph, gx, bx, bw }: { x: number; y: number; w: number; h: number; glyph: GlyphName; gx: number; bx: number; bw: number }) {
  const cy = y + h / 2;
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx="5" fill={ORANGE} stroke-width="2" />
      <Glyph name={glyph} x={gx} y={cy - 5.5} s={11} c={WHITE} sw={2.1} />
      <Bar x={bx} y={cy} w={bw} c={WHITE} />
    </g>
  );
}

/* ---------- the pictures ---------- */

/** Android, Chrome: the ⋮ menu open, "Install app" picked out. */
export function AndroidInstallPicture() {
  const rows: Array<{ g: GlyphName; w: number }> = [
    { g: 'plus', w: 34 },
    { g: 'clock', w: 28 },
    { g: 'install', w: 0 },
    { g: 'download', w: 30 },
    { g: 'sliders', w: 24 },
  ];
  return (
    <Frame>
      <Phone>
        {/* the address bar, and the ⋮ button — pressed, so orange */}
        <rect x="76" y="27" width="72" height="13" rx="6.5" stroke={GREY} stroke-width="2" />
        <Bar x={83} y={33.5} w={34} sw={3} />
        <rect x="152.5" y="25.5" width="13" height="16" rx="4.5" fill={ORANGE} stroke-width="2" />
        <circle cx="159" cy="29.3" r="1.5" fill={WHITE} stroke="none" />
        <circle cx="159" cy="33.5" r="1.5" fill={WHITE} stroke="none" />
        <circle cx="159" cy="37.7" r="1.5" fill={WHITE} stroke="none" />
        <path d="M71 46H169" stroke={GREY} stroke-width="2" />
        {/* the page behind */}
        <Bar x={77} y={55} w={48} sw={6} />
        <Bar x={77} y={66} w={84} />
        <Bar x={77} y={75} w={70} />
        <rect x="77" y="85" width="40" height="30" rx="3" stroke={GREY} stroke-width="2" />
        <Bar x={77} y={125} w={84} />
        <Bar x={77} y={134} w={76} />
        <Bar x={77} y={143} w={60} />
        {/* the menu */}
        <rect x="98" y="48" width="68" height="104" rx="6" fill={WHITE} stroke-width="2.5" />
        <Glyph name="arrowRight" x={103} y={53} s={10} />
        <Glyph name="star" x={118} y={53} s={10} />
        <Glyph name="download" x={133} y={53} s={10} />
        <Glyph name="refresh" x={148} y={53} s={10} />
        <path d="M98 67H166" stroke={GREY} stroke-width="2" />
        {rows.map((r, i) => {
          const cy = 77 + i * 16.5;
          return r.g === 'install' ? (
            <PickedRow key={r.g} x={101} y={cy - 8.5} w={62} h={17} glyph="install" gx={104} bx={119} bw={34} />
          ) : (
            <g key={r.g}>
              <Glyph name={r.g} x={104.5} y={cy - 5} s={10} />
              <Bar x={119} y={cy} w={r.w} />
            </g>
          );
        })}
      </Phone>
      <Finger x={149} y={111} />
    </Frame>
  );
}

/** iPhone, Safari: Share pressed, the share sheet up, "Add to Home Screen" picked out. */
export function IosAddPicture() {
  return (
    <Frame>
      <Phone ios>
        {/* the page behind */}
        <Bar x={78} y={32} w={46} sw={6} />
        <Bar x={78} y={43} w={82} />
        <Bar x={78} y={51} w={64} />
        {/* the share sheet */}
        <rect x="73" y="55" width="94" height="78" rx="9" fill={WHITE} stroke-width="2.5" />
        <path d="M112 60H128" stroke={GREY} stroke-width="3" />
        <circle cx="89" cy="73" r="6.5" fill={WHITE} stroke={GREY} stroke-width="2" />
        <circle cx="109" cy="73" r="6.5" fill={WHITE} stroke={GREY} stroke-width="2" />
        <circle cx="129" cy="73" r="6.5" fill={WHITE} stroke={GREY} stroke-width="2" />
        <circle cx="149" cy="73" r="6.5" fill={WHITE} stroke={GREY} stroke-width="2" />
        {/* the rows: words on the left, the icon on the right, as Safari has them */}
        <Bar x={81} y={92} w={28} />
        <Glyph name="copy" x={150} y={87} s={10} />
        <rect x="76" y="100" width="88" height="16" rx="5" fill={ORANGE} stroke-width="2" />
        <Bar x={81} y={108} w={50} c={WHITE} />
        <Glyph name="plusSquare" x={149} y={102.5} s={11} c={WHITE} sw={2.1} />
        <Bar x={81} y={124} w={36} />
        <Glyph name="book" x={150} y={119} s={10} />
        {/* the toolbar, Share in orange: a box open at the top, an arrow rising out of it */}
        <path d="M71 137H169" stroke={GREY} stroke-width="2" />
        <Glyph name="chevronLeft" x={76} y={142} s={12} />
        <Glyph name="chevronRight" x={95} y={142} s={12} c={GREY} />
        <path
          d="M117 145.5h-1.5a2 2 0 0 0-2 2v6.5a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-6.5a2 2 0 0 0-2-2H123M120 151.5V140M116.8 143.2 120 140l3.2 3.2"
          stroke={ORANGE}
          stroke-width="2.4"
        />
        <Glyph name="book" x={133} y={142} s={12} />
        <Glyph name="tabs" x={152} y={142} s={12} />
      </Phone>
      <Finger x={133} y={109} />
    </Frame>
  );
}

/** The question the phone asks: may this app send notifications? Allow, in orange. */
export function AllowPicture() {
  return (
    <Frame>
      <Phone>
        {/* our app behind, dimmed */}
        <AppIcon x={77} y={27} s={11} />
        <Bar x={93} y={32.5} w={34} />
        <rect x="77" y="45" width="86" height="30" rx="5" stroke={GREY} stroke-width="2" />
        <Bar x={83} y={55} w={50} />
        <Bar x={83} y={65} w={34} />
        <rect x="77" y="81" width="86" height="30" rx="5" stroke={GREY} stroke-width="2" />
        <Bar x={83} y={91} w={56} />
        <Bar x={83} y={101} w={40} />
        <rect x="77" y="117" width="86" height="30" rx="5" stroke={GREY} stroke-width="2" />
        <Bar x={83} y={127} w={46} />
        <Bar x={83} y={137} w={30} />
        <rect x="71" y="22" width="98" height="136" rx="3" fill={NAVY} fill-opacity="0.32" stroke="none" />
        {/* the question */}
        <rect x="78" y="48" width="84" height="80" rx="10" fill={WHITE} stroke-width="2.5" />
        <Glyph name="bell" x={111} y={54} s={18} sw={2.4} />
        <Bar x={90} y={81} w={60} />
        <Bar x={99} y={90} w={42} />
        <rect x="84" y="102" width="34" height="18" rx="9" fill={WHITE} stroke-width="2" />
        <Bar x={93} y={111} w={16} sw={3} />
        <rect x="122" y="102" width="34" height="18" rx="9" fill={ORANGE} stroke-width="2" />
        <Bar x={131} y={111} w={16} sw={3} c={WHITE} />
      </Phone>
      <Finger x={143} y={113} />
    </Frame>
  );
}

/** Android home screen: hold our icon; the little menu shows, App info (the circled i) picked out. */
export function AndroidHoldPicture() {
  const cols = [87, 109, 131, 153];
  const rows = [44, 70, 96, 122];
  return (
    <Frame>
      <Phone>
        <Bar x={77} y={28} w={12} sw={3} />
        <Bar x={150} y={28} w={14} sw={3} />
        {rows.map((cy) => (
          <g key={cy}>
            {cols.map((cx) =>
            cx === 109 && cy === 122 ? (
              <g key={cx}>
                <AppIcon x={cx - 8} y={cy - 8} s={16} />
                <Bar x={cx - 6} y={cy + 13} w={12} sw={3} />
              </g>
            ) : (
              <g key={cx}>
                <rect x={cx - 8} y={cy - 8} width="16" height="16" rx="4.5" fill={WHITE} stroke={GREY} stroke-width="2.2" />
                <Bar x={cx - 6} y={cy + 13} w={12} sw={3} />
              </g>
            ),
            )}
          </g>
        ))}
        {/* the dock */}
        <path d="M76 140H164" stroke={GREY} stroke-width="1.5" />
        {cols.map((cx) => (
          <rect key={cx} x={cx - 7} y="143" width="14" height="14" rx="4" fill={WHITE} stroke={GREY} stroke-width="2.2" />
        ))}
        {/* the menu that comes up from the icon */}
        <path
          d="M93 50H153Q160 50 160 57V89Q160 96 153 96H115L109 102L103 96H93Q86 96 86 89V57Q86 50 93 50Z"
          fill={WHITE}
          stroke-width="2.5"
        />
        <PickedRow x={89} y={53} w={68} h={14} glyph="info" gx={92.5} bx={107} bw={34} />
        <Glyph name="grid" x={93} y={69.5} s={10} />
        <Bar x={107} y={74.5} w={30} />
        <Glyph name="pencil" x={93} y={83.5} s={10} />
        <Bar x={107} y={88.5} w={24} />
      </Phone>
      <Finger x={116} y={130} a={-30} ra={45} />
      {/* held, not tapped: a clock beside the hand */}
      <circle cx="173" cy="121" r="9" fill={WHITE} stroke-width="2.5" />
      <path d="M173 116V121L176.5 123.2" stroke-width="2.2" />
    </Frame>
  );
}

/** Android, App info: our icon at the top, the rows under it, Notifications (the bell) picked out. */
export function AndroidAppInfoPicture() {
  const rows: Array<{ g: GlyphName; w: number }> = [
    { g: 'bell', w: 0 },
    { g: 'shield', w: 34 },
    { g: 'storage', w: 44 },
    { g: 'data', w: 30 },
    { g: 'battery', w: 38 },
  ];
  return (
    <Frame>
      <Phone>
        <Glyph name="arrowLeft" x={76} y={26} s={11} />
        <AppIcon x={108} y={30} s={24} />
        <Bar x={104} y={62} w={32} />
        {rows.map((r, i) => {
          const cy = 78 + i * 17;
          return r.g === 'bell' ? (
            <PickedRow key={r.g} x={74} y={cy - 8.5} w={92} h={17} glyph="bell" gx={79} bx={97} bw={40} />
          ) : (
            <g key={r.g}>
              <Glyph name={r.g} x={79} y={cy - 5.5} s={11} />
              <Bar x={97} y={cy} w={r.w} />
            </g>
          );
        })}
      </Phone>
      <Finger x={146} y={79} a={-28} />
    </Frame>
  );
}

/** Android, the app's Notifications: the main switch on (orange), the smaller ones under it on too. */
export function AndroidNotificationsPicture() {
  const rows = [
    { cy: 98, w: 40, w2: 52 },
    { cy: 117, w: 32, w2: 46 },
    { cy: 136, w: 44, w2: 38 },
  ];
  return (
    <Frame>
      <Phone>
        <Glyph name="arrowLeft" x={76} y={26} s={11} />
        <Glyph name="bell" x={92} y={25.5} s={12} />
        <Bar x={110} y={31.5} w={36} sw={5} />
        {/* the main switch, in its own card */}
        <rect x="74" y="43" width="92" height="30" rx="9" fill={WHITE} stroke-width="2.5" />
        <Bar x={82} y={58} w={28} />
        <Toggle x={121} y={49} w={39} h={18} />
        <Bar x={78} y={84} w={20} sw={3} />
        {rows.map((r) => (
          <g key={r.cy}>
            <Bar x={78} y={r.cy - 3} w={r.w} />
            <Bar x={78} y={r.cy + 5} w={r.w2} sw={2.5} />
            <Toggle x={143} y={r.cy - 5} w={18} h={10} />
          </g>
        ))}
      </Phone>
      <Finger x={130} y={59} a={28} left />
    </Frame>
  );
}

/** Android, the app's battery use: three choices, the top one (Unrestricted) chosen. */
export function AndroidBatteryPicture() {
  const rows = [
    { cy: 82, w: 46, w2: 58, on: true },
    { cy: 108, w: 38, w2: 52, on: false },
    { cy: 134, w: 42, w2: 46, on: false },
  ];
  return (
    <Frame>
      <Phone>
        <Glyph name="arrowLeft" x={76} y={26} s={11} />
        <Glyph name="battery" x={91} y={25.5} s={13} />
        <Bar x={111} y={31.5} w={34} sw={5} />
        <AppIcon x={77} y={43} s={14} />
        <Bar x={97} y={50} w={34} />
        <path d="M76 66H164" stroke={GREY} stroke-width="1.5" />
        {rows.map((r) => (
          <g key={r.cy}>
            {r.on ? (
              <>
                <circle cx="84" cy={r.cy} r="6.5" fill={WHITE} stroke={ORANGE} stroke-width="2.5" />
                <circle cx="84" cy={r.cy} r="3" fill={ORANGE} stroke="none" />
              </>
            ) : (
              <circle cx="84" cy={r.cy} r="6.5" fill={WHITE} stroke-width="2" />
            )}
            <Bar x={97} y={r.cy - 4} w={r.w} />
            <Bar x={97} y={r.cy + 5} w={r.w2} sw={2.5} />
          </g>
        ))}
      </Phone>
      <Finger x={120} y={83} />
    </Frame>
  );
}

/** iPhone, Settings for our app: its icon at the top, the main switch on (orange). */
export function IosSettingsPicture() {
  return (
    <Frame>
      <Phone ios>
        <Glyph name="chevronLeft" x={75} y={26} s={11} />
        <Bar x={87} y={31.5} w={18} sw={3} />
        <AppIcon x={109} y={37} s={22} />
        <Bar x={104} y={67} w={32} />
        {/* the main switch */}
        <rect x="75" y="77" width="90" height="25" rx="8" fill={WHITE} stroke-width="2" />
        <Bar x={82} y={89.5} w={28} />
        <Toggle x={122} y={81.5} w={37} h={16} />
        {/* the rows under it */}
        <Bar x={80} y={113} w={16} sw={3} />
        <rect x="75" y="120" width="90" height="34" rx="8" fill={WHITE} stroke-width="2" />
        <Bar x={82} y={128.5} w={40} />
        <Glyph name="chevronRight" x={150} y={124} s={9} c={GREY} />
        <path d="M82 137H165" stroke={GREY} stroke-width="1.5" />
        <Bar x={82} y={145.5} w={30} />
        <Glyph name="chevronRight" x={150} y={141} s={9} c={GREY} />
      </Phone>
      <Finger x={131} y={90} a={-30} />
    </Frame>
  );
}

export const INSTALL_PICTURES = {
  AndroidInstallPicture,
  IosAddPicture,
  AllowPicture,
  AndroidHoldPicture,
  AndroidAppInfoPicture,
  AndroidNotificationsPicture,
  AndroidBatteryPicture,
  IosSettingsPicture,
} as const;
