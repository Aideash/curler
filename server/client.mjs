import http from 'node:http'
import https from 'node:https'
import zlib from 'node:zlib'

const MAX_REDIRECTS = 10
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

export const DEFAULT_MAX_RESPONSE_MB = 10

const now = () => Number(process.hrtime.bigint()) / 1e6

/** X.509 names arrive as objects; `CN=api.example.com, O=Example` reads better. */
function formatName(name) {
  if (!name || typeof name !== 'object') return null
  const parts = []
  for (const key of ['CN', 'O', 'OU', 'L', 'ST', 'C']) {
    if (name[key]) parts.push(`${key}=${name[key]}`)
  }
  return parts.length ? parts.join(', ') : null
}

function describeCertificate(socket) {
  let certificate
  try {
    certificate = socket.getPeerCertificate(false)
  } catch {
    return null
  }
  if (!certificate || !certificate.subject) return null

  return {
    protocol: socket.getProtocol?.() ?? null,
    cipher: socket.getCipher?.()?.name ?? null,
    subject: formatName(certificate.subject),
    issuer: formatName(certificate.issuer),
    validFrom: certificate.valid_from ?? null,
    validTo: certificate.valid_to ?? null,
    altNames: certificate.subjectaltname ?? null,
    authorized: socket.authorized === true,
    authorizationError: socket.authorizationError ? String(socket.authorizationError) : null,
  }
}

/**
 * Performs one hop. Written against node:https rather than global fetch so the
 * request can opt out of certificate verification, control redirects itself and
 * report accurate timings -- the things curl gives you and fetch does not.
 *
 * Diagnostics are gathered unconditionally. They cost a few socket listeners,
 * and the moment you actually want them is always the request that already
 * happened, so there is nothing to gain by making the caller ask first.
 */
function requestOnce({ url, method, headers, body, insecure, timeoutMs, maxBytes }) {
  return new Promise((resolve, reject) => {
    let target
    try {
      target = new URL(url)
    } catch {
      reject(new Error(`"${url}" is not a valid URL.`))
      return
    }

    if (target.protocol !== 'http:' && target.protocol !== 'https:') {
      reject(new Error(`Unsupported protocol "${target.protocol}".`))
      return
    }

    const startedAt = now()
    const marks = { dns: null, connect: null, tls: null, firstByte: null }
    const connection = { remoteAddress: null, remotePort: null, reused: false }
    let tls = null
    let settled = false

    const transport = target.protocol === 'https:' ? https : http
    const path = `${target.pathname}${target.search}`

    const request = transport.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || (target.protocol === 'https:' ? 443 : 80),
        path,
        method,
        headers,
        rejectUnauthorized: !insecure,
      },
      (response) => {
        marks.firstByte = now()

        const chunks = []
        let received = 0
        let truncated = false

        response.on('data', (chunk) => {
          if (truncated) return
          const room = maxBytes - received
          if (chunk.length >= room) {
            // Keep exactly up to the cap, then stop pulling bytes off the wire
            // rather than buffering a response nobody asked to download.
            if (room > 0) chunks.push(chunk.subarray(0, room))
            received += room
            truncated = true
            request.destroy()
            return
          }
          chunks.push(chunk)
          received += chunk.length
        })

        const finish = () => {
          if (settled) return
          settled = true
          resolve({
            status: response.statusCode ?? 0,
            statusText: response.statusMessage ?? '',
            httpVersion: response.httpVersion ?? '',
            headers: response.headers,
            raw: Buffer.concat(chunks),
            truncated,
            endedAt: now(),
            startedAt,
            marks,
            connection,
            tls,
            requestPath: path,
          })
        }

        response.on('end', finish)
        // A truncated read is closed by us, so `end` never arrives.
        response.on('close', finish)
        response.on('error', (error) => {
          if (truncated) finish()
          else reject(error)
        })
      },
    )

    request.on('socket', (socket) => {
      // A pooled socket skips lookup and connect entirely, which is worth
      // reporting rather than showing as a suspiciously instant handshake.
      if (socket.connecting === false) {
        connection.reused = true
        connection.remoteAddress = socket.remoteAddress ?? null
        connection.remotePort = socket.remotePort ?? null
        return
      }

      socket.on('lookup', () => {
        marks.dns = now()
      })
      socket.on('connect', () => {
        marks.connect = now()
        connection.remoteAddress = socket.remoteAddress ?? null
        connection.remotePort = socket.remotePort ?? null
      })
      socket.on('secureConnect', () => {
        marks.tls = now()
        tls = describeCertificate(socket)
      })
    })

    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error(`The request timed out after ${timeoutMs} ms.`))
    })

    request.on('error', (error) => {
      if (settled) return
      if (error.code === 'ENOTFOUND') {
        reject(new Error(`Could not resolve host "${target.hostname}".`))
      } else if (error.code === 'ECONNREFUSED') {
        reject(new Error(`Connection refused by ${target.host}.`))
      } else if (
        error.code === 'DEPTH_ZERO_SELF_SIGNED_CERT' ||
        error.code === 'SELF_SIGNED_CERT_IN_CHAIN'
      ) {
        reject(
          new Error(
            'The server presented a self-signed certificate. Enable "Skip TLS verify" to accept it.',
          ),
        )
      } else {
        reject(error)
      }
    })

    if (body) request.write(body)
    request.end()
  })
}

