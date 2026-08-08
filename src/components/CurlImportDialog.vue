<script setup lang="ts">
import { computed, ref } from 'vue'
import ModalShell from './ModalShell.vue'
import { parseCurl, type ParsedCurl } from '../lib/curl'
import {
  curlHelpCommandLabel,
  curlHelpHashForCategory,
  isKnownCurlHelpCategory,
} from '../lib/curlHelpNav'
import { newRequest } from '../lib/store'
import { navigate } from '../composables/useRoute'
import type { RequestModel } from '../types'

const emit = defineEmits<{ close: []; imported: [request: RequestModel] }>()

const text = ref('')

const preview = computed((): ParsedCurl | null => {
  if (!text.value.trim()) return null
  try {
    return parseCurl(text.value)
  } catch (error) {
    return {
      request: newRequest({ name: 'Import error', url: '' }),
      warnings: [error instanceof Error ? error.message : String(error)],
    }
  }
})

const helpDestination = computed(() => {
  const category = preview.value?.helpCategory
  const known = category ? isKnownCurlHelpCategory(category) : true
  return {
    command: curlHelpCommandLabel(known ? category : undefined),
    hash: curlHelpHashForCategory(category),
    unknownCategory: category && !known ? category : null,
  }
})

function confirm() {
  const parsed = preview.value
  if (parsed?.request) emit('imported', parsed.request)
}

function viewHelp() {
  navigate('help', helpDestination.value.hash)
  emit('close')
}
</script>

<template>
  <ModalShell title="Import a curl command" width="700px" @close="emit('close')">
    <textarea
      id="curl-import"
      v-model="text"
      class="mono input"
      rows="8"
      spellcheck="false"
      placeholder="curl -X POST 'https://api.example.com/v1/things' \
  -H 'Content-Type: application/json' \
  -H 'x-api-key: $API_KEY' \
  -d '{&quot;name&quot;: &quot;widget&quot;}'"
    />

    <p class="hint faint">
      Shell variables such as <code>$API_KEY</code> are kept as curler variables, so they resolve
      from the active environment instead of being expanded now.
    </p>

    <div v-if="preview?.redirectToHelp" class="preview help-preview">
      <p class="faint">
        Not an HTTP request — opens
        <code class="mono">{{ helpDestination.command }}</code
        >.
      </p>
      <p v-if="helpDestination.unknownCategory" class="unknown-category faint">
        Unknown help category “{{ helpDestination.unknownCategory }}” — opening main help instead.
      </p>
    </div>

    <div v-else-if="preview?.request" class="preview">
      <div class="row">
        <span class="label faint">Method</span>
        <span class="mono">{{ preview.request.method }}</span>
      </div>
      <div class="row">
        <span class="label faint">URL</span>
        <span class="mono break">{{ preview.request.url || '—' }}</span>
      </div>
      <div class="row">
        <span class="label faint">Headers</span>
        <span class="mono">
          {{ preview.request.headers.filter((h) => h.name).length || 'none' }}
        </span>
      </div>
      <div class="row">
        <span class="label faint">Body</span>
        <span class="mono">{{ preview.request.body.mode }}</span>
      </div>
    </div>

    <ul v-if="preview?.warnings.length && !preview?.redirectToHelp" class="warnings">
      <li v-for="(warning, index) in preview.warnings" :key="index">{{ warning }}</li>
    </ul>

    <template #footer>
      <button @click="emit('close')">Cancel</button>
      <button v-if="preview?.redirectToHelp" class="primary" @click="viewHelp">View help</button>
      <button v-else class="primary" :disabled="!preview?.request?.url" @click="confirm">
        Import
      </button>
    </template>
  </ModalShell>
</template>

<style scoped>
.input {
  width: 100%;
  resize: vertical;
  line-height: 1.6;
}

.hint {
  font-size: 12px;
  margin: 10px 0 0;
  line-height: 1.5;
}

.hint code {
  font-family: var(--mono);
  color: var(--text-dim);
}

.preview {
  margin-top: 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 10px 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.help-preview p {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.5;
}

.help-preview code.mono {
  font-size: 12px;
}

.unknown-category {
  margin-top: 8px !important;
  color: var(--amber);
}

.row {
  display: grid;
  grid-template-columns: 72px 1fr;
  gap: 12px;
  font-size: 12.5px;
}

.label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding-top: 1px;
}

.break {
  word-break: break-all;
}

.warnings {
  margin: 12px 0 0;
  padding-left: 18px;
  color: var(--amber);
  font-size: 12px;
  line-height: 1.6;
}
</style>
