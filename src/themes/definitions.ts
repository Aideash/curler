export type ThemeTokens = Record<string, string>

export interface Theme {
  id: string
  name: string
  description: string
  /** Drives the native `color-scheme`, so form controls match. */
  colorScheme: 'light' | 'dark'
  tokens: ThemeTokens
}

export const THEME_STORAGE_KEY = 'curler.theme-preference'
export const SYSTEM_PREFERENCE = 'system'

const SANS = '-apple-system, BlinkMacSystemFont, "Segoe UI", Inter, system-ui, sans-serif'
const MONO = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace'

/**
 * The generic families, left for the browser to fill in. A theme whose whole
 * character is its typeface wants whatever the reader has installed rather than
 * a stack picked here, which is why these are the bare keywords.
 *
 * `font-family` lands on <html> and reaches the page by inheritance, so it
 * governs body text and form controls without touching anything that names its
 * own font -- the JSON editor and every `.mono` run stay monospace.
 */
const CURSIVE = 'cursive'
const MONOSPACE = 'monospace'

/**
 * Every theme defines this whole token set. Syntax colours are part of it so
 * the JSON editor tracks the theme instead of staying dark on a light page.
 */
const dark: ThemeTokens = {
  'font-family': SANS,
  mono: MONO,

  bg: '#0f1115',
  'bg-raised': '#161920',
  'bg-input': '#1c2029',
  'bg-hover': '#232833',

  border: '#262b36',
  'border-strong': '#333a49',

  text: '#e5e9f0',
  'text-dim': '#97a0b0',
  'text-faint': '#6b7382',

  accent: '#6ea8fe',
  'accent-hover': '#8bbaff',
  'accent-dim': '#2f4f7f',
  'on-accent': '#0b1220',

  green: '#4ade80',
  amber: '#fbbf24',
  red: '#f87171',
  purple: '#c084fc',
  /** OPTIONS, which has no conventional colour and was otherwise indistinguishable from HEAD. */
  cyan: '#22d3ee',
  /** TRACE, kept magenta rather than rose so it reads apart from red and purple. */
  pink: '#f472d6',

  'green-border': '#245c39',
  'amber-border': '#6b5a1f',
  'red-border': '#6e2f2f',
  'purple-border': '#503a6b',

  scrollbar: '#2b313d',
  'scrollbar-hover': '#3a4252',
  selection: '#2f4f7f',

  backdrop: 'rgba(6, 8, 12, 0.66)',
  shadow: 'rgba(0, 0, 0, 0.5)',
  'shadow-strong': 'rgba(0, 0, 0, 0.6)',

  'syntax-key': '#7cc4ff',
  'syntax-string': '#7ee787',
  'syntax-number': '#ffb86c',
  'syntax-literal': '#d2a8ff',
  'syntax-punctuation': '#8b95a7',
  'syntax-comment': '#6b7382',
}

const light: ThemeTokens = {
  'font-family': SANS,
  mono: MONO,

  bg: '#ffffff',
  'bg-raised': '#f6f8fa',
  'bg-input': '#ffffff',
  'bg-hover': '#eceff4',

  border: '#e2e6ed',
  'border-strong': '#cbd2dd',

  text: '#1c2128',
  'text-dim': '#59616e',
  'text-faint': '#8b939f',

  accent: '#2563eb',
  'accent-hover': '#1d4ed8',
  'accent-dim': '#c7dbfd',
  'on-accent': '#ffffff',

  green: '#15803d',
  amber: '#b45309',
  red: '#b91c1c',
  purple: '#7c3aed',
  cyan: '#0e7490',
  pink: '#bf1b90',

  'green-border': '#a7d8ba',
  'amber-border': '#e6c493',
  'red-border': '#eaadad',
  'purple-border': '#cfb6f5',

  scrollbar: '#cbd2dd',
  'scrollbar-hover': '#aab3c0',
  selection: '#c7dbfd',

  backdrop: 'rgba(20, 24, 32, 0.34)',
  shadow: 'rgba(15, 23, 42, 0.14)',
  'shadow-strong': 'rgba(15, 23, 42, 0.22)',

  'syntax-key': '#0550ae',
  'syntax-string': '#0a7c42',
  'syntax-number': '#a1521a',
  'syntax-literal': '#7c3aed',
  'syntax-punctuation': '#59616e',
  'syntax-comment': '#8b939f',
}

