/**
 * A big-screen layout: a theme with optional colour overrides, and widgets
 * placed in five zones around the clock. Layouts are saved by name and any
 * tournament can use one.
 *
 *   +------------- top --------------+
 *   | left |      center     | right |
 *   +------------ bottom ------------+
 */
export const zones = ['top', 'left', 'center', 'right', 'bottom'] as const;
export type Zone = (typeof zones)[number];

export const widgetTypes = [
  'title',
  'level',
  'clock',
  'blinds',
  'next',
  'players',
  'avgStack',
  'chips',
  'prizePool',
  'placesPaid',
  'buyIn',
  'nextBreak',
  'lateReg',
  'payouts',
  'bustouts',
  'sponsor',
  'message',
] as const;
export type WidgetType = (typeof widgetTypes)[number];

/**
 * When a widget is on screen. The money is final once late registration and
 * rebuys have closed, which is when the payout table stops changing.
 */
export type ShowWhen = 'always' | 'moneyOpen' | 'moneyFinal' | 'break';

export interface Widget {
  type: WidgetType;
  show?: ShowWhen;
  /** Message widget text. */
  text?: string;
  /** Sponsor widget image. */
  assetId?: number;
  /** How many rows the bustouts widget lists. */
  count?: number;
}

export type ColorKey = 'bg' | 'text' | 'muted' | 'accent' | 'warning';

export interface LayoutConfig {
  theme: string;
  /** Colours that replace the theme's own; leave a key out to keep the theme colour. */
  colors: Partial<Record<ColorKey, string>>;
  font?: string;
  /** Optional background image, drawn under everything. */
  backgroundAssetId?: number | null;
  zones: Record<Zone, Widget[]>;
}

export interface ScreenLayout extends LayoutConfig {
  id: number;
  name: string;
  updatedAt: string;
}

export const widgetNames: Record<WidgetType, string> = {
  title: 'Tournament name',
  level: 'Level number',
  clock: 'Clock',
  blinds: 'Blinds and ante',
  next: 'Next level',
  players: 'Players left',
  avgStack: 'Average stack',
  chips: 'Chips in play',
  prizePool: 'Prize pool',
  placesPaid: 'Places paid',
  buyIn: 'Buy-in',
  nextBreak: 'Time to next break',
  lateReg: 'Late registration countdown',
  payouts: 'Payout table',
  bustouts: 'Recent bustouts',
  sponsor: 'Sponsor logo',
  message: 'Message',
};

export const showWhenNames: Record<ShowWhen, string> = {
  always: 'Always',
  moneyOpen: 'While registration or rebuys are open',
  moneyFinal: 'Once registration and rebuys have closed',
  break: 'Only during breaks',
};

export const zoneNames: Record<Zone, string> = {
  top: 'Top bar',
  left: 'Left column',
  center: 'Centre',
  right: 'Right column',
  bottom: 'Bottom bar',
};

/**
 * The built-in layout: tournament name across the top, the clock in the
 * middle, field stats on the left and timings on the right. The payout table
 * takes the place of the late-registration countdown once the money is final.
 */
export const defaultLayout: LayoutConfig = {
  theme: 'classic',
  colors: {},
  backgroundAssetId: null,
  zones: {
    top: [{ type: 'title' }],
    left: [{ type: 'players' }, { type: 'avgStack' }, { type: 'prizePool' }],
    center: [{ type: 'level' }, { type: 'clock' }, { type: 'blinds' }, { type: 'next' }],
    right: [{ type: 'nextBreak' }, { type: 'lateReg', show: 'moneyOpen' }, { type: 'payouts', show: 'moneyFinal' }],
    bottom: [],
  },
};

const showValues: ShowWhen[] = ['always', 'moneyOpen', 'moneyFinal', 'break'];
const colorKeys: ColorKey[] = ['bg', 'text', 'muted', 'accent', 'warning'];
const isColor = (v: unknown) => typeof v === 'string' && /^#[0-9a-f]{3,8}$/i.test(v);
const isId = (v: unknown) => Number.isInteger(v) && (v as number) > 0;

/** Checks a layout sent by a client. Returns an error message, or null when it is fine. */
export function layoutError(l: unknown): string | null {
  if (!l || typeof l !== 'object') return 'layout missing';
  const c = l as LayoutConfig;
  if (typeof c.theme !== 'string' || !c.theme) return 'pick a theme';
  if (!c.colors || typeof c.colors !== 'object') return 'colours missing';
  for (const [k, v] of Object.entries(c.colors)) {
    if (!colorKeys.includes(k as ColorKey) || !isColor(v)) return `bad colour ${k}`;
  }
  if (c.font !== undefined && (typeof c.font !== 'string' || c.font.length > 200)) return 'bad font';
  if (c.backgroundAssetId != null && !isId(c.backgroundAssetId)) return 'bad background image';
  if (!c.zones || typeof c.zones !== 'object') return 'zones missing';
  for (const z of zones) {
    const list = c.zones[z];
    if (!Array.isArray(list) || list.length > 20) return `zone ${z} must be a list of up to 20 widgets`;
    for (const w of list) {
      if (!w || !widgetTypes.includes(w.type)) return `unknown widget in ${z}`;
      if (w.show !== undefined && !showValues.includes(w.show)) return `bad visibility for ${w.type}`;
      if (w.text !== undefined && (typeof w.text !== 'string' || w.text.length > 500)) return 'message too long';
      if (w.assetId !== undefined && !isId(w.assetId)) return 'bad sponsor image';
      if (w.count !== undefined && !(Number.isInteger(w.count) && w.count >= 1 && w.count <= 30)) return 'bustouts count must be 1 to 30';
    }
  }
  return null;
}

/** Keeps only the known fields, so nothing extra is stored. */
export function cleanLayout(c: LayoutConfig): LayoutConfig {
  const zonesOut = {} as Record<Zone, Widget[]>;
  for (const z of zones) {
    zonesOut[z] = c.zones[z].map(({ type, show, text, assetId, count }) => {
      const w: Widget = { type };
      if (show && show !== 'always') w.show = show;
      if (text !== undefined) w.text = text;
      if (assetId !== undefined) w.assetId = assetId;
      if (count !== undefined) w.count = count;
      return w;
    });
  }
  return {
    theme: c.theme,
    colors: Object.fromEntries(Object.entries(c.colors).filter(([k]) => colorKeys.includes(k as ColorKey))),
    ...(c.font ? { font: c.font } : {}),
    backgroundAssetId: c.backgroundAssetId ?? null,
    zones: zonesOut,
  };
}
