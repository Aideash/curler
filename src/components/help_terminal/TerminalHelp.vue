<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import CategoryHelp from './CategoryHelp.vue'
import { CURL_HELP_CATEGORIES } from '../../lib/curlHelpData'
import { CURL_HELP_TIER_LEGEND } from '../../lib/curlOptionSupport'
import { helpSectionFromHash, navigate } from '../../composables/useRoute'

const pageOptions = [
  { key: '', label: '' },
  { key: 'category', label: 'category' },
  ...CURL_HELP_CATEGORIES.map((category) => ({
    key: category.name,
    label: category.name,
  })),
]

function pageKeyFromSection(section: string | null): string {
  if (!section?.startsWith('--help')) return ''
  return section.slice('--help/'.length)
}

function pageKeyFromHash(): string {
  return pageKeyFromSection(helpSectionFromHash())
}

const activePageKey = ref(pageKeyFromHash())

function onHashChange() {
  const next = pageKeyFromHash()
  if (next !== activePageKey.value) activePageKey.value = next
}

watch(activePageKey, (key) => {
  const wanted = key ? `--help/${key}` : '--help'
  if (helpSectionFromHash() !== wanted) navigate('help', wanted)
})

function copyActivePageToClipboard() {
  const command = activePageKey.value ? `curl --help ${activePageKey.value}` : 'curl --help'
  navigator.clipboard.writeText(command)
}

onMounted(() => window.addEventListener('hashchange', onHashChange))
onBeforeUnmount(() => window.removeEventListener('hashchange', onHashChange))
</script>

<template>
  <div class="faux-terminal mono">
    <p class="cmd-line">
      <span style="color: var(--syntax-comment)">$</span> curl --help
      <select v-model="activePageKey" aria-label="Curl help category">
        <option v-for="option in pageOptions" :key="option.key || 'main'" :value="option.key">
          {{ option.label }}
        </option>
      </select>
    </p>
    <CategoryHelp :page-key="activePageKey" />
    <p class="tier-legend faint">
      <span v-for="item in CURL_HELP_TIER_LEGEND" :key="item.tier" :class="`legend-${item.tier}`">
        {{ item.label }}
      </span>
    </p>
    <button
      class="ghost copy-button"
      title="Copy as curl"
      aria-label="Copy as curl"
      @click="copyActivePageToClipboard"
    >
      <span class="material-icons sm" aria-hidden="true">content_copy</span>
    </button>
  </div>
</template>

<style scoped>
.faux-terminal {
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: 4px;
  margin: 0 auto;
  padding: 12px 14px 0px 14px;
  font-size: 12px;
  line-height: 1.4;
  max-width: 850px;
  max-height: 500px;
  overflow: auto;
  position: relative;
}

.faux-terminal p {
  margin: 0;
}

.faux-terminal :deep(.cmd-line + .help-options),
.faux-terminal :deep(.help-options + .cmd-line),
.faux-terminal :deep(.cmd-line + .cmd-line) {
  margin-top: 0.35em;
}

.faux-terminal :deep(.help-options) {
  width: 100%;
  border-collapse: collapse;
  margin: 0;
  padding-left: 1ch;
}

.faux-terminal :deep(.help-options td) {
  padding: 0;
  border: none;
  vertical-align: top;
  text-align: left;
}

.faux-terminal :deep(.help-options td:nth-child(1)) {
  width: 1%;
  white-space: nowrap;
  padding-right: 1ch;
}

.faux-terminal :deep(.help-options td:nth-child(2)) {
  width: 1%;
  white-space: nowrap;
  padding-right: 2ch;
}

.cmd-line {
  display: block;
}

.faux-terminal .tier-legend {
  background: var(--bg-input);
  display: flex;
  flex-wrap: wrap;
  gap: 6px 14px;
  margin-top: 10px;
  padding-left: 1ch;
  padding-bottom: 2px;
  font-size: 11px;
  border-top: 1px solid var(--border);
  position: sticky;
  bottom: 0;
  z-index: 10;
}

.legend-send::before {
  content: '● ';
  color: var(--accent);
}

.legend-copy::before {
  content: '○ ';
  color: var(--text-dim);
}

.legend-none::before {
  content: '– ';
  color: var(--text-dim);
  opacity: 0.6;
}

.copy-button {
  position: absolute;
  top: 12px;
  right: 12px;
  padding: 0;
  margin: 0;
  width: 24px;
  height: 24px;
}

.copy-button:hover {
  background: var(--bg-input);
}
</style>
