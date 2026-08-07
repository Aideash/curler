import { nextTick, ref, type Ref } from 'vue'

/** Moves one item within an array, matching HTML5 drag-drop index semantics. */
export function reorderItems<T>(items: T[], fromIndex: number, toIndex: number): void {
  const { length } = items
  if (fromIndex < 0 || fromIndex >= length || toIndex < 0 || toIndex > length) return
  const insertAt = fromIndex < toIndex ? toIndex - 1 : toIndex
  if (insertAt === fromIndex) return
  const [item] = items.splice(fromIndex, 1)
  items.splice(insertAt, 0, item)
}

export interface ReorderDragState<G = string> {
  groupId: G
  fromIndex: number
}

export interface ReorderDropTarget<G = string> {
  groupId: G
  index: number
}

export interface UseReorderListOptions<G = string> {
  reorder: (groupId: G, fromIndex: number, toIndex: number) => void
  /** Root element to search for handles after keyboard reorder. */
  root?: Ref<HTMLElement | null>
  handleSelector?: (itemId: string) => string
}

export function useReorderList<G = string>(options: UseReorderListOptions<G>) {
  const dragging = ref<ReorderDragState<G> | null>(null)
  const dropTarget = ref<ReorderDropTarget<G> | null>(null)

  let committed = false
  let cancelled = false
  let pointerOutsideList = false
  let listContainer: HTMLElement | null = null
  let listGroupId: G | null = null
  let listLength = 0

  function trackListContainer(groupId: G, length: number, container: HTMLElement) {
    listContainer = container
    listGroupId = groupId
    listLength = length
  }

  function dropIndexFromPointer(container: HTMLElement, clientY: number): number {
    const rows = container.querySelectorAll<HTMLElement>('[data-reorder-row]')
    for (let i = 0; i < rows.length; i++) {
      const rowRect = rows[i].getBoundingClientRect()
      if (clientY < rowRect.top + rowRect.height / 2) return i
    }
    return rows.length
  }

  function updateDropFromPointer(groupId: G, length: number, clientY: number) {
    if (!listContainer) return
    const rect = listContainer.getBoundingClientRect()
    if (clientY < rect.top) dropTarget.value = { groupId, index: 0 }
    else if (clientY > rect.bottom) dropTarget.value = { groupId, index: length }
  }

  function commitIfReady() {
    if (committed || cancelled || !dragging.value) return
    const drag = dragging.value
    const target = dropTarget.value
    if (!target || target.groupId !== drag.groupId) return
    // Clear before reorder so is-reordering lifts and TransitionGroup can animate the move.
    dragging.value = null
    dropTarget.value = null
    options.reorder(drag.groupId as G, drag.fromIndex, target.index)
    committed = true
  }

  function removeDocumentListeners() {
    document.removeEventListener('keydown', onEscape, true)
    document.removeEventListener('mouseup', onDocumentMouseUp, true)
    document.removeEventListener('dragover', onDocumentDragOver, true)
  }

  function onDocumentDragOver(event: DragEvent) {
    const groupId = listGroupId
    if (
      cancelled ||
      !dragging.value ||
      !listContainer ||
      groupId == null ||
      groupId !== dragging.value.groupId
    )
      return
    const rect = listContainer.getBoundingClientRect()
    const y = event.clientY
    if (y >= rect.top && y <= rect.bottom) {
      pointerOutsideList = false
      return
    }
    pointerOutsideList = true
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
    updateDropFromPointer(groupId, listLength, y)
  }

  function onDocumentMouseUp() {
    commitIfReady()
  }

  function cancelDrag() {
    if (!dragging.value) return
    cancelled = true
    dropTarget.value = null
    endDrag()
  }

  function onEscape(event: KeyboardEvent) {
    if (event.key !== 'Escape' || !dragging.value) return
    event.preventDefault()
    event.stopPropagation()
    cancelDrag()
  }

  function resetDragState() {
    removeDocumentListeners()
    listContainer = null
    listGroupId = null
    listLength = 0
    committed = false
    cancelled = false
    pointerOutsideList = false
    dragging.value = null
    dropTarget.value = null
  }

  function startDrag(groupId: G, fromIndex: number, event: DragEvent) {
    committed = false
    cancelled = false
    listContainer = null
    listGroupId = null
    listLength = 0
    pointerOutsideList = false
    dragging.value = { groupId, fromIndex }
    document.addEventListener('keydown', onEscape, true)
    document.addEventListener('mouseup', onDocumentMouseUp, true)
    document.addEventListener('dragover', onDocumentDragOver, true)
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData('text/plain', String(fromIndex))
    }
  }

  function endDrag(event?: DragEvent) {
    if (dragging.value && !cancelled) {
      const dropEffect = event?.dataTransfer?.dropEffect
      if (dropEffect !== 'none' || pointerOutsideList) commitIfReady()
    }
    resetDragState()
  }

  function dragOverContainer(groupId: G, length: number, event: DragEvent) {
    if (cancelled || !dragging.value || dragging.value.groupId !== groupId) return
    pointerOutsideList = false
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
    const container = event.currentTarget
    if (!(container instanceof HTMLElement)) return
    trackListContainer(groupId, length, container)
    const target = event.target
    if (target instanceof Element && target !== container) {
      const row = target.closest('[data-reorder-row]')
      if (row) return
    }
    dropTarget.value = { groupId, index: dropIndexFromPointer(container, event.clientY) }
  }

  function dragOver(groupId: G, index: number, event: DragEvent) {
    if (cancelled || !dragging.value || dragging.value.groupId !== groupId) return
    pointerOutsideList = false
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
    const row = event.currentTarget
    if (!(row instanceof HTMLElement)) return
    const container = row.closest('[data-reorder-list]')
    if (container instanceof HTMLElement) {
      const length = container.querySelectorAll('[data-reorder-row]').length
      trackListContainer(groupId, length, container)
    }
    const after = event.clientY > row.getBoundingClientRect().top + row.offsetHeight / 2
    dropTarget.value = { groupId, index: after ? index + 1 : index }
  }

  function drop(groupId: G, event: DragEvent) {
    event.preventDefault()
    if (cancelled || !dragging.value || dragging.value.groupId !== groupId) return
    commitIfReady()
  }

  function dropIndicator(groupId: G, index: number, length: number): 'before' | 'after' | null {
    if (!dropTarget.value || dropTarget.value.groupId !== groupId) return null
    const insert = dropTarget.value.index
    if (insert === index) return 'before'
    if (insert === length && index === length - 1) return 'after'
    return null
  }

  async function refocusHandle(itemId: string) {
    if (!options.root || !options.handleSelector) return
    await nextTick()
    options.root.value?.querySelector<HTMLButtonElement>(options.handleSelector(itemId))?.focus()
  }

  function reorderByKeyboard(
    groupId: G,
    index: number,
    direction: -1 | 1,
    event: KeyboardEvent,
    itemId: string,
    length: number,
  ) {
    event.preventDefault()
    let moved = false
    if (direction === -1 && index > 0) {
      options.reorder(groupId, index, index - 1)
      moved = true
    } else if (direction === 1 && index < length - 1) {
      options.reorder(groupId, index, index + 2)
      moved = true
    }
    if (moved) void refocusHandle(itemId)
  }

  function onHandleKeydown(
    groupId: G,
    index: number,
    itemId: string,
    length: number,
    event: KeyboardEvent,
  ) {
    if (event.key === 'ArrowUp') reorderByKeyboard(groupId, index, -1, event, itemId, length)
    else if (event.key === 'ArrowDown') reorderByKeyboard(groupId, index, 1, event, itemId, length)
  }

  return {
    dragging,
    dropTarget,
    startDrag,
    endDrag,
    dragOver,
    dragOverContainer,
    drop,
    dropIndicator,
    onHandleKeydown,
  }
}
