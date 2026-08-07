<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  activeEnvironment,
  addCollection,
  buildVariableSet,
  deleteCollection,
  deleteRequest,
  duplicateRequest,
  newScratchRequest,
  renameCollection,
  renameRequest,
  reorderRequest,
  selectRequest,
  settingBoolean,
  state,
} from '../lib/store'
import { describeIssues, requestVariableIssues } from '../lib/vars'
import { useReorderList } from '../composables/useReorderList'
import type { EditableScope } from '../types'
import RestoreBackupDialog from './RestoreBackupDialog.vue'

const emit = defineEmits<{ manageVariables: [scope?: EditableScope] }>()

const showRestore = ref(false)

/** Saved requests whose referenced variables are missing or empty for the active environment. */
const unconfigured = computed(() => {
  const environment = activeEnvironment.value
  const out = new Map<string, string>()
  for (const collection of state.collections) {
    for (const request of collection.requests) {
      const issues = requestVariableIssues(
        request,
        buildVariableSet(request, collection, environment).values,
      )
      if (issues.length) out.set(request.id, describeIssues(issues))
    }
  }
  return out
})

const collapsed = ref(new Set<string>())
const renamingId = ref<string | null>(null)
const renameValue = ref('')
/** The control that opened the rename field, to hand focus back to. */
let renameOrigin: HTMLElement | null = null

const railed = ref(settingBoolean('sidebarCollapsed'))
const root = ref<HTMLElement | null>(null)
/** Keep in sync with the overlay breakpoint in this component's styles. */
const overlaying = window.matchMedia('(max-width: 750px)')

function setRailed(value: boolean) {
  railed.value = value
}

function toggleRail() {
  setRailed(!railed.value)
}

/**
 * Dialogs and menus teleport to the body, outside the layout shell, and dismiss
 * themselves. Anything they receive is theirs to act on, so an open sidebar
 * behind one is left alone rather than collapsing out of sight.
 */
function fromOverlay(target: EventTarget | null): boolean {
  const shell = root.value?.parentElement
  return target instanceof Node && target !== document.body && !shell?.contains(target)
}

/**
 * Only the narrow layout puts the expanded panel over the content beside it,
 * and only then is there anything to dismiss.
 */
function overlaid(): boolean {
  return !railed.value && overlaying.matches
}

/** Anything reaching the covered content puts the panel away. */
function dismissFrom(target: EventTarget | null) {
  if (!overlaid() || fromOverlay(target)) return
  if (target instanceof Node && root.value?.contains(target)) return
  setRailed(true)
}

function onPointerDown(event: PointerEvent) {
  dismissFrom(event.target)
}

/**
 * The scrim stops presses reaching what the panel covers, but Tab still walks
 * straight into it. Leaving on the keyboard means the same thing as leaving on
 * the pointer, so it closes the same way -- and focus keeps going where the
 * user sent it rather than being penned in.
 */
function onFocusIn(event: FocusEvent) {
  dismissFrom(event.target)
}

function onKeydown(event: KeyboardEvent) {
  // Escape belongs to the rename field for as long as one is open.
  if (event.key !== 'Escape' || renamingId.value) return
  if (overlaid() && !fromOverlay(event.target)) setRailed(true)
}

onMounted(() => {
  document.addEventListener('pointerdown', onPointerDown)
  document.addEventListener('focusin', onFocusIn)
  document.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onPointerDown)
  document.removeEventListener('focusin', onFocusIn)
  document.removeEventListener('keydown', onKeydown)
})

function toggle(id: string) {
  if (collapsed.value.has(id)) collapsed.value.delete(id)
  else collapsed.value.add(id)
  collapsed.value = new Set(collapsed.value)
}

function startRename(id: string, current: string) {
  renamingId.value = id
  renameValue.value = current
  const origin = document.activeElement
  renameOrigin = origin instanceof HTMLElement && origin !== document.body ? origin : null
}

