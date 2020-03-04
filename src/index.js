const path = require('path')
const EventEmitter = require('events')
const { Worker, MessageChannel } = require('worker_threads')
// TODO: Adjust debug namespace when worker threads are nested
const debug = require('debug')('puddle:master')
const { Transferable, withTransfer } = require('./Transferable')
const dynamicExports = require('./export-bridge')

const workerProxyPath = path.resolve(__dirname, 'worker.js')
let threadIdOffset = 1

async function createThreadPool (workerPath, {
  size = 1,
  workerOptions = {},
  startupTimeout = 30000
} = {}) {
  debug('carving out a puddle...')

  const threads = []
  const availableThreads = []
  const threadRequests = []
  const threadCallbacks = new Map()
  let callbackCount = 0
  let isTerminated = false

  const allWorkersTarget = {}
  const puddleInterface = new EventEmitter()

  const onReady = (thread) => {
    if (thread.callQueue.length > 0) {
      const waitingCall = thread.callQueue.shift()
      callOnThread(thread, ...waitingCall)
      return
    }

    if (threadRequests.length > 0) {
      const request = threadRequests.shift()
      request.resolve(thread)
      return
    }

    thread.busy = false
    availableThreads.push(thread)
  }

  const removeThread = ({ id }) => {
    threads.splice(threads.findIndex(thread => (thread.id === id)), 1)
    availableThreads.splice(availableThreads.findIndex(thread => (thread.id === id)), 1)
  }

  const createThread = (id) => {
    debug('creating worker thread %s', id)

    const worker = new Worker(workerProxyPath, workerOptions)
    const { port1, port2 } = new MessageChannel()
    const thread = {
      id,
      worker,
      port: port2,
      error: false,
      callQueue: [],
      busy: false
    }

    worker.on('exit', (code) => {
      debug('worker %d exited with code %d', id, code)

      if (!thread.error) {
        const err = new Error('Worker thread exited before resolving')
        const callbacks = threadCallbacks.get(id)

        for (const { reject } of callbacks.values()) {
          reject(err)
        }
      }

      removeThread(thread)

      if (threads.length === 0) {
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

      if (!isTerminated) {
        const callbacks = threadCallbacks.get(id)

        for (const { reject } of callbacks.values()) {
          reject(err)
        }

        thread.error = err

        debug(`restarting worker ${id} after uncaught error`)
        createThread(id)
      }
    })

    worker.postMessage({ action: 'init', workerPath, port: port1, id }, [port1])
    port2.on('message', (msg) => {
      switch (msg.action) {
        case 'resolve': {
          debug('worker %d resolved callback %d', id, msg.callbackId)
          const callbacks = threadCallbacks.get(id)
          const { resolve } = callbacks.get(msg.callbackId)
          callbacks.delete(msg.callbackId)
          onReady(thread)
          resolve(msg.result)
          break
        }
        case 'reject': {
          const callbacks = threadCallbacks.get(id)
          const { reject } = callbacks.get(msg.callbackId)
          callbacks.delete(msg.callbackId)
          const err = new Error(msg.message)
          err.stack = msg.stack
          onReady(thread)
          reject(err)
          break
        }
        case 'ready': {
          onReady(thread)
          break
        }
        case 'startup-error': {
          if (threadRequests.length > 0) {
            const request = threadRequests.shift()
            const err = new Error(msg.message)
            err.stack = msg.stack
            request.reject(err)
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

  for (let i = threadIdOffset; i < size + threadIdOffset; i += 1) {
    createThread(i)
  }

  threadIdOffset += size

  function callOnThread (thread, key, args, resolve, reject) {
    debug('calling %s on worker %d', key, thread.id)
    thread.busy = true
    const callbackId = callbackCount++
    threadCallbacks.get(thread.id).set(callbackId, { resolve, reject })

    const transferables = []
    const iteratedArgs = args.map((arg) => {
      if (arg instanceof Transferable) {
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
      debug('Resolving available worker %d', thread.id)
      return resolve(thread)
    }

    const threadRequest = { resolve, reject }
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

      if (['pool', 'all'].includes(key)) {
        return target[key]
      }

      return (...args) => new Promise((resolve, reject) => {
        getAvailableThread()
          .then(thread => callOnThread(thread, key, args, resolve, reject))
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
  ...dynamicExports
}
