import type { ThemeTokens } from './definitions'

export const CONTRAST_STORAGE_KEY = 'curler.contrast-preference'
export const CONTRAST_DEFAULT = 'medium'

export type ContrastPreference = 'high' | 'medium' | 'low'

export const CONTRAST_LEVELS: readonly ContrastPreference[] = ['high', 'medium', 'low']

export function parseContrastPreference(value: unknown): ContrastPreference {
  if (value === 'high' || value === 'medium' || value === 'low') return value
  return CONTRAST_DEFAULT
}

/**
 * Remap chrome tokens for a contrast level. Body text, accents, and syntax
 * literals stay on the theme so the look stays recognisable.
 *
 * Medium is a no-op (same object) so applying it is free. High and Low only
 * alias existing tokens — no colour math, no extra work on first paint.
 */
export function tokensForContrast(tokens: ThemeTokens, level: ContrastPreference): ThemeTokens {
  if (level === 'medium') return tokens

  if (level === 'high') {
    return {
      ...tokens,
      'text-faint': tokens['text-dim'],
      'syntax-comment': tokens['text-dim'],
      'syntax-punctuation': tokens['text-dim'],
      border: tokens['border-strong'],
    }
  }

  return {
    ...tokens,
    'text-dim': tokens['text-faint'],
    'syntax-punctuation': tokens['syntax-comment'],
  }
}