/**
 * Vue calls element ref functions on every patch, so this has to check before
 * taking focus -- reselecting the text on each keystroke would be unusable.
 */
function focusRename(el: unknown) {
  if (el instanceof HTMLInputElement && document.activeElement !== el) {
    el.focus()
    el.select()
  }
}

function commitRename(kind: 'collection' | 'request') {
  if (!renamingId.value) return
  if (kind === 'collection') renameCollection(renamingId.value, renameValue.value)
  else renameRequest(renamingId.value, renameValue.value)
  renamingId.value = null
}

/**
 * Enter and Escape unmount the field while focus is still inside it, which
 * would drop focus to the body. Blur needs no such help, since focus has
 * already gone wherever the user sent it.
 */
function submitRename(kind: 'collection' | 'request') {
  commitRename(kind)
  restoreFocus()
}

function cancelRename() {
  renamingId.value = null
  restoreFocus()
}

function restoreFocus() {
  renameOrigin?.focus()
  renameOrigin = null
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

const {
  dragging,
  startDrag,
  endDrag,
  dragOver: dragOverRequest,
  dragOverContainer: dragOverRequestContainer,
  drop: dropOnRequests,
  dropIndicator,
  onHandleKeydown,
} = useReorderList({
  reorder: reorderRequest,
  root,
  handleSelector: (requestId) => `.drag-handle[data-request-id="${requestId}"]`,
})
</script>

<template>
  <aside ref="root" class="sidebar" :class="{ railed }">
    <!-- Icon rail, shown when collapsed. -->
    <div class="rail">
      <!-- Sourced from the 192px icon rather than favicon-32x32 so it stays sharp on HiDPI. -->
      <img
        class="rail-mark"
        src="/android-chrome-192x192.png"
        alt="curler"
        width="22"
        height="22"
      />
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
        <select
          id="active-environment"
          v-model="state.activeEnvironmentId"
          title="Active environment"
        >
          <option
            v-for="environment in state.environments"
            :key="environment.id"
            :value="environment.id"
          >
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
            <button
              class="ghost chevron"
              :title="collapsed.has(collection.id) ? 'Expand collection' : 'Collapse collection'"
              :aria-expanded="!collapsed.has(collection.id)"
              @click="toggle(collection.id)"
            >
              <span class="material-icons sm">
                {{ collapsed.has(collection.id) ? 'chevron_right' : 'expand_more' }}
              </span>
            </button>
            <input
              v-if="renamingId === collection.id"
              id="collection-rename"
              :ref="focusRename"
              v-model="renameValue"
              class="rename"
              aria-label="Collection name"
              @blur="commitRename('collection')"
              @keydown.enter="submitRename('collection')"
              @keydown.esc="cancelRename"
            />
            <span
              v-else
              class="collection-name"
              @dblclick="startRename(collection.id, collection.name)"
            >
              {{ collection.name }}
            </span>
            <button
              v-if="settingBoolean('showCollectionEditIcons')"
              class="ghost tiny"
              title="Rename collection"
              @click="startRename(collection.id, collection.name)"
            >
              <span class="material-icons sm">edit</span>
            </button>
            <button
              class="ghost danger tiny"
              title="Delete collection"
              @click="confirmDeleteCollection(collection.id, collection.name)"
            >
              <span class="material-icons sm">delete_outline</span>
            </button>
            <span class="count faint">{{ collection.requests.length }}</span>
          </div>

          <TransitionGroup
            v-if="!collapsed.has(collection.id)"
            tag="ul"
            name="request"
            class="requests"
            data-reorder-list
            :class="{ 'is-reordering': dragging?.groupId === collection.id }"
            @dragover="dragOverRequestContainer(collection.id, collection.requests.length, $event)"
            @drop="dropOnRequests(collection.id, $event)"
          >
            <li
              v-for="(request, index) in collection.requests"
              :key="request.id"
              class="request-item"
              data-reorder-row
              :class="{
                active: state.activeRequestId === request.id,
                unconfigured: unconfigured.has(request.id),
                dragging: dragging?.fromIndex === index && dragging?.groupId === collection.id,
                'drop-before':
                  dropIndicator(collection.id, index, collection.requests.length) === 'before',
                'drop-after':
                  dropIndicator(collection.id, index, collection.requests.length) === 'after',
              }"
              :title="unconfigured.get(request.id)"
              @click="selectRequest(request.id)"
              @dragover="dragOverRequest(collection.id, index, $event)"
            >
              <button
                class="ghost drag-handle"
                draggable="true"
                :data-request-id="request.id"
                title="Drag to reorder"
                aria-label="Drag to reorder, or press arrow up or down"
                aria-keyshortcuts="ArrowUp ArrowDown"
                @click.stop
                @dragstart="startDrag(collection.id, index, $event)"
                @dragend="endDrag($event)"
                @keydown="
                  onHandleKeydown(
                    collection.id,
                    index,
                    request.id,
                    collection.requests.length,
                    $event,
                  )
                "
              >
                <span class="material-icons sm">drag_indicator</span>
              </button>
              <span class="method mono" :class="request.method.toLowerCase()">
                {{ request.method.slice(0, 4) }}
              </span>
              <input
                v-if="renamingId === request.id"
                id="request-rename"
                :ref="focusRename"
                v-model="renameValue"
                class="rename"
                aria-label="Request name"
                @click.stop
                @blur="commitRename('request')"
                @keydown.enter="submitRename('request')"
                @keydown.esc="cancelRename"
              />
              <!--
              The whole row is a click target for the mouse, but selecting one
              by keyboard needs a real control: this button carries no handler
              of its own because activating it bubbles to the row's.
            -->
              <button
                v-else
                class="request-name"
                :title="request.name"
                aria-label="Request name: {{ request.name }}"
                :aria-current="state.activeRequestId === request.id ? 'true' : undefined"
                @dblclick.stop="startRename(request.id, request.name)"
                @keydown.shift.enter="startRename(request.id, request.name)"
              >
                {{ request.name }}
              </button>
              <span class="row-actions">
                <button
                  v-if="settingBoolean('showRequestEditIcons')"
                  class="ghost tiny"
                  title="Rename"
                  @click.stop="startRename(request.id, request.name)"
                >
                  <span class="material-icons sm">edit</span>
                </button>
                <button
                  class="ghost tiny"
                  title="Duplicate"
                  @click.stop="duplicateRequest(request.id)"
                >
                  <span class="material-icons sm">content_copy</span>
                </button>
                <button
                  class="ghost tiny danger"
                  title="Delete"
                  @click.stop="deleteRequest(request.id)"
                >
                  <span class="material-icons sm">delete_outline</span>
                </button>
              </span>
            </li>
            <li v-if="!collection.requests.length" key="empty" class="empty faint">
              No saved requests
            </li>
          </TransitionGroup>
        </div>

        <button class="ghost add-collection" @click="promptCollection">
          <span class="material-icons sm">create_new_folder</span>
          Collection
        </button>
      </div>

      <footer
        class="footer faint mono"
        :title="
          state.error ? 'Error: ' + state.error : 'Workspace being saved at: ' + state.workspacePath
        "
      >
        <span class="footer-path">{{ state.error ? state.error : state.workspacePath }}</span>
        <button
          v-if="!state.error"
          class="ghost tiny restore"
          title="Restore from backup"
          @click="showRestore = true"
        >
          <span class="material-icons sm">restore</span>
        </button>
      </footer>
    </div>
  </aside>

  <RestoreBackupDialog v-if="showRestore" @close="showRestore = false" />

  <!-- Dims the covered content and catches the press that closes the panel. -->
  <div class="scrim" :class="{ show: !railed }" aria-hidden="true" />
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

