import { createHarness, loadModules } from './harness.mjs'

const { modules, close } = await loadModules([
  '/src/themes/definitions.ts',
  '/src/themes/contrast.ts',
])
const { themes, getThemeList } = modules
const { tokensForContrast, parseContrastPreference, CONTRAST_DEFAULT } = modules
const { group, expect, detail, pass, fail, summary } = createHarness('themes')

function channel(value) {
  const srgb = value / 255
  return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4
}

function luminance(hex) {
  const full = hex.length === 4 ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}` : hex
  const [r, g, b] = [1, 3, 5].map((at) => parseInt(full.slice(at, at + 2), 16))
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/** WCAG contrast ratio, 1 (identical) to 21 (black on white). */
function contrast(foreground, background) {
  const a = luminance(foreground)
  const b = luminance(background)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

const isHex = (value) => typeof value === 'string' && /^#[0-9a-f]{3,8}$/i.test(value)

/**
 * The whole point of the exercise: no token may end up as a near-invisible
 * smudge on the surface it is painted on. Syntax colors sit on the editor
 * background, everything else on the page background.
 */
const RULES = [
  ['text', 'bg', 7],
  ['text-dim', 'bg', 4],
  ['text-faint', 'bg', 2.8],
  ['accent', 'bg', 3],
  ['green', 'bg', 3],
  ['amber', 'bg', 3],
  ['red', 'bg', 3],
  ['purple', 'bg', 3],
  ['cyan', 'bg', 3],
  ['pink', 'bg', 3],
  ['on-accent', 'accent', 4],
  ['syntax-key', 'bg-input', 4],
  ['syntax-variable', 'bg-input', 4],
  ['syntax-argument', 'bg-input', 4],
  ['syntax-string', 'bg-input', 4],
  ['syntax-number', 'bg-input', 4],
  ['syntax-literal', 'bg-input', 4],
  ['syntax-punctuation', 'bg-input', 3],
  ['syntax-comment', 'bg-input', 2.5],
]

const reference = Object.keys(themes.dark.tokens).sort()

for (const theme of getThemeList()) {
  group(`${theme.id} (${theme.colorScheme})`)

  expect('defines the full token set', Object.keys(theme.tokens).sort(), reference)

  for (const [token, surface, floor] of RULES) {
    const foreground = theme.tokens[token]
    const background = theme.tokens[surface]

    if (!isHex(foreground) || !isHex(background)) {
      detail(`skipped ${token}, not a plain hex colour`)
      continue
    }

    const ratio = contrast(foreground, background)
    const label = `${token} on ${surface} is legible`
    if (ratio >= floor) {
      detail(`${token} on ${surface}: ${ratio.toFixed(2)}:1`)
      pass(label)
    } else {
      fail(label, `${foreground} on ${background} is ${ratio.toFixed(2)}:1, want ${floor}:1`)
    }
  }

  // Booleans were the original complaint, so keep them distinct from strings
  // rather than merely legible.
  const { 'syntax-literal': literal, 'syntax-string': string } = theme.tokens
  expect('booleans are not painted as strings', literal === string, false)

  const {
    'syntax-key': key,
    'syntax-argument': argument,
    'syntax-variable': variable,
  } = theme.tokens
  expect('arguments are not painted as fields', argument === key, false)
  expect('variables are not painted as fields', variable === key, false)
}

group('contrast remaps')

expect('unknown values fall back to medium', parseContrastPreference('vivid'), CONTRAST_DEFAULT)
expect('null falls back to medium', parseContrastPreference(null), 'medium')

for (const theme of getThemeList()) {
  const medium = tokensForContrast(theme.tokens, 'medium')
  expect(`${theme.id} medium is the raw tokens`, medium === theme.tokens, true)

  const high = tokensForContrast(theme.tokens, 'high')
  expect(`${theme.id} high lifts faint to dim`, high['text-faint'], theme.tokens['text-dim'])
  expect(`${theme.id} high lifts comments to dim`, high['syntax-comment'], theme.tokens['text-dim'])
  expect(`${theme.id} high leaves body text`, high.text, theme.tokens.text)

  const low = tokensForContrast(theme.tokens, 'low')
  expect(`${theme.id} low drops dim to faint`, low['text-dim'], theme.tokens['text-faint'])
  expect(`${theme.id} low leaves body text`, low.text, theme.tokens.text)
}

const failures = summary()

await close()
process.exit(failures === 0 ? 0 : 1)
