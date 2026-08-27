<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useTheme } from '../composables/useTheme'
import { editorTabIndentExtensions } from '../lib/editorTabIndent'
import { editorValueCycleExtensions } from '../lib/editorValueCycle'
import { Compartment, EditorState, StateField, Prec, type Extension } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  placeholder as placeholderExt,
  type DecorationSet,
} from '@codemirror/view'
import { basicSetup } from 'codemirror'
import { javascript } from '@codemirror/lang-javascript'
import { html } from '@codemirror/lang-html'
import { json, jsonParseLinter } from '@codemirror/lang-json'
import { sass } from '@codemirror/lang-sass'
import { graphql, graphqlLanguageSupport, updateSchema } from 'cm6-graphql'
import { linter, lintGutter, type Diagnostic } from '@codemirror/lint'
import type { GraphQLSchema } from 'graphql'
import { firstErrorMessage, validateAgainstSchema, validateSyntax } from '../lib/graphqlValidate'
import { findPlaceholderTypenameRanges, type RootOperation } from '../lib/graphqlQueryBuilder'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'

const props = withDefaults(
  defineProps<{
    modelValue: string
    language?: 'json' | 'graphql' | 'javascript' | 'css' | 'sass' | 'html' | 'text'
    readonly?: boolean
    placeholder?: string
    /** Tab indents; Esc then Tab leaves the editor. Off when readonly. */
    indentWithTab?: boolean
    /** When set, GraphQL mode uses schema-aware lint and completion. */
    schema?: GraphQLSchema | null
    /** When set with GraphQL, lone __typename placeholders are dimmed in the editor. */
    graphqlOperation?: RootOperation | null
    /** Optional JSON property names mapped to enum choices for Alt+Enter cycling. */
    valueCycleEnumOptions?: Record<string, string[]>
    /** Accessible name for the editable surface. Placeholders are not announced as names. */
    ariaLabel?: string
  }>(),
  {
    language: 'text',
    readonly: false,
    placeholder: '',
    indentWithTab: true,
    schema: null,
    graphqlOperation: null,
    valueCycleEnumOptions: () => ({}),
    ariaLabel: '',
  },
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
const placeholderTypenameCompartment = new Compartment()
const valueCycleCompartment = new Compartment()
const ariaCompartment = new Compartment()

const { isDark } = useTheme()

const tabIndentEnabled = computed(() => !props.readonly && props.indentWithTab)
const valueCycleEnabled = computed(
  () => !props.readonly && (props.language === 'json' || props.language === 'graphql'),
)

function buildTheme(dark: boolean): Extension {
  return EditorView.theme(
    {
      '&': { color: 'var(--text)', backgroundColor: 'var(--bg-input)', height: '100%' },
      '&.cm-focused': {
        outline: '2px solid var(--accent)',
        outlineOffset: '2px',
      },
      '.cm-content': { caretColor: 'var(--accent)', padding: '8px 0' },
      '&.cm-focused .cm-cursor': { borderLeftColor: 'var(--accent)' },
      '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': {
        backgroundColor: 'var(--selection)',
      },
      '.cm-line': { padding: '0 10px' },
      '.cm-placeholder': { color: 'var(--text-faint)' },
      '.cm-typename-placeholder': {
        opacity: '0.55',
        color: 'var(--text-faint)',
      },
      // Panel chrome lives under .cm-editor but is styled by @codemirror/view's
      // baseTheme (&light/&dark), which beats a plain `.themePrefix .cm-panels`
      // selector. Pin rules to `.themePrefix.cm-editor` for enough specificity.
      '.cm-panels': {
        backgroundColor: 'var(--bg-raised)',
        color: 'var(--text)',
      },
      '.cm-panels-top': { borderBottom: '1px solid var(--border)' },
      '.cm-panel.cm-search': {
        backgroundColor: 'var(--bg-raised)',
        '& label': { color: 'var(--text-dim)' },
        '& [name=close]': {
          backgroundColor: 'transparent',
          color: 'var(--text-dim)',
        },
        '& .cm-textfield': {
          backgroundImage: 'none',
          backgroundColor: 'var(--bg-input)',
          color: 'var(--text)',
          border: '1px solid var(--border)',
        },
        '& .cm-button': {
          backgroundImage: 'none',
          backgroundColor: 'var(--bg-input)',
          color: 'var(--text)',
          border: '1px solid var(--border-strong)',
          '&:active': { backgroundImage: 'none', backgroundColor: 'var(--bg-hover)' },
        },
      },
      '.cm-searchMatch': { backgroundColor: 'var(--selection)' },
      '.cm-searchMatch-selected': { backgroundColor: 'var(--accent-dim)' },
    },
    { dark },
  )
}

/**
 * Colors come from the theme tokens rather than literals so the editor
 * repaints with the rest of the page.
 */
const highlighting = HighlightStyle.define([
  { tag: [tags.propertyName, tags.tagName], color: 'var(--syntax-key)' },
  // GraphQL variables like $id (cm6-graphql tags these as variableName).
  { tag: tags.variableName, color: 'var(--syntax-variable)' },
  // GraphQL argument names (cm6-graphql tags these as attributeName).
  { tag: tags.attributeName, color: 'var(--syntax-argument)' },
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

function buildPlaceholderTypenameDecorations(doc: string, operation: RootOperation): DecorationSet {
  const ranges = findPlaceholderTypenameRanges(doc, operation)
  if (!ranges.length) return Decoration.none
  return Decoration.set(
    ranges.map(({ from, to }) =>
      Decoration.mark({ class: 'cm-typename-placeholder' }).range(from, to),
    ),
  )
}

function placeholderTypenameExtension(operation: RootOperation): Extension {
  return StateField.define<DecorationSet>({
    create(state) {
      return buildPlaceholderTypenameDecorations(state.doc.toString(), operation)
    },
    update(decorations, tr) {
      if (tr.docChanged) {
        return buildPlaceholderTypenameDecorations(tr.state.doc.toString(), operation)
      }
      return decorations.map(tr.changes)
    },
    provide: (field) => EditorView.decorations.from(field),
  })
}

function placeholderTypenameExtensionConfig(): Extension {
  if (props.language !== 'graphql' || !props.graphqlOperation) return []
  return placeholderTypenameExtension(props.graphqlOperation)
}

function graphqlSyntaxLinter() {
  return linter((view): Diagnostic[] => {
    const result = validateSyntax(view.state.doc.toString())
    if (result.valid) return []
    const err = result.errors[0]
    if (!err) return []
    try {
      const line = view.state.doc.line(err.line)
      const from = Math.max(line.from, Math.min(line.to, line.from + err.col - 1))
      return [{ from, to: Math.min(from + 1, line.to), severity: 'error', message: err.message }]
    } catch {
      return [{ from: 0, to: 1, severity: 'error', message: err.message }]
    }
  })
}

function graphqlExtensions(): Extension[] {
  if (props.schema) {
    // cm6-graphql types target an older graphql release; runtime values match.
    return [...graphql(props.schema as Parameters<typeof graphql>[0]), lintGutter()]
  }
  return [graphqlLanguageSupport(), graphqlSyntaxLinter(), lintGutter()]
}

function languageExtensions(): Extension[] {
  if (props.language === 'json') return [json(), linter(jsonParseLinter()), lintGutter()]
  if (props.language === 'graphql') return graphqlExtensions()
  if (props.language === 'javascript') return [javascript()]
  if (props.language === 'html') return [html({ autoCloseTags: false })]
  if (props.language === 'sass') return [sass({ indented: true })]
  if (props.language === 'css') return [sass()]
  return []
}

function tabIndentExtensions(): Extension[] {
  return tabIndentEnabled.value ? editorTabIndentExtensions() : []
}

function valueCycleExtensions(): Extension[] {
  return editorValueCycleExtensions({
    language: props.language,
    readonly: props.readonly,
    enumOptionsByKey: props.valueCycleEnumOptions,
    schema: props.schema,
  })
}

function editorKeyShortcuts(): string | undefined {
  const shortcuts: string[] = []
  if (tabIndentEnabled.value) shortcuts.push('Escape Tab')
  if (valueCycleEnabled.value) shortcuts.push('Alt+Enter Shift+Alt+Enter')
  return shortcuts.length ? shortcuts.join(' ') : undefined
}

function editorAriaLabel(): string {
  if (props.ariaLabel) return props.ariaLabel
  if (props.language === 'graphql')
    return props.readonly ? 'GraphQL query, read only' : 'GraphQL query'
  if (props.language === 'json') return props.readonly ? 'JSON, read only' : 'JSON'
  return props.readonly ? 'Code editor, read only' : 'Code editor'
}

function ariaExtensions(): Extension {
  return EditorView.contentAttributes.of({
    'aria-label': editorAriaLabel(),
    'aria-multiline': 'true',
  })
}

/**
 * The gutter linter shows where the problem is; this reports whether the
 * document parses at all so the surrounding UI can react.
 */
function reportValidity(text: string) {
  if (props.language === 'json') {
    if (text.trim() === '') {
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
    return
  }

  if (props.language === 'graphql') {
    const result = props.schema ? validateAgainstSchema(text, props.schema) : validateSyntax(text)
    emit('validity', {
      valid: result.valid,
      message: result.valid ? '' : firstErrorMessage(result),
    })
    return
  }

  emit('validity', { valid: true, message: '' })
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
        valueCycleCompartment.of(valueCycleExtensions()),
        placeholderTypenameCompartment.of(placeholderTypenameExtensionConfig()),
        EditorView.lineWrapping,
        ariaCompartment.of(ariaExtensions()),
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
  () => props.schema,
  (schema, prev) => {
    if (!view || props.language !== 'graphql') return
    const hadSchema = Boolean(prev)
    const hasSchema = Boolean(schema)
    if (hadSchema !== hasSchema) {
      view.dispatch({ effects: languageCompartment.reconfigure(graphqlExtensions()) })
    }
    if (hasSchema) updateSchema(view, schema as Parameters<typeof updateSchema>[1])
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

watch(
  () => [props.language, props.readonly, props.valueCycleEnumOptions, props.schema] as const,
  () => {
    view?.dispatch({ effects: valueCycleCompartment.reconfigure(valueCycleExtensions()) })
  },
  { deep: true },
)

watch(
  () => [props.language, props.graphqlOperation] as const,
  () => {
    view?.dispatch({
      effects: placeholderTypenameCompartment.reconfigure(placeholderTypenameExtensionConfig()),
    })
  },
)

watch(isDark, (dark) => {
  view?.dispatch({ effects: themeCompartment.reconfigure(buildTheme(dark)) })
})

watch(
  () => [props.ariaLabel, props.language, props.readonly] as const,
  () => {
    view?.dispatch({ effects: ariaCompartment.reconfigure(ariaExtensions()) })
  },
)

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
  getCursorOffset() {
    return view?.state.selection.main.head ?? 0
  },
})
</script>

<template>
  <div class="code-editor" :aria-keyshortcuts="editorKeyShortcuts()">
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
  cursor: text;
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
