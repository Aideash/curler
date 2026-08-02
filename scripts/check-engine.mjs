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

  if (url.pathname === '/big') {
    const mb = Number(url.searchParams.get('mb') ?? 1)
    response.writeHead(200, { 'Content-Type': 'application/octet-stream' })
    for (let i = 0; i < mb; i += 1) response.write(Buffer.alloc(1024 * 1024, 0x61))
    response.end()
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
  url: `${base}/big?mb=4`,
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
  url: `${base}/big?mb=2`,
  method: 'GET',
  headers: [],
  maxResponseMb: 10,
})
h.expect('a body under the cap is untouched', uncapped.truncated, false)
h.expect('and arrives whole', uncapped.bytes, 2 * 1024 * 1024)

const defaulted = await performRequest({ url: `${base}/`, method: 'GET', headers: [] })
h.expect('the cap defaults to 10 MB', defaulted.diagnostics.maxResponseMb, 10)

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
