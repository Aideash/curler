import {
  CONTRAST_DEFAULT,
  CONTRAST_STORAGE_KEY,
  parseContrastPreference,
  tokensForContrast,
  type ContrastPreference,
} from './contrast'
import {
  SYSTEM_PREFERENCE,
  THEME_STORAGE_KEY,
  getThemeById,
  themes,
  type Theme,
} from './definitions'

/** Either a concrete theme id or the literal `system`. */
export type ThemePreference = string
export type { ContrastPreference }

const DARK_QUERY = '(prefers-color-scheme: dark)'

export function systemPrefersDark(): boolean {
  return window.matchMedia(DARK_QUERY).matches
}

/** Fast path for first paint, before the workspace has loaded. */
export function readCachedThemePreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    if (stored === SYSTEM_PREFERENCE) return SYSTEM_PREFERENCE
    if (stored && getThemeById(stored)) return stored
  } catch {
    // Private browsing and locked-down profiles can throw here.
  }
  return SYSTEM_PREFERENCE
}

export function writeCachedThemePreference(preference: ThemePreference): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, preference)
  } catch {
    // A theme that does not survive a reload still beats a crash.
  }
}

export function readCachedContrastPreference(): ContrastPreference {
  try {
    return parseContrastPreference(localStorage.getItem(CONTRAST_STORAGE_KEY))
  } catch {
    // Same as a missing key: Medium is the default look.
  }
  return CONTRAST_DEFAULT
}

export function writeCachedContrastPreference(preference: ContrastPreference): void {
  try {
    localStorage.setItem(CONTRAST_STORAGE_KEY, preference)
  } catch {
    // A contrast that does not survive a reload still beats a crash.
  }
}

export function resolveThemeId(preference: ThemePreference): string {
  if (preference === SYSTEM_PREFERENCE) return systemPrefersDark() ? 'dark' : 'light'
  return getThemeById(preference) ? preference : 'dark'
}

export function applyTheme(themeId: string): Theme {
  const theme = getThemeById(themeId) ?? themes.dark
  const root = document.documentElement
  const tokens = tokensForContrast(theme.tokens, activeContrast)

  for (const [token, value] of Object.entries(tokens)) {
    root.style.setProperty(`--${token}`, value)
  }

  root.dataset.theme = theme.id
  root.dataset.contrast = activeContrast
  root.style.colorScheme = theme.colorScheme
  return theme
}

let activePreference: ThemePreference = SYSTEM_PREFERENCE
let activeContrast: ContrastPreference = CONTRAST_DEFAULT
let mediaQuery: MediaQueryList | null = null
let mediaHandler: (() => void) | null = null

function syncSystemListener(): void {
  const wanted = activePreference === SYSTEM_PREFERENCE

  if (!wanted) {
    if (mediaQuery && mediaHandler) mediaQuery.removeEventListener('change', mediaHandler)
    mediaQuery = null
    mediaHandler = null
    return
  }

  if (mediaQuery) return
  mediaQuery = window.matchMedia(DARK_QUERY)
  mediaHandler = () => {
    applyTheme(resolveThemeId(SYSTEM_PREFERENCE))
    notify()
  }
  mediaQuery.addEventListener('change', mediaHandler)
}

const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of listeners) listener()
}

export function onThemeChange(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Apply a theme in the UI and cache it for the next first paint. */
export function setThemePreference(preference: ThemePreference): void {
  activePreference = preference
  writeCachedThemePreference(preference)
  applyTheme(resolveThemeId(preference))
  syncSystemListener()
  notify()
}

export function getThemePreference(): ThemePreference {
  return activePreference
}

export function getResolvedThemeId(): string {
  return resolveThemeId(activePreference)
}

/** Apply a contrast level in the UI and cache it for the next first paint. */
export function setContrastPreference(preference: string): void {
  activeContrast = parseContrastPreference(preference)
  writeCachedContrastPreference(activeContrast)
  applyTheme(resolveThemeId(activePreference))
  notify()
}

export function getContrastPreference(): ContrastPreference {
  return activeContrast
}

/**
 * Paint from the browser cache before Vue mounts. Theme and contrast share this
 * tick so the first frame already matches the last visit — no workspace wait,
 * no second pass that would flash.
 */
export function initTheme(): void {
  activePreference = readCachedThemePreference()
  activeContrast = readCachedContrastPreference()
  applyTheme(resolveThemeId(activePreference))
  syncSystemListener()
  // Subscribers are registered during module evaluation, which happens before
  // this runs, so they need telling about the cached preference.
  notify()
}
