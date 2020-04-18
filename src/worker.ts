import { parentPort } from 'worker_threads'
import createDebug from 'debug'
import { TransferableValue } from './Transferable'
import majorVersion from './major-node-version'

const dynamicExports = require('./export-bridge')

if (!parentPort) {
  throw new Error('No parentPort available')
}

parentPort.once('message', async (msg) => {
  if (msg.action === 'init') {
    const { workerPath, port, id, parentId } = msg

    let debug = createDebug(`puddle:thread:${id}`)
    if (parentId) {
      debug = createDebug(`puddle:parent:${parentId}:thread:${id}`)
    } 

    debug('Initializing worker thread...')
    let worker: Record<string, Function | any> | null = null

    dynamicExports.threadId = id
    dynamicExports.debug = debug

    try {
      let isCommonJS = false

      if (majorVersion >= 13) {
        worker = await import(workerPath)

        if (!worker) {
          throw new Error('Worker does not expose a mountable object')
        }

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
      for (const key of Object.keys(worker!)) {
        if (typeof worker![key] === 'function') {
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
            // TODO: ensure hasOwnProperty
            if (typeof worker![key] !== 'function') {
              debug('%s is not a function', key)
              throw new Error(`"${key}" is not a function in this worker thread`)
            }
            const result = await worker![key](...args)

            debug('worker done with thread method %s', key)

            if (result instanceof TransferableValue) {
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