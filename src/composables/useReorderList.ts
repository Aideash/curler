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

  function startDrag(groupId: G, fromIndex: number, event: DragEvent) {
    dragging.value = { groupId, fromIndex }
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData('text/plain', String(fromIndex))
    }
  }

  function endDrag() {
    dragging.value = null
    dropTarget.value = null
  }

  function dragOver(groupId: G, index: number, event: DragEvent) {
    if (!dragging.value || dragging.value.groupId !== groupId) return
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
    const row = event.currentTarget
    if (!(row instanceof HTMLElement)) return
    const after = event.clientY > row.getBoundingClientRect().top + row.offsetHeight / 2
    dropTarget.value = { groupId, index: after ? index + 1 : index }
  }

  function drop(groupId: G, event: DragEvent) {
    event.preventDefault()
    if (!dragging.value || dragging.value.groupId !== groupId) return
    const toIndex = dropTarget.value?.index ?? dragging.value.fromIndex
    options.reorder(groupId, dragging.value.fromIndex, toIndex)
    endDrag()
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
    drop,
    dropIndicator,
    onHandleKeydown,
  }
}
