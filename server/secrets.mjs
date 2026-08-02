import keytar from 'keytar'

import { readWorkspace } from './storage.mjs'

const SERVICE = 'curler'

function account(workspaceId, rowId) {
  return `${workspaceId}/${rowId}`
}

function visitRows(rows, ids) {
  for (const row of rows ?? []) {
    if (row.secret && row.id) ids.push(row.id)
  }
}

/** Every secret row id in a parsed workspace object. */
export function secretRowIds(parsed) {
  const ids = []
  visitRows(parsed.globals, ids)
  for (const environment of parsed.environments ?? []) visitRows(environment.variables, ids)
  for (const collection of parsed.collections ?? []) {
    visitRows(collection.variables, ids)
    for (const request of collection.requests ?? []) visitRows(request.variables, ids)
  }
  return ids
}

export async function readWorkspaceMeta() {
  const contents = await readWorkspace()
  if (!contents) return { workspaceId: null, secretIds: [] }
  try {
    const parsed = JSON.parse(contents)
    return {
      workspaceId: parsed.workspaceId ?? null,
      secretIds: secretRowIds(parsed),
    }
  } catch {
    return { workspaceId: null, secretIds: [] }
  }
}

export async function requireWorkspaceId() {
  const { workspaceId } = await readWorkspaceMeta()
  if (!workspaceId) {
    throw new Error('Workspace has no id yet. Reload the page and try again.')
  }
  return workspaceId
}

export async function getSecret(workspaceId, rowId) {
  return keytar.getPassword(SERVICE, account(workspaceId, rowId))
}

export async function setSecret(workspaceId, rowId, value) {
  await keytar.setPassword(SERVICE, account(workspaceId, rowId), value)
}

export async function deleteSecret(workspaceId, rowId) {
  return keytar.deletePassword(SERVICE, account(workspaceId, rowId))
}

export async function copySecret(workspaceId, fromRowId, toRowId) {
  const value = await getSecret(workspaceId, fromRowId)
  if (value === null) return false
  await setSecret(workspaceId, toRowId, value)
  return true
}

export async function readSecrets(workspaceId, rowIds) {
  const values = {}
  for (const rowId of rowIds) {
    values[rowId] = await getSecret(workspaceId, rowId)
  }
  return values
}
