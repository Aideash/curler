/**
 * Default values and user-facing flags for every setting. Metadata (title,
 * description) lives in src/lib/settings.ts. Shared by the API server and the
 * UI so neither side drifts.
 */

/** @typedef {'boolean' | 'number' | 'string'} SettingType */

/** @type {Record<string, { type: SettingType, default: boolean | number | string, userFacing: boolean }>} */
export const SETTINGS = {
  showRequestEditIcons: { type: 'boolean', default: false, userFacing: true },
  showCollectionEditIcons: { type: 'boolean', default: false, userFacing: true },
  themePreference: { type: 'string', default: 'system', userFacing: true },
  sidebarCollapsed: { type: 'boolean', default: false, userFacing: true },
  graphqlArgInsertMode: { type: 'string', default: 'required-vars', userFacing: true },
  graphqlSchemaSort: { type: 'string', default: 'schema', userFacing: true },

  defaultTimeoutSecs: { type: 'number', default: 30, userFacing: true },
  defaultFollowRedirects: { type: 'boolean', default: true, userFacing: true },
  defaultInsecure: { type: 'boolean', default: false, userFacing: true },
  defaultMaxResponseMb: { type: 'number', default: 1, userFacing: true },
  defaultHttpMethod: { type: 'string', default: 'GET', userFacing: true },
  defaultRequestName: { type: 'string', default: 'Untitled request', userFacing: true },
  defaultUserAgent: { type: 'string', default: 'curler/0.1', userFacing: true },
  multipartFilePicker: { type: 'boolean', default: false, userFacing: true },
  variableNotesScopes: { type: 'string', default: 'request', userFacing: true },

  compareNormalizeJson: { type: 'boolean', default: true, userFacing: true },
  compareShowDiff: { type: 'boolean', default: false, userFacing: true },
  compareDifferencesOnly: { type: 'boolean', default: false, userFacing: true },
  compareActiveTab: { type: 'string', default: 'body', userFacing: true },
  graphqlShowArgs: { type: 'boolean', default: false, userFacing: true },
  requestDetailsExpanded: { type: 'boolean', default: true, userFacing: true },
  defaultCurlCopyMode: { type: 'string', default: 'shareable', userFacing: true },

  autosaveDebounceMs: { type: 'number', default: 400, userFacing: true },
  secretSaveDebounceMs: { type: 'number', default: 400, userFacing: true },
  workspaceBackupIntervalMs: { type: 'number', default: 5 * 60 * 1000, userFacing: true },
  workspaceBackupsRetained: { type: 'number', default: 40, userFacing: true },
  compareMaxLanes: { type: 'number', default: 4, userFacing: true },
  diffMaxChars: { type: 'number', default: 1_000_000, userFacing: true },
  diffMaxCells: { type: 'number', default: 4_000_000, userFacing: true },
  mediaPreviewMaxMb: { type: 'number', default: 5, userFacing: true },
  toastDurationSuccessMs: { type: 'number', default: 2200, userFacing: true },
  toastDurationErrorMs: { type: 'number', default: 6000, userFacing: true },
  copiedFeedbackDurationMs: { type: 'number', default: 1600, userFacing: true },

  maxRedirects: { type: 'number', default: 10, userFacing: true },
  requestTimeoutMaxSecs: { type: 'number', default: 600, userFacing: true },
  requestMaxResponseMbMax: { type: 'number', default: 2048, userFacing: true },
}

/**
 * @param {string} name
 * @param {{ settings?: Record<string, unknown> }} [workspace]
 */
export function getSetting(name, workspace = {}) {
  const setting = SETTINGS[name]
  if (!setting) throw new Error(`Setting not found: ${name}`)
  if (!setting.userFacing) return setting.default
  return workspace.settings?.[name] ?? setting.default
}
