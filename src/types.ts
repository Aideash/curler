export type HttpMethod =
  | 'GET'
  | 'POST'
  | 'PUT'
  | 'PATCH'
  | 'DELETE'
  | 'HEAD'
  | 'OPTIONS'

export const HTTP_METHODS: HttpMethod[] = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
]

export type BodyMode = 'none' | 'json' | 'text' | 'form'

export interface KeyValue {
  id: string
  name: string
  value: string
  enabled: boolean
}

export interface RequestBody {
  mode: BodyMode
  /** Raw text for the `json` and `text` modes. */
  text: string
  /** Field list for the `form` mode (application/x-www-form-urlencoded). */
  form: KeyValue[]
}

export interface RequestOptions {
  followRedirects: boolean
  /** Skip TLS certificate verification, equivalent to curl's -k. */
  insecure: boolean
  timeoutSecs: number
  /** Stop reading a response body past this size rather than buffering it all. */
  maxResponseMb: number
}

export const DEFAULT_MAX_RESPONSE_MB = 10

/**
 * Flags that only mean something to the curl binary in a terminal. They are
 * appended to "Copy as curl" and are deliberately inert for requests sent from
 * curler, which has no stdout to quieten and no file to write.
 *
 * Boolean flags hold `true`; valued ones hold their argument, and count as off
 * when that argument is blank.
 */
export type TerminalFlags = Record<string, string | boolean>

export interface RequestModel {
  id: string
  name: string
  method: HttpMethod
  url: string
  headers: KeyValue[]
  body: RequestBody
  options: RequestOptions
  /** Variables visible only to this request. */
  variables: KeyValue[]
  terminalFlags: TerminalFlags
}

export interface Collection {
  id: string
  name: string
  requests: RequestModel[]
  /** Variables visible to every request in this collection. */
  variables: KeyValue[]
}

export interface Environment {
  id: string
  name: string
  variables: KeyValue[]
}

export interface Workspace {
  collections: Collection[]
  environments: Environment[]
  activeEnvironmentId: string | null
  /** Variables visible to every request, whatever the environment. */
  globals: KeyValue[]
}

/**
 * Variable scopes, narrowest first. A name defined more than once resolves to
 * the narrowest definition, so a request can override a shared value without
 * disturbing it.
 */
export const SCOPES = ['request', 'collection', 'environment', 'global', 'builtin'] as const

export type Scope = (typeof SCOPES)[number]

export const SCOPE_LABELS: Record<Scope, string> = {
  request: 'Request',
  collection: 'Collection',
  environment: 'Environment',
  global: 'Global',
  builtin: 'Built-in',
}

/** The scopes a user can actually put a variable in. */
export const EDITABLE_SCOPES = ['request', 'collection', 'environment', 'global'] as const

export type EditableScope = (typeof EDITABLE_SCOPES)[number]

export interface RedirectHop {
  status: number
  from: string
  to: string
}

/** Null for a stage that did not happen, such as TLS on a plain HTTP hop. */
export interface Timings {
  dnsMs: number | null
  connectMs: number | null
  tlsMs: number | null
  waitingMs: number | null
  downloadMs: number | null
  totalMs: number
}

export interface TlsInfo {
  protocol: string | null
  cipher: string | null
  subject: string | null
  issuer: string | null
  validFrom: string | null
  validTo: string | null
  altNames: string | null
  authorized: boolean
  authorizationError: string | null
}

/**
 * Diagnostics are per hop, because timings, certificates and the peer address
 * all change across a redirect chain.
 */
export interface HopDiagnostics {
  index: number
  method: string
  url: string
  requestTarget: string
  requestHeaders: [string, string][]
  requestBodyBytes: number
  status: number
  statusText: string
  httpVersion: string
  responseHeaders: [string, string][]
  remoteAddress: string | null
  remotePort: number | null
  reusedConnection: boolean
  tls: TlsInfo | null
  timings: Timings
  wireBytes: number
  decodedBytes: number
  contentEncoding: string | null
  truncated: boolean
}

export interface Diagnostics {
  hops: HopDiagnostics[]
  totalMs: number
  maxResponseMb: number
  truncated: boolean
}

/** Response shape returned by the local API server. */
export interface HttpResponse {
  status: number
  statusText: string
  headers: [string, string][]
  body: string
  /** True when the body was not valid UTF-8 and `body` holds a placeholder. */
  bodyIsBinary: boolean
  elapsedMs: number
  bytes: number
  finalUrl: string
  redirectChain: RedirectHop[]
  truncated: boolean
  diagnostics: Diagnostics
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

export function emptyKeyValue(): KeyValue {
  return { id: uid(), name: '', value: '', enabled: true }
}

export function newRequest(partial: Partial<RequestModel> = {}): RequestModel {
  return {
    id: uid(),
    name: 'Untitled request',
    method: 'GET',
    url: '',
    headers: [],
    body: { mode: 'none', text: '', form: [] },
    options: {
      followRedirects: true,
      insecure: false,
      timeoutSecs: 30,
      maxResponseMb: DEFAULT_MAX_RESPONSE_MB,
    },
    variables: [],
    terminalFlags: {},
    ...partial,
  }
}
