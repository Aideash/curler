import http from 'node:http'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { performRequest } from './client.mjs'
import { checkUploadPath } from './paths.mjs'
import { stageUploadedFile } from './staging.mjs'
import { getUploadPolicy, uploadPolicyForClient } from './uploadPolicy.mjs'
import { resolveMaxUploadBytes } from '../config.mjs'
import {
  copySecret,
  deleteSecret,
  readSecrets,
  readWorkspaceMeta,
  requireWorkspaceId,
  setSecret,
} from './secrets.mjs'
import {
  readWorkspace,
  writeWorkspace,
  listBackups,
  restoreBackup,
  WORKSPACE_FILE,
} from './storage.mjs'
import { debugEnabled, debugLog } from './debug.mjs'
import { resolvePorts } from '../config.mjs'

/**
 * A typo in .env deserves a sentence, not a stack trace: the reader is looking
 * at a config file, not at this code.
 */
function resolvePortOrExit() {
  try {
    return resolvePorts().api
  } catch (error) {
    console.error(error.message)
    process.exit(1)
  }
}

const PORT = resolvePortOrExit()
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIST = path.join(ROOT, 'dist')

/** Renders the diagnostics the UI shows, in curl's `>` and `<` trace shape. */
function logDiagnostics(diagnostics) {
  for (const hop of diagnostics.hops) {
    debugLog(`> ${hop.method} ${hop.url}`)
    for (const [name, value] of hop.requestHeaders) debugLog(`>   ${name}: ${value}`)
    if (hop.requestBodyBytes) debugLog(`>   [${hop.requestBodyBytes} byte body]`)

    if (hop.remoteAddress) {
      const reused = hop.reusedConnection ? ' (reused)' : ''
      debugLog(`* ${hop.remoteAddress}:${hop.remotePort}${reused}`)
    }
    if (hop.tls) {
      debugLog(`* ${hop.tls.protocol} ${hop.tls.cipher} · ${hop.tls.subject ?? 'no subject'}`)
    }

    debugLog(`< HTTP/${hop.httpVersion} ${hop.status} ${hop.statusText}`)
    for (const [name, value] of hop.responseHeaders) debugLog(`<   ${name}: ${value}`)

    const timings = Object.entries(hop.timings)
      .filter(([, value]) => value !== null)
      .map(([name, value]) => `${name.replace(/Ms$/, '')} ${value}ms`)
      .join(' · ')
    debugLog(`* ${timings} · ${hop.wireBytes} bytes${hop.truncated ? ' (truncated)' : ''}`)
  }
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

/**
 * A deliberately short allowlist rather than the whole environment. Handing
 * the page every exported variable would put cloud credentials one typo away
 * from being posted to a third party.
 */
const BUILTIN_NAMES = ['USER', 'LOGNAME', 'HOSTNAME', 'HOME', 'LANG', 'SHELL']

function builtinVariables() {
  const variables = {}
  for (const name of BUILTIN_NAMES) {
    const value = process.env[name]
    if (value) variables[name] = value
  }
  // macOS leaves HOSTNAME unset in most shells, and USER is the one people
  // actually reach for, so fill the obvious gaps rather than leaving holes.
  if (!variables.HOSTNAME) variables.HOSTNAME = os.hostname()
  if (!variables.USER && variables.LOGNAME) variables.USER = variables.LOGNAME
  return variables
}

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload)
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  })
  response.end(body)
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = []
    request.on('data', (chunk) => chunks.push(chunk))
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    request.on('error', reject)
  })
}

function readBodyBuffer(request, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let length = 0
    request.on('data', (chunk) => {
      length += chunk.length
      if (length > maxBytes) {
        request.destroy()
        reject(new Error(`File exceeds the ${Math.round(maxBytes / (1024 * 1024))} MB upload limit.`))
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => resolve(Buffer.concat(chunks)))
    request.on('error', reject)
  })
}

const MAX_STAGE_BYTES = resolveMaxUploadBytes()

async function serveStatic(url, response) {
  const relative = url === '/' ? 'index.html' : url.replace(/^\/+/, '')
  const target = path.join(DIST, relative)

  // Never let a crafted path escape the build directory.
  if (!target.startsWith(DIST)) {
    sendJson(response, 403, { error: 'Forbidden' })
    return
  }

  try {
    const file = await fs.readFile(target)
    response.writeHead(200, {
      'Content-Type': MIME_TYPES[path.extname(target)] ?? 'application/octet-stream',
    })
    response.end(file)
  } catch {
    try {
      // Unknown paths fall back to the SPA entry point.
      const index = await fs.readFile(path.join(DIST, 'index.html'))
      response.writeHead(200, { 'Content-Type': MIME_TYPES['.html'] })
      response.end(index)
    } catch {
      sendJson(response, 404, {
        error: 'No build found. Run "npm run build", or use "npm run dev" for development.',
      })
    }
  }
}

