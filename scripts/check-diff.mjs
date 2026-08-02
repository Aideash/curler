import { createHarness, loadModules } from './harness.mjs'

const { modules, close } = await loadModules(['/src/lib/diff.ts'])

const {
  normalizeJson,
  diffLines,
  summarize,
  toUnifiedText,
  compareMeta,
  compareHeaders,
  MAX_DIFF_CHARS,
} = modules
const { group, expect, detail, summary } = createHarness('diff')

/** Shorthand for the aligned rows, as `kind left|right`, which reads well on failure. */
function shape(result) {
  return result.rows.map((row) => `${row.kind} ${row.left ?? ''}|${row.right ?? ''}`)
}

function response(partial = {}) {
  return {
    status: 200,
    statusText: 'OK',
    headers: [],
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

/* Normalisation ----------------------------------------------------------- */

group('normalizeJson')

expect('key order stops mattering', normalizeJson('{"b":1,"a":2}'), normalizeJson('{"a":2,"b":1}'))

expect(
  'nested objects are sorted too',
  normalizeJson('{"outer":{"z":1,"a":{"y":2,"b":3}}}'),
  '{\n  "outer": {\n    "a": {\n      "b": 3,\n      "y": 2\n    },\n    "z": 1\n  }\n}',
)

expect(
  'array order is preserved, since reordering changes meaning',
  normalizeJson('[3,1,2]'),
  '[\n  3,\n  1,\n  2\n]',
)

expect(
  'objects inside arrays are still sorted',
  normalizeJson('[{"b":1,"a":2}]'),
  '[\n  {\n    "a": 2,\n    "b": 1\n  }\n]',
)

expect('invalid JSON passes through untouched', normalizeJson('{not json'), '{not json')
expect('plain text passes through untouched', normalizeJson('hello world'), 'hello world')
expect('empty stays empty', normalizeJson(''), '')
expect('null is valid JSON, not a parse failure', normalizeJson('null'), 'null')
expect('a bare string body is handled', normalizeJson('"text"'), '"text"')

/* Alignment --------------------------------------------------------------- */

group('diffLines')

const identical = diffLines('a\nb\nc', 'a\nb\nc')
expect('identical text reports identical', identical.identical, true)
expect('identical text is all same rows', shape(identical), ['same a|a', 'same b|b', 'same c|c'])
expect('identical text has no changes in the summary', identical.summary, {
  same: 3,
  added: 0,
  removed: 0,
  changed: 0,
})

const inserted = diffLines('a\nc', 'a\nb\nc')
expect('an inserted line is added, not changed', shape(inserted), [
  'same a|a',
  'added |b',
  'same c|c',
])
expect('an insert is not identical', inserted.identical, false)

const deleted = diffLines('a\nb\nc', 'a\nc')
expect('a deleted line is removed', shape(deleted), ['same a|a', 'removed b|', 'same c|c'])

const modified = diffLines('a\nb\nc', 'a\nB\nc')
expect('a modified line pairs into one changed row', shape(modified), [
  'same a|a',
  'changed b|B',
  'same c|c',
])

const lopsided = diffLines('a\nb\nc\nd', 'a\nX\nd')
expect('an uneven run pairs what it can and lists the rest', shape(lopsided), [
  'same a|a',
  'changed b|X',
  'removed c|',
  'same d|d',
])

const grown = diffLines('a\nb\nd', 'a\nX\nY\nd')
expect('the added remainder follows the paired rows', shape(grown), [
  'same a|a',
  'changed b|X',
  'added |Y',
  'same d|d',
])

expect(
  'line numbers track each side independently',
  deleted.rows.map((r) => `${r.leftNo ?? '-'}:${r.rightNo ?? '-'}`),
  ['1:1', '2:-', '3:2'],
)

const fromEmpty = diffLines('', 'a\nb')
expect('everything is added when the left side is empty', shape(fromEmpty), [
  'added |a',
  'added |b',
])

const toEmpty = diffLines('a\nb', '')
expect('everything is removed when the right side is empty', shape(toEmpty), [
  'removed a|',
  'removed b|',
])

expect('two empty bodies are identical', diffLines('', '').identical, true)

/* Prefix and suffix trimming --------------------------------------------- */

group('prefix and suffix trimming')

// The trimmed path and the aligned path have to agree, or a change buried in a
// long shared preamble would come out differently from the same change alone.
const buried = diffLines(
  ['h1', 'h2', 'h3', 'target', 'f1', 'f2'].join('\n'),
  ['h1', 'h2', 'h3', 'TARGET', 'f1', 'f2'].join('\n'),
)
expect('a change inside a long shared body is found', shape(buried), [
  'same h1|h1',
  'same h2|h2',
  'same h3|h3',
  'changed target|TARGET',
  'same f1|f1',
  'same f2|f2',
])
expect('trimming keeps the line numbers right', buried.rows[3].leftNo, 4)

const sharedOnly = diffLines('a\nb\nc', 'a\nb\nc\nd')
expect('a trailing addition after a full shared prefix', shape(sharedOnly), [
  'same a|a',
  'same b|b',
  'same c|c',
  'added |d',
])

const leadingAdd = diffLines('b\nc', 'a\nb\nc')
expect('a leading addition before a shared suffix', shape(leadingAdd), [
  'added |a',
  'same b|b',
  'same c|c',
])

/* Budgets ----------------------------------------------------------------- */

group('size budgets')

const huge = 'x'.repeat(MAX_DIFF_CHARS + 1)
const bailed = diffLines(huge, 'small')
expect('an oversized side is skipped rather than aligned', bailed.skipped, true)
expect('a skipped diff has no rows', bailed.rows.length, 0)
detail('reason:', bailed.reason)
expect('a skipped diff explains itself', bailed.reason.length > 0, true)

// Sharing a prefix and suffix is what keeps large, near-identical responses
// inside the cell budget, so a big pair with a small difference must not bail.
const bigLeft = Array.from({ length: 20000 }, (_, index) => `line ${index}`)
const bigRight = [...bigLeft]
bigRight[10000] = 'changed line'
const bigResult = diffLines(bigLeft.join('\n'), bigRight.join('\n'))
expect('a large pair with one change still diffs', bigResult.skipped, false)
expect('and finds exactly the one change', bigResult.summary.changed, 1)
expect('without inventing others', bigResult.summary.added + bigResult.summary.removed, 0)

/* Summary and unified text ----------------------------------------------- */

group('summarize and toUnifiedText')

expect(
  'summarize counts each kind',
  summarize([
    { kind: 'same', left: 'a', right: 'a', leftNo: 1, rightNo: 1 },
    { kind: 'added', left: null, right: 'b', leftNo: null, rightNo: 2 },
    { kind: 'added', left: null, right: 'c', leftNo: null, rightNo: 3 },
    { kind: 'removed', left: 'd', right: null, leftNo: 2, rightNo: null },
    { kind: 'changed', left: 'e', right: 'E', leftNo: 3, rightNo: 4 },
  ]),
  { same: 1, added: 2, removed: 1, changed: 1 },
)

expect(
  'unified text uses the familiar prefixes',
  toUnifiedText(diffLines('a\nb\nc', 'a\nB\nc'), 'A', 'B'),
  ['--- A', '+++ B', '  a', '- b', '+ B', '  c'].join('\n'),
)

expect(
  'a skipped diff copies its reason rather than an empty patch',
  toUnifiedText(bailed, 'A', 'B'),
  bailed.reason,
)

/* Metadata --------------------------------------------------------------- */

group('compareMeta')

const metaRows = compareMeta([
  response({ status: 200, statusText: 'OK', bytes: 100, elapsedMs: 10 }),
  response({ status: 404, statusText: 'Not Found', bytes: 100, elapsedMs: 900 }),
])
const meta = Object.fromEntries(metaRows.map((row) => [row.label, row]))

expect('a differing status is flagged', meta.Status.differs, true)
expect('and both values are reported', meta.Status.values, ['200 OK', '404 Not Found'])
expect('a matching size is not flagged', meta.Size.differs, false)
expect('timing is reported', meta.Time.values, ['10 ms', '900 ms'])
expect('but timing is never flagged as a difference', meta.Time.differs, false)

const partial = compareMeta([response({ status: 200 }), null])
expect('a lane with no response yet contributes null, not a false difference', partial[0].values, [
  '200 OK',
  null,
])
expect('and one value alone cannot differ', partial[0].differs, false)

expect(
  'three lanes agreeing is not a difference',
  compareMeta([response({ status: 200 }), response({ status: 200 }), response({ status: 200 })])[0]
    .differs,
  false,
)

expect(
  'one lane out of three differing is',
  compareMeta([
    response({ status: 200 }),
    response({ status: 200 }),
    response({ status: 500, statusText: 'Server Error' }),
  ])[0].differs,
  true,
)

/* Headers ---------------------------------------------------------------- */

group('compareHeaders')

const headerRows = compareHeaders([
  response({
    headers: [
      ['Content-Type', 'application/json'],
      ['X-Only-Left', '1'],
    ],
  }),
  response({
    headers: [
      ['content-type', 'application/json'],
      ['X-Only-Right', '2'],
    ],
  }),
])
const headers = Object.fromEntries(headerRows.map((row) => [row.label, row]))

expect('header names are compared case-insensitively', headers['content-type'].differs, false)
expect('names are lowercased for display', Object.keys(headers).includes('Content-Type'), false)
expect('a header only one side sent is present as null', headers['x-only-left'].values, ['1', null])
expect('and is not counted as a difference on its own', headers['x-only-left'].differs, false)
expect(
  'names come out sorted',
  headerRows.map((row) => row.label),
  ['content-type', 'x-only-left', 'x-only-right'],
)

const differing = compareHeaders([
  response({ headers: [['etag', 'aaa']] }),
  response({ headers: [['etag', 'bbb']] }),
])
expect('a header with two different values is flagged', differing[0].differs, true)

const repeated = compareHeaders([
  response({
    headers: [
      ['set-cookie', 'a=1'],
      ['set-cookie', 'b=2'],
    ],
  }),
  response({ headers: [['set-cookie', 'a=1']] }),
])
expect('repeated header names are joined rather than dropped', repeated[0].values, [
  'a=1, b=2',
  'a=1',
])

const failures = summary()

await close()
process.exit(failures === 0 ? 0 : 1)
