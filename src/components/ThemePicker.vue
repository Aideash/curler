<script setup lang="ts">
import { computed, ref } from 'vue'
import PopMenu from './PopMenu.vue'
import SettingsDialog from './SettingsDialog.vue'
import { pickContrast, pickTheme } from '../lib/store'
import { useTheme } from '../composables/useTheme'
import { getThemeById } from '../themes/definitions'
import type { ContrastPreference } from '../themes/contrast'

const {
  preference,
  resolvedThemeId,
  contrastPreference,
  contrastLevels,
  themes,
  systemPreference,
} = useTheme()

const contrastCopy: Record<ContrastPreference, { name: string; hint: string; icon: string }> = {
  high: { name: 'High', hint: 'Stronger chrome and comments', icon: 'contrast' },
  medium: { name: 'Medium', hint: 'Theme default', icon: 'tonality' },
  low: { name: 'Low', hint: 'Softer labels', icon: 'brightness_low' },
}

const siteSettingsOpen = ref(false)

const systemLabel = computed(() => {
  const active = getThemeById(resolvedThemeId.value)
  return active ? `Following your OS: ${active.name}` : 'Follow your OS'
})

/** A miniature of the theme, so the list reads at a glance. */
function swatch(id: string) {
  const tokens = getThemeById(id)?.tokens ?? {}
  return {
    background: tokens.bg,
    borderColor: tokens['border-strong'],
    color: tokens.accent,
  }
}

function openSiteSettings(closeMenu: () => void) {
  closeMenu()
  siteSettingsOpen.value = true
}
</script>

<template>
  <PopMenu icon="settings" title="Settings" :width="272" align="right">
    <template #default="{ close }">
      <div class="settings-menu">
        <button class="menu-option" @click="openSiteSettings(close)">
          <span class="material-icons sm menu-option__glyph" aria-hidden="true">tune</span>
          <span class="menu-option__text">
            <span class="menu-option__name">Site settings</span>
            <span class="menu-option__hint">Defaults, limits, and behaviour</span>
          </span>
        </button>

        <div class="menu-rule" />

        <div class="menu-heading">Theme</div>

        <button
          class="menu-option"
          :class="{ active: preference === systemPreference }"
          @click="
            () => {
              pickTheme(systemPreference)
              close()
            }
          "
        >
          <span class="material-icons sm menu-option__glyph" aria-hidden="true"
            >brightness_auto</span
          >
          <span class="menu-option__text">
            <span class="menu-option__name">System default</span>
            <span class="menu-option__hint">{{ systemLabel }}</span>
          </span>
          <span
            v-if="preference === systemPreference"
            class="material-icons sm tick"
            aria-hidden="true"
          >
            check
          </span>
        </button>

        <div class="menu-rule" />

        <button
          v-for="theme in themes"
          :key="theme.id"
          class="menu-option"
          :class="{ active: preference === theme.id }"
          @click="
            () => {
              pickTheme(theme.id)
              close()
            }
          "
        >
          <span class="menu-option__swatch" :style="swatch(theme.id)">Aa</span>
          <span class="menu-option__text">
            <span class="menu-option__name">{{ theme.name }}</span>
            <span class="menu-option__hint">{{ theme.description }}</span>
          </span>
          <span v-if="preference === theme.id" class="material-icons sm tick" aria-hidden="true"
            >check</span
          >
        </button>

        <div class="menu-rule" />

        <div class="menu-heading">Contrast</div>

        <button
          v-for="level in contrastLevels"
          :key="level"
          class="menu-option"
          :class="{ active: contrastPreference === level }"
          @click="pickContrast(level)"
        >
          <span class="material-icons sm menu-option__glyph" aria-hidden="true">{{
            contrastCopy[level].icon
          }}</span>
          <span class="menu-option__text">
            <span class="menu-option__name">{{ contrastCopy[level].name }}</span>
            <span class="menu-option__hint">{{ contrastCopy[level].hint }}</span>
          </span>
          <span
            v-if="contrastPreference === level"
            class="material-icons sm tick"
            aria-hidden="true"
          >
            check
          </span>
        </button>
      </div>
    </template>
  </PopMenu>

  <SettingsDialog v-if="siteSettingsOpen" @close="siteSettingsOpen = false" />
</template>

<style scoped>
.menu-heading {
  padding: 6px 8px 4px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-faint);
}

.menu-rule {
  height: 1px;
  margin: 4px 6px;
  background: var(--border);
}

.menu-option {
  display: flex;
  align-items: center;
  gap: 9px;
  width: 100%;
  padding: 6px 8px;
  text-align: left;
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius);
}

.menu-option:hover:not(:disabled) {
  background: var(--bg-hover);
  border-color: transparent;
}

.menu-option.active {
  background: var(--bg-hover);
}

.menu-option__glyph,
.menu-option__swatch {
  flex: none;
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: 5px;
  border: 1px solid var(--border-strong);
  vertical-align: 0;
}

.menu-option__swatch {
  font-family: var(--mono);
  font-size: 11px;
  font-weight: 600;
  border-style: solid;
}

.menu-option__text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.menu-option__name {
  font-size: 13px;
}

.menu-option__hint {
  font-size: 11px;
  color: var(--text-faint);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tick {
  flex: none;
  color: var(--accent);
  vertical-align: 0;
}
</style>
