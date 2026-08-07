export type SettingType = 'boolean' | 'number' | 'string'

export interface SettingDefaults {
  type: SettingType
  default: boolean | number | string
  userFacing: boolean
}

export const SETTINGS: Record<string, SettingDefaults>

export function getSetting(
  name: string,
  workspace?: { settings?: Record<string, unknown> },
): boolean | number | string
