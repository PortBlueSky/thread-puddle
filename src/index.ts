import path from 'path'
import { EventEmitter } from 'events'
import createDebug from 'debug'
import { TransferableValue, withTransfer } from './Transferable'
import { MessagePort, Worker, MessageChannel, isMainThread } from 'worker_threads'

const { threadId, debug: dynamicDebug } = require('./export-bridge')

let debug = createDebug('puddle:master')
let exportedDebug = debug
if (!isMainThread) {
  debug = createDebug(`puddle:parent:${threadId}:master`)
  exportedDebug = dynamicDebug
}

const workerProxyPath = path.resolve(__dirname, 'worker.js')
let __puddle__threadIdOffset: number = 1

export type ThreadId = number
export type CallbackId = number

export interface Thread {
  id: number;
  worker: Worker;
  port: MessagePort;
  error: Error | boolean;
  callQueue: QueuedCall[];
  busy: boolean;
}

export interface QueuedCall {
  key: string | number | symbol;
  args: Array<any>;
  resolve: (result: any) => void,
  reject: (error: Error) => void
}

export interface ThreadRequest {
  resolve(thread: Thread): void;
  reject(error: Error): void;
}

export interface Callback {
  resolve(thread: Thread): void;
  reject(error: Error): void;
}

export enum MessageAction {
  RESOLVE = 'resolve',
  REJECT = 'reject',
  READY = 'ready',
  STARTUP_ERROR = 'startup-error'
}

export interface ThreadMessage {
  action: MessageAction;
  callbackId: CallbackId;
  result: any;
}

export interface ThreadErrorMessage extends ThreadMessage {
  message: string;
  stack: string;
}

