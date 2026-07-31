import { computed, ref } from 'vue'
import { SYSTEM_PREFERENCE, getThemeById, getThemeList } from '../themes/definitions'
import {
  getResolvedThemeId,
  getThemePreference,
  onThemeChange,
  setThemePreference,
  type ThemePreference,
} from '../themes/manager'

const preference = ref<ThemePreference>(getThemePreference())
const resolvedThemeId = ref(getResolvedThemeId())

onThemeChange(() => {
  preference.value = getThemePreference()
  resolvedThemeId.value = getResolvedThemeId()
})

export function useTheme() {
  return {
    preference,
    resolvedThemeId,
    themes: getThemeList(),
    systemPreference: SYSTEM_PREFERENCE,
    isSystem: computed(() => preference.value === SYSTEM_PREFERENCE),
    isDark: computed(
      () => getThemeById(resolvedThemeId.value)?.colorScheme !== 'light',
    ),
    setPreference: setThemePreference,
  }
}
