const path = require('path')
const createDebug = require('debug')

const debug = createDebug('puddle:ts-bridge')

// TODO: Only load ts-node if worker path resolves to .ts
try {
  require.resolve('ts-node')
  // TODO: Use require(ts-node/register/transpile-only)
  require('ts-node').register()
} catch (e) {
  debug('ts-node not available')
}

debug('resolving worker...')
require(path.resolve(__dirname, 'worker'))

// NOTE: ts-node seems to swallow uncaught exceptions,
// and the error event on the worker is never triggered,
// the worker just exits with error code 1.
// Re-throwing the error triggers the worker error event.
process.on('uncaughtException', (err, origin) => {
  debug('Error: Uncaught Exception', err)
  throw err
})
