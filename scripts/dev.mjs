import { spawn } from 'node:child_process'

// Runs the API server and the Vite dev server together so `npm run dev` is the
// only command you need. Vite proxies /api through to the API server.
const TASKS = [
  // Scoped to ./server: a bare --watch also walks node_modules and exhausts
  // the open-file limit.
  {
    name: 'api',
    color: '\u001b[36m',
    command: 'node',
    args: [
      // Vite reads .env itself through loadEnv; plain Node needs telling.
      '--env-file-if-exists=.env',
      '--watch-path=./server',
      'server/index.mjs',
    ],
  },
  { name: 'web', color: '\u001b[35m', command: 'npx', args: ['vite'] },
]

const RESET = '\u001b[0m'
const children = []
let shuttingDown = false

const debug = process.env.CURLER_DEBUG === '1'

/**
 * `node --watch` announces every restart on stderr, which drowns out anything
 * worth seeing during a normal edit-save loop. Vite's re-optimise notices are
 * the same kind of chatter.
 */
const CHATTER = [
  /^\s*$/,
  /Restarting '.*'/,
  /Completed running '.*'/,
  /^\s*\[?nodemon/i,
  /new dependencies optimized/i,
  /optimized dependencies changed. reloading/i,
]

function isChatter(line) {
  // eslint-disable-next-line no-control-regex
  const bare = line.replace(/\u001b\[[0-9;]*m/g, '').trim()
  return CHATTER.some((pattern) => pattern.test(bare))
}

function prefix(task, stream) {
  let buffer = ''
  stream.on('data', (chunk) => {
    buffer += chunk.toString()
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!debug && isChatter(line)) continue
      process.stdout.write(`${task.color}${task.name.padEnd(3)}${RESET} | ${line}\n`)
    }
  })
}

function shutdown(code) {
  if (shuttingDown) return
  shuttingDown = true
  for (const child of children) child.kill('SIGTERM')
  process.exit(code)
}

for (const task of TASKS) {
  const child = spawn(task.command, task.args, {
    stdio: ['inherit', 'pipe', 'pipe'],
    // Piping the children strips their colour, so ask for it back unless the
    // environment has explicitly opted out.
    env: process.env.NO_COLOR ? process.env : { ...process.env, FORCE_COLOR: '1' },
  })
  prefix(task, child.stdout)
  prefix(task, child.stderr)
  child.on('exit', (code) => {
    if (!shuttingDown) {
      process.stdout.write(`${task.color}${task.name}${RESET} exited with code ${code}\n`)
      shutdown(code ?? 0)
    }
  })
  children.push(child)
}

if (!debug) {
  process.stdout.write(
    'Quiet by default. Run "npm run dev:debug" to see restarts and every request.\n',
  )
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))
