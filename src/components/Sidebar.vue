<script setup lang="ts">
import { ref } from 'vue'
import {
  addCollection,
  deleteCollection,
  deleteRequest,
  duplicateRequest,
  newScratchRequest,
  renameCollection,
  renameRequest,
  selectRequest,
  state,
} from '../lib/store'
import type { EditableScope } from '../types'

const emit = defineEmits<{ manageVariables: [scope?: EditableScope] }>()

const collapsed = ref(new Set<string>())
const renamingId = ref<string | null>(null)
const renameValue = ref('')

const RAIL_KEY = 'curler.sidebar-collapsed'
const railed = ref(readRailed())

function readRailed(): boolean {
  try {
    return localStorage.getItem(RAIL_KEY) === '1'
  } catch {
    return false
  }
}

function toggleRail() {
  railed.value = !railed.value
  try {
    localStorage.setItem(RAIL_KEY, railed.value ? '1' : '0')
  } catch {
    // A sidebar that forgets its width is survivable.
  }
}

function toggle(id: string) {
  if (collapsed.value.has(id)) collapsed.value.delete(id)
  else collapsed.value.add(id)
  collapsed.value = new Set(collapsed.value)
}

function startRename(id: string, current: string) {
  renamingId.value = id
  renameValue.value = current
}

function commitRename(kind: 'collection' | 'request') {
  if (!renamingId.value) return
  if (kind === 'collection') renameCollection(renamingId.value, renameValue.value)
  else renameRequest(renamingId.value, renameValue.value)
  renamingId.value = null
}

function promptCollection() {
  const name = window.prompt('Collection name')
  if (name !== null) addCollection(name)
}

function confirmDeleteCollection(id: string, name: string) {
  if (window.confirm(`Delete the collection "${name}" and all of its requests?`)) {
    deleteCollection(id)
  }
}
</script>

<template>
  <aside class="sidebar" :class="{ railed }">
    <!-- Icon rail, shown when collapsed. -->
    <div class="rail">
      <img class="rail-mark" src="/favicon.svg" alt="curler" width="22" height="21" />
      <button class="ghost" title="New request" @click="newScratchRequest()">
        <span class="material-icons">add</span>
      </button>
      <button class="ghost" title="Variables" @click="emit('manageVariables')">
        <span class="material-icons">data_object</span>
      </button>
      <button class="ghost" title="Expand the sidebar" @click="toggleRail">
        <span class="material-icons">keyboard_double_arrow_right</span>
      </button>
    </div>

    <!-- Full panel, shown when expanded. -->
    <div class="panel">
    <header class="brand">
      <span class="logo mono">curler</span>
      <span class="brand-actions">
        <button class="ghost" title="New request" @click="newScratchRequest()">
          <span class="material-icons sm">add</span>
          New
        </button>
        <button class="ghost rail-toggle" title="Collapse the sidebar" @click="toggleRail">
          <span class="material-icons sm">keyboard_double_arrow_left</span>
        </button>
      </span>
    </header>

    <div class="env">
      <select v-model="state.activeEnvironmentId" title="Active environment">
        <option v-for="environment in state.environments" :key="environment.id" :value="environment.id">
          {{ environment.name }}
        </option>
      </select>
      <button class="ghost" title="Manage variables" @click="emit('manageVariables')">
        <span class="material-icons sm">data_object</span>
        Vars
      </button>
    </div>

    <div class="tree">
      <div v-for="collection in state.collections" :key="collection.id" class="collection">
        <div class="collection-head">
          <button class="ghost chevron" @click="toggle(collection.id)">
            <span class="material-icons sm">
              {{ collapsed.has(collection.id) ? 'chevron_right' : 'expand_more' }}
            </span>
          </button>
          <input
            v-if="renamingId === collection.id"
            v-model="renameValue"
            class="rename"
            autofocus
            @blur="commitRename('collection')"
            @keydown.enter="commitRename('collection')"
            @keydown.esc="renamingId = null"
          />
          <span
            v-else
            class="collection-name"
            @dblclick="startRename(collection.id, collection.name)"
          >
            {{ collection.name }}
          </span>
          <span class="count faint">{{ collection.requests.length }}</span>
          <button
            class="ghost danger tiny"
            title="Delete collection"
            @click="confirmDeleteCollection(collection.id, collection.name)"
          >
            <span class="material-icons sm">delete_outline</span>
          </button>
        </div>

        <ul v-if="!collapsed.has(collection.id)" class="requests">
          <li
            v-for="request in collection.requests"
            :key="request.id"
            class="request-item"
            :class="{ active: state.activeRequestId === request.id }"
            @click="selectRequest(request.id)"
          >
            <span class="method mono" :class="request.method.toLowerCase()">
              {{ request.method.slice(0, 4) }}
            </span>
            <input
              v-if="renamingId === request.id"
              v-model="renameValue"
              class="rename"
              autofocus
              @click.stop
              @blur="commitRename('request')"
              @keydown.enter="commitRename('request')"
              @keydown.esc="renamingId = null"
            />
            <span v-else class="request-name" @dblclick.stop="startRename(request.id, request.name)">
              {{ request.name }}
            </span>
            <span class="row-actions">
              <button class="ghost tiny" title="Duplicate" @click.stop="duplicateRequest(request.id)">
                <span class="material-icons sm">content_copy</span>
              </button>
              <button class="ghost tiny danger" title="Delete" @click.stop="deleteRequest(request.id)">
                <span class="material-icons sm">delete_outline</span>
              </button>
            </span>
          </li>
          <li v-if="!collection.requests.length" class="empty faint">No saved requests</li>
        </ul>
      </div>

      <button class="ghost add-collection" @click="promptCollection">
        <span class="material-icons sm">create_new_folder</span>
        Collection
      </button>
    </div>

    <footer class="footer faint mono" :title="state.workspacePath">
      {{ state.error ? state.error : state.workspacePath }}
    </footer>
    </div>
  </aside>
