import { createHarness, loadModules } from './harness.mjs'

const { modules, close } = await loadModules(['/src/lib/response.ts'])

const {
  canPrettyPrintResponse,
  isHtmlResponse,
  isJsonResponse,
  isJavascriptResponse,
  prettyBody,
  prettyJavascriptBody,
  prettyResponseBody,
  responseEditorLanguage,
} = modules
const { group, expect, summary } = createHarness('response')

function response(partial = {}) {
  return {
    status: 200,
    statusText: 'OK',
    headers: partial.headers ?? [['Content-Type', partial.contentType ?? 'text/plain']],
    body: '',
    bodyIsBinary: false,
    elapsedMs: 10,
    bytes: 0,
    finalUrl: 'https://example.test/',
    redirectChain: [],
    truncated: false,
    diagnostics: { hops: [], totalMs: 10, maxResponseMb: 10, truncated: false },
    ...partial,
  }
}

group('content types')

expect(
  'JSON content type is detected',
  isJsonResponse(response({ contentType: 'application/json' })),
  true,
)
expect(
  'JavaScript content type is detected',
  isJavascriptResponse(response({ contentType: 'text/javascript' })),
  true,
)
expect(
  'HTML content type is detected',
  isHtmlResponse(response({ contentType: 'text/html; charset=utf-8' })),
  true,
)
expect(
  'XHTML content type is detected',
  isHtmlResponse(response({ contentType: 'application/xhtml+xml' })),
  true,
)
expect(
  'HTML responses use the html editor language',
  responseEditorLanguage(response({ contentType: 'text/html' })),
  'html',
)
expect(
  'plain text stays plain text',
  responseEditorLanguage(response({ contentType: 'text/plain' })),
  'text',
)
expect(
  'can pretty-print JSON and JavaScript',
  canPrettyPrintResponse(response({ contentType: 'application/json' })) &&
    canPrettyPrintResponse(response({ contentType: 'text/javascript' })),
  true,
)
expect(
  'plain text is not pretty-printable',
  canPrettyPrintResponse(response({ contentType: 'text/plain' })),
  false,
)

group('prettyBody')

expect('valid JSON is indented', prettyBody('{"b":1,"a":2}'), '{\n  "b": 1,\n  "a": 2\n}')
expect('invalid JSON passes through untouched', prettyBody('{not json'), '{not json')

group('prettyJavascriptBody')

expect(
  'JavaScript is indented',
  prettyJavascriptBody('function f(){return 1}'),
  'function f() {\n  return 1\n}',
)

group('prettyResponseBody')

expect(
  'JSON responses use JSON formatting',
  prettyResponseBody(response({ contentType: 'application/json' }), '{"a":1}'),
  '{\n  "a": 1\n}',
)
expect(
  'JavaScript responses use JS formatting',
  prettyResponseBody(response({ contentType: 'text/javascript' }), 'function f(){return 1}'),
  'function f() {\n  return 1\n}',
)

await close()
summary()
