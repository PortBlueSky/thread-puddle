const { parentPort } = require('worker_threads')
const createDebug = require('debug')
const { Transferable } = require('./Transferable')
const dynamicExports = require('./export-bridge')
const majorVersion = require('./major-node-version')

parentPort.once('message', async (msg) => {
  if (msg.action === 'init') {
    const { workerPath, port, id } = msg
    // TODO: Adjust debug namespace when worker threads are nested
    const debug = createDebug(`puddle:thread:${id}`)
    debug('Initializing worker thread...')
    let worker = null

    dynamicExports.threadId = id

    try {
      let isCommonJS = false

      if (majorVersion >= 13) {
        worker = await import(workerPath)

        const workerKeys = Object.keys(worker)
        isCommonJS = workerKeys.length === 1 && workerKeys[0] === 'default'

        if (isCommonJS) {
          worker = worker.default
        }
      } else {
        worker = require(workerPath)
        isCommonJS = true
      }

      if (isCommonJS) {
        if (!(worker instanceof Object)) {
          throw new Error(`Worker should export an object, got ${worker}`)
        }
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

            debug('worker done with thread method %s', key)

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
