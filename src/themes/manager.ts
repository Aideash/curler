import {
  SYSTEM_PREFERENCE,
  THEME_STORAGE_KEY,
  getThemeById,
  themes,
  type Theme,
} from './definitions'

/** Either a concrete theme id or the literal `system`. */
export type ThemePreference = string

const DARK_QUERY = '(prefers-color-scheme: dark)'

export function systemPrefersDark(): boolean {
  return window.matchMedia(DARK_QUERY).matches
}

export function readStoredPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    if (stored === SYSTEM_PREFERENCE) return SYSTEM_PREFERENCE
    if (stored && getThemeById(stored)) return stored
  } catch {
    // Private browsing and locked-down profiles can throw here.
  }
  return SYSTEM_PREFERENCE
}

function writeStoredPreference(preference: ThemePreference): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, preference)
  } catch {
    // A theme that does not survive a reload still beats a crash.
  }
}

export function resolveThemeId(preference: ThemePreference): string {
  if (preference === SYSTEM_PREFERENCE) return systemPrefersDark() ? 'dark' : 'light'
  return getThemeById(preference) ? preference : 'dark'
}

export function applyTheme(themeId: string): Theme {
  const theme = getThemeById(themeId) ?? themes.dark
  const root = document.documentElement

  for (const [token, value] of Object.entries(theme.tokens)) {
    root.style.setProperty(`--${token}`, value)
  }

  root.dataset.theme = theme.id
  root.style.colorScheme = theme.colorScheme
  return theme
}

let activePreference: ThemePreference = SYSTEM_PREFERENCE
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

export function setThemePreference(preference: ThemePreference): void {
  activePreference = preference
  writeStoredPreference(preference)
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

export function initTheme(): void {
  activePreference = readStoredPreference()
  applyTheme(resolveThemeId(activePreference))
  syncSystemListener()
  // Subscribers are registered during module evaluation, which happens before
  // this runs, so they need telling about the stored preference.
  notify()
}
