<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import CodeEditor from './CodeEditor.vue'
import { responseEditorLanguage } from '../lib/response'
import type { HttpResponse } from '../types'

const props = defineProps<{
  response: HttpResponse
  /** Pretty-printed or normalized text body for the editor. */
  displayBody: string
}>()

type SvgMode = 'text' | 'preview'

const svgMode = ref<SvgMode>('text')
const previewUrl = ref<string | null>(null)

const editorLanguage = computed(() => responseEditorLanguage(props.response))
const isSvg = computed(() => props.response.bodyPreview === 'svg')

const svgSource = computed(() => {
  if (!props.response.bodyBase64) return props.displayBody
  try {
    return props.displayBody || atob(props.response.bodyBase64)
  } catch {
    return props.displayBody
  }
})

function revokeObjectUrl() {
  if (previewUrl.value) {
    URL.revokeObjectURL(previewUrl.value)
    previewUrl.value = null
  }
}

function rebuildPreviewUrl() {
  revokeObjectUrl()
  const { bodyBase64, bodyMime, bodyPreview } = props.response
  if (!bodyBase64 || !bodyMime || !bodyPreview) return
  try {
    const binary = atob(bodyBase64)
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
    const blob = new Blob([bytes], { type: bodyMime })
    previewUrl.value = URL.createObjectURL(blob)
  } catch {
    previewUrl.value = null
  }
}

watch(
  () => props.response,
  () => {
    svgMode.value = 'text'
    rebuildPreviewUrl()
  },
  { immediate: true },
)

onBeforeUnmount(revokeObjectUrl)
</script>

<template>
  <div class="body-view">
    <p v-if="response.bodySkipped" class="placeholder faint">{{ response.body }}</p>

    <template v-else-if="response.bodyPreview && response.bodyBase64 && previewUrl">
      <div v-if="isSvg" class="svg-toolbar">
        <button
          class="ghost mode"
          :class="{ active: svgMode === 'text' }"
          type="button"
          @click="svgMode = 'text'"
        >
          Source
        </button>
        <button
          class="ghost mode"
          :class="{ active: svgMode === 'preview' }"
          type="button"
          @click="svgMode = 'preview'"
        >
          Preview
        </button>
      </div>

      <img
        v-if="response.bodyPreview === 'image' || (isSvg && svgMode === 'preview')"
        class="media image"
        :src="previewUrl"
        :alt="response.bodyMime ?? 'Response image'"
      />

      <video
        v-else-if="response.bodyPreview === 'video'"
        class="media video"
        :src="previewUrl"
        controls
        preload="metadata"
      />

      <audio
        v-else-if="response.bodyPreview === 'audio'"
        class="media audio"
        :src="previewUrl"
        controls
        preload="metadata"
      />

      <div v-if="isSvg && svgMode === 'text'" class="editor-wrap">
        <CodeEditor :model-value="svgSource" language="text" readonly />
      </div>
    </template>

    <p v-else-if="response.bodyIsBinary" class="placeholder faint">{{ response.body }}</p>
    <p v-else-if="!response.body" class="placeholder faint">Empty response body.</p>

    <div v-else class="editor-wrap">
      <CodeEditor :model-value="displayBody" :language="editorLanguage" readonly />
    </div>
  </div>
</template>

<style scoped>
.body-view {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.editor-wrap {
  flex: 1;
  min-height: 0;
}

.placeholder {
  padding: 32px;
  text-align: center;
}

.svg-toolbar {
  display: flex;
  gap: 4px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.mode {
  padding: 4px 10px;
  font-size: 12px;
}

.mode.active {
  background: var(--bg-hover);
  color: var(--text);
}

.media {
  display: block;
  max-width: 100%;
  margin: 16px auto;
}

.media.image {
  max-height: min(70vh, 640px);
  object-fit: contain;
}

.media.video {
  max-height: min(70vh, 480px);
  background: #000;
}

.media.audio {
  width: min(100%, 480px);
  padding: 16px;
}
</style>
