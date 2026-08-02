import { parse as shellParse } from 'shell-quote'
import {
  emptyKeyValue,
  newRequest,
  uid,
  type HttpMethod,
  type KeyValue,
  type RequestModel,
} from '../types'
import { parseGraphqlBody, buildGraphqlBody } from './graphql'
import { resolve, resolveUrl, type VariableSet } from './vars'
import { TERMINAL_FLAGS, terminalFlagArgs, terminalFlagBySpelling } from './terminalFlags'

/** Long flags that take an argument, for the line-wrapping pass in `toCurl`. */
const VALUED_LONG_FLAGS = new Set(
  TERMINAL_FLAGS.filter((flag) => flag.kind === 'value').map((flag) => flag.flag),
)

/**
 * shell-quote wants to expand `$FOO` itself. We hand it back our own `${FOO}`
 * placeholder syntax instead, so shell variables in a pasted command survive
 * as curler variables rather than being blanked out.
 */
const preserveVariable = (key: string) => '${' + key + '}'

const SHORT_WITH_VALUE = new Set([
  'X',
  'H',
  'd',
  'F',
  'u',
  'A',
  'b',
  'e',
  'm',
  'o',
  'T',
  'x',
  'E',
  'w',
])

/** Short flags we understand but that carry no payload. */
const SHORT_BOOLEAN = new Set([
  'L',
  'k',
  'I',
  'G',
  's',
  'S',
  'v',
  'i',
  'f',
  'g',
  'N',
  'C',
  'O',
  'j',
  'a',
  '4',
  '6',
  '#',
])

export interface ParsedCurl {
  request: RequestModel
  warnings: string[]
}

/** How much of the variable table to substitute when copying as curl. */
export type CurlCopyMode = 'ready' | 'shareable' | 'general'

/** The variable map `toCurl` should use for a given copy mode. */
export function variablesForCurlCopy(
  set: VariableSet,
  mode: CurlCopyMode,
): Record<string, string> | undefined {
  if (mode === 'general') return undefined
  if (mode === 'ready') return set.values
  const out: Record<string, string> = {}
  for (const [name, value] of Object.entries(set.values)) {
    if (!set.secretNames.has(name)) out[name] = value
  }
  return out
}

/** Path-parameter map for `toCurl`. Withheld in the general form so nothing expands. */
export function pathVariablesForCurlCopy(
  set: VariableSet,
  mode: CurlCopyMode,
): Record<string, string> | undefined {
  return mode === 'general' ? undefined : set.values
}

/** The escapes bash resolves inside `$'...'` that stand for a single character. */
const ANSI_C_ESCAPES: Record<string, string> = {
  a: '\x07',
  b: '\b',
  e: '\x1b',
  E: '\x1b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
  v: '\v',
  '\\': '\\',
  "'": "'",
  '"': '"',
  '?': '?',
}

/** `\x41`, `\u00e9`, `\U0001f600` and octal `\101`, matched where we stand. */
const ANSI_C_NUMERIC =
  /\\(?:x([0-9A-Fa-f]{1,2})|u([0-9A-Fa-f]{1,4})|U([0-9A-Fa-f]{1,8})|([0-7]{1,3}))/y

/**
 * Decodes the body of a `$'...'` string, starting at the first character after
 * the opening quote, and reports where the closing quote left off. A string
 * that is never closed is read to the end rather than rejected, since a
 * half-copied command is still worth importing.
 */
function decodeAnsiC(input: string, start: number): { value: string; end: number } {
  let value = ''
  let cursor = start

  while (cursor < input.length) {
    const char = input[cursor]
    if (char === "'") return { value, end: cursor + 1 }
    if (char !== '\\') {
      value += char
      cursor += 1
      continue
    }

    const next = input[cursor + 1]
    if (next === undefined) {
      value += '\\'
      break
    }

    const simple = ANSI_C_ESCAPES[next]
    if (simple !== undefined) {
      value += simple
      cursor += 2
      continue
    }

    // `\cA` is Ctrl-A: the letter with its 0x40 bit cleared.
    if (next === 'c' && input[cursor + 2] !== undefined) {
      value += String.fromCharCode(input[cursor + 2].toUpperCase().charCodeAt(0) ^ 0x40)
      cursor += 3
      continue
    }

    ANSI_C_NUMERIC.lastIndex = cursor
    const numeric = ANSI_C_NUMERIC.exec(input)
    if (numeric) {
      const [hex2, hex4, hex8, octal] = numeric.slice(1)
      const code = octal !== undefined ? parseInt(octal, 8) : parseInt(hex2 ?? hex4 ?? hex8, 16)
      // A `\U` escape can name a code point that does not exist; drop those
      // instead of throwing partway through the command.
      if (code <= 0x10ffff) value += String.fromCodePoint(code)
      cursor = ANSI_C_NUMERIC.lastIndex
      continue
    }

    // Bash passes an escape it does not recognise through exactly as written.
    value += `\\${next}`
    cursor += 2
  }

  return { value, end: cursor }
}

