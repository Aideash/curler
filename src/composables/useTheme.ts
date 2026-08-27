import { computed, ref } from 'vue'
import { CONTRAST_LEVELS } from '../themes/contrast'
import { SYSTEM_PREFERENCE, getThemeById, getThemeList } from '../themes/definitions'
import {
  getContrastPreference,
  getResolvedThemeId,
  getThemePreference,
  onThemeChange,
  setContrastPreference,
  setThemePreference,
  type ContrastPreference,
  type ThemePreference,
} from '../themes/manager'

const preference = ref<ThemePreference>(getThemePreference())
const resolvedThemeId = ref(getResolvedThemeId())
const contrastPreference = ref<ContrastPreference>(getContrastPreference())

onThemeChange(() => {
  preference.value = getThemePreference()
  resolvedThemeId.value = getResolvedThemeId()
  contrastPreference.value = getContrastPreference()
})

export function useTheme() {
  return {
    preference,
    resolvedThemeId,
    contrastPreference,
    contrastLevels: CONTRAST_LEVELS,
    themes: getThemeList(),
    systemPreference: SYSTEM_PREFERENCE,
    isSystem: computed(() => preference.value === SYSTEM_PREFERENCE),
    isDark: computed(() => getThemeById(resolvedThemeId.value)?.colorScheme !== 'light'),
    setPreference: setThemePreference,
    setContrast: setContrastPreference,
  }
}
