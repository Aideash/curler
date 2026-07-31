import { createServer } from 'vite'

/**
 * Verbose mode prints every passing assertion, which is what you want when a
 * check is misbehaving and nothing else. The default is a single summary line.
 */
export const verbose =
  process.env.CURLER_VERBOSE === '1' ||
  process.argv.includes('--verbose') ||
  process.argv.includes('-v')

/**
 * The checks import the app's TypeScript modules directly. Vite in middleware
 * mode transpiles them on demand, so there is no build step to keep in sync.
 */
export async function loadModules(paths) {
  const server = await createServer({
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'error',
  })

  const modules = {}
  for (const path of paths) Object.assign(modules, await server.ssrLoadModule(path))

  return { modules, close: () => server.close() }
}

export function createHarness(title) {
  let checks = 0
  let failures = 0
  let currentGroup = ''
  let groupPrinted = false

  function printGroup() {
    if (groupPrinted || !currentGroup) return
    console.log(`\n-- ${currentGroup}`)
    groupPrinted = true
  }

  return {
    group(name) {
      currentGroup = name
      groupPrinted = false
      if (verbose) printGroup()
    },

    /** Prints only in verbose mode; use for context around a group. */
    detail(...args) {
      if (verbose) console.log('  ', ...args)
    },

    expect(label, actual, wanted) {
      checks += 1
      if (JSON.stringify(actual) === JSON.stringify(wanted)) {
        if (verbose) console.log(`   ok   ${label}`)
        return true
      }

      failures += 1
      printGroup()
      console.log(`   FAIL ${label}`)
      console.log(`        got    ${JSON.stringify(actual)}`)
      console.log(`        wanted ${JSON.stringify(wanted)}`)
      return false
    },

    /** Reports a failure that does not fit the got/wanted shape. */
    fail(label, ...lines) {
      checks += 1
      failures += 1
      printGroup()
      console.log(`   FAIL ${label}`)
      for (const line of lines) console.log(`        ${line}`)
    },

    pass(label) {
      checks += 1
      if (verbose) console.log(`   ok   ${label}`)
    },

    summary() {
      if (failures === 0) console.log(`${title}: ${checks} checks passed`)
      else console.log(`\n${title}: ${failures} of ${checks} checks FAILED`)
      return failures
    },
  }
}