function decompress(raw, encoding) {
  if (!encoding || raw.length === 0) return raw
  try {
    switch (encoding.trim().toLowerCase()) {
      case 'gzip':
        return zlib.gunzipSync(raw)
      case 'deflate':
        return zlib.inflateSync(raw)
      case 'br':
        return zlib.brotliDecompressSync(raw)
      default:
        return raw
    }
  } catch {
    // A body that will not decompress is more useful returned as-is than as an error.
    return raw
  }
}

function flattenHeaders(headers) {
  const flat = []
  for (const [name, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      for (const entry of value) flat.push([name, entry])
    } else if (value !== undefined) {
      flat.push([name, String(value)])
    }
  }
  return flat
}

/** Milliseconds between two marks, or null when a stage did not happen. */
function span(from, to) {
  if (from === null || to === null) return null
  return Math.round((to - from) * 100) / 100
}

function buildTimings(result) {
  const { startedAt, marks, endedAt } = result
  const connectStart = marks.dns ?? startedAt
  const requestSent = marks.tls ?? marks.connect ?? startedAt

  return {
    dnsMs: span(startedAt, marks.dns),
    connectMs: span(connectStart, marks.connect),
    tlsMs: span(marks.connect, marks.tls),
    waitingMs: span(requestSent, marks.firstByte),
    downloadMs: span(marks.firstByte, endedAt),
    totalMs: span(startedAt, endedAt) ?? 0,
  }
}

export async function performRequest(spec) {
  const timeoutMs = Math.min(Math.max(spec.timeoutSecs ?? 30, 1), 600) * 1000
  const maxMb = Math.min(Math.max(spec.maxResponseMb ?? DEFAULT_MAX_RESPONSE_MB, 1), 2048)
  const maxBytes = maxMb * 1024 * 1024

  const headers = {}
  for (const [name, value] of spec.headers ?? []) {
    if (!name) continue
    // Repeated header names are collected so things like multiple cookies survive.
    if (headers[name] === undefined) headers[name] = value
    else if (Array.isArray(headers[name])) headers[name].push(value)
    else headers[name] = [headers[name], value]
  }

  const has = (name) => Object.keys(headers).some((key) => key.toLowerCase() === name.toLowerCase())

  if (!has('accept')) headers.Accept = '*/*'
  if (!has('user-agent')) headers['User-Agent'] = 'curler/0.1'
  if (!has('accept-encoding')) headers['Accept-Encoding'] = 'gzip, deflate, br'

  const body = spec.body ? Buffer.from(spec.body, 'utf8') : null
  if (body && !has('content-length')) headers['Content-Length'] = String(body.length)

  let url = spec.url.trim()
  let method = (spec.method || 'GET').toUpperCase()
  let payload = body
  const redirectChain = []
  const hops = []

  const started = process.hrtime.bigint()

  for (let hop = 0; ; hop += 1) {
    const result = await requestOnce({
      url,
      method,
      headers,
      body: payload,
      insecure: Boolean(spec.insecure),
      timeoutMs,
      maxBytes,
    })

    const decoded = decompress(result.raw, result.headers['content-encoding'])

    hops.push({
      index: hop,
      method,
      url,
      requestTarget: result.requestPath,
      // Exactly what went out, including the headers curler adds for you.
      requestHeaders: flattenHeaders(headers),
      requestBodyBytes: payload ? payload.length : 0,
      status: result.status,
      statusText: result.statusText,
      httpVersion: result.httpVersion,
      responseHeaders: flattenHeaders(result.headers),
      remoteAddress: result.connection.remoteAddress,
      remotePort: result.connection.remotePort,
      reusedConnection: result.connection.reused,
      tls: result.tls,
      timings: buildTimings(result),
      wireBytes: result.raw.length,
      decodedBytes: decoded.length,
      contentEncoding: result.headers['content-encoding'] ?? null,
      truncated: result.truncated,
    })

    const location = result.headers.location
    const isRedirect = REDIRECT_STATUSES.has(result.status) && Boolean(location)

    if (isRedirect && spec.followRedirects && hop < MAX_REDIRECTS) {
      redirectChain.push({ status: result.status, from: url, to: location })
      url = new URL(location, url).toString()

      // 303 always becomes GET; 301 and 302 do so for anything that is not GET/HEAD,
      // which is what curl -L and every browser actually do in practice.
      if (
        result.status === 303 ||
        (method !== 'GET' && method !== 'HEAD' && result.status !== 307 && result.status !== 308)
      ) {
        method = 'GET'
        payload = null
        delete headers['Content-Length']
        delete headers['content-length']
      }
      continue
    }

    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6
    const text = decoded.toString('utf8')
    // A round-trip mismatch means the payload was not valid UTF-8 text.
    const bodyIsBinary = Buffer.compare(Buffer.from(text, 'utf8'), decoded) !== 0

    return {
      status: result.status,
      statusText: result.statusText,
      headers: flattenHeaders(result.headers),
      body: bodyIsBinary ? `<${decoded.length} bytes of binary data>` : text,
      bodyIsBinary,
      elapsedMs: Math.round(elapsedMs),
      bytes: result.raw.length,
      finalUrl: url,
      redirectChain,
      truncated: result.truncated,
      diagnostics: {
        hops,
        totalMs: Math.round(elapsedMs),
        maxResponseMb: maxMb,
        truncated: result.truncated,
      },
    }
  }
}
