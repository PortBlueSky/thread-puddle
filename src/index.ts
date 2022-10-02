import path from 'path'
import { EventEmitter } from 'events'
import createDebug from 'debug'
import getCallsites from './utils/callsites'

import { TransferableValue } from './Transferable'
export { withTransfer } from './Transferable'
import { MessagePort, Worker, MessageChannel, isMainThread } from 'worker_threads'
import hasTSNode from './utils/has-ts-node'
import { CallbackId, ThreadId, ThreadMethodKey } from './types/general'
import { CallMessage, InitMessage, MainMessageAction, ThreadCallbackMessage, ThreadErrorMessage, ThreadFunctionMessage, ThreadMessageAction } from './types/messages'
import { createSequence } from './utils/sequence'

const { threadId: dynamicThreadId, debug: dynamicDebug } = require('./export-bridge')
export const threadId = dynamicThreadId

let debugOut = createDebug('puddle:master')
export let debug = debugOut
if (!isMainThread) {
  debugOut = createDebug(`puddle:parent:${threadId}:master`)
  debug = dynamicDebug
}

let __puddle__threadIdOffset: number = 1

export type Thread = {
  id: ThreadId
  connected: boolean
  worker: Worker
  port: MessagePort
  error: Error | boolean
  callQueue: QueuedCall[]
  busy: boolean
}

export interface QueuedCall {
  key: ThreadMethodKey
  args: Array<any>
  resolve: (result: any) => void,
  reject: (error: Error) => void
}

export interface ThreadRequest {
  resolve(thread: Thread): void
  reject(error: Error): void
}

export interface Callback {
  resolve(thread: Thread): void
  reject(error: Error): void
}

export type ThreadPoolOptions = {
  size?: number
  typecheck?: boolean
  workerOptions?: any // TODO: Use worker options type from node types
  startupTimeout?: number
}

export interface BaseWorker {
  pool: PoolInterface
}

export interface PoolInterface extends EventEmitter {
  terminate(): void
  size: number
  isTerminated: boolean
}

type ProxyWorkerTarget = Record<string, any>

type FilterType<Base, Condition> = Pick<Base, {
  [Key in keyof Base]: Base[Key] extends Condition ? Key : never
}[keyof Base]>;

type TypeWithMethods = Record<string | number | symbol,  (...a: any) => any | Promise<any>>
export type AsyncMethod = (...param: any) => Promise<any>

type WrapReturnType<Base extends TypeWithMethods> = {
  [Key in keyof Base]: Base[Key] extends AsyncMethod
    ? Base[Key] 
    : (...a: Parameters<Base[Key]>) => Promise<ReturnType<Base[Key]>>;
};

// @ts-ignore
// TODO: Fix usage of interface vs. type
// Even though this complains, the type is inferred from the template correctly,
// working for classes/interfaces and types
type FilterAndWrap<Base> = WrapReturnType<FilterType<Required<Base>, Function>>


