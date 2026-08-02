import { indentWithTab } from '@codemirror/commands'
import { type Extension } from '@codemirror/state'
import { EditorView, keymap, ViewPlugin } from '@codemirror/view'
import { queryFocusable } from '../composables/useFocusTrap'

/** True when the keydown that just ran was Tab (Shift-Tab counts). Cleared on mousedown. */
let lastKeyWasTab = false
let tabKeyTrackerInstalled = false

function ensureTabKeyTracker() {
  if (tabKeyTrackerInstalled || typeof document === 'undefined') return
  tabKeyTrackerInstalled = true

  document.addEventListener(
    'keydown',
    (event) => {
      lastKeyWasTab = event.key === 'Tab'
    },
    true,
  )

  document.addEventListener(
    'mousedown',
    () => {
      lastKeyWasTab = false
    },
    true,
  )
}

function moveFocus(view: EditorView, direction: 'forward' | 'backward') {
  const order = queryFocusable(document.body).filter((el) => el.getClientRects().length > 0)
  const active = document.activeElement
  const index = order.findIndex(
    (el) =>
      el === view.contentDOM || (active instanceof Node && (el === active || el.contains(active))),
  )
  if (index < 0) return false
  const target = direction === 'forward' ? order[index + 1] : order[index - 1]
  if (!target) return false
  target.focus()
  return true
}

/**
 * Tab indents, with two ways out for keyboard users:
 * - Esc then Tab (CodeMirror's built-in tab-focus mode)
 * - Tab straight through when focus just arrived via Tab
 */
export function editorTabIndentExtensions(): Extension[] {
  ensureTabKeyTracker()

  const passThrough = ViewPlugin.fromClass(
    class {
      enteredViaTab = false
      private readonly onDocKeydown: (event: KeyboardEvent) => void
      private readonly view: EditorView

      constructor(view: EditorView) {
        this.view = view
        this.onDocKeydown = (event: KeyboardEvent) => {
          if (event.key !== 'Tab' || !this.enteredViaTab) return
          if (!this.view.dom.contains(document.activeElement)) return

          this.enteredViaTab = false
          event.preventDefault()
          event.stopImmediatePropagation()
          moveFocus(this.view, event.shiftKey ? 'backward' : 'forward')
        }
        document.addEventListener('keydown', this.onDocKeydown, true)
      }

      destroy() {
        document.removeEventListener('keydown', this.onDocKeydown, true)
      }
    },
    {
      eventHandlers: {
        focusin(this: { enteredViaTab: boolean }) {
          if (!lastKeyWasTab) return
          this.enteredViaTab = true
          lastKeyWasTab = false
        },
        keydown(this: { enteredViaTab: boolean }, event: KeyboardEvent) {
          if (this.enteredViaTab && event.key !== 'Tab' && event.key !== 'Shift') {
            this.enteredViaTab = false
          }
        },
        mousedown(this: { enteredViaTab: boolean }) {
          this.enteredViaTab = false
        },
      },
    },
  )

  return [passThrough, keymap.of([indentWithTab])]
}
