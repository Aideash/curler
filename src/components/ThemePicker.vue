<script setup lang="ts">
import { computed } from 'vue'
import PopMenu from './PopMenu.vue'
import { useTheme } from '../composables/useTheme'
import { getThemeById } from '../themes/definitions'

const { preference, resolvedThemeId, themes, systemPreference, setPreference } = useTheme()

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
</script>

<template>
  <PopMenu icon="settings" title="Appearance" :width="272" align="right">
    <template #default="{ close }">
      <div class="theme-menu">
        <div class="theme-menu__heading">Theme</div>

        <button
          class="theme-option"
          :class="{ active: preference === systemPreference }"
          @click="
            () => {
              setPreference(systemPreference)
              close()
            }
          "
        >
          <span class="material-icons sm theme-option__glyph">brightness_auto</span>
          <span class="theme-option__text">
            <span class="theme-option__name">System default</span>
            <span class="theme-option__hint">{{ systemLabel }}</span>
          </span>
          <span v-if="preference === systemPreference" class="material-icons sm tick"> check </span>
        </button>

        <div class="theme-menu__rule" />

        <button
          v-for="theme in themes"
          :key="theme.id"
          class="theme-option"
          :class="{ active: preference === theme.id }"
          @click="
            () => {
              setPreference(theme.id)
              close()
            }
          "
        >
          <span class="theme-option__swatch" :style="swatch(theme.id)">Aa</span>
          <span class="theme-option__text">
            <span class="theme-option__name">{{ theme.name }}</span>
            <span class="theme-option__hint">{{ theme.description }}</span>
          </span>
          <span v-if="preference === theme.id" class="material-icons sm tick">check</span>
        </button>
      </div>
    </template>
  </PopMenu>
</template>

<style scoped>
.theme-menu__heading {
  padding: 6px 8px 4px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-faint);
}

.theme-menu__rule {
  height: 1px;
  margin: 4px 6px;
  background: var(--border);
}

.theme-option {
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

.theme-option:hover:not(:disabled) {
  background: var(--bg-hover);
  border-color: transparent;
}

.theme-option.active {
  background: var(--bg-hover);
}

.theme-option__glyph,
.theme-option__swatch {
  flex: none;
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: 5px;
  border: 1px solid var(--border-strong);
  vertical-align: 0;
}

.theme-option__swatch {
  font-family: var(--mono);
  font-size: 11px;
  font-weight: 600;
  border-style: solid;
}

.theme-option__text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.theme-option__name {
  font-size: 13px;
}

.theme-option__hint {
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