export async function createThreadPool<WorkerType> (workerPath: string, {
  size = 1,
  workerOptions = {},
  startupTimeout = 30000,
  typecheck = false
}: ThreadPoolOptions = {}): Promise<FilterAndWrap<WorkerType> & BaseWorker & { all: FilterAndWrap<WorkerType> }> {
  debugOut('carving out a puddle...')

  type TargetWorkerType = BaseWorker & { all: FilterAndWrap<WorkerType> }
  type ExtendedWorkerType = TargetWorkerType & FilterAndWrap<WorkerType>

  // Based on: https://github.com/Microsoft/TypeScript/issues/20846#issuecomment-582183737
  interface PoolProxyConstructor {
    new <T, H extends object, K extends BaseWorker>(target: T, handler: ProxyHandler<H>): K
  }

  interface PoolProxyAllConstructor {
    new <T, H extends object, K extends WorkerType>(target: T, handler: ProxyHandler<H>): K
  }

  // Resolve relative worker path
  let resolvedWorkerPath = workerPath

  if (!path.isAbsolute(workerPath)) {
    let callsites = getCallsites()
    if (callsites) {
      callsites = callsites.filter((cs) => cs.getFileName())
      const callerPath = callsites[1].getFileName()
      const { dir: basePath} = path.parse(callerPath!)
      resolvedWorkerPath = path.resolve(basePath, workerPath)
    }
  }

  const { ext: resolvedWorkerExtension } = path.parse(require.resolve(resolvedWorkerPath))

  const threads: Thread[] = []
  const availableThreads: Thread[] = []
  const threadRequests: ThreadRequest[] = []
  const threadCallbacks: Map<ThreadId, Map<CallbackId, Callback>> = new Map<ThreadId,  Map<CallbackId, Callback>>()
  
  const mainFunctions = new Map<ThreadMethodKey, { [id: number]: Function }>()
  const functionSequence = createSequence()
  const functionToId = new Map<Function, number>()
  
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
    debugOut('creating worker thread %s', id)

    const bridgeWorkerPath = path.resolve(__dirname, 'worker')
    const { ext: bridgeWorkerExtension } = path.parse(require.resolve(bridgeWorkerPath))
    let workerString = `require('${bridgeWorkerPath}')`

    if (hasTSNode() && [bridgeWorkerExtension, resolvedWorkerExtension].includes('.ts')) {
      if (typecheck) {
        workerString = `require('ts-node').register()\n${workerString}`
      } else {
        workerString = `require('ts-node/register/transpile-only')\n${workerString}`
      }
    }

    const worker = new Worker(workerString, { ...workerOptions, eval: true })
    const { port1, port2 } = new MessageChannel()
    const thread: Thread = {
      id,
      connected: false,
      worker,
      port: port2,
      error: false,
      callQueue: [],
      busy: false
    }

    worker.on('online', () => {
      debugOut(`worker ${id} connected`)

      thread.connected = true
    })

    worker.on('exit', (code: number) => {
      debugOut('worker %d exited with code %d', id, code)

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

        const err = new Error('All workers exited before resolving (use an error event handler or DEBUG=puddle:*)')
        for (const workerRequest of threadRequests) {
          workerRequest.reject(err)
        }
      }
    })

    worker.on('error', (err) => {
      debugOut(`worker ${id} Error: %s`, err.message)

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
        if (thread.connected) {
          debugOut(`restarting worker ${id} after uncaught error`)
          createThread(id)
        }
      }
    })

    const initMsg: InitMessage = {
      action: MainMessageAction.INIT,
      workerPath: resolvedWorkerPath,
      port: port1,
      id,
      parentId: threadId
    }

    worker.postMessage(initMsg, [port1])
    port2.on('message', (msg: ThreadCallbackMessage | ThreadErrorMessage | ThreadFunctionMessage) => {
      switch (msg.action) {
        case ThreadMessageAction.RESOLVE: {
          msg = msg as ThreadCallbackMessage
          debugOut('worker %d resolved callback %d', id, msg.callbackId)
          
          const callbacks = threadCallbacks.get(id)
          const callback = callbacks!.get(msg.callbackId)
          callbacks!.delete(msg.callbackId)
          onReady(thread)
          callback!.resolve(msg.result)
          break
        }

        case ThreadMessageAction.REJECT: {
          const errorMsg = msg as ThreadErrorMessage
          debugOut('worker %d rejected callback %d', id, errorMsg.callbackId)
          
          const callbacks = threadCallbacks.get(id)
          const callback = callbacks!.get(errorMsg.callbackId)
          callbacks!.delete(errorMsg.callbackId)
          const err = new Error(errorMsg.message)
          err.stack = errorMsg.stack
          onReady(thread)
          callback!.reject(err)
          break
        }

        case ThreadMessageAction.CALL_FUNCTION: {
          msg = msg as ThreadFunctionMessage
          debugOut('worker %d calling function %s[%d]', id, msg.key, msg.functionId)
          
          const fnHolder = mainFunctions.get(msg.key)
          if (fnHolder) {
            fnHolder[msg.functionId](...msg.args)
          }
          break
        }

        case ThreadMessageAction.READY: {
          onReady(thread)
          break
        }

        case ThreadMessageAction.STARTUP_ERROR: {
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

  debugOut('filling puddle with thread liquid...')

  const idStart: ThreadId = __puddle__threadIdOffset
  const idEnd: ThreadId = idStart + size

  for (let id: ThreadId = idStart; id < idEnd; id += 1) {
    createThread(id)
  }

  __puddle__threadIdOffset += size

  function callOnThread (
    thread: Thread, 
    key: ThreadMethodKey, 
    args: Array<any>, 
    resolve: (thread: Thread) => void, 
    reject: (error: Error) => void
  ) {
    debugOut('calling %s on worker %d', key, thread.id)
    thread.busy = true
    const callbackId = callbackCount++
    threadCallbacks.get(thread.id)!.set(callbackId, { resolve, reject })

    let functionsInArgs = 0
    let argFunctionPositions: number[] = []
    const transferables: Array<MessagePort | ArrayBuffer> = []
    const iteratedArgs = args.map((arg: any, index: number) => {
      if (arg instanceof TransferableValue) {
        transferables.push(...arg.transferables)
        return arg.obj
      }
      if (typeof arg === 'function') {
        functionsInArgs += 1
        argFunctionPositions.push(index)
        if (!mainFunctions.has(key)) {
          mainFunctions.set(key, {})
        }
        const fnHolder = mainFunctions.get(key)!
        
        if (functionToId.has(arg)) {
          return { id: functionToId.get(arg) }
        }

        const newId = functionSequence.next()
        fnHolder[newId] = arg
        return { id: newId } 
      }
      return arg
    })

    const msg: CallMessage = {
      action: MainMessageAction.CALL,
      key,
      callbackId,
      args: iteratedArgs,
      argFunctionPositions
    }

    thread.port.postMessage(msg, transferables)
  }

  const getAvailableThread = () => new Promise<Thread>((resolve, reject) => {
    if (isTerminated) {
      return reject(new Error('Worker pool already terminated.'))
    }

    if (availableThreads.length > 0) {
      const thread = availableThreads.shift()
      debugOut('Resolving available worker %d', thread!.id)
      return resolve(thread as Thread)
    }

    const threadRequest: ThreadRequest = { resolve, reject }
    threadRequests.push(threadRequest)
    debugOut('Added worker request')
  })

  const terminate = () => {
    if (isTerminated) {
      return
    }
    
    debugOut('pulling the plug on the puddle...')
    
    isTerminated = true
    
    for (const thread of threads) {
      thread.worker.terminate()
    }
  }

  await Promise.all(threads.map((thread) => new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      terminate()
      reject(new Error(`Worker ${thread.id} initialization timed out`))
    }, startupTimeout)
    const threadRequest: ThreadRequest = {
      resolve: (thread) => {
        debugOut('worker %d ready', thread.id)

        clearTimeout(timeout)
        availableThreads.push(thread)
        resolve()
      },
      reject: (err) => {
        debugOut('worker %d startup failed', thread.id)

        clearTimeout(timeout)
        terminate()
        reject(err)
      }
    }

    threadRequests.push(threadRequest)
  })))

  debugOut('puddle filled, happy splashing!')

  Object.assign(puddleInterface, {
    terminate
  })
  Object.defineProperties(puddleInterface, {
    size: {
      get: () => threads.length
    },
    isTerminated: {
      get: () => isTerminated
    }
  })

  const PoolProxy = Proxy as PoolProxyConstructor
  const PoolProxyAll = Proxy as PoolProxyAllConstructor
  const allWorkersHandler = {
    get: (target: ProxyWorkerTarget, key: string) => {
      // NOTE: If the proxy is returned from an async function,
      // the engine checks if it is a thenable by checking existence of a then method
      if (key === 'then') {
        return undefined
      }

      return (...args: any[]) => Promise.all(
        threads.map(thread => new Promise((resolve, reject) => {
          if (!thread.busy) {
            callOnThread(thread, key, args, resolve, reject)
            return
          }
          thread.callQueue.push({ key, args, resolve, reject })
        }))
      )
    }
  }

  const allWorkersInterface: WorkerType = new PoolProxyAll<
    typeof allWorkersTarget, 
    typeof allWorkersHandler, 
    WorkerType
  >(allWorkersTarget, allWorkersHandler)

  const target: TargetWorkerType = {
    pool: puddleInterface as PoolInterface,
    all: allWorkersInterface as FilterAndWrap<WorkerType>
  }

  // Intermediate, so the proxy can return itself
  let proxy: ExtendedWorkerType
  
  const handler = {
    get: (proxyTarget: ProxyWorkerTarget, key: string) => {
      // NOTE: If the proxy is returned from an async function,
      // the engine checks if it is a thenable by checking existence of a then method
      if (key === 'then') {
        return undefined
      }

      if (key === 'pool' || key === 'all') {
        return proxyTarget[key]
      }

      return async (...args: any[]) => {
        const result = await new Promise((resolve, reject) => {
          getAvailableThread()
            .then((thread: Thread) => callOnThread(thread, key, args, resolve, reject))
            .catch(err => reject(err))
        })
        
        if (result === '__THIS__') {
          return proxy
        }

        return result
      }
    }
  }

  proxy = new PoolProxy<typeof target, typeof handler, ExtendedWorkerType> (target, handler)
  return proxy
}
