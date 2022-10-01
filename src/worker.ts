import { parentPort } from 'worker_threads'
import createDebug from 'debug'
import { TransferableValue } from './Transferable'
import { MainMessage, InitMessage } from '.'

const dynamicExports = require('./export-bridge')

if (!parentPort) {
  throw new Error('No parentPort available')
}

parentPort.once('message', async (msg: InitMessage) => {
  if (msg.action !== 'init') {
    return
  }
    
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

    worker = await import(workerPath)

    if (!worker) {
      throw new Error('Worker does not expose a mountable object')
    }

    const workerKeys = Object.keys(worker)
    isCommonJS = workerKeys.includes('default')

    if (isCommonJS) {
      worker = worker.default
      if (!(worker instanceof Object)) {
        throw new Error(`Worker should export an object, got ${worker}`)
      }
    }
  } catch ({ message, stack }) {
    port.postMessage({ action: 'startup-error', message, stack })
    return
  }

  port.on('message', async ({ action, key, args, callbackId }: MainMessage) => {
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
})