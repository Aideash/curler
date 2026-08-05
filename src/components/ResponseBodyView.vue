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
const imageBackground = ref<'white' | 'black' | 'checkered'>('checkered')

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

      <div
        v-if="response.bodyPreview === 'image' || (isSvg && svgMode === 'preview')"
        class="image-toolbar"
      >
        <label for="image-background-select">Background: </label>
        <select id="image-background-select" v-model="imageBackground">
          <option value="white">White</option>
          <option value="black">Black</option>
          <option value="checkered">Checkered</option>
        </select>
      </div>

      <img
        v-if="response.bodyPreview === 'image' || (isSvg && svgMode === 'preview')"
        class="media image"
        :class="'image-background-' + imageBackground"
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

      <!-- <div
        v-if="response.bodyPreview === 'image' || (isSvg && svgMode === 'preview')"
        class="media image-preview"
      >
        <img class="image" :src="previewUrl" :alt="response.bodyMime ?? 'Response image'" />
      </div>

      <div v-else-if="response.bodyPreview === 'video'" class="media video-preview">
        <div class="video-preview-inner">
          <video class="video" :src="previewUrl" controls preload="metadata" />
        </div>
      </div> -->

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
    <!-- <div style="display: none">
      <svg xmlns="http://www.w3.org/2000/svg" version="1.1">
        <defs>
          <filter id="woodgrain">
            <feTurbulence
              id="turbulence"
              baseFrequency="0.01 0.1"
              numOctaves="1"
              result="noise"
              seed="1"
            />
            <feColorMatrix
              type="matrix"
              values="0.1 0.1 0.1 0.1 0
              0.1 0.1 0.1 0.1 0
              0.1 0.1 0.1 0.1 0
              0.2 0.2 0.2 0.4 0"
            />
          </filter>
          <filter id="steel">
            <feTurbulence
              id="turbulence"
              baseFrequency="0.008 0.4"
              numOctaves="3"
              result="noise"
              seed="1"
            />
            <feColorMatrix
              type="matrix"
              values="0.1 0.1 0.1 0.1 0
              0.1 0.1 0.1 0.1 0
              0.1 0.1 0.1 0.1 0
              0.1 0.1 0.1 0.2 0"
            />
          </filter>
        </defs>
      </svg>
    </div> -->
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
  max-height: min(calc(100% - 65px), 70vh, 640px);
  object-fit: contain;
}

.media.video {
  max-height: min(100%, 70vh, 480px);
  border-radius: 10px;
}

.media.image,
.media.video {
  border: 2px solid var(--border-strong);
  box-shadow: 0 0 30px 0px lch(from var(--bg) calc(100 - l) calc(2.5 * c) h / 0.5);
}

/* .media.image-preview {
  max-height: min(100%, 70vh, 640px);
  max-width: 100%;
  position: relative;
  padding: 30px;
  background-color: lch(from var(--bg) calc(60 - l / 10) calc(2.5 * c) h);
  overflow: hidden;
}

.media.image-preview:after {
  filter: url(#steel);
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  right: 0;
  content: ' ';
}

img.image {
  position: relative;
  z-index: 3;
  max-height: 100%;
  max-width: 100%;
  object-fit: contain;
}

.media.video-preview {
  max-height: min(100%, 70vh, 480px);
  background-color: var(--accent-dim);
  overflow: hidden;
  padding: 15px;
  border-radius: 10px;
  border: 2px solid var(--accent);
  position: relative;
}

.media.video-preview:after {
  filter: url(#woodgrain);
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  right: 0;
  content: ' ';
}

.video-preview-inner {
  max-height: 100%;
  max-width: 100%;
  aspect-ratio: 5 / 3;
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 1px;
  border-radius: 20% / 3%;
  border: 2px ridge black;
  background-color: black;
  overflow: hidden;
  position: relative;
  z-index: 3;
}

video.video {
  max-height: 100%;
  max-width: 100%;
  box-shadow: 0 0 30px 0px #fff8;
} */

.media.audio {
  width: min(100%, 480px);
  padding: 16px;
}

.image-toolbar {
  margin: 5px 0 0 5px;
  font-size: 12px;
}

.image-toolbar label {
  font-weight: 500;
  color: var(--text-dim);
}

.image-background-white {
  background-color: white;
}

.image-background-black {
  background-color: black;
}

.image-background-checkered {
  background: repeating-conic-gradient(#888 0 25%, #555 0 50%) 50% / 20px 20px;
  background: repeating-conic-gradient(
      lch(from var(--bg) calc((50 + l) / 2) c h) 0 25%,
      lch(from var(--bg) calc((100 + l) / 3) c h) 0 50%
    )
    50% / 20px 20px;
}
</style>
