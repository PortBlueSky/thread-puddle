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
}

export interface BaseWorker {
  pool: PoolInterface
}

export type MainFunctionMap = Map<number, Function>

export interface PoolInterface extends EventEmitter {
  terminate(): void
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

  const threads: WorkerThread[] = []
  const availableThreads: WorkerThread[] = []
  const threadRequests: ThreadRequest[] = []
  
  let isTerminated = false

  const allWorkersTarget = {}
  const puddleInterface = new EventEmitter()

  const removeThread = ({ id }: WorkerThread) => {
    threads.splice(threads.findIndex(thread => (thread.id === id)), 1)
    availableThreads.splice(availableThreads.findIndex(thread => (thread.id === id)), 1)
  }

  const threadCallableStore = new CallableStore(debugOut)

  const createThread = () => {
    debugOut('creating worker thread')

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

    const thread = new WorkerThread(workerThreadIdSequence.next(), threadId, debugOut, workerString, resolvedWorkerPath, workerOptions, threadCallableStore)

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
      puddleInterface.emit('exit', code, id)

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

    thread.on('error', (err, id) => {
      if (puddleInterface.listenerCount('error') > 0) {
        puddleInterface.emit('error', err, id)
      }

      // TODO: Make auto respawn optional
      if (thread.connected) {
        debugOut(`restarting worker after uncaught error`)
        
        createThread()
      }
    })

    threads.push(thread)
  }

  debugOut('filling puddle with thread liquid...')

  for (let i = 0; i < size; i += 1) {
    createThread()
  }

  const getAvailableThread = () => new Promise<WorkerThread>((resolve, reject) => {
    if (isTerminated) {
      return reject(new Error('Worker pool already terminated.'))
    }

    if (availableThreads.length > 0) {
      const thread = availableThreads.shift()
      debugOut('Resolving available worker %d', thread!.id)
      return resolve(thread as WorkerThread)
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

  Object.assign(puddleInterface, {
    terminate
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

      return (...args: any[]) => Promise.all(
        threads.map(thread => new Promise((resolve, reject) => {
          thread.callOnThread(key, args, resolve, reject)
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
