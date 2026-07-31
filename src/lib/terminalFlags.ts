import type { TerminalFlags } from '../types'

export interface TerminalFlag {
  id: string
  /** Long form, which is what gets written out for readability. */
  flag: string
  short?: string
  label: string
  description: string
  kind: 'boolean' | 'value'
  placeholder?: string
  /** Cannot be combined. Selecting one disables the others outright. */
  conflicts?: string[]
  /** Legal together, but pointless without the named flag. */
  requires?: string[]
  group: TerminalGroup
}

export type TerminalGroup = 'output' | 'errors' | 'diagnostics' | 'network'

export const TERMINAL_GROUPS: { id: TerminalGroup; label: string }[] = [
  { id: 'output', label: 'Output' },
  { id: 'errors', label: 'Errors' },
  { id: 'diagnostics', label: 'Diagnostics' },
  { id: 'network', label: 'Network' },
]

/**
 * Deliberately a curated list rather than everything curl accepts. These are
 * the flags people actually hand-write, and each one either has no meaning in
 * a window (there is no progress meter to silence) or is something curler does
 * not implement.
 */
export const TERMINAL_FLAGS: TerminalFlag[] = [
  {
    id: 'silent',
    flag: '--silent',
    short: '-s',
    label: 'Silent',
    description: 'No progress meter and no error messages.',
    kind: 'boolean',
    conflicts: ['progressBar'],
    group: 'output',
  },
  {
    id: 'showError',
    flag: '--show-error',
    short: '-S',
    label: 'Show errors anyway',
    description: 'Keeps error messages when silent is on.',
    kind: 'boolean',
    requires: ['silent'],
    group: 'output',
  },
  {
    id: 'progressBar',
    flag: '--progress-bar',
    short: '-#',
    label: 'Progress bar',
    description: 'A bar instead of the default progress table.',
    kind: 'boolean',
    conflicts: ['silent', 'noProgressMeter'],
    group: 'output',
  },
  {
    id: 'noProgressMeter',
    flag: '--no-progress-meter',
    label: 'No progress meter',
    description: 'Hides progress but keeps error messages.',
    kind: 'boolean',
    conflicts: ['progressBar'],
    group: 'output',
  },
  {
    id: 'include',
    flag: '--include',
    short: '-i',
    label: 'Include response headers',
    description: 'Prints headers above the body. This window shows them either way.',
    kind: 'boolean',
    group: 'output',
  },
  {
    id: 'output',
    flag: '--output',
    short: '-o',
    label: 'Write to file',
    description: 'Sends the body to a file instead of the terminal.',
    kind: 'value',
    placeholder: 'response.json',
    conflicts: ['remoteName'],
    group: 'output',
  },
  {
    id: 'remoteName',
    flag: '--remote-name',
    short: '-O',
    label: 'Write to a file named by the URL',
    description: 'Saves using the last path segment as the filename.',
    kind: 'boolean',
    conflicts: ['output'],
    group: 'output',
  },
  {
    id: 'fail',
    flag: '--fail',
    short: '-f',
    label: 'Fail on HTTP errors',
    description: 'Exit code 22 and no body when the status is 400 or above.',
    kind: 'boolean',
    conflicts: ['failWithBody'],
    group: 'errors',
  },
  {
    id: 'failWithBody',
    flag: '--fail-with-body',
    label: 'Fail on HTTP errors, keep the body',
    description: 'Same exit code as fail, but still prints the response.',
    kind: 'boolean',
    conflicts: ['fail'],
    group: 'errors',
  },
  {
    id: 'retry',
    flag: '--retry',
    label: 'Retry count',
    description: 'Retries transient failures the given number of times.',
    kind: 'value',
    placeholder: '3',
    group: 'errors',
  },
  {
    id: 'verbose',
    flag: '--verbose',
    short: '-v',
    label: 'Verbose',
    description: 'Connection and header trace on stderr. This tab is the equivalent.',
    kind: 'boolean',
    conflicts: ['trace'],
    group: 'diagnostics',
  },
  {
    id: 'trace',
    flag: '--trace-ascii',
    label: 'Full ASCII trace',
    description: 'Every byte sent and received, written to a file. Use - for stderr.',
    kind: 'value',
    placeholder: '-',
    conflicts: ['verbose'],
    group: 'diagnostics',
  },
  {
    id: 'writeOut',
    flag: '--write-out',
    short: '-w',
    label: 'Write-out format',
    description: 'Prints selected values after the transfer.',
    kind: 'value',
    placeholder: '%{http_code} %{time_total}s',
    group: 'diagnostics',
  },
  {
    id: 'ipv4',
    flag: '--ipv4',
    short: '-4',
    label: 'IPv4 only',
    description: 'Resolves names to IPv4 addresses only.',
    kind: 'boolean',
    conflicts: ['ipv6'],
    group: 'network',
  },
  {
    id: 'ipv6',
    flag: '--ipv6',
    short: '-6',
    label: 'IPv6 only',
    description: 'Resolves names to IPv6 addresses only.',
    kind: 'boolean',
    conflicts: ['ipv4'],
    group: 'network',
  },
  {
    id: 'http11',
    flag: '--http1.1',
    label: 'Force HTTP/1.1',
    description: 'Refuses to negotiate a newer version.',
    kind: 'boolean',
    conflicts: ['http2'],
    group: 'network',
  },
  {
    id: 'http2',
    flag: '--http2',
    label: 'Force HTTP/2',
    description: 'Attempts HTTP/2 for this request.',
    kind: 'boolean',
    conflicts: ['http11'],
    group: 'network',
  },
  {
    id: 'globoff',
    flag: '--globoff',
    short: '-g',
    label: 'Disable URL globbing',
    description: 'Stops curl treating [] and {} in the URL as ranges.',
    kind: 'boolean',
    group: 'network',
  },
]