/**
 * Hides every `$'...'` string behind a placeholder word, so shell-quote — which
 * does not know the syntax — cannot get at it, and returns the decoder that
 * puts the real text back once the command has been split into tokens.
 *
 * Browsers reach for ANSI-C quoting as soon as a payload holds a `!`, a single
 * quote or a control character, and double the payload's backslashes to suit. A
 * GraphQL body qualifies nearly every time, its newlines arriving as JSON `\n`
 * escapes, so left alone shell-quote reads the `$` as a variable and hands back
 * a body with every backslash still doubled.
 *
 * `$"..."` is reduced to a plain double-quoted string in the same pass: the
 * translation it asks for is not ours to do, and the bare `$` would likewise be
 * mistaken for a variable.
 */
function hideAnsiCStrings(input: string): {
  command: string
  restore: (token: string) => string
} {
  if (!input.includes("$'") && !input.includes('$"')) {
    return { command: input, restore: (token) => token }
  }

  // A placeholder has to survive shell-quote untouched, so it is a bare word,
  // and it must not be something the command could contain on its own.
  let marker = 'curlerAnsiC'
  while (input.includes(marker)) marker += 'x'

  const values = new Map<string, string>()
  let command = ''
  let cursor = 0

  while (cursor < input.length) {
    const char = input[cursor]

    // Ordinary quoting is copied across verbatim: a `$'` inside it is text.
    if (char === "'") {
      const end = input.indexOf("'", cursor + 1)
      command += end === -1 ? input.slice(cursor) : input.slice(cursor, end + 1)
      cursor = end === -1 ? input.length : end + 1
      continue
    }

    if (char === '"') {
      let end = cursor + 1
      while (end < input.length && input[end] !== '"') end += input[end] === '\\' ? 2 : 1
      command += input.slice(cursor, end + 1)
      cursor = end + 1
      continue
    }

    if (char === '\\') {
      command += input.slice(cursor, cursor + 2)
      cursor += 2
      continue
    }

    if (char === '$' && input[cursor + 1] === "'") {
      const { value, end } = decodeAnsiC(input, cursor + 2)
      const placeholder = `${marker}${values.size}${marker}`
      values.set(placeholder, value)
      command += placeholder
      cursor = end
      continue
    }

    if (char === '$' && input[cursor + 1] === '"') {
      cursor += 1
      continue
    }

    command += char
    cursor += 1
  }

  const placeholderPattern = new RegExp(`${marker}\\d+${marker}`, 'g')
  return {
    command,
    restore: (token) => token.replace(placeholderPattern, (match) => values.get(match) ?? match),
  }
}