</template>

<style scoped>
/*
 * Both layers stay mounted at their natural width and cross-fade, while the
 * aside animates its own width. Reflowing the tree on every frame of the
 * transition would be both janky and pointless, since it is fading out.
 */
.sidebar {
  position: relative;
  width: 268px;
  flex-shrink: 0;
  background: var(--bg-raised);
  border-right: 1px solid var(--border);
  min-height: 0;
  overflow: hidden;
  transition: width 0.22s ease;
}

.sidebar.railed {
  width: 56px;
}

.panel,
.rail {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
  /* Visibility keeps the hidden layer out of the tab order, and transitioning
     it defers the flip until the fade has finished. */
  transition: opacity 0.16s ease, visibility 0.16s;
}

.panel {
  width: 268px;
}

.rail {
  width: 56px;
  align-items: center;
  gap: 4px;
  padding-top: 12px;
}

.sidebar.railed .panel,
.sidebar:not(.railed) .rail {
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
}

.rail-mark {
  display: block;
  margin-bottom: 10px;
}

.rail button {
  padding: 7px;
}

.rail .material-icons {
  vertical-align: 0;
}

@media (prefers-reduced-motion: reduce) {
  .sidebar,
  .panel,
  .rail {
    transition: none;
  }
}

.brand {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 8px 8px 16px;
}

.brand-actions {
  display: flex;
  align-items: center;
  gap: 2px;
}

.rail-toggle {
  padding: 5px;
}

.logo {
  font-size: 15px;
  font-weight: 700;
  color: var(--accent);
  letter-spacing: -0.02em;
}

.env {
  display: flex;
  gap: 6px;
  padding: 0 12px 10px 16px;
}

.env select {
  flex: 1;
  font-size: 13px;
}

.tree {
  flex: 1;
  overflow: auto;
  padding: 4px 8px 12px;
  min-height: 0;
}

.collection-head {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px 4px 4px 0;
}

.sidebar button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.sidebar .material-icons {
  vertical-align: 0;
}

.chevron {
  padding: 2px;
  color: var(--text-faint);
}

.collection-name {
  flex: 1;
  font-size: 13px;
  font-weight: 600;
  cursor: default;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.count {
  font-size: 11px;
  font-family: var(--mono);
  padding-right: 2px;
}

.collection-head .tiny,
.row-actions .tiny {
  opacity: 0;
  padding: 2px 4px;
}

.collection-head:hover .tiny,
.request-item:hover .tiny {
  opacity: 1;
}

.requests {
  list-style: none;
  margin: 0 0 6px;
  padding: 0 0 0 14px;
}

.request-item {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 4px 6px;
  border-radius: 4px;
  cursor: pointer;
}

.request-item:hover {
  background: var(--bg-hover);
}

.request-item.active {
  background: var(--accent-dim);
}

.method {
  font-size: 10px;
  font-weight: 700;
  width: 32px;
  flex-shrink: 0;
}

.method.get { color: var(--green); }
.method.post { color: var(--accent); }
.method.put { color: var(--amber); }
.method.patc { color: var(--purple); }
.method.dele { color: var(--red); }
.method.head, .method.opti { color: var(--text-dim); }

.request-name {
  flex: 1;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row-actions {
  display: flex;
  gap: 1px;
}

.rename {
  flex: 1;
  padding: 2px 6px;
  font-size: 13px;
}

.empty {
  font-size: 12px;
  padding: 4px 6px;
  list-style: none;
}

.add-collection {
  width: 100%;
  justify-content: flex-start;
  text-align: left;
  margin-top: 6px;
  font-size: 12px;
}

.footer {
  padding: 8px 16px;
  border-top: 1px solid var(--border);
  font-size: 10.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
