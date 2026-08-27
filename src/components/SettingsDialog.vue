<script setup lang="ts">
import { reactive } from 'vue'
import ModalShell from './ModalShell.vue'
import { HTTP_METHODS } from '../types'
import {
  SETTING_GROUPS,
  SETTING_STRING_OPTIONS,
  defaultSettings,
  defaultUserSettings,
} from '../lib/settings'
import { applyWorkspaceSettings, readEffectiveSettings } from '../lib/store'
import { getContrastPreference, getThemePreference } from '../themes/manager'
import type { Setting, SettingName, SettingValue } from '../types'

const emit = defineEmits<{ close: [] }>()

const settingsByName = Object.fromEntries(defaultSettings.map((s) => [s.name, s])) as Record<
  SettingName,
  Setting
>

const draft = reactive<Partial<Record<SettingName, SettingValue>>>({
  ...readEffectiveSettings(),
})

function stringOptions(setting: Setting): { value: string; label: string }[] {
  if (setting.name === 'defaultHttpMethod') {
    return HTTP_METHODS.map((method) => ({ value: method, label: method }))
  }
  return [...(SETTING_STRING_OPTIONS[setting.name] ?? [])]
}

function save() {
  const { themePreference: _theme, contrastPreference: _contrast, ...values } = draft
  applyWorkspaceSettings({
    ...values,
    themePreference: getThemePreference(),
    contrastPreference: getContrastPreference(),
  })
  emit('close')
}

function resetAll() {
  for (const setting of defaultSettings) {
    if (setting.name === 'themePreference' || setting.name === 'contrastPreference') continue
    draft[setting.name] = defaultUserSettings[setting.name]
  }
}
</script>

<template>
  <ModalShell title="Site settings" width="760px" @close="emit('close')">
    <p class="lead">
      Values are saved with your workspace. Some only apply on the next page load or when you create
      a new request. Theme and contrast are changed from the gear menu.
    </p>

    <div class="groups">
      <section v-for="group in SETTING_GROUPS" :key="group.title" class="group">
        <h3 class="group-title">{{ group.title }}</h3>
        <ul class="fields">
          <li v-for="name in group.names" :key="name" class="field">
            <template v-if="settingsByName[name]">
              <label class="field-label" :for="`setting-${name}`">
                <span class="field-name">{{ settingsByName[name].title ?? name }}</span>
                <span v-if="settingsByName[name].description" class="field-hint">
                  {{ settingsByName[name].description }}
                </span>
              </label>

              <input
                v-if="settingsByName[name].type === 'boolean'"
                :id="`setting-${name}`"
                v-model="draft[name]"
                type="checkbox"
                class="checkbox"
              />

              <input
                v-else-if="settingsByName[name].type === 'number'"
                :id="`setting-${name}`"
                v-model.number="draft[name]"
                type="number"
                class="number"
              />

              <select
                v-else-if="stringOptions(settingsByName[name]).length"
                :id="`setting-${name}`"
                v-model="draft[name]"
                class="select"
              >
                <option
                  v-for="option in stringOptions(settingsByName[name])"
                  :key="option.value"
                  :value="option.value"
                >
                  {{ option.label }}
                </option>
              </select>

              <input
                v-else
                :id="`setting-${name}`"
                v-model="draft[name]"
                type="text"
                class="text"
              />
            </template>
          </li>
        </ul>
      </section>
    </div>

    <template #footer>
      <button type="button" class="ghost" @click="resetAll">Reset all to defaults</button>
      <button type="button" class="ghost" @click="emit('close')">Cancel</button>
      <button type="button" class="primary" @click="save">Save</button>
    </template>
  </ModalShell>
</template>

<style scoped>
.lead {
  margin: 0 0 18px;
  font-size: 13px;
  color: var(--text-faint);
  line-height: 1.45;
}

.groups {
  display: flex;
  flex-direction: column;
  gap: 22px;
}

.group-title {
  margin: 0 0 10px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-faint);
}

.fields {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.field {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px 16px;
  align-items: start;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg);
}

.field-label {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  cursor: pointer;
}

.field-name {
  font-size: 13px;
  font-weight: 500;
}

.field-hint {
  font-size: 11px;
  color: var(--text-faint);
  line-height: 1.35;
}

.checkbox {
  margin-top: 2px;
  justify-self: end;
}

.number,
.text,
.select {
  width: min(220px, 100%);
  justify-self: end;
  font: inherit;
  font-size: 13px;
  padding: 6px 8px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  background: var(--bg-raised);
  color: inherit;
}

.number {
  font-family: var(--mono);
}

.select {
  max-width: 220px;
}
</style>
