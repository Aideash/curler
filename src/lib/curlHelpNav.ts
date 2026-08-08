import { CURL_HELP_PAGES } from './curlHelpData'

const knownHelpCategories = new Set(Object.keys(CURL_HELP_PAGES))

export function isKnownCurlHelpCategory(category: string): boolean {
  return knownHelpCategories.has(category)
}

/** Hash section under `#/help/` for a parsed `curl --help` category argument. */
export function curlHelpHashForCategory(category?: string): string {
  if (category && isKnownCurlHelpCategory(category)) return `--help/${category}`
  return '--help'
}

export function curlHelpCommandLabel(category?: string): string {
  if (category && isKnownCurlHelpCategory(category)) return `curl --help ${category}`
  return 'curl --help'
}