const BY_ID = new Map(TERMINAL_FLAGS.map((flag) => [flag.id, flag]))

export function terminalFlag(id: string): TerminalFlag | undefined {
  return BY_ID.get(id)
}

export function isActive(flags: TerminalFlags, id: string): boolean {
  const value = flags[id]
  const definition = BY_ID.get(id)
  if (!definition) return false
  return definition.kind === 'boolean'
    ? value === true
    : typeof value === 'string' && value.trim() !== ''
}

/** Ids of active flags that rule this one out. */
export function blockedBy(flags: TerminalFlags, id: string): string[] {
  const definition = BY_ID.get(id)
  if (!definition?.conflicts) return []
  return definition.conflicts.filter((other) => isActive(flags, other))
}

/** Active flags whose prerequisite is missing, so they do nothing. */
export function ineffective(flags: TerminalFlags, id: string): string[] {
  const definition = BY_ID.get(id)
  if (!definition?.requires || !isActive(flags, id)) return []
  return definition.requires.filter((other) => !isActive(flags, other))
}

export function activeTerminalFlags(flags: TerminalFlags): TerminalFlag[] {
  return TERMINAL_FLAGS.filter((definition) => isActive(flags, definition.id))
}

/**
 * Tokens to append to a generated curl command. Values are returned raw; the
 * caller quotes them, since only it knows which quoting style is in play.
 */
export function terminalFlagArgs(flags: TerminalFlags): { flag: string; value?: string }[] {
  const args: { flag: string; value?: string }[] = []
  for (const definition of activeTerminalFlags(flags)) {
    if (definition.kind === 'boolean') args.push({ flag: definition.flag })
    else args.push({ flag: definition.flag, value: String(flags[definition.id]).trim() })
  }
  return args
}

/** Lookup used by the curl parser, keyed on every spelling curl accepts. */
const BY_SPELLING = new Map<string, TerminalFlag>()
for (const definition of TERMINAL_FLAGS) {
  BY_SPELLING.set(definition.flag.replace(/^--/, ''), definition)
  if (definition.short) BY_SPELLING.set(definition.short.replace(/^-/, ''), definition)
}

export function terminalFlagBySpelling(spelling: string): TerminalFlag | undefined {
  return BY_SPELLING.get(spelling)
}
