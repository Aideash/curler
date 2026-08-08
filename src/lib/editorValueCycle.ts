import { syntaxTree } from '@codemirror/language'
import { Prec, type EditorState, type Extension } from '@codemirror/state'
import type { SyntaxNode } from '@lezer/common'
import type { GraphQLSchema } from 'graphql'
import { EditorView, keymap } from '@codemirror/view'
import { guessGraphqlEnumChoices, resolveGraphqlEnumChoicesAt } from './graphqlValueCycle'
import { cycleScalarValue, type CycleDirection } from './valueCycle'

const JSON_VALUE_NODES = new Set(['True', 'False', 'Number', 'String'])
const GRAPHQL_VALUE_NODES = new Set(['IntValue', 'BooleanValue', 'EnumValue'])

function readPropertyKey(state: EditorState, propertyNode: SyntaxNode): string | undefined {
  const nameNode = propertyNode.getChild('PropertyName')
  if (!nameNode) return undefined
  const raw = state.doc.sliceString(nameNode.from, nameNode.to)
  try {
    const parsed = JSON.parse(raw)
    if (typeof parsed === 'string') return parsed
  } catch {
    return raw.replace(/^"|"$/g, '')
  }
  return undefined
}

function locateJsonValueNode(
  state: EditorState,
  pos: number,
): { node: SyntaxNode; propertyKey?: string } | null {
  const tree = syntaxTree(state)
  let node: SyntaxNode | null = tree.resolveInner(pos, -1)

  while (node) {
    if (JSON_VALUE_NODES.has(node.name)) {
      let propertyKey: string | undefined
      for (let parent = node.parent; parent; parent = parent.parent) {
        if (parent.name === 'Property') {
          propertyKey = readPropertyKey(state, parent)
          break
        }
      }
      return { node, propertyKey }
    }
    node = node.parent
  }

  return null
}

function locateGraphqlValueNode(state: EditorState, pos: number): SyntaxNode | null {
  const tree = syntaxTree(state)
  let node: SyntaxNode | null = tree.resolveInner(pos, -1)

  while (node) {
    if (GRAPHQL_VALUE_NODES.has(node.name)) return node
    node = node.parent
  }

  return null
}

function cycleJsonAtCursor(
  view: EditorView,
  direction: CycleDirection,
  enumOptionsByKey: Record<string, string[]> | undefined,
): boolean {
  const { state } = view
  const pos = state.selection.main.head
  const located = locateJsonValueNode(state, pos)
  if (!located) return false

  const { node, propertyKey } = located
  const raw = state.doc.sliceString(node.from, node.to)
  const enumChoices = propertyKey ? enumOptionsByKey?.[propertyKey] : undefined
  const next = cycleScalarValue(
    raw,
    direction,
    enumChoices?.length ? { enumChoices, format: 'json' } : { format: 'json' },
  )
  if (next === null) return false

  view.dispatch({
    changes: { from: node.from, to: node.to, insert: next },
    selection: { anchor: node.from + next.length },
  })
  return true
}

function cycleGraphqlAtCursor(
  view: EditorView,
  direction: CycleDirection,
  schema: GraphQLSchema | null | undefined,
): boolean {
  const { state } = view
  const pos = state.selection.main.head
  const node = locateGraphqlValueNode(state, pos)
  if (!node) return false

  const raw = state.doc.sliceString(node.from, node.to)
  const doc = state.doc.toString()

  let enumChoices: string[] | undefined
  if (node.name === 'EnumValue' && schema) {
    enumChoices =
      resolveGraphqlEnumChoicesAt(doc, pos, schema) ?? guessGraphqlEnumChoices(schema, raw)
  }

  const next = cycleScalarValue(
    raw,
    direction,
    enumChoices?.length ? { enumChoices, format: 'plain' } : { format: 'plain' },
  )
  if (next === null) return false

  view.dispatch({
    changes: { from: node.from, to: node.to, insert: next },
    selection: { anchor: node.from + next.length },
  })
  return true
}

export function editorValueCycleExtensions(options: {
  language: string
  readonly: boolean
  enumOptionsByKey?: Record<string, string[]>
  schema?: GraphQLSchema | null
}): Extension[] {
  if (options.readonly) return []

  const { language, enumOptionsByKey, schema } = options
  if (language !== 'json' && language !== 'graphql') return []

  const cycle =
    language === 'json'
      ? (view: EditorView, direction: CycleDirection) =>
          cycleJsonAtCursor(view, direction, enumOptionsByKey)
      : (view: EditorView, direction: CycleDirection) =>
          cycleGraphqlAtCursor(view, direction, schema)

  return [
    Prec.highest(
      keymap.of([
        {
          key: 'Alt-Enter',
          run: (view) => cycle(view, 'next'),
        },
        {
          key: 'Shift-Alt-Enter',
          run: (view) => cycle(view, 'prev'),
        },
      ]),
    ),
  ]
}
