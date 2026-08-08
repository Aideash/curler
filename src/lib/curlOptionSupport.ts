import { TERMINAL_FLAGS } from './terminalFlags'
import type { CurlHelpOption } from './curlHelpData'

/** How curler treats a curl flag shown in the faux-terminal help. */
export type CurlOptionTier = 'send' | 'copy' | 'ignored' | 'none'

export const CURL_OPTION_TIER_LABELS: Record<CurlOptionTier, string> = {
  send: 'Sent by curler',
  copy: 'Copy as curl only',
  ignored: 'Accepted on import but dropped',
  none: 'Not supported',
}

/** Keys for the faux-terminal legend (ignored omitted — rare on the main/help pages). */
export const CURL_HELP_TIER_LEGEND: { tier: CurlOptionTier; label: string }[] = [
  { tier: 'send', label: CURL_OPTION_TIER_LABELS.send },
  { tier: 'copy', label: CURL_OPTION_TIER_LABELS.copy },
  { tier: 'none', label: CURL_OPTION_TIER_LABELS.none },
]

/** Long-option stems handled by parseCurl and passed through to the send engine. */
const SEND_LONG = new Set([
  'request',
  'url',
  'header',
  'data',
  'data-raw',
  'data-ascii',
  'data-binary',
  'data-urlencode',
  'json',
  'form',
  'form-string',
  'user',
  'user-agent',
  'cookie',
  'referer',
  'max-time',
  'location',
  'location-trusted',
  'insecure',
  'head',
  'get',
])

/** Short flags that shape the outgoing request (case-sensitive: -I ≠ -i). */
const SEND_SHORT = new Set(['X', 'H', 'd', 'F', 'u', 'A', 'b', 'e', 'm', 'L', 'k', 'I', 'G'])

/** Swallowed silently by parseCurl — neither stored nor warned. */
const IGNORED_LONG = new Set(['compressed', 'no-buffer'])

const COPY_LONG = new Set<string>()
const COPY_SHORT = new Set<string>()

for (const flag of TERMINAL_FLAGS) {
  COPY_LONG.add(flag.flag.replace(/^--/, ''))
  if (flag.short) COPY_SHORT.add(flag.short.replace(/^-/, ''))
}

function longStem(long: string): string | null {
  const match = long.match(/^--([\w.-]+)/)
  return match?.[1] ?? null
}

function shortLetter(short?: string): string | null {
  if (!short) return null
  const letter = short.replace(/^-/, '').replace(/,$/, '')
  return letter || null
}

export function curlOptionTier(option: CurlHelpOption): CurlOptionTier {
  const long = longStem(option.long)
  const short = shortLetter(option.short)

  if (long && IGNORED_LONG.has(long)) return 'ignored'

  // Terminal flags win over send for overlapping short letters (-i, -f, -s, …).
  if (long && COPY_LONG.has(long)) return 'copy'
  if (short && COPY_SHORT.has(short)) return 'copy'

  if (long && SEND_LONG.has(long)) return 'send'
  if (short && SEND_SHORT.has(short)) return 'send'

  return 'none'
}

export function curlOptionTierTitle(option: CurlHelpOption): string {
  return CURL_OPTION_TIER_LABELS[curlOptionTier(option)]
}

/** Spellings curler knows about — useful for sanity checks. */
export function knownCurlOptionSpellings(): { send: string[]; copy: string[]; ignored: string[] } {
  return {
    send: [...SEND_LONG, ...SEND_SHORT],
    copy: [...COPY_LONG, ...COPY_SHORT],
    ignored: [...IGNORED_LONG],
  }
}
