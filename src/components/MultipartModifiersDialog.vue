<script setup lang="ts">
import { ref } from 'vue'
import ModalShell from './ModalShell.vue'

const props = defineProps<{
  partName: string
  contentType: string
  filename: string
}>()

const emit = defineEmits<{
  close: []
  save: [values: { contentType?: string; filename?: string }]
}>()

const draftContentType = ref(props.contentType)
const draftFilename = ref(props.filename)

function save() {
  emit('save', {
    contentType: draftContentType.value.trim() || undefined,
    filename: draftFilename.value.trim() || undefined,
  })
}
</script>

<template>
  <ModalShell
    :title="partName.trim() ? `Part modifiers — ${partName.trim()}` : 'Part modifiers'"
    width="480px"
    @close="emit('close')"
  >
    <p class="hint faint">
      curl <code>-F</code> modifiers appended after the part value. They affect the wire format on
      send and Copy as curl.
    </p>

    <label class="field" for="multipart-modifier-type">
      <span class="label">Content-Type</span>
      <span class="field-hint"><code>;type=</code> — MIME type for this part</span>
      <input
        id="multipart-modifier-type"
        v-model="draftContentType"
        type="text"
        class="mono input"
        spellcheck="false"
        placeholder="e.g. image/jpeg"
      />
    </label>

    <label class="field" for="multipart-modifier-filename">
      <span class="label">Filename</span>
      <span class="field-hint"><code>;filename=</code> — name in Content-Disposition</span>
      <input
        id="multipart-modifier-filename"
        v-model="draftFilename"
        type="text"
        class="mono input"
        spellcheck="false"
        placeholder="e.g. photo.jpg"
      />
    </label>

    <template #footer>
      <button type="button" @click="emit('close')">Cancel</button>
      <button type="button" class="primary" @click="save">Save</button>
    </template>
  </ModalShell>
</template>

<style scoped>
.hint {
  margin: 0 0 16px;
  font-size: 12px;
  line-height: 1.5;
}

.hint code {
  font-family: var(--mono);
  color: var(--text-dim);
}

.field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 14px;
}

.field:last-child {
  margin-bottom: 0;
}

.label {
  font-size: 12px;
  font-weight: 600;
}

.field-hint {
  font-size: 11.5px;
  color: var(--text-faint);
  line-height: 1.4;
}

.field-hint code {
  font-family: var(--mono);
  color: var(--text-dim);
}

.input {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--bg-input);
  color: var(--text);
  font-size: 13px;
}
</style>
