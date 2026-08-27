import { getSetting as getSettingRaw, SETTINGS } from '../../settings.defaults.mjs'
import type { Setting, SettingName, SettingValue, UserSetting, Workspace } from '../types'

const SETTING_META: Record<
  SettingName,
  Pick<Setting, 'title' | 'description'> & { type: Setting['type'] }
> = {
  showRequestEditIcons: {
    type: 'boolean',
    title: 'Show request edit icons',
    description:
      'Include a button next to requests in the Sidebar to edit their names (double-click will work either way).',
  },
  showCollectionEditIcons: {
    type: 'boolean',
    title: 'Show collection edit icons',
    description:
      'Include a button next to collections in the Sidebar to edit their names (double-click will work either way).',
  },
  themePreference: {
    type: 'string',
    title: 'Theme',
    description: 'Color theme on load: a built-in theme id, or "system" to follow the OS.',
  },
  contrastPreference: {
    type: 'string',
    title: 'Contrast',
    description: 'Chrome contrast on load: "high", "medium", or "low".',
  },
  sidebarCollapsed: {
    type: 'boolean',
    title: 'Sidebar collapsed',
    description: 'Whether the collections rail starts collapsed on load.',
  },
  graphqlArgInsertMode: {
    type: 'string',
    title: 'GraphQL arg insert mode',
    description:
      'How argument values are written when inserting fields from the schema explorer: "placeholder", "required-vars", or "variables-only".',
  },
  graphqlSchemaSort: {
    type: 'string',
    title: 'GraphQL schema sort',
    description: 'Field order in the schema explorer on load: "schema" or "alphabetical".',
  },
  defaultTimeoutSecs: {
    type: 'number',
    title: 'Default request timeout',
    description: 'Timeout in seconds for newly created requests (equivalent to curl -m).',
  },
  defaultFollowRedirects: {
    type: 'boolean',
    title: 'Default follow redirects',
    description: 'Whether new requests follow HTTP redirects (equivalent to curl -L).',
  },
  defaultInsecure: {
    type: 'boolean',
    title: 'Default skip TLS verification',
    description: 'Whether new requests skip TLS certificate verification (equivalent to curl -k).',
  },
  defaultMaxResponseMb: {
    type: 'number',
    title: 'Default response size cap',
    description: 'Maximum response body size in MB for newly created requests.',
  },
  defaultHttpMethod: {
    type: 'string',
    title: 'Default HTTP method',
    description: 'HTTP method assigned to newly created requests.',
  },
  defaultRequestName: {
    type: 'string',
    title: 'Default request name',
    description: 'Placeholder name for newly created requests.',
  },
  defaultUserAgent: {
    type: 'string',
    title: 'Default User-Agent',
    description: 'User-Agent header sent when a request does not define one.',
  },
  multipartFilePicker: {
    type: 'boolean',
    title: 'Multipart file picker',
    description: 'Show the attach button on multipart form parts to pick files from disk.',
  },
  variableNotesScopes: {
    type: 'string',
    title: 'Variable notes',
    description: 'Which variable scopes can carry short notes under each row.',
  },
  compareNormalizeJson: {
    type: 'boolean',
    title: 'Compare: normalize JSON',
    description: 'Sort JSON object keys before comparing response bodies.',
  },
  compareShowDiff: {
    type: 'boolean',
    title: 'Compare: show diff',
    description: 'Open the compare view with the unified diff panel visible.',
  },
  compareDifferencesOnly: {
    type: 'boolean',
    title: 'Compare: differences only',
    description: 'On the headers and meta tabs, hide rows that match across lanes.',
  },
  compareActiveTab: {
    type: 'string',
    title: 'Compare: active tab',
    description: 'Which compare tab is selected on load: "body", "headers", or "meta".',
  },
  graphqlShowArgs: {
    type: 'boolean',
    title: 'GraphQL explorer: show arguments',
    description: 'Whether the schema explorer starts with field arguments visible.',
  },
  requestDetailsExpanded: {
    type: 'boolean',
    title: 'Request details expanded',
    description: 'Whether the headers, body, and options sections start expanded.',
  },
  defaultCurlCopyMode: {
    type: 'string',
    title: 'Default copy-as-curl mode',
    description:
      'Preferred "Copy as curl" variant on load: "ready" (substituted), "shareable" (placeholders), or "general" (raw).',
  },
  autosaveDebounceMs: {
    type: 'number',
    title: 'Autosave debounce',
    description: 'Milliseconds to wait after a workspace edit before writing to disk.',
  },
  secretSaveDebounceMs: {
    type: 'number',
    title: 'Secret save debounce',
    description:
      'Milliseconds to wait after editing a secret variable before writing to the keychain.',
  },
  workspaceBackupIntervalMs: {
    type: 'number',
    title: 'Workspace backup interval',
    description: 'Minimum milliseconds between automatic workspace snapshots.',
  },
  workspaceBackupsRetained: {
    type: 'number',
    title: 'Workspace backups retained',
    description: 'Maximum number of workspace backup files to keep.',
  },
  compareMaxLanes: {
    type: 'number',
    title: 'Compare lane limit',
    description: 'Maximum number of lanes in the compare view.',
  },
  diffMaxChars: {
    type: 'number',
    title: 'Diff size limit (characters)',
    description: 'Maximum combined character count of two bodies before diffing is refused.',
  },
  diffMaxCells: {
    type: 'number',
    title: 'Diff size limit (cells)',
    description: 'Maximum Myers diff cell count before the algorithm bails out.',
  },
  mediaPreviewMaxMb: {
    type: 'number',
    title: 'Media preview cap',
    description: 'Maximum size in MB for inline image and media previews in responses.',
  },
  toastDurationSuccessMs: {
    type: 'number',
    title: 'Success toast duration',
    description: 'Milliseconds before a success toast dismisses itself.',
  },
  toastDurationErrorMs: {
    type: 'number',
    title: 'Error toast duration',
    description: 'Milliseconds before an error toast dismisses itself.',
  },
  copiedFeedbackDurationMs: {
    type: 'number',
    title: 'Copied feedback duration',
    description: 'Milliseconds the "Copied" indicator stays visible after copying text.',
  },
  maxRedirects: {
    type: 'number',
    title: 'Maximum redirects',
    description: 'How many HTTP redirects the client will follow before giving up.',
  },
  requestTimeoutMaxSecs: {
    type: 'number',
    title: 'Request timeout ceiling',
    description: 'Upper bound in seconds for the per-request timeout option.',
  },
  requestMaxResponseMbMax: {
    type: 'number',
    title: 'Response size cap ceiling',
    description: 'Upper bound in MB for the per-request response size cap.',
  },
}

