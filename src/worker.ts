import { parentPort } from 'worker_threads'
import createDebug from 'debug'
import { TransferableValue } from './Transferable'
import {
  BaseMainMessage,
  CallMessage,
  InitMessage,
  MainMessageAction,
  ThreadCallbackMessage,
  ThreadErrorMessage,
  ThreadFreeFunctionMessage,
  ThreadFunctionMessage,
  ThreadMessageAction
} from './types/messages'
import { FunctionId, ThreadMethodKey } from './types/general'
import majorNodeVersion from './utils/major-node-version'

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
  let worker: Record<string, any> | null = null

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

  const functionRegistry = new FinalizationRegistry(({ id, key }: { id: FunctionId, key: ThreadMethodKey }) => {
    debug('thread freeing method %s for %s', id, key)

    const fnMsg: ThreadFreeFunctionMessage = {
      action: ThreadMessageAction.FREE_FUNCTION,
      functionId: id,
      key
    }

    port.postMessage(fnMsg)
  })

  // TODO: Handle message error. 
  // Rare and possibly fatal as promises may never be resolved.
  // Note: This happens when trying to receive an array buffer that has already been detached.
  port.on('messageerror', () => {
    // Consider pool termination and reject all open promises
  })

  port.on('message', async (msg: BaseMainMessage) => {
    switch (msg.action) {
      case MainMessageAction.CALL: {
        const { key, args, callableId, argFunctionPositions } = msg as CallMessage
        debug('calling worker thread method %s', key)

        try {
          if (typeof worker![key] !== 'function') {
            debug('%s is not a function', key)
            throw new Error(`"${key}" is not a function in this worker thread`)
          }

          if (argFunctionPositions.length > 0) {
            for (const fnArgPos of argFunctionPositions) {
              const { id } = args[fnArgPos]
              const fn = (...cbArgs: any[]) => {
                // TODO: Make transferables work here
                const fnMsg: ThreadFunctionMessage = {
                  action: ThreadMessageAction.CALL_FUNCTION,
                  functionId: id,
                  key,
                  args: cbArgs,
                  pos: fnArgPos,
                }
                port.postMessage(fnMsg)
              }
              functionRegistry.register(fn, { id, key }, fn)
              args[fnArgPos] = fn
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
              callableId,
              result: result.obj
            }

            port.postMessage(resultMsg, result.transferables)
          } else {
            const resultMsg: ThreadCallbackMessage = {
              action: ThreadMessageAction.RESOLVE,
              callableId,
              result
            }
            port.postMessage(resultMsg)
          }
        } catch ({ message, stack }) {
          debug(message)
          const resultMsg: ThreadErrorMessage = {
            action: ThreadMessageAction.REJECT,
            callableId,
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

  // Note: Node < 16 does not exit and throw unhandled promise rejections
  if (majorNodeVersion < 16) {
    process.on('unhandledRejection', (reason) => {
      throw reason
    });
  }

  msg.port.postMessage({ action: 'ready' })
})