export const themes: Record<string, Theme> = {
  dark: {
    id: 'dark',
    name: 'Dark',
    description: 'Cool slate, the default',
    colorScheme: 'dark',
    tokens: dark,
  },

  light: {
    id: 'light',
    name: 'Light',
    description: 'Clean and bright',
    colorScheme: 'light',
    tokens: light,
  },

  cute: {
    id: 'cute',
    name: 'Cute',
    description: 'Soft pinks on cream, handwritten',
    colorScheme: 'light',
    tokens: {
      ...light,
      'font-family': CURSIVE,
      bg: '#fff5fa',
      'bg-raised': '#ffeaf4',
      'bg-input': '#fffafc',
      'bg-hover': '#ffdcec',
      border: '#f9c6dd',
      'border-strong': '#f0a2c6',
      text: '#4c0531',
      'text-dim': '#8d3a67',
      'text-faint': '#b9749b',
      accent: '#db2777',
      'accent-hover': '#be185d',
      'accent-dim': '#fbcfe8',
      'on-accent': '#ffffff',
      green: '#0f766e',
      purple: '#9333ea',
      // Pushed towards blue: this theme's green is itself a teal, and a plain
      // cyan would leave GET and OPTIONS looking like the same colour.
      cyan: '#0284c7',
      // Deepened into plum: the theme spends its pink on the accent, which POST
      // already wears, so TRACE has to sit well below it.
      pink: '#8c1a74',
      'green-border': '#9fd3ce',
      'amber-border': '#eccb9f',
      'red-border': '#f1b2b2',
      'purple-border': '#dcbaf7',
      scrollbar: '#f6bcd6',
      'scrollbar-hover': '#ef9cc2',
      selection: '#fbcfe8',
      backdrop: 'rgba(76, 5, 49, 0.3)',
      shadow: 'rgba(160, 30, 100, 0.16)',
      'shadow-strong': 'rgba(160, 30, 100, 0.26)',
      'syntax-key': '#c026d3',
      'syntax-string': '#0f766e',
      'syntax-number': '#c2410c',
      'syntax-literal': '#9333ea',
      'syntax-punctuation': '#8d3a67',
      'syntax-comment': '#b9749b',
    },
  },

  minimalist: {
    id: 'minimalist',
    name: 'Minimalist',
    description: 'Neutral greys, low contrast chrome',
    colorScheme: 'light',
    tokens: {
      ...light,
      bg: '#fafafa',
      'bg-raised': '#f4f4f5',
      'bg-input': '#ffffff',
      'bg-hover': '#e9e9ec',
      border: '#e4e4e7',
      'border-strong': '#c4c4cb',
      text: '#18181b',
      'text-dim': '#52525b',
      'text-faint': '#8a8a93',
      accent: '#3f3f46',
      'accent-hover': '#27272a',
      'accent-dim': '#d4d4d8',
      'on-accent': '#ffffff',
      green: '#3f6212',
      amber: '#854d0e',
      red: '#991b1b',
      purple: '#5b21b6',
      // Held back to match the theme's deliberately muted palette.
      cyan: '#155e75',
      pink: '#7e2166',
      'green-border': '#c3d3a8',
      'amber-border': '#ddc79c',
      'red-border': '#e0b4b4',
      'purple-border': '#c2b2e4',
      scrollbar: '#d4d4d8',
      'scrollbar-hover': '#b4b4bb',
      selection: '#d4d4d8',
      backdrop: 'rgba(24, 24, 27, 0.32)',
      shadow: 'rgba(0, 0, 0, 0.1)',
      'shadow-strong': 'rgba(0, 0, 0, 0.18)',
      'syntax-key': '#1f2937',
      'syntax-string': '#3f6212',
      'syntax-number': '#854d0e',
      'syntax-literal': '#5b21b6',
      'syntax-punctuation': '#71717a',
      'syntax-comment': '#a1a1aa',
    },
  },

  bterminal: {
    id: 'bterminal',
    name: 'BTerminal',
    description: 'Black and amber, monospace throughout',
    colorScheme: 'dark',
    tokens: {
      ...dark,
      'font-family': MONOSPACE,
      bg: '#000000',
      'bg-raised': '#0a0a0a',
      'bg-input': '#101010',
      'bg-hover': '#1c1a16',
      border: '#2b2823',
      'border-strong': '#453f33',
      text: '#f2e4cf',
      'text-dim': '#b08a5e',
      'text-faint': '#7c6144',
      accent: '#ff9500',
      'accent-hover': '#ffb340',
      'accent-dim': '#59380a',
      'on-accent': '#000000',
      green: '#7ee787',
      amber: '#ffcc33',
      red: '#ff6b5e',
      purple: '#d8a2ff',
      // Cyan is an original ANSI terminal colour, so it earns full brightness here.
      cyan: '#00e5ff',
      // Magenta likewise, so TRACE gets the bright ANSI shade rather than a tint.
      pink: '#ff5fff',
      'green-border': '#2e5c33',
      'amber-border': '#6b5518',
      'red-border': '#6e3029',
      'purple-border': '#52386b',
      scrollbar: '#3a342a',
      'scrollbar-hover': '#544a3a',
      selection: '#59380a',
      backdrop: 'rgba(0, 0, 0, 0.74)',
      shadow: 'rgba(255, 149, 0, 0.12)',
      'shadow-strong': 'rgba(0, 0, 0, 0.8)',
      'syntax-key': '#ffb340',
      'syntax-string': '#7ee787',
      'syntax-number': '#ffcc33',
      'syntax-literal': '#d8a2ff',
      'syntax-punctuation': '#b08a5e',
      'syntax-comment': '#7c6144',
    },
  },

  aquatic: {
    id: 'aquatic',
    name: 'Aquatic',
    description: 'Deep water, teal accents',
    colorScheme: 'dark',
    tokens: {
      ...dark,
      bg: '#021018',
      'bg-raised': '#05202b',
      'bg-input': '#082a38',
      'bg-hover': '#0d3a4b',
      border: '#0f4557',
      'border-strong': '#17627a',
      text: '#dff5fb',
      'text-dim': '#8ec6d8',
      'text-faint': '#5b93a6',
      accent: '#2dd4bf',
      'accent-hover': '#5eead4',
      'accent-dim': '#12564f',
      'on-accent': '#022c26',
      green: '#5eead4',
      amber: '#fcd34d',
      red: '#fb7185',
      purple: '#a5b4fc',
      // Bluer than the inherited cyan, which sat a few degrees of hue from this
      // theme's teal accent and read as the same colour on a method label.
      cyan: '#38bdf8',
      // Orchid rather than the base magenta, which sat too near this theme's
      // rose red.
      pink: '#e879f9',
      'green-border': '#12564f',
      'amber-border': '#6b5a1f',
      'red-border': '#6e2f3f',
      'purple-border': '#3b4a7a',
      scrollbar: '#0f4557',
      'scrollbar-hover': '#17627a',
      selection: '#12564f',
      backdrop: 'rgba(2, 16, 24, 0.72)',
      shadow: 'rgba(0, 12, 20, 0.6)',
      'shadow-strong': 'rgba(0, 12, 20, 0.72)',
      'syntax-key': '#67e8f9',
      'syntax-string': '#5eead4',
      'syntax-number': '#fcd34d',
      'syntax-literal': '#a5b4fc',
      'syntax-punctuation': '#8ec6d8',
      'syntax-comment': '#5b93a6',
    },
  },

  forest: {
    id: 'forest',
    name: 'Forest',
    description: 'Deep pine, warm earth accents',
    colorScheme: 'dark',
    tokens: {
      ...dark,
      bg: '#0a1410',
      'bg-raised': '#101d16',
      'bg-input': '#13241a',
      'bg-hover': '#1a3122',
      border: '#1e3626',
      'border-strong': '#2d5036',
      text: '#e4eee3',
      'text-dim': '#a3b8a5',
      'text-faint': '#76907d',
      accent: '#e07a45',
      'accent-hover': '#f0975f',
      'accent-dim': '#5e3418',
      'on-accent': '#1a1005',
      green: '#7fd18a',
      amber: '#e6b455',
      // The warm half of this palette has to carry three method labels that sit
      // in one column, so red is kept lighter and pinker than the copper accent
      // and the wheat amber rather than the brick red the theme would suggest.
      red: '#f4736f',
      purple: '#b79ae0',
      // Pulled towards blue, well clear of the greens that make up most of the
      // theme, since OPTIONS otherwise read as another shade of GET.
      cyan: '#5fb8d4',
      // Softened to the theme's lower saturation, and kept dustier than the
      // salmon red it shares the warm half of the palette with.
      pink: '#e07ab8',
      'green-border': '#2f5c39',
      'amber-border': '#6a5423',
      'red-border': '#6e3230',
      'purple-border': '#4d3f6b',
      scrollbar: '#24402c',
      'scrollbar-hover': '#345a3e',
      selection: '#5e3418',
      backdrop: 'rgba(5, 12, 8, 0.7)',
      shadow: 'rgba(0, 8, 4, 0.55)',
      'shadow-strong': 'rgba(0, 8, 4, 0.68)',
      'syntax-key': '#e5c76b',
      'syntax-string': '#8fd07a',
      'syntax-number': '#ea8b58',
      'syntax-literal': '#6a98ff',
      'syntax-punctuation': '#8ba58f',
      'syntax-comment': '#6f8b76',
    },
  },

  fireside: {
    id: 'fireside',
    name: 'Fireside',
    description: 'Warm ember glow on dark hearth',
    colorScheme: 'dark',
    tokens: {
      ...dark,
      bg: '#150e0b',
      'bg-raised': '#221812',
      'bg-input': '#2a1e16',
      'bg-hover': '#342820',
      border: '#5e1b0b',
      'border-strong': '#b01800',
      text: '#fdf0e4',
      'text-dim': '#d3b77f',
      'text-faint': '#a89480',
      accent: '#ff9a4d',
      'accent-hover': '#ffb574',
      'accent-dim': '#8a4518',
      'on-accent': '#1a0e08',
      green: '#8fd07a',
      amber: '#ffc857',
      // Kept lighter and pinker than the ember accent so DELETE and POST stay
      // readable in the same column as the copper accent and wheat amber.
      red: '#ff7a6e',
      purple: '#c995c7',
      // Pulled towards blue so OPTIONS reads apart from this theme's greens.
      cyan: '#6ec5e0',
      // Dusty rose, well below the bright ember accent POST already wears.
      pink: '#e07ab8',
      'green-border': '#3d5c32',
      'amber-border': '#6b5520',
      'red-border': '#6e3830',
      'purple-border': '#5a3f6b',
      scrollbar: '#523028',
      'scrollbar-hover': '#6a3830',
      selection: '#8a4518',
      backdrop: 'rgba(18, 10, 6, 0.68)',
      shadow: 'rgba(255, 120, 40, 0.1)',
      'shadow-strong': 'rgba(12, 6, 4, 0.65)',
      'syntax-key': '#f0c060',
      'syntax-string': '#8fd07a',
      'syntax-number': '#ff9f5a',
      'syntax-literal': '#c9a0ff',
      'syntax-punctuation': '#b8a090',
      'syntax-comment': '#8a7565',
    },
  },
}

export function getThemeById(id: string): Theme | undefined {
  return themes[id]
}

export function getThemeList(): Theme[] {
  return Object.values(themes)
}