/**
 * Canonical defaults for every tunable value. Settings marked user-facing will
 * eventually appear in a preferences UI; the rest stay internal until promoted.
 *
 * Page-load defaults (sidebar, compare toggles, GraphQL explorer state, etc.)
 * seed the initial UI on open. Changing them in the app updates active session
 * state only — not these defaults — unless the user edits them in settings.
 */
export const defaultSettings: Setting[] = (Object.keys(SETTINGS) as SettingName[]).map((name) => {
  const { default: defaultValue, userFacing } = SETTINGS[name]
  const meta = SETTING_META[name]
  return {
    name,
    type: meta.type,
    default: defaultValue as SettingValue,
    userFacing,
    title: meta.title,
    description: meta.description,
  }
})

export const defaultUserSettings: UserSetting = Object.fromEntries(
  defaultSettings.map((setting) => [setting.name, setting.default]),
) as UserSetting

export function emptyWorkspace(): Workspace {
  return {
    collections: [],
    environments: [],
    activeEnvironmentId: null,
    globals: [],
  }
}

export function getSetting(name: SettingName, workspace: Workspace): SettingValue {
  return getSettingRaw(name, workspace) as SettingValue
}

export function getSettingBoolean(name: SettingName, workspace: Workspace): boolean {
  const value = getSetting(name, workspace)
  if (typeof value !== 'boolean') throw new Error(`Setting ${name} is not a boolean`)
  return value
}

export function getSettingNumber(name: SettingName, workspace: Workspace): number {
  const value = getSetting(name, workspace)
  if (typeof value !== 'number') throw new Error(`Setting ${name} is not a number`)
  return value
}

export function getSettingString(name: SettingName, workspace: Workspace): string {
  const value = getSetting(name, workspace)
  if (typeof value !== 'string') throw new Error(`Setting ${name} is not a string`)
  return value
}

function isValidValue(setting: Setting, value: SettingValue): boolean {
  if (setting.type === 'boolean') return typeof value === 'boolean'
  if (setting.type === 'number') return typeof value === 'number'
  if (setting.type === 'string') return typeof value === 'string'
  return false
}