/* The wide layout has nothing to dim: the panel sits beside the content. */
.scrim {
  display: none;
}

/* Below this the panel is an overlay rather than a column; the content beside
   it only reserves room for the rail. Kept in step with BuildView's .main. */
@media screen and (max-width: 750px) {
  .sidebar {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    z-index: 10;
  }

  .scrim {
    display: block;
    position: fixed;
    inset: 0;
    /* Below the sidebar, above everything the sidebar covers. */
    z-index: 9;
    background: var(--backdrop);
    opacity: 0;
    visibility: hidden;
    pointer-events: none;
    transition:
      opacity 0.22s ease,
      visibility 0.22s;
  }

  .scrim.show {
    opacity: 1;
    visibility: visible;
    pointer-events: auto;
  }
}

.sidebar.railed {
  width: var(--rail-width);
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
  transition:
    opacity 0.16s ease,
    visibility 0.16s;
}

.panel {
  width: 268px;
}

.rail {
  width: var(--rail-width);
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
  .rail,
  .scrim {
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
  padding-left: 5px;
}

.collection-head .tiny,
.row-actions .tiny {
  opacity: 0;
  padding: 2px 4px;
}

/*
 * Opacity leaves these buttons in the tab order, so keyboard focus landing
 * anywhere in the row has to reveal them; otherwise tabbing through the tree
 * moves an invisible focus ring. Hover alone covers the pointer, and
 * :focus-visible keeps a click on the row from pinning them open.
 */
.collection-head:hover .tiny,
.collection-head:has(:focus-visible) .tiny,
.request-item:hover .tiny,
.request-item:has(:focus-visible) .tiny,
.request-item:hover .drag-handle,
.request-item:has(:focus-visible) .drag-handle {
  opacity: 1;
}

.drag-handle {
  opacity: 0;
  padding: 0 1px;
  color: var(--text-faint);
  cursor: grab;
  flex-shrink: 0;
}

.drag-handle:active {
  cursor: grabbing;
}

.request-item.dragging {
  opacity: 0.45;
}

.request-item.drop-before {
  box-shadow: inset 0 2px 0 var(--accent);
}

.request-item.drop-after {
  box-shadow: inset 0 -2px 0 var(--accent);
}

.request-move {
  transition: transform 0.18s ease;
}

.requests.is-reordering .request-move {
  transition: none;
}

@media (prefers-reduced-motion: reduce) {
  .request-move {
    transition: none;
  }
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

/* Dim requests that still have missing or empty vars for this environment. */
.request-item.unconfigured:not(.active) {
  opacity: 0.5;
}

.request-item.unconfigured:not(.active):hover {
  opacity: 0.75;
}

.method {
  font-size: 10px;
  font-weight: 700;
  width: 32px;
  flex-shrink: 0;
}

.method.get {
  color: var(--green);
}
.method.post {
  color: var(--accent);
}
.method.put {
  color: var(--amber);
}
.method.patch {
  color: var(--purple);
}
.method.delete {
  color: var(--red);
}
.method.head {
  color: var(--text-dim);
}
.method.options {
  color: var(--cyan);
}
.method.trace {
  color: var(--pink);
}

/* Reset to a bare row label: the button exists for focus and Enter, not looks. */
.sidebar .request-name {
  display: block;
  flex: 1;
  min-width: 0;
  padding: 0;
  border: none;
  background: none;
  color: inherit;
  font-size: 13px;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sidebar .request-name:hover {
  background: none;
}

.sidebar .request-name:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
  border-radius: 2px;
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
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 10px 2px 16px;
  border-top: 1px solid var(--border);
  font-size: 10.5px;
  line-height: 22px; /* larger than button */
}

.footer-path {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.footer .restore {
  position: absolute;
  opacity: 0;
  flex-shrink: 0;
  padding: 2px 4px;
}

.footer:hover .restore,
.footer:has(:focus-visible) .restore {
  position: relative;
  opacity: 1;
}
</style>