function tokenize(input: string): string[] {
  const { command, restore } = hideAnsiCStrings(input)
  const normalized = command
    .replace(/\\\r?\n/g, ' ')
    .replace(/\^\r?\n/g, ' ')
    .replace(/`\r?\n/g, ' ')
    // shell-quote reads the `#` in `-#` as the start of a comment and discards
    // the rest of the command. A real shell only does that at a word boundary,
    // so the long spelling is swapped in before parsing.
    .replace(/(^|\s)-#(?=\s|$)/g, '$1--progress-bar')
    .trim()

  const parsed = shellParse(normalized, preserveVariable as never)
  const tokens: string[] = []
  for (const entry of parsed) {
    if (typeof entry === 'string') {
      tokens.push(restore(entry))
    } else if (entry && typeof entry === 'object' && 'pattern' in entry) {
      tokens.push(restore((entry as { pattern: string }).pattern))
    }
    // Operators (|, >, &&, ...) terminate the curl invocation.
    else if (entry && typeof entry === 'object' && 'op' in entry) {
      break
    }
  }
  return tokens
}

function splitHeader(raw: string): KeyValue | null {
  const index = raw.indexOf(':')
  if (index === -1) return null
  const name = raw.slice(0, index).trim()
  const value = raw.slice(index + 1).trim()
  if (!name) return null
  return { id: uid(), name, value, enabled: true }
}

export function parseCurl(input: string): ParsedCurl {
  const warnings: string[] = []
  const request = newRequest({ name: 'Imported request' })
  const tokens = tokenize(input)

  let index = 0
  if (tokens[0] && /^curl(\.exe)?$/i.test(tokens[0])) index = 1

  let explicitMethod: HttpMethod | null = null
  let dataAsQuery = false
  let usedFormFlag = false
  const dataParts: string[] = []

  const setHeader = (name: string, value: string) => {
    const existing = request.headers.find((h) => h.name.toLowerCase() === name.toLowerCase())
    if (existing) existing.value = value
    else request.headers.push({ id: uid(), name, value, enabled: true })
  }

  const takeValue = (flag: string, attached: string | undefined): string => {
    if (attached !== undefined && attached !== '') return attached
    index += 1
    const value = tokens[index]
    if (value === undefined) {
      warnings.push(`${flag} was given without a value.`)
      return ''
    }
    return value
  }

  /**
   * Records a terminal-only flag if `spelling` names one. Returns false when
   * it does not, so the caller can fall through to its own warning.
   */
  const captureTerminalFlag = (spelling: string, attached: string | undefined) => {
    const definition = terminalFlagBySpelling(spelling)
    if (!definition) return false

    if (definition.kind === 'boolean') {
      request.terminalFlags[definition.id] = true
    } else {
      request.terminalFlags[definition.id] = takeValue(definition.flag, attached)
    }

    // Whichever spelling arrived last wins, matching how curl itself behaves.
    for (const other of definition.conflicts ?? []) delete request.terminalFlags[other]
    return true
  }

  const applyLongOption = (name: string, attached: string | undefined) => {
    switch (name) {
      case 'request':
        explicitMethod = takeValue('--request', attached).toUpperCase() as HttpMethod
        break
      case 'url':
        request.url = takeValue('--url', attached)
        break
      case 'header':
        {
          const header = splitHeader(takeValue('--header', attached))
          if (header) request.headers.push(header)
        }
        break
      case 'data':
      case 'data-raw':
      case 'data-ascii':
      case 'data-binary':
        dataParts.push(takeValue(`--${name}`, attached))
        break
      case 'data-urlencode':
        dataParts.push(urlEncodeDataArgument(takeValue('--data-urlencode', attached)))
        break
      case 'json':
        dataParts.push(takeValue('--json', attached))
        setHeader('Content-Type', 'application/json')
        setHeader('Accept', 'application/json')
        break
      case 'form':
      case 'form-string':
        {
          const raw = takeValue(`--${name}`, attached)
          const eq = raw.indexOf('=')
          if (eq !== -1) {
            request.body.mode = 'form'
            request.body.form.push({
              id: uid(),
              name: raw.slice(0, eq),
              value: raw.slice(eq + 1),
              enabled: true,
            })
            usedFormFlag = true
          }
        }
        break
      case 'user':
        setHeader('Authorization', `Basic ${btoa(takeValue('--user', attached))}`)
        break
      case 'user-agent':
        setHeader('User-Agent', takeValue('--user-agent', attached))
        break
      case 'cookie':
        setHeader('Cookie', takeValue('--cookie', attached))
        break
      case 'referer':
        setHeader('Referer', takeValue('--referer', attached))
        break
      case 'max-time':
        {
          const secs = Number(takeValue('--max-time', attached))
          if (Number.isFinite(secs) && secs > 0) request.options.timeoutSecs = secs
        }
        break
      case 'location':
      case 'location-trusted':
        request.options.followRedirects = true
        break
      case 'insecure':
        request.options.insecure = true
        break
      case 'head':
        explicitMethod = 'HEAD'
        break
      case 'get':
        dataAsQuery = true
        break
      case 'compressed':
      case 'no-buffer':
        break
      default:
        // Terminal-only flags are kept rather than dropped, so a pasted
        // command comes back out of "Copy as curl" the way it went in.
        if (captureTerminalFlag(name, attached)) break
        warnings.push(`Ignored unsupported option --${name}.`)
    }
  }

  for (; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (token === undefined) break

    if (token.startsWith('--')) {
      const body = token.slice(2)
      const eq = body.indexOf('=')
      if (eq !== -1) applyLongOption(body.slice(0, eq), body.slice(eq + 1))
      else applyLongOption(body, undefined)
      continue
    }

    if (token.startsWith('-') && token.length > 1) {
      let cursor = 1
      while (cursor < token.length) {
        const flag = token[cursor]
        if (SHORT_WITH_VALUE.has(flag)) {
          const attached = token.slice(cursor + 1)
          switch (flag) {
            case 'X':
              explicitMethod = takeValue('-X', attached).toUpperCase() as HttpMethod
              break
            case 'H':
              {
                const header = splitHeader(takeValue('-H', attached))
                if (header) request.headers.push(header)
              }
              break
            case 'd':
              dataParts.push(takeValue('-d', attached))
              break
            case 'F':
              applyLongOption('form', attached || undefined)
              break
            case 'u':
              setHeader('Authorization', `Basic ${btoa(takeValue('-u', attached))}`)
              break
            case 'A':
              setHeader('User-Agent', takeValue('-A', attached))
              break
            case 'b':
              setHeader('Cookie', takeValue('-b', attached))
              break
            case 'e':
              setHeader('Referer', takeValue('-e', attached))
              break
            case 'm':
              {
                const secs = Number(takeValue('-m', attached))
                if (Number.isFinite(secs) && secs > 0) request.options.timeoutSecs = secs
              }
              break
            default:
              if (captureTerminalFlag(flag, attached)) break
              takeValue(`-${flag}`, attached)
              warnings.push(`Ignored unsupported option -${flag}.`)
          }
          break
        }

        if (SHORT_BOOLEAN.has(flag)) {
          if (flag === 'L') request.options.followRedirects = true
          else if (flag === 'k') request.options.insecure = true
          else if (flag === 'I') explicitMethod = 'HEAD'
          else if (flag === 'G') dataAsQuery = true
          else captureTerminalFlag(flag, undefined)
          cursor += 1
          continue
        }

        if (!captureTerminalFlag(flag, undefined)) {
          warnings.push(`Ignored unsupported option -${flag}.`)
        }
        cursor += 1
      }
      continue
    }

    if (!request.url) request.url = token
    else warnings.push(`Ignored extra argument "${token}".`)
  }

  const data = dataParts.join('&')

  if (data && dataAsQuery) {
    request.url += (request.url.includes('?') ? '&' : '?') + data
  } else if (data) {
    const graphql = parseGraphqlBody(data)
    if (graphql) {
      request.body.mode = 'graphql'
      request.body.text = graphql.query
      request.body.graphqlVariables = graphql.variables
    } else {
      request.body.mode = looksLikeJson(data) ? 'json' : 'text'
      request.body.text = data
    }
  }

  if (explicitMethod) request.method = explicitMethod
  else if (request.body.mode !== 'none') request.method = 'POST'

  if (request.body.mode === 'json' || request.body.mode === 'graphql') {
    const hasContentType = request.headers.some((h) => h.name.toLowerCase() === 'content-type')
    if (!hasContentType) setHeader('Content-Type', 'application/json')
  }

  // A URL starting with a variable probably carries its own scheme, so leave it be.
  if (request.url && !/^https?:\/\//i.test(request.url) && !request.url.startsWith('$')) {
    request.url = `https://${request.url}`
  }

  if (usedFormFlag) {
    warnings.push(
      'curl -F sends multipart/form-data, which curler does not support yet. The fields were imported as a URL-encoded form body instead.',
    )
  }

  if (!request.url) warnings.push('No URL was found in the command.')
  if (request.headers.length === 0) request.headers.push(emptyKeyValue())

  request.name = deriveName(request.url) ?? 'Imported request'
  return { request, warnings }
}

/**
 * Mirrors curl's --data-urlencode, which encodes only the value half of
 * `name=value`. Variable references are restored afterwards so they stay
 * substitutable rather than being percent-encoded into nonsense.
 */
function urlEncodeDataArgument(raw: string): string {
  const restoreVariables = (encoded: string) =>
    encoded.replace(/%24%7B([A-Za-z_][A-Za-z0-9_]*)%7D/g, '$${$1}')

  const eq = raw.indexOf('=')
  if (eq === -1) return restoreVariables(encodeURIComponent(raw))

  const name = raw.slice(0, eq)
  const value = restoreVariables(encodeURIComponent(raw.slice(eq + 1)))
  return name ? `${name}=${value}` : value
}

function deriveName(url: string): string | null {
  if (!url) return null
  const withoutScheme = url.replace(/^https?:\/\//i, '')
  const path = withoutScheme.split('?')[0]
  const segments = path.split('/').filter(Boolean)
  return segments.length > 1 ? `/${segments.slice(1).join('/')}` : (segments[0] ?? null)
}

function looksLikeJson(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return false
  try {
    JSON.parse(trimmed)
    return true
  } catch {
    // A body that is *meant* to be JSON but currently has a typo should still
    // open in the JSON editor so the linter can point at the mistake.
    return true
  }
}

/** Single quotes: the shell sees the value exactly as written. */
function shellEscape(value: string): string {
  if (value === '') return "''"
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) return value
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/** Curler's own reference syntax, which is the braced form and nothing else. */
const VARIABLE_REFERENCE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g

function escapeInsideDoubleQuotes(text: string): string {
  return text.replace(/([\\"`$])/g, '\\$1')
}

/**
 * Double quotes, with variable references left intact so the receiving shell
 * expands them from its own environment. Everything around them is escaped,
 * including any `$` that is not part of a reference — which is how a GraphQL
 * `$id` in the payload reaches the far end as itself rather than as whatever
 * the reader's shell happens to have in `id`.
 *
 * A reference is written bare as `$NAME` unless the next character could be
 * read as part of the name, in which case it needs the braces back.
 */
function shellEscapeExpanding(value: string): string {
  let out = ''
  let cursor = 0
  const pattern = new RegExp(VARIABLE_REFERENCE.source, 'g')

  for (let match = pattern.exec(value); match; match = pattern.exec(value)) {
    out += escapeInsideDoubleQuotes(value.slice(cursor, match.index))
    const name = match[1]
    const following = value[match.index + match[0].length]
    out += following && /[A-Za-z0-9_]/.test(following) ? `\${${name}}` : `$${name}`
    cursor = match.index + match[0].length
  }

  out += escapeInsideDoubleQuotes(value.slice(cursor))
  return `"${out}"`
}

function hasVariableReference(value: string): boolean {
  return new RegExp(VARIABLE_REFERENCE.source).test(value)
}

/**
 * Serialises a request as a curl command. Pass `variables` to substitute
 * `${VAR}` references, which is what you want when the command has to run in a
 * shell; omit it to keep the placeholders for sharing.
 */
export function toCurl(
  request: RequestModel,
  variables?: Record<string, string>,
  /** Used for `:id` path parameters when `variables` is withheld. */
  pathVariables: Record<string, string> | undefined = variables,
): string {
  const apply = (input: string) => (variables ? resolve(input, variables).value : input)

  /**
   * Resolved values are literal, so single quotes are both correct and safer.
   * Unresolved ones have to stay expandable, which needs double quotes.
   */
  const quote = (value: string) =>
    hasVariableReference(value) ? shellEscapeExpanding(value) : shellEscape(value)

  /**
   * `:id` is a curler idea with no shell equivalent, so it is expanded even in
   * the shareable form — leaving it in place would produce a command that
   * quietly requests the wrong path.
   */
  const applyUrl = (input: string) =>
    pathVariables ? resolveUrl(input, pathVariables).value : input

  const parts: string[] = ['curl']

  if (request.method !== 'GET') parts.push('-X', request.method)
  parts.push(quote(applyUrl(apply(request.url || ''))))

  for (const header of request.headers) {
    if (!header.enabled || !header.name.trim() || !header.value.trim()) continue
    parts.push('-H', quote(`${apply(header.name)}: ${apply(header.value)}`))
  }

  if (request.body.mode === 'json' || request.body.mode === 'text') {
    if (request.body.text) parts.push('-d', quote(apply(request.body.text)))
  } else if (request.body.mode === 'graphql') {
    const payload = buildGraphqlBody(request.body.text, request.body.graphqlVariables ?? [], apply)
    if (payload) parts.push('-d', quote(payload))
  } else if (request.body.mode === 'form') {
    const encoded = request.body.form
      .filter((field) => field.enabled && field.name.trim() && field.value.trim())
      .map(
        (field) =>
          `${encodeURIComponent(apply(field.name))}=${encodeURIComponent(apply(field.value))}`,
      )
      .join('&')
    if (encoded) parts.push('-d', quote(encoded))
  }

  if (request.options.followRedirects) parts.push('-L')
  if (request.options.insecure) parts.push('-k')
  if (request.options.timeoutSecs !== 30) {
    parts.push('-m', String(request.options.timeoutSecs))
  }

  // Terminal-only flags come last, where a reader expects the trimmings.
  for (const arg of terminalFlagArgs(request.terminalFlags ?? {})) {
    parts.push(arg.flag)
    if (arg.value !== undefined) parts.push(quote(apply(arg.value)))
  }

  // Wrap onto continuation lines so long commands stay readable when pasted.
  const lines: string[] = []
  let current = parts[0]
  for (let i = 1; i < parts.length; i += 1) {
    const part = parts[i]
    const takesValue =
      part.startsWith('-') &&
      i + 1 < parts.length &&
      !parts[i + 1].startsWith('-') &&
      (part.length <= 2 || VALUED_LONG_FLAGS.has(part))
    if (takesValue) {
      lines.push(current)
      current = `  ${part} ${parts[i + 1]}`
      i += 1
    } else if (part.startsWith('-')) {
      lines.push(current)
      current = `  ${part}`
    } else {
      current += ` ${part}`
    }
  }
  lines.push(current)
  return lines.join(' \\\n')
}