const server = http.createServer(async (request, response) => {
  const url = (request.url ?? '/').split('?')[0]

  try {
    if (url === '/api/send' && request.method === 'POST') {
      const spec = JSON.parse(await readBody(request))

      try {
        const result = await performRequest(spec)
        // The Diagnostics tab is the place to read this, so the terminal only
        // echoes it when CURLER_DEBUG asks, from the very same object.
        if (debugEnabled) logDiagnostics(result.diagnostics)
        sendJson(response, 200, result)
      } catch (error) {
        // A failed HTTP call is a normal outcome here, not a server fault.
        debugLog(`${spec.method} ${spec.url} failed: ${error.message}`)
        sendJson(response, 200, { error: error.message })
      }
      return
    }

    if (url === '/api/builtins' && request.method === 'GET') {
      sendJson(response, 200, { variables: builtinVariables() })
      return
    }

    if (url === '/api/check-paths' && request.method === 'POST') {
      const { paths } = JSON.parse(await readBody(request))
      const items = Array.isArray(paths) ? paths : []
      const results = items.map((item) => {
        const id = String(item?.id ?? '')
        const rawPath = String(item?.path ?? '')
        const checked = checkUploadPath(rawPath)
        return checked.ok ? { id, ok: true } : { id, ok: false, message: checked.message }
      })
      sendJson(response, 200, { results })
      return
    }

    if (url === '/api/current-dir' && request.method === 'GET') {
      sendJson(response, 200, { currentDir: process.cwd() })
      return
    }

    if (url === '/api/upload-policy' && request.method === 'GET') {
      sendJson(response, 200, uploadPolicyForClient(getUploadPolicy()))
      return
    }

    if (url === '/api/stage-file' && request.method === 'POST') {
      const originalName = request.headers['x-filename'] ?? 'upload'
      const buffer = await readBodyBuffer(request, MAX_STAGE_BYTES)
      const stagedPath = await stageUploadedFile(buffer, originalName, MAX_STAGE_BYTES)
      sendJson(response, 200, { path: stagedPath })
      return
    }

    if (url === '/api/workspace' && request.method === 'GET') {
      sendJson(response, 200, {
        contents: await readWorkspace(),
        path: WORKSPACE_FILE,
      })
      return
    }

    if (url === '/api/workspace' && request.method === 'PUT') {
      const { contents } = JSON.parse(await readBody(request))
      await writeWorkspace(contents)
      sendJson(response, 200, { ok: true })
      return
    }

    if (url === '/api/backups' && request.method === 'GET') {
      sendJson(response, 200, { backups: await listBackups() })
      return
    }

    const restoreMatch = url.match(/^\/api\/backups\/([^/]+)\/restore$/)
    if (restoreMatch && request.method === 'POST') {
      const name = decodeURIComponent(restoreMatch[1])
      await restoreBackup(name)
      sendJson(response, 200, { ok: true })
      return
    }

    if (url === '/api/secrets' && request.method === 'GET') {
      const { workspaceId, secretIds } = await readWorkspaceMeta()
      if (!workspaceId) {
        sendJson(response, 200, { values: {} })
        return
      }
      const requested = new URL(request.url ?? '', 'http://127.0.0.1').searchParams.get('ids')
      const rowIds = requested ? requested.split(',').filter(Boolean) : secretIds
      sendJson(response, 200, { values: await readSecrets(workspaceId, rowIds) })
      return
    }

    const secretMatch = url.match(/^\/api\/secrets\/([^/]+)$/)
    if (secretMatch && request.method === 'PUT') {
      const rowId = decodeURIComponent(secretMatch[1])
      const { value } = JSON.parse(await readBody(request))
      const workspaceId = await requireWorkspaceId()
      await setSecret(workspaceId, rowId, value ?? '')
      sendJson(response, 200, { ok: true })
      return
    }

    if (secretMatch && request.method === 'DELETE') {
      const rowId = decodeURIComponent(secretMatch[1])
      const workspaceId = await requireWorkspaceId()
      await deleteSecret(workspaceId, rowId)
      sendJson(response, 200, { ok: true })
      return
    }

    const copyMatch = url.match(/^\/api\/secrets\/([^/]+)\/copy$/)
    if (copyMatch && request.method === 'POST') {
      const toRowId = decodeURIComponent(copyMatch[1])
      const { fromRowId } = JSON.parse(await readBody(request))
      const workspaceId = await requireWorkspaceId()
      const copied = await copySecret(workspaceId, fromRowId, toRowId)
      sendJson(response, 200, { ok: true, copied })
      return
    }

    if (url.startsWith('/api/')) {
      sendJson(response, 404, { error: `Unknown endpoint ${url}` })
      return
    }

    await serveStatic(url, response)
  } catch (error) {
    sendJson(response, 500, { error: error.message })
  }
})

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(
      `Port ${PORT} is already in use, so curler is probably running elsewhere.\n` +
        'Close it, or set API_PORT in .env to move this one.',
    )
    process.exit(1)
  }
  throw error
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`curler api    http://127.0.0.1:${PORT}`)
  console.log(`workspace     ${WORKSPACE_FILE}`)
  if (debugEnabled) console.log('debug         on, logging every request')
})
