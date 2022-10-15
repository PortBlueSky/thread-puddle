import path from 'path'
import { EventEmitter } from 'events'
import createDebug from 'debug'
import getCallsites from './utils/callsites'

export { withTransfer } from './Transferable'
import { isMainThread, WorkerOptions } from 'worker_threads'
import hasTSNode from './utils/has-ts-node'
import { ThreadMethodKey } from './types/general'
import { createSequence } from './utils/sequence'
import { CallableStore } from './components/callable-store'
import { WorkerThread } from './WorkerThread'

const { threadId: dynamicThreadId, debug: dynamicDebug } = require('./export-bridge')
export const threadId = dynamicThreadId

const workerThreadIdSequence = createSequence({ start: 1 })

let debugOut = createDebug('puddle:master')
export let debug = debugOut
if (!isMainThread) {
  debugOut = createDebug(`puddle:parent:${threadId}:master`)
  debug = dynamicDebug
}

export interface ThreadRequest {
  resolve(thread: WorkerThread): void
  reject(error: Error): void
}

export type ThreadPoolOptions = {
  size?: number
  typecheck?: boolean
  workerOptions?: WorkerOptions
  startupTimeout?: number
  maxQueueSize?: number
  autoRefill?: boolean
}

export interface BaseWorker {
  pool: PoolInterface
}

export type MainFunctionMap = Map<number, Function>

export interface PoolInterface extends EventEmitter {
  terminate(): void
  refill(): void
  size: number
  isTerminated: boolean
  callbacks: ReadonlyMap<ThreadMethodKey, MainFunctionMap>
}

type ProxyWorkerTarget = Record<string, any>

type FilterType<Base, Condition> = Pick<Base, {
  [Key in keyof Base]: Base[Key] extends Condition ? Key : never
}[keyof Base]>;

type TypeWithMethods = Record<string | number | symbol,  (...a: any) => any | Promise<any>>
export type AsyncMethod = (...param: any) => Promise<any>

// TODO: 
// Should reject sync callback methods in parameters
// (or re-type them to async?)
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

export type WrapWorkerType<Base> = FilterAndWrap<Base> & BaseWorker & { all: FilterAndWrap<Base> }

export async function createThreadPool<T> (workerPath: string, {
  size = 1,
  workerOptions = {},
  startupTimeout = 30000,
  typecheck = false,
  maxQueueSize = 1000,
  autoRefill = false
}: ThreadPoolOptions = {}) {
  // Validate Options
  if (maxQueueSize < size) {
    throw new Error('maxQueueSize needs to be at least the number of workers in the pool')
  }

  debugOut('carving out a puddle...')

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
  
  // TODO: Automatically infer types from worker path if not given
  // const implicitWorkerType = await import('./__tests__/workers/basic');
  // type WorkerType = unknown extends T
  //   ? typeof implicitWorkerType
  //   : T;
  // -> See: https://github.com/microsoft/TypeScript/issues/31090
  type WorkerType = T
  
  type TargetWorkerType = BaseWorker & { all: FilterAndWrap<WorkerType> }
  type ExtendedWorkerType = TargetWorkerType & FilterAndWrap<WorkerType>

  // Based on: https://github.com/Microsoft/TypeScript/issues/20846#issuecomment-582183737
  interface PoolProxyConstructor {
    new <T, H extends object, K extends BaseWorker>(target: T, handler: ProxyHandler<H>): K
  }

  interface PoolProxyAllConstructor {
    new <T, H extends object, K extends WorkerType>(target: T, handler: ProxyHandler<H>): K
  }

  const threads: WorkerThread[] = []
  const availableThreads: WorkerThread[] = []
  const threadRequests: ThreadRequest[] = []

  // Holds the number of queued direct calls via worker.all
  let directCallQueueSize = 0;
  
  let isTerminated = false

  const allWorkersTarget = {}
  const puddleInterface = new EventEmitter()

  const removeThread = ({ id }: WorkerThread) => {
    threads.splice(threads.findIndex(thread => (thread.id === id)), 1)
    availableThreads.splice(availableThreads.findIndex(thread => (thread.id === id)), 1)
  }

  const threadCallableStore = new CallableStore(debugOut)

  // Forward callback errors to worker.pool interface
  threadCallableStore.on('callback:error', (err, id) => {
    if (puddleInterface.listenerCount('callback:error') > 0) {
      puddleInterface.emit('callback:error', err, id)
      return
    }
    throw err
  })

  const refill = () => {
    const diff = size - threads.length

    for (let i = 0; i < diff; i++) {
      createThread()
    }
  }

  const createThread = () => {
    debugOut('creating worker thread')

    const thread = new WorkerThread(workerThreadIdSequence.next(), threadId, debugOut, workerString, resolvedWorkerPath, workerOptions, threadCallableStore)
    threads.push(thread)

    debugOut('creates worker thread %s', thread.id)

    thread.on('ready', () => {
      if (threadRequests.length > 0) {
        const request = threadRequests.shift()
        request!.resolve(thread)
        return
      }
  
      availableThreads.push(thread)
    })

    thread.on('message', (msg, id) => {
      puddleInterface.emit('thread:message', msg, id)
    })

    thread.on('startup-error', (err) => {
      if (threadRequests.length > 0) {
        const request = threadRequests.shift()
        request!.reject(err)
      }
    })

    thread.on('exit', (code, id) => {
      removeThread(thread)
      puddleInterface.emit('exit', code, id)

      if (!isTerminated && autoRefill) {
        refill()
      }
      
      if (threads.length === 0) {
        terminate()

        const err = new Error('All workers exited before resolving (use an error event handler or DEBUG=puddle:*)')
        for (const workerRequest of threadRequests) {
          workerRequest.reject(err)
        }
      }
    })

    thread.on('error', (err, id) => {
      if (puddleInterface.listenerCount('error') > 0) {
        puddleInterface.emit('error', err, id)
      } else {
        terminate()
      }
    })
  }

  debugOut('filling puddle with thread liquid...')
  refill()

  const getAvailableThread = () => new Promise<WorkerThread>((resolve, reject) => {
    if (isTerminated) {
      return reject(new Error('Worker pool already terminated.'))
    }

    if (availableThreads.length > 0) {
      const thread = availableThreads.shift()!
      debugOut('Resolving available worker %d', thread!.id)
      return resolve(thread)
    }

    if (threadRequests.length + directCallQueueSize >= maxQueueSize) {
      return reject(new Error('Max thread queue size reached'))
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
      thread.terminate()
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

  // TODO: Metrics
  // Optionally gather metrics for method calls,
  // to get a metrics object like:
  // { function1: { roundTrip: { avg: 25, median: 23, max: 934 }, calls: 1564 } }

  Object.assign(puddleInterface, {
    terminate,
    refill
  })
  Object.defineProperties(puddleInterface, {
    size: {
      get: () => threads.length
    },
    isTerminated: {
      get: () => isTerminated
    },
    callbacks: {
      get: () => threadCallableStore.mainFunctions
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

      if (threadRequests.length + directCallQueueSize >= maxQueueSize) {
        return () => Promise.reject(new Error('Max thread queue size reached'))
      }

      availableThreads.splice(0)
      return (...args: any[]) => Promise.all(
        threads.map(thread => new Promise((resolve, reject) => {
          directCallQueueSize += 1
          thread.callOnThread(key, args, (value: any) => {
            directCallQueueSize -= 1
            resolve(value)
          }, (err) => {
            directCallQueueSize -= 1
            reject(err)
          })
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
            .then((thread: WorkerThread) => thread.callOnThread(key, args, resolve, reject))
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
