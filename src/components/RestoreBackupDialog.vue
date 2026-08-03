<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import ModalShell from './ModalShell.vue'
import { listBackups, restoreBackup, type BackupEntry } from '../lib/backend'
import { reloadWorkspace, state } from '../lib/store'

const emit = defineEmits<{ close: [] }>()

const loading = ref(true)
const restoring = ref(false)
const error = ref<string | null>(null)
const backups = ref<BackupEntry[]>([])
const selected = ref<string | null>(null)

onMounted(async () => {
  try {
    backups.value = await listBackups()
    if (backups.value.length) selected.value = backups.value[0].name
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    loading.value = false
  }
})

function formatWhen(createdAt: string) {
  return new Date(createdAt).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

function describeBackup(backup: BackupEntry) {
  const parts: string[] = []
  if (backup.requestCount !== null) {
    const label = backup.requestCount === 1 ? 'request' : 'requests'
    parts.push(`${backup.requestCount} ${label}`)
  }
  if (backup.collectionCount !== null) {
    const label = backup.collectionCount === 1 ? 'collection' : 'collections'
    parts.push(`${backup.collectionCount} ${label}`)
  }
  if (backup.shrunk) parts.push('before requests were removed')
  return parts.join(' · ')
}

const canRestore = computed(
  () => selected.value && !loading.value && !restoring.value && state.persistable,
)

async function confirmRestore() {
  if (!selected.value || restoring.value) return
  restoring.value = true
  error.value = null
  try {
    await restoreBackup(selected.value)
    await reloadWorkspace()
    emit('close')
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    restoring.value = false
  }
}
</script>

<template>
  <ModalShell title="Restore from backup" width="520px" @close="emit('close')">
    <p class="intro faint">
      Pick a snapshot to replace your current workspace. Your current workspace is backed up first
      so you can restore again to undo.
    </p>

    <p v-if="error" class="error">{{ error }}</p>

    <p v-else-if="loading" class="faint">Loading backups…</p>

    <p v-else-if="!backups.length" class="faint">
      No backups yet. Snapshots are created automatically when your workspace changes.
    </p>

    <ul v-else class="backup-list" role="listbox" aria-label="Workspace backups">
      <li v-for="backup in backups" :key="backup.name">
        <button
          type="button"
          class="backup"
          :class="{ selected: selected === backup.name }"
          role="option"
          :aria-selected="selected === backup.name"
          @click="selected = backup.name"
        >
          <span class="when">{{ formatWhen(backup.createdAt) }}</span>
          <span class="detail faint">{{ describeBackup(backup) }}</span>
        </button>
      </li>
    </ul>

    <template #footer>
      <button @click="emit('close')">Cancel</button>
      <button class="primary" :disabled="!canRestore" @click="confirmRestore">
        {{ restoring ? 'Restoring…' : 'Restore' }}
      </button>
    </template>
  </ModalShell>
</template>

<style scoped>
.intro {
  margin: 0 0 14px;
  font-size: 13px;
  line-height: 1.45;
}

.error {
  margin: 0;
  color: var(--danger);
  font-size: 13px;
}

.backup-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: min(52vh, 420px);
  overflow: auto;
}

.backup {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg);
  color: var(--text);
  text-align: left;
  cursor: pointer;
}

.backup:hover {
  background: var(--bg-hover);
}

.backup.selected {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 8%, var(--bg));
}

.when {
  font-size: 13px;
  font-weight: 500;
}

.detail {
  font-size: 12px;
  line-height: 1.35;
}
</style>
