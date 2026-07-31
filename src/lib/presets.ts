/** Pre-filled name for a new environment variable, by far the most common one. */
export const DEFAULT_VARIABLE_NAME = 'API_KEY'

export interface HeaderPreset {
  name: string
  value: string
}

export interface HeaderBundle {
  label: string
  description: string
  headers: HeaderPreset[]
}

/** One-click groups for the combinations that come up constantly. */
export const HEADER_BUNDLES: HeaderBundle[] = [
  {
    label: 'JSON API',
    description: 'Send and accept JSON',
    headers: [
      { name: 'Content-Type', value: 'application/json' },
      { name: 'Accept', value: 'application/json' },
    ],
  },
  {
    label: 'Bearer token',
    description: 'Authorization via bearer token',
    headers: [{ name: 'Authorization', value: 'Bearer ${TOKEN}' }],
  },
  {
    label: 'API key',
    description: 'x-api-key header',
    headers: [{ name: 'x-api-key', value: '${API_KEY}' }],
  },
  {
    label: 'Form submit',
    description: 'URL-encoded form body',
    headers: [
      { name: 'Content-Type', value: 'application/x-www-form-urlencoded' },
    ],
  },
  {
    label: 'No cache',
    description: 'Bypass intermediate caches',
    headers: [
      { name: 'Cache-Control', value: 'no-cache' },
      { name: 'Pragma', value: 'no-cache' },
    ],
  },
]

/** Individual headers offered in the quick-add menu and name autocomplete. */
export const HEADER_PRESETS: HeaderPreset[] = [
  { name: 'Content-Type', value: 'application/json' },
  { name: 'Content-Type', value: 'application/x-www-form-urlencoded' },
  { name: 'Content-Type', value: 'text/plain' },
  { name: 'Content-Type', value: 'application/xml' },
  { name: 'Accept', value: 'application/json' },
  { name: 'Accept', value: '*/*' },
  { name: 'Authorization', value: 'Bearer ${TOKEN}' },
  { name: 'Authorization', value: 'Basic ${BASIC_AUTH}' },
  { name: 'x-api-key', value: '${API_KEY}' },
  { name: 'Accept-Encoding', value: 'gzip, deflate, br' },
  { name: 'Accept-Language', value: 'en-US,en;q=0.9' },
  { name: 'Cache-Control', value: 'no-cache' },
  { name: 'User-Agent', value: 'curler/0.1' },
  { name: 'Cookie', value: '' },
  { name: 'Origin', value: '' },
  { name: 'Referer', value: '' },
  { name: 'If-None-Match', value: '' },
  { name: 'X-Request-Id', value: '' },
]

export const HEADER_NAMES: string[] = [
  ...new Set(HEADER_PRESETS.map((preset) => preset.name)),
]