export function updateSetting(
  name: SettingName,
  value: SettingValue,
  workspace: Workspace,
): Workspace {
  const setting = defaultSettings.find((item) => item.name === name)
  if (!setting) return workspace
  if (!setting.userFacing) return workspace
  if (!isValidValue(setting, value)) return workspace

  if (!workspace.settings) workspace.settings = {} as UserSetting

  return {
    ...workspace,
    settings: { ...workspace.settings, [name]: value },
  }
}

export function getUserFacingSettings(): Setting[] {
  return defaultSettings.filter((setting) => setting.userFacing)
}

/** Labels for string settings that are really enums. */
export const SETTING_STRING_OPTIONS: Partial<
  Record<SettingName, readonly { value: string; label: string }[]>
> = {
  themePreference: [{ value: 'system', label: 'System default' }],
  contrastPreference: [
    { value: 'high', label: 'High' },
    { value: 'medium', label: 'Medium' },
    { value: 'low', label: 'Low' },
  ],
  graphqlArgInsertMode: [
    { value: 'placeholder', label: 'Placeholder' },
    { value: 'required-vars', label: 'Required variables' },
    { value: 'variables-only', label: 'Variables only' },
  ],
  graphqlSchemaSort: [
    { value: 'schema', label: 'Schema order' },
    { value: 'alphabetical', label: 'Alphabetical' },
  ],
  compareActiveTab: [
    { value: 'body', label: 'Body' },
    { value: 'headers', label: 'Headers' },
    { value: 'meta', label: 'Meta' },
  ],
  defaultCurlCopyMode: [
    { value: 'ready', label: 'Ready to run' },
    { value: 'shareable', label: 'Shareable' },
    { value: 'general', label: 'General' },
  ],
  variableNotesScopes: [
    { value: 'request', label: 'Request only' },
    { value: 'all', label: 'All scopes' },
  ],
}

export const SETTING_GROUPS: { title: string; names: SettingName[] }[] = [
  {
    title: 'Sidebar & UI',
    names: [
      'showRequestEditIcons',
      'showCollectionEditIcons',
      'sidebarCollapsed',
      'requestDetailsExpanded',
      'multipartFilePicker',
      'variableNotesScopes',
    ],
  },
  {
    title: 'GraphQL',
    names: ['graphqlArgInsertMode', 'graphqlSchemaSort', 'graphqlShowArgs'],
  },
  {
    title: 'New request defaults',
    names: [
      'defaultHttpMethod',
      'defaultRequestName',
      'defaultTimeoutSecs',
      'defaultFollowRedirects',
      'defaultInsecure',
      'defaultMaxResponseMb',
      'defaultUserAgent',
    ],
  },
  {
    title: 'Compare view',
    names: [
      'compareNormalizeJson',
      'compareShowDiff',
      'compareDifferencesOnly',
      'compareActiveTab',
      'compareMaxLanes',
    ],
  },
  { title: 'Copy as curl', names: ['defaultCurlCopyMode'] },
  {
    title: 'Timing & feedback',
    names: [
      'autosaveDebounceMs',
      'secretSaveDebounceMs',
      'toastDurationSuccessMs',
      'toastDurationErrorMs',
      'copiedFeedbackDurationMs',
    ],
  },
  {
    title: 'Workspace & backups',
    names: ['workspaceBackupIntervalMs', 'workspaceBackupsRetained'],
  },
  {
    title: 'Diff & media',
    names: ['diffMaxChars', 'diffMaxCells', 'mediaPreviewMaxMb'],
  },
  {
    title: 'Request limits',
    names: ['maxRedirects', 'requestTimeoutMaxSecs', 'requestMaxResponseMbMax'],
  },
]

export function effectiveSettingValue(name: SettingName, workspace: Workspace): SettingValue {
  return getSetting(name, workspace)
}

/** Persist only values that differ from the built-in default. */
export function buildSettingsOverrides(values: Partial<UserSetting>): Partial<UserSetting> {
  const overrides: Partial<UserSetting> = {}
  for (const setting of defaultSettings) {
    const value = values[setting.name]
    if (value === undefined) continue
    if (!isValidValue(setting, value)) continue
    if (value !== setting.default) overrides[setting.name] = value
  }
  return overrides
}
