const { parentPort } = require('worker_threads')
const createDebug = require('debug')
const { Transferable } = require('./Transferable')

parentPort.once('message', (msg) => {
  if (msg.action === 'init') {
    const { workerPath, port, id } = msg
    const debug = createDebug(`puddle:thread:${id}`)
    debug('Initializing worker thread...')
    let worker = null

    try {
      worker = require(workerPath)

      if (!(worker instanceof Object)) {
        throw new Error(`Worker should export an object, got ${worker}`)
      }

      let callables = 0
      for (const key of Object.keys(worker)) {
        if (typeof worker[key] === 'function') {
          callables++
        }
      }
      if (callables === 0) {
        throw new Error('Worker should export at least one method')
      }
    } catch ({ message, stack }) {
      port.postMessage({ action: 'startup-error', message, stack })
      return
    }

    worker.__ID__ = id

    port.on('message', async ({ action, key, args, callbackId }) => {
      switch (action) {
        case 'call': {
          debug('calling worker thread method %s', key)

          try {
            if (typeof worker[key] !== 'function') {
              debug('%s is not a function', key)
              throw new Error(`"${key}" is not a function in this worker thread`)
            }
            const result = await worker[key](...args)

            if (result instanceof Transferable) {
              port.postMessage({
                action: 'resolve',
                callbackId,
                result: result.obj
              }, result.transferables)
            } else {
              port.postMessage({ action: 'resolve', callbackId, result })
            }
          } catch ({ message, stack }) {
            debug(message)
            port.postMessage({ action: 'reject', callbackId, message, stack })
          }
          break
        }
        default: {
          throw new Error(`Unknown action "${msg.action}" for worker thread`)
        }
      }
    })

    msg.port.postMessage({ action: 'ready' })
  }
})
