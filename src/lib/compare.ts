import { reactive } from 'vue'
import { newRequest, uid, type Environment, type RequestModel } from '../types'
import { buildVariableSet, collectionOfRequest, environmentById, state } from './store'
import { performSend, type SendOutcome } from './send'
import type { VariableSet } from './vars'

/**
 * A comparison is deliberately not part of the workspace. Nothing here is
 * persisted, and every lane holds a *copy* of its request: editing lane B's URL
 * to point at production must never reach through and rewrite the saved request
 * it came from, which autosave would then write to disk.
 */
export interface Lane {
  id: string
  /** A, B, C, D. Positional, and reassigned when a lane is removed. */
  label: string
  request: RequestModel
  environmentId: string | null
  /** Where the lane was seeded from, for the "from" label. Null once edited freely. */
  sourceRequestId: string | null
  sending: boolean
  outcome: SendOutcome | null
  /** The request as it was when `outcome` was produced, to detect edits since. */
  sentSignature: string | null
}

export const MAX_LANES = 4

const LABELS = ['A', 'B', 'C', 'D']

export const compare = reactive<{ lanes: Lane[] }>({ lanes: [] })

function clone(request: RequestModel): RequestModel {
  const copy: RequestModel = JSON.parse(JSON.stringify(request))
  copy.id = uid()
  return copy
}

/**
 * Everything that changes what would be sent. Compared as a string so a lane
 * can say its response is out of date without keeping a second copy of the
 * request around.
 */
function signature(lane: Lane): string {
  return JSON.stringify([lane.request, lane.environmentId])
}

function relabel() {
  compare.lanes.forEach((lane, index) => {
    lane.label = LABELS[index] ?? String(index + 1)
  })
}

function makeLane(request: RequestModel, sourceRequestId: string | null): Lane {
  return {
    id: uid(),
    label: '',
    request: clone(request),
    environmentId: state.activeEnvironmentId,
    sourceRequestId,
    sending: false,
    outcome: null,
    sentSignature: null,
  }
}

export function addLane(seed?: RequestModel, sourceRequestId: string | null = null) {
  if (compare.lanes.length >= MAX_LANES) return
  compare.lanes.push(makeLane(seed ?? newRequest(), sourceRequestId))
  relabel()
}

export function removeLane(id: string) {
  // Two lanes is the floor: a comparison of one is the builder.
  if (compare.lanes.length <= 2) return
  const index = compare.lanes.findIndex((lane) => lane.id === id)
  if (index === -1) return
  compare.lanes.splice(index, 1)
  relabel()
}

/** Copies a lane's request and environment, which is the quickest way to a pair that differs in one field. */
export function duplicateLane(id: string) {
  if (compare.lanes.length >= MAX_LANES) return
  const index = compare.lanes.findIndex((lane) => lane.id === id)
  if (index === -1) return

  const source = compare.lanes[index]
  const copy = makeLane(source.request, source.sourceRequestId)
  copy.environmentId = source.environmentId
  compare.lanes.splice(index + 1, 0, copy)
  relabel()
}

/** Loads a saved request into a lane, as a copy. Its response is dropped, since it now describes something else. */
export function seedLane(id: string, requestId: string) {
  const lane = compare.lanes.find((item) => item.id === id)
  if (!lane) return

  for (const collection of state.collections) {
    const found = collection.requests.find((request) => request.id === requestId)
    if (!found) continue
    lane.request = clone(found)
    lane.sourceRequestId = requestId
    lane.outcome = null
    lane.sentSignature = null
    return
  }
}

/**
 * Opens a comparison from whatever the builder has on screen: the request as
 * lane A, and a copy of it as lane B. Any previous comparison is discarded,
 * since carrying stale lanes into a new one only causes confusion.
 */
export function startComparison(request: RequestModel, sourceRequestId: string | null) {
  compare.lanes = [makeLane(request, sourceRequestId), makeLane(request, sourceRequestId)]
  relabel()
}

/** Two blank lanes, for a comparison started from nothing. */
export function ensureLanes() {
  if (compare.lanes.length >= 2) return
  while (compare.lanes.length < 2) {
    compare.lanes.push(makeLane(newRequest(), null))
  }
  relabel()
}

export function laneEnvironment(lane: Lane): Environment | null {
  return environmentById(lane.environmentId)
}

/**
 * The lane's own variable table. The collection comes from wherever the lane
 * was seeded, so a collection-scoped API key keeps resolving after the lane has
 * been carried over here.
 */
export function laneVariables(lane: Lane): VariableSet {
  return buildVariableSet(
    lane.request,
    collectionOfRequest(lane.sourceRequestId),
    laneEnvironment(lane),
  )
}

/** True when the lane has been edited since the response it is showing was fetched. */
export function laneIsStale(lane: Lane): boolean {
  if (!lane.outcome || !lane.sentSignature) return false
  return signature(lane) !== lane.sentSignature
}

/**
 * One lane, on its own. Nothing here touches any other lane, so a lane can be
 * mid-flight while another holds a good response and a third has never been
 * sent -- which is the point of running them separately.
 */
export async function sendLane(id: string) {
  const lane = compare.lanes.find((item) => item.id === id)
  if (!lane || lane.sending || !lane.request.url.trim()) return

  lane.sending = true
  // The signature is taken before the await so an edit made while the request
  // is in flight still marks the result stale.
  const sent = signature(lane)

  try {
    lane.outcome = await performSend(
      lane.request,
      laneVariables(lane),
      laneEnvironment(lane)?.name ?? 'none',
    )
    lane.sentSignature = sent
  } finally {
    lane.sending = false
  }
}

/**
 * A convenience over `sendLane`, not a different path. `allSettled` rather than
 * `all` because one lane failing must not abandon the others -- a comparison
 * where one side errored is often exactly the result you were looking for.
 */
export async function sendAll() {
  await Promise.allSettled(compare.lanes.map((lane) => sendLane(lane.id)))
}
