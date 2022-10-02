import { parentPort } from 'worker_threads'
import createDebug from 'debug'
import { TransferableValue } from './Transferable'
import { 
  BaseMainMessage,
  CallMessage,
  InitMessage,
  ThreadCallbackMessage,
  ThreadErrorMessage,
  ThreadFunctionMessage,
  ThreadMessageAction 
} from './types/messages'

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
    port.postMessage({ action: ThreadMessageAction.STARTUP_ERROR, message, stack })
    return
  }

  port.on('message', async (msg: BaseMainMessage) => {
    switch (msg.action) {
      case 'call': {
        const { key, args, callbackId, argFunctionPositions } = msg as CallMessage
        debug('calling worker thread method %s', key)

        try {
          // TODO: ensure hasOwnProperty
          if (typeof worker![key] !== 'function') {
            debug('%s is not a function', key)
            throw new Error(`"${key}" is not a function in this worker thread`)
          }

          if (argFunctionPositions.length > 0) {
            for (const fnArgPos of argFunctionPositions) {
              const { id } = args[fnArgPos]
              // TODO: Register and use finalizer to de-reference on main when gc'd
              args[fnArgPos] = (...cbArgs: any[]) => {
                // TODO: Make transferables work here
                const fnMsg: ThreadFunctionMessage = {
                  action: ThreadMessageAction.CALL_FUNCTION,
                  functionId: id,
                  key,
                  args: cbArgs
                }
                port.postMessage(fnMsg)
              }
            }
          }

          let result = await worker![key](...args)

          debug('worker done with thread method %s', key)

          if (result === worker) {
            result = '__THIS__'
          } 
          
          if (result instanceof TransferableValue) {
            const resultMsg: ThreadCallbackMessage = {
              action: ThreadMessageAction.RESOLVE,
              callbackId,
              result: result.obj
            }
            port.postMessage(resultMsg, result.transferables)
          } else {
            const resultMsg: ThreadCallbackMessage = { 
              action: ThreadMessageAction.RESOLVE, 
              callbackId, 
              result 
            }
            port.postMessage(resultMsg)
          }
        } catch ({ message, stack }) {
          debug(message)
          const resultMsg: ThreadErrorMessage = { 
            action: ThreadMessageAction.REJECT, 
            callbackId, 
            message: message as string, 
            stack: stack as string 
          }
          port.postMessage(resultMsg)
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