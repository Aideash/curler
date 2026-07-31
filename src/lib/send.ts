import { sendRequest } from './backend'
import { resolveRequest, traceRequest, type BuildTrace, type ResolvedRequest, type VariableSet } from './vars'
import type { HttpResponse, RequestModel } from '../types'

/**
 * Everything the interface needs to know about one send, whether it succeeded,
 * failed at the far end, or was refused before leaving the machine.
 */
export interface SendOutcome {
  response: HttpResponse | null
  error: string | null
  /** Distinguishes "we refused to send" from "the server rejected it". */
  errorTitle: string
  errorChip: string
  trace: BuildTrace | null
}

/**
 * Sending `${API_KEY}` verbatim is never what anyone wants; it arrives at the
 * far end as a nonsense credential and comes back as a confusing 401 or 403.
 * Refuse, and say exactly what needs fixing.
 */
export function variableProblem(
  resolved: ResolvedRequest,
  environmentName: string,
): string | null {
  if (!resolved.missing.length && !resolved.empty.length) return null

  const lines: string[] = []
  if (resolved.missing.length) {
    lines.push(
      `Not defined in the active environment: ${resolved.missing.map((n) => '$' + n).join(', ')}`,
    )
  }
  if (resolved.empty.length) {
    lines.push(`Defined but empty: ${resolved.empty.map((n) => '$' + n).join(', ')}`)
  }

  lines.push(
    `Open Vars to set them, at whichever scope fits. The active environment is "${environmentName}".`,
  )
  lines.push(
    'A variable needs a name in the left-hand field; a row with only a value is ignored.',
  )

  return lines.join('\n')
}

/**
 * One send, start to finish. The builder and every compare lane go through
 * here, which is what keeps a lane from quietly growing its own rules about
 * unresolved variables or when the trace is captured.
 */
export async function performSend(
  request: RequestModel,
  set: VariableSet,
  environmentName: string,
): Promise<SendOutcome> {
  const resolved = resolveRequest(request, set.values)

  const problem = variableProblem(resolved, environmentName)
  if (problem) {
    return {
      response: null,
      error: problem,
      errorTitle: 'Not sent: unresolved variables',
      errorChip: 'Not sent',
      trace: null,
    }
  }

  // Snapshotted before the send, so the diagnostics describe the request that
  // actually went out rather than whatever the editor holds when it returns.
  const trace = traceRequest(request, set)

  try {
    return {
      response: await sendRequest(resolved),
      error: null,
      errorTitle: 'Request failed',
      errorChip: 'Failed',
      trace,
    }
  } catch (caught) {
    return {
      response: null,
      error: caught instanceof Error ? caught.message : String(caught),
      errorTitle: 'Request failed',
      errorChip: 'Failed',
      trace,
    }
  }
}