async function createThreadPool (workerPath, {
  size = 1,
  workerOptions = {},
  startupTimeout = 30000
} = {}) {
  debug('carving out a puddle...')

  const threads: Thread[] = []
  const availableThreads: Thread[] = []
  const threadRequests: ThreadRequest[] = []
  const threadCallbacks: Map<ThreadId, Map<CallbackId, Callback>> = new Map<ThreadId,  Map<CallbackId, Callback>>()
  let callbackCount = 0
  let isTerminated = false

  const allWorkersTarget = {}
  const puddleInterface = new EventEmitter()

  const onReady = (thread: Thread) => {
    if (thread.callQueue.length > 0) {
      const { key, args, resolve, reject } = thread.callQueue.shift() as QueuedCall
      callOnThread(thread, key, args, resolve, reject)
      return
    }

    if (threadRequests.length > 0) {
      const request = threadRequests.shift()
      request!.resolve(thread)
      return
    }

    thread.busy = false
    availableThreads.push(thread)
  }

  const removeThread = ({ id }: Thread) => {
    threads.splice(threads.findIndex(thread => (thread.id === id)), 1)
    availableThreads.splice(availableThreads.findIndex(thread => (thread.id === id)), 1)
  }

  const createThread = (id: ThreadId) => {
    debug('creating worker thread %s', id)

    const worker = new Worker(workerProxyPath, workerOptions)
    const { port1, port2 } = new MessageChannel()
    const thread: Thread = {
      id,
      worker,
      port: port2,
      error: false,
      callQueue: [],
      busy: false
    }

    worker.on('exit', (code) => {
      debug('worker %d exited with code %d', id, code)

      if (puddleInterface.listenerCount('exit') > 0) {
        puddleInterface.emit('exit', code, id)
      }

      if (!thread.error) {
        const err = new Error('Worker thread exited before resolving')
        if (threadCallbacks.has(id)) {
          const callbacks = threadCallbacks.get(id)

          for (const { reject } of callbacks!.values()) {
            reject(err)
          }
        }
      }

      // TODO: Ensure thread is not removed after being created from error
      removeThread(thread)

      if (threads.length === 0) {
        terminate()

        const err = new Error('All workers exited before resolving')
        for (const workerRequest of threadRequests) {
          workerRequest.reject(err)
        }
      }
    })

    worker.on('error', (err) => {
      debug(`worker ${id} Error: %s`, err.message)

      if (puddleInterface.listenerCount('error') > 0) {
        puddleInterface.emit('error', err)
      }

      // TODO: Reject only the call that errored,
      // -> recall all other
      if (!isTerminated) {
        if (threadCallbacks.has(id)) {
          const callbacks = threadCallbacks.get(id)

          for (const { reject } of callbacks!.values()) {
            reject(err)
          }
        }

        thread.error = err

        // TODO: Make auto respawn optional
        debug(`restarting worker ${id} after uncaught error`)
        createThread(id)
      }
    })

    worker.postMessage({
      action: 'init',
      workerPath,
      port: port1,
      id,
      parentId: threadId
    }, [port1])
    port2.on('message', (msg: ThreadMessage | ThreadErrorMessage) => {
      switch (msg.action) {
        case MessageAction.RESOLVE: {
          debug('worker %d resolved callback %d', id, msg.callbackId)
          const callbacks = threadCallbacks.get(id)
          const callback = callbacks!.get(msg.callbackId)
          callbacks!.delete(msg.callbackId)
          onReady(thread)
          callback!.resolve(msg.result)
          break
        }
        case MessageAction.REJECT: {
          const errorMsg = msg as ThreadErrorMessage
          const callbacks = threadCallbacks.get(id)
          const callback = callbacks!.get(errorMsg.callbackId)
          callbacks!.delete(errorMsg.callbackId)
          const err = new Error(errorMsg.message)
          err.stack = errorMsg.stack
          onReady(thread)
          callback!.reject(err)
          break
        }
        case MessageAction.READY: {
          onReady(thread)
          break
        }
        case MessageAction.STARTUP_ERROR: {
          if (threadRequests.length > 0) {
            const errorMsg = msg as ThreadErrorMessage
            const request = threadRequests.shift()
            const err = new Error(errorMsg.message)
            err.stack = errorMsg.stack
            request!.reject(err)
          }
          break
        }
        default: {
          throw new Error(`Unknown worker pool action "${msg.action}"`)
        }
      }
    })

    threadCallbacks.set(id, new Map())

    threads.push(thread)
  }

  debug('filling puddle with thread liquid...')

  const idStart: ThreadId = __puddle__threadIdOffset
  const idEnd: ThreadId = idStart + size

  for (let id: ThreadId = idStart; id < idEnd; id += 1) {
    createThread(id)
  }

  __puddle__threadIdOffset += size

  function callOnThread (
    thread: Thread, 
    key: string | number | symbol, 
    args: Array<any>, 
    resolve: (thread: Thread) => void, 
    reject: (error: Error) => void
  ) {
    debug('calling %s on worker %d', key, thread.id)
    thread.busy = true
    const callbackId = callbackCount++
    threadCallbacks.get(thread.id)!.set(callbackId, { resolve, reject })

    const transferables: Array<MessagePort | ArrayBuffer> = []
    const iteratedArgs = args.map((arg: TransferableValue) => {
      if (arg instanceof TransferableValue) {
        transferables.push(...arg.transferables)
        return arg.obj
      }
      return arg
    })

    thread.port.postMessage({
      action: 'call',
      key,
      callbackId,
      args: iteratedArgs
    }, transferables)
  }

  const getAvailableThread = () => new Promise((resolve, reject) => {
    if (isTerminated) {
      return reject(new Error('Worker pool already terminated.'))
    }

    if (availableThreads.length > 0) {
      const thread = availableThreads.shift()
      debug('Resolving available worker %d', thread!.id)
      return resolve(thread)
    }

    const threadRequest: ThreadRequest = { resolve, reject }
    threadRequests.push(threadRequest)
    debug('Added worker request')
  })

  const terminate = () => {
    debug('pulling the plug on the puddle...')

    isTerminated = true
    for (const thread of threads) {
      thread.worker.terminate()
    }
  }

  await Promise.all(threads.map((thread) => new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      terminate()
      reject(new Error(`Worker ${thread.id} initialization timed out`))
    }, startupTimeout)
    const threadRequest = {
      resolve: (thread) => {
        debug('worker %d ready', thread.id)

        clearTimeout(timeout)
        availableThreads.push(thread)
        resolve()
      },
      reject: (err) => {
        debug('worker %d startup failed', thread.id)

        clearTimeout(timeout)
        terminate()
        reject(err)
      }
    }

    threadRequests.push(threadRequest)
  })))

  debug('puddle filled, happy splashing!')

  Object.assign(puddleInterface, {
    terminate
  })
  Object.defineProperties(puddleInterface, {
    size: {
      get: () => threads.length,
      writeable: false
    },
    isTerminated: {
      get: () => isTerminated,
      writeable: false
    }
  })

  const allWorkersInterface = new Proxy(allWorkersTarget, {
    get: (target, key) => {
      if (key === 'then') {
        return undefined
      }

      return (...args) => Promise.all(
        threads.map(thread => new Promise((resolve, reject) => {
          if (!thread.busy) {
            callOnThread(thread, key, args, resolve, reject)
            return
          }
          thread.callQueue.push({ key, args, resolve, reject })
        }))
      )
    }
  })

  return new Proxy({
    pool: puddleInterface,
    all: allWorkersInterface
  }, {
    get: (target, key) => {
      // If the proxy is returned from an async function,
      // the engine checks if it is a thenable by checking existence of a then method
      if (key === 'then') {
        return undefined
      }

      if (['pool', 'all'].includes(key as string)) {
        return target[key]
      }

      return (...args) => new Promise((resolve, reject) => {
        getAvailableThread()
          .then((thread: Thread) => callOnThread(thread, key, args, resolve, reject))
          .catch(err => reject(err))
      })
    }
  })
}

module.exports = {
  createPuddle: createThreadPool,
  spawn: createThreadPool,
  createThreadPool,
  withTransfer,
  threadId,
  debug: exportedDebug
}
