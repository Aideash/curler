<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useTheme } from '../composables/useTheme'
import { editorTabIndentExtensions } from '../lib/editorTabIndent'
import { Compartment, EditorState, Prec, type Extension } from '@codemirror/state'
import { EditorView, placeholder as placeholderExt } from '@codemirror/view'
import { basicSetup } from 'codemirror'
import { json, jsonParseLinter } from '@codemirror/lang-json'
import { graphqlLanguageSupport } from 'cm6-graphql'
import { linter, lintGutter } from '@codemirror/lint'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'

const props = withDefaults(
  defineProps<{
    modelValue: string
    language?: 'json' | 'graphql' | 'text'
    readonly?: boolean
    placeholder?: string
    /** Tab indents; Esc then Tab leaves the editor. Off when readonly. */
    indentWithTab?: boolean
  }>(),
  { language: 'text', readonly: false, placeholder: '', indentWithTab: true },
)

const emit = defineEmits<{
  'update:modelValue': [value: string]
  validity: [result: { valid: boolean; message: string }]
}>()

const host = ref<HTMLDivElement>()
let view: EditorView | undefined
const languageCompartment = new Compartment()
const readonlyCompartment = new Compartment()
const themeCompartment = new Compartment()
const tabIndentCompartment = new Compartment()

const { isDark } = useTheme()

const tabIndentEnabled = computed(() => !props.readonly && props.indentWithTab)

function buildTheme(dark: boolean): Extension {
  return EditorView.theme(
    {
      '&': { color: 'var(--text)', backgroundColor: 'var(--bg-input)', height: '100%' },
      '.cm-content': { caretColor: 'var(--accent)', padding: '8px 0' },
      '&.cm-focused .cm-cursor': { borderLeftColor: 'var(--accent)' },
      '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': {
        backgroundColor: 'var(--selection)',
      },
      '.cm-line': { padding: '0 10px' },
      '.cm-placeholder': { color: 'var(--text-faint)' },
    },
    { dark },
  )
}

/**
 * Colors come from the theme tokens rather than literals so the editor
 * repaints with the rest of the page.
 */
const highlighting = HighlightStyle.define([
  {
    tag: [tags.propertyName, tags.attributeName, tags.variableName],
    color: 'var(--syntax-key)',
  },
  { tag: tags.string, color: 'var(--syntax-string)' },
  { tag: [tags.number, tags.integer, tags.float], color: 'var(--syntax-number)' },
  {
    tag: [tags.bool, tags.null, tags.atom, tags.keyword, tags.definitionKeyword, tags.modifier],
    color: 'var(--syntax-literal)',
  },
  {
    tag: [tags.punctuation, tags.brace, tags.paren, tags.separator],
    color: 'var(--syntax-punctuation)',
  },
  { tag: [tags.comment, tags.lineComment], color: 'var(--syntax-comment)', fontStyle: 'italic' },
  { tag: tags.invalid, color: 'var(--red)' },
])

function languageExtensions(): Extension {
  if (props.language === 'json') return [json(), linter(jsonParseLinter()), lintGutter()]
  if (props.language === 'graphql') return [graphqlLanguageSupport()]
  return []
}

function tabIndentExtensions(): Extension[] {
  return tabIndentEnabled.value ? editorTabIndentExtensions() : []
}

/**
 * The gutter linter shows where the problem is; this reports whether the
 * document parses at all so the surrounding UI can react.
 */
function reportValidity(text: string) {
  if (props.language !== 'json' || text.trim() === '') {
    emit('validity', { valid: true, message: '' })
    return
  }
  try {
    JSON.parse(text)
    emit('validity', { valid: true, message: '' })
  } catch (error) {
    emit('validity', {
      valid: false,
      message: error instanceof Error ? error.message : 'Invalid JSON',
    })
  }
}

onMounted(() => {
  if (!host.value) return
  view = new EditorView({
    parent: host.value,
    state: EditorState.create({
      doc: props.modelValue,
      extensions: [
        basicSetup,
        themeCompartment.of(buildTheme(isDark.value)),
        // basicSetup registers defaultHighlightStyle ahead of this one, so the
        // palette below has to outrank it explicitly. A `fallback` highlighter
        // would lose that contest and never paint.
        Prec.highest(syntaxHighlighting(highlighting)),
        placeholderExt(props.placeholder),
        languageCompartment.of(languageExtensions()),
        readonlyCompartment.of(EditorState.readOnly.of(props.readonly)),
        tabIndentCompartment.of(tabIndentExtensions()),
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return
          const text = update.state.doc.toString()
          emit('update:modelValue', text)
          reportValidity(text)
        }),
      ],
    }),
  })
  reportValidity(props.modelValue)
})

onBeforeUnmount(() => view?.destroy())

watch(
  () => props.modelValue,
  (value) => {
    if (!view || value === view.state.doc.toString()) return
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
    })
    reportValidity(value)
  },
)

watch(
  () => props.language,
  () => {
    view?.dispatch({ effects: languageCompartment.reconfigure(languageExtensions()) })
    reportValidity(props.modelValue)
  },
)

watch(
  () => props.readonly,
  (value) => {
    view?.dispatch({
      effects: readonlyCompartment.reconfigure(EditorState.readOnly.of(value)),
    })
  },
)

watch(tabIndentEnabled, () => {
  view?.dispatch({ effects: tabIndentCompartment.reconfigure(tabIndentExtensions()) })
})

watch(isDark, (dark) => {
  view?.dispatch({ effects: themeCompartment.reconfigure(buildTheme(dark)) })
})

defineExpose({
  format() {
    if (!view || props.language !== 'json') return false
    try {
      const formatted = JSON.stringify(JSON.parse(view.state.doc.toString()), null, 2)
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: formatted },
      })
      return true
    } catch {
      return false
    }
  },
})
</script>

<template>
  <div class="code-editor" :aria-keyshortcuts="tabIndentEnabled ? 'Escape Tab' : undefined">
    <div ref="host" class="editor-host" />
    <p v-if="tabIndentEnabled" class="tab-hint faint">Esc, then Tab to leave editor</p>
  </div>
</template>

<style scoped>
.code-editor {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.editor-host {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  background: var(--bg-input);
}

.tab-hint {
  flex-shrink: 0;
  margin: 0;
  padding: 4px 10px;
  font-size: 11px;
  border-top: 1px solid var(--border);
}
</style>
