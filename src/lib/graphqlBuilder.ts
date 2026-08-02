import { reactive } from 'vue'
import type { GraphqlBody, RequestModel } from '../types'
import { currentRequest } from './store'

export interface GraphqlBuilderDraft {
  requestId: string
  requestName: string
  graphql: GraphqlBody
}

export const graphqlBuilder = reactive({
  draft: null as GraphqlBuilderDraft | null,
  schemaLoading: false,
  schemaError: null as string | null,
  schemaCacheKey: null as string | null,
})

function cloneGraphql(graphql: GraphqlBody): GraphqlBody {
  return JSON.parse(JSON.stringify(graphql))
}

export function openFromRequest(request: RequestModel) {
  graphqlBuilder.draft = {
    requestId: request.id,
    requestName: request.name,
    graphql: cloneGraphql(request.body.graphql),
  }
  graphqlBuilder.schemaError = null
}

export function applyDraft() {
  const draft = graphqlBuilder.draft
  if (!draft) return

  const req = currentRequest.value
  req.method = 'POST'
  req.body.mode = 'graphql'
  req.body.graphql = cloneGraphql(draft.graphql)
  graphqlBuilder.draft = null
  graphqlBuilder.schemaError = null
}

export function cancelDraft() {
  graphqlBuilder.draft = null
  graphqlBuilder.schemaError = null
}

export function updateDraftGraphql(graphql: GraphqlBody) {
  if (!graphqlBuilder.draft) return
  graphqlBuilder.draft.graphql = cloneGraphql(graphql)
}
