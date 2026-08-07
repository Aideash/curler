import http from 'node:http'
import https from 'node:https'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHarness } from './harness.mjs'
import { performRequest } from '../server/client.mjs'

const h = createHarness('engine')

/**
 * Minted on the spot rather than committed, since a checked-in certificate
 * would expire and turn into a mystery failure months from now. Returns null
 * where openssl is unavailable, and the TLS checks are skipped.
 */
function selfSignedCertificate() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'curler-tls-'))
  const key = path.join(dir, 'key.pem')
  const cert = path.join(dir, 'cert.pem')

  try {
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-keyout',
        key,
        '-out',
        cert,
        '-days',
        '1',
        '-nodes',
        '-subj',
        '/CN=localhost/O=Curler Test',
        '-addext',
        'subjectAltName=DNS:localhost,IP:127.0.0.1',
      ],
      { stdio: 'ignore' },
    )
  } catch {
    return null
  }

  return { key: fs.readFileSync(key), cert: fs.readFileSync(cert) }
}

/**
 * A throwaway server on a loopback port. Exercising the real socket path is the
 * only way to know the timings, sizes and truncation logic actually hold.
 */
const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost')

  if (url.pathname === '/binary') {
    response.writeHead(200, { 'Content-Type': 'application/octet-stream' })
    response.end(Buffer.alloc(256, 0xff))
    return
  }

  if (url.pathname === '/big') {
    const mb = Number(url.searchParams.get('mb') ?? 1)
    response.writeHead(200, { 'Content-Type': 'application/octet-stream' })
    for (let i = 0; i < mb; i += 1) response.write(Buffer.alloc(1024 * 1024, 0x61))
    response.end()
    return
  }

  if (url.pathname === '/big-text') {
    const mb = Number(url.searchParams.get('mb') ?? 1)
    response.writeHead(200, { 'Content-Type': 'text/plain' })
    for (let i = 0; i < mb; i += 1) response.write('a'.repeat(1024 * 1024))
    response.end()
    return
  }

  if (url.pathname === '/image') {
    response.writeHead(200, {
      'Content-Type': 'image/png',
      'Content-Length': '8192',
    })
    response.end(Buffer.alloc(8192, 0xff))
    return
  }

  if (url.pathname === '/script') {
    response.writeHead(200, { 'Content-Type': 'application/javascript' })
    response.end('alert("should not run")')
    return
  }

  if (url.pathname === '/pdf') {
    response.writeHead(200, {
      'Content-Type': 'application/pdf',
      'Content-Length': '4096',
    })
    response.end(Buffer.alloc(4096, 0x25))
    return
  }

  if (url.pathname === '/zip') {
    response.writeHead(200, { 'Content-Type': 'application/zip' })
    response.end(Buffer.from('PK\x03\x04', 'binary'))
    return
  }

  if (url.pathname === '/multipart-echo') {
    const chunks = []
    request.on('data', (chunk) => chunks.push(chunk))
    request.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      const textOk = /name="name"\r\n\r\nbob\r\n/.test(raw)
      const fileOk = /name="file"[\s\S]*?\r\n\r\nfile-bytes\r\n/.test(raw)
      response.writeHead(200, { 'Content-Type': 'text/plain' })
      response.end(
        textOk && fileOk ? 'multipart-file-ok' : textOk ? 'multipart-ok' : 'multipart-fail',
      )
    })
    return
  }

  if (url.pathname === '/redirect') {
    response.writeHead(302, { Location: '/landed' })
    response.end()
    return
  }

  if (url.pathname === '/landed') {
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end('{"ok":true}')
    return
  }

  response.writeHead(200, { 'Content-Type': 'text/plain', 'X-Echo': request.method })
  response.end('hello')
})

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`

// -- Diagnostics ------------------------------------------------------------

h.group('diagnostics')

const plain = await performRequest({ url: `${base}/`, method: 'GET', headers: [] })

h.expect('one hop for a direct request', plain.diagnostics.hops.length, 1)
h.expect('the body arrives', plain.body, 'hello')
h.expect('nothing was truncated', plain.truncated, false)

const hop = plain.diagnostics.hops[0]
h.expect('the hop records the method', hop.method, 'GET')
h.expect('the hop records the status', hop.status, 200)
h.expect('the request target is a path, not a URL', hop.requestTarget, '/')
h.expect('plain HTTP has no TLS block', hop.tls, null)
h.expect('the peer address is captured', hop.remoteAddress, '127.0.0.1')

const sentNames = hop.requestHeaders.map(([name]) => name.toLowerCase())
h.expect('the defaults curler adds are reported', sentNames.includes('user-agent'), true)
h.expect('accept-encoding is reported', sentNames.includes('accept-encoding'), true)

const receivedNames = hop.responseHeaders.map(([name]) => name.toLowerCase())
h.expect('response headers are captured', receivedNames.includes('x-echo'), true)

h.expect('a total time is always present', typeof hop.timings.totalMs, 'number')
h.expect('the total is not negative', hop.timings.totalMs >= 0, true)
h.expect(
  'stage times never exceed the total',
  ['dnsMs', 'connectMs', 'tlsMs', 'waitingMs', 'downloadMs']
    .map((key) => hop.timings[key])
    .filter((value) => value !== null)
    .every((value) => value <= hop.timings.totalMs + 1),
  true,
)

// -- Multipart bodies -------------------------------------------------------

h.group('multipart')

const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'curler-engine-upload-'))
const uploadFile = path.join(uploadDir, 'payload.txt')
fs.writeFileSync(uploadFile, 'file-bytes')

const multipart = await performRequest({
  url: `${base}/multipart-echo`,
  method: 'POST',
  headers: [],
  multipart: [{ name: 'name', value: 'bob' }],
})

h.expect('text multipart parts are encoded and sent', multipart.body, 'multipart-ok')
h.expect(
  'multipart content-type was set on the wire',
  multipart.diagnostics.hops[0].requestHeaders.some(
    ([name, value]) =>
      name.toLowerCase() === 'content-type' && value.startsWith('multipart/form-data'),
  ),
  true,
)

const multipartFile = await performRequest({
  url: `${base}/multipart-echo`,
  method: 'POST',
  headers: [],
  multipart: [
    { name: 'name', value: 'bob' },
    { name: 'file', value: `@${uploadFile}` },
  ],
})

h.expect('file parts are read from disk and sent', multipartFile.body, 'multipart-file-ok')

const missingFile = await performRequest({
  url: `${base}/`,
  method: 'POST',
  headers: [],
  multipart: [{ name: 'file', value: `@${path.join(uploadDir, 'missing.txt')}` }],
}).catch((error) => error)

h.expect(
  'missing files fail with a readable error',
  missingFile instanceof Error && /not found/i.test(missingFile.message),
  true,
)

const stdinPart = await performRequest({
  url: `${base}/`,
  method: 'POST',
  headers: [],
  multipart: [{ name: 'file', value: '@-' }],
}).catch((error) => error)

h.expect(
  'stdin file parts fail with a readable error',
  stdinPart instanceof Error && /stdin/i.test(stdinPart.message),
  true,
)

const literalAt = await performRequest({
  url: `${base}/multipart-echo`,
  method: 'POST',
  headers: [],
  multipart: [{ name: 'note', value: '@not-a-file', textOnly: true }],
})

h.expect(
  'form-string parts are sent as literal text',
  literalAt.diagnostics.hops[0].requestBodyBytes > 0 && literalAt.status === 200,
  true,
)

const { resetUploadPolicy } = await import('../server/uploadPolicy.mjs')

process.env.CURLER_UPLOAD_ALLOW = uploadDir
resetUploadPolicy()

const blockedOutside = await performRequest({
  url: `${base}/`,
  method: 'POST',
  headers: [],
  multipart: [{ name: 'file', value: `@${path.join(os.tmpdir(), 'curler-blocked-test.txt')}` }],
}).catch((error) => error)

h.expect(
  'paths outside CURLER_UPLOAD_ALLOW fail at send time',
  blockedOutside instanceof Error && /not permitted/i.test(blockedOutside.message),
  true,
)

delete process.env.CURLER_UPLOAD_ALLOW
resetUploadPolicy()

fs.rmSync(uploadDir, { recursive: true, force: true })

// -- Redirects --------------------------------------------------------------

h.group('redirects')

const redirected = await performRequest({
  url: `${base}/redirect`,
  method: 'GET',
  headers: [],
  followRedirects: true,
})

h.expect('every hop is recorded', redirected.diagnostics.hops.length, 2)
h.expect('the first hop kept its 302', redirected.diagnostics.hops[0].status, 302)
h.expect('the second hop landed', redirected.diagnostics.hops[1].status, 200)
h.expect('the final body is the landing page', redirected.body, '{"ok":true}')
h.expect('the redirect chain is reported', redirected.redirectChain.length, 1)

const notFollowed = await performRequest({
  url: `${base}/redirect`,
  method: 'GET',
  headers: [],
  followRedirects: false,
})
h.expect('one hop when redirects are off', notFollowed.diagnostics.hops.length, 1)
h.expect('the 302 is surfaced', notFollowed.status, 302)

// -- Response cap -----------------------------------------------------------

h.group('response cap')

const capped = await performRequest({
  url: `${base}/big-text?mb=4`,
  method: 'GET',
  headers: [],
  maxResponseMb: 1,
})

h.expect('the cap is reported as hit', capped.truncated, true)
h.expect('diagnostics agree', capped.diagnostics.truncated, true)
h.expect('the cap value is reported', capped.diagnostics.maxResponseMb, 1)
h.expect('no more than the cap is kept', capped.bytes <= 1024 * 1024, true)
h.expect('the cap is actually reached', capped.bytes, 1024 * 1024)

const uncapped = await performRequest({
  url: `${base}/big-text?mb=2`,
  method: 'GET',
  headers: [],
  maxResponseMb: 10,
})
h.expect('a body under the cap is untouched', uncapped.truncated, false)
h.expect('and arrives whole', uncapped.bytes, 2 * 1024 * 1024)

const defaulted = await performRequest({ url: `${base}/`, method: 'GET', headers: [] })
h.expect('the cap defaults to 1 MB', defaulted.diagnostics.maxResponseMb, 1)

// -- Body policy -------------------------------------------------------------

h.group('body policy')

const binary = await performRequest({ url: `${base}/binary`, method: 'GET', headers: [] })
h.expect('octet-stream is buffered', binary.bodySkipped, false)
h.expect('opaque binary is flagged', binary.bodyIsBinary, true)
h.expect('the placeholder names the size', /256 bytes of binary data/.test(binary.body), true)

const image = await performRequest({ url: `${base}/image`, method: 'GET', headers: [] })
h.expect('images are buffered for preview', image.bodySkipped, false)
h.expect('image preview metadata is present', image.bodyPreview, 'image')
h.expect('image bytes are base64-encoded', typeof image.bodyBase64, 'string')
h.expect('base64 is non-empty', (image.bodyBase64 ?? '').length > 0, true)

const script = await performRequest({ url: `${base}/script`, method: 'GET', headers: [] })
h.expect('javascript is buffered as text', script.bodySkipped, false)
h.expect('the script source arrives', /alert/.test(script.body), true)

const pdf = await performRequest({ url: `${base}/pdf`, method: 'GET', headers: [] })
h.expect('pdf is not buffered', pdf.bodySkipped, true)
h.expect('pdf placeholder names the type', /pdf/i.test(pdf.body), true)

const archive = await performRequest({ url: `${base}/zip`, method: 'GET', headers: [] })
h.expect('archives are not buffered', archive.bodySkipped, true)

const head = await performRequest({ url: `${base}/`, method: 'HEAD', headers: [] })
h.expect('HEAD has no body', head.bodySkipped, true)

// -- TLS --------------------------------------------------------------------

h.group('tls')

const certificate = selfSignedCertificate()
if (!certificate) {
  h.detail('openssl is unavailable, skipping the TLS checks')
} else {
  const tlsServer = https.createServer(certificate, (request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end('{"ok":true}')
  })
  await new Promise((resolve) => tlsServer.listen(0, '127.0.0.1', resolve))
  const tlsBase = `https://127.0.0.1:${tlsServer.address().port}/`

  let rejection = null
  try {
    await performRequest({ url: tlsBase, method: 'GET', headers: [] })
  } catch (error) {
    rejection = error.message
  }
  h.expect(
    'a self-signed certificate is refused by default',
    /self-signed/i.test(rejection ?? ''),
    true,
  )
  h.expect('and the message points at the fix', /Skip TLS verify/.test(rejection ?? ''), true)

  const accepted = await performRequest({
    url: tlsBase,
    method: 'GET',
    headers: [],
    insecure: true,
  })
  const tls = accepted.diagnostics.hops[0].tls

  h.expect('insecure mode gets through', accepted.status, 200)
  h.expect('the certificate is reported', tls !== null, true)
  h.expect('the protocol is named', /^TLSv/.test(tls.protocol ?? ''), true)
  h.expect('the cipher is named', typeof tls.cipher, 'string')
  h.expect('the subject is readable', tls.subject, 'CN=localhost, O=Curler Test')
  h.expect('the issuer is readable', tls.issuer, 'CN=localhost, O=Curler Test')
  h.expect('alt names are captured', /127\.0\.0\.1/.test(tls.altNames ?? ''), true)
  h.expect('validity dates are present', Boolean(tls.validFrom && tls.validTo), true)
  h.expect('an unverified certificate says so', tls.authorized, false)
  h.expect('and names the reason', tls.authorizationError, 'DEPTH_ZERO_SELF_SIGNED_CERT')
  h.expect('a TLS handshake is timed', accepted.diagnostics.hops[0].timings.tlsMs !== null, true)

  tlsServer.close()
}

// -- Failures ---------------------------------------------------------------

h.group('failures')

let refused = null
try {
  // Port 1 on loopback has nothing listening.
  await performRequest({ url: 'http://127.0.0.1:1/', method: 'GET', headers: [] })
} catch (error) {
  refused = error.message
}
h.expect('a refused connection explains itself', /refused/i.test(refused ?? ''), true)

let badUrl = null
try {
  await performRequest({ url: 'not a url', method: 'GET', headers: [] })
} catch (error) {
  badUrl = error.message
}
h.expect('an invalid URL explains itself', /not a valid URL/i.test(badUrl ?? ''), true)

server.close()
process.exit(h.summary() === 0 ? 0 : 1)
