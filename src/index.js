const path = require('path')
const { Worker, MessageChannel } = require('worker_threads')
const debug = require('debug')('puddle:master')
const { Transferable, withTransfer } = require('./Transferable')

const workerProxyPath = path.resolve(__dirname, 'worker.js')
let threadIdOffset = 1

async function createThreadPool (workerPath, {
  size = 1,
  workerOptions = {},
  startupTimeout = 30000
} = {}) {
  debug('carving out a puddle...')

  const workers = []
  const availableWorkers = []
  const workerRequests = []
  const workerCallbacks = {}
  let callbackCount = 0
  let isTerminated = false

  const onReady = (worker) => {
    if (worker.callQueue.length > 0) {
      const waitingCall = worker.callQueue.shift()
      callOnWorker(worker, ...waitingCall)
      return
    }

    if (workerRequests.length) {
      const request = workerRequests.shift()
      request.resolve(worker)
      return
    }

    worker.busy = false
    availableWorkers.push(worker)
  }

  const removeWorker = ({ id }) => {
    workers.splice(workers.findIndex(worker => (worker.id === id)), 1)
    availableWorkers.splice(availableWorkers.findIndex(worker => (worker.id === id)), 1)
  }

  const createWorker = (id) => {
    debug('creating worker thread %s', id)

    const worker = new Worker(workerProxyPath, workerOptions)
    const { port1, port2 } = new MessageChannel()
    const workerWithChannel = {
      id,
      worker,
      port: port2,
      error: false,
      callQueue: [],
      busy: false
    }

    worker.on('exit', (code) => {
      debug('worker %d exited with code %d', id, code)

      if (!workerWithChannel.error) {
        const err = new Error('Worker thread exited before resolving')

        for (const callbackId in workerCallbacks[id]) {
          workerCallbacks[id][callbackId].reject(err)
        }
      }

      removeWorker(workerWithChannel)

      if (workers.length === 0) {
        const err = new Error('All workers exited before resolving')
        for (const workerRequest of workerRequests) {
          workerRequest.reject(err)
        }
      }
    })

    worker.on('error', (err) => {
      debug(`worker ${id} Error: %s`, err.message)
      if (!isTerminated) {
        for (const callbackId in workerCallbacks[id]) {
          workerCallbacks[id][callbackId].reject(err)
        }
        workerWithChannel.error = err

        debug(`restarting worker ${id} after uncaught error`)
        createWorker(id)
      }
    })

    worker.postMessage({ action: 'init', workerPath, port: port1, id }, [port1])
    port2.on('message', (msg) => {
      switch (msg.action) {
        case 'resolve': {
          const { resolve } = workerCallbacks[id][msg.callbackId]
          delete workerCallbacks[id][msg.callbackId]
          onReady(workerWithChannel)
          resolve(msg.result)
          break
        }
        case 'reject': {
          const { reject } = workerCallbacks[id][msg.callbackId]
          delete workerCallbacks[id][msg.callbackId]
          const err = new Error(msg.message)
          err.stack = msg.stack
          onReady(workerWithChannel)
          reject(err)
          break
        }
        case 'ready': {
          onReady(workerWithChannel)
          break
        }
        default: {
          throw new Error(`Unknown worker pool action "${msg.action}"`)
        }
      }
    })

    workerCallbacks[id] = {}

    workers.push(workerWithChannel)
  }

  debug('filling puddle with thread liquid...')

  for (let i = threadIdOffset; i < size + threadIdOffset; i += 1) {
    createWorker(i)
  }

  threadIdOffset += size

  function callOnWorker (worker, key, args, resolve, reject) {
    worker.busy = true
    const callbackId = callbackCount++
    workerCallbacks[worker.id][callbackId] = { resolve, reject }

    const transferables = []
    const iteratedArgs = args.map((arg) => {
      if (arg instanceof Transferable) {
        transferables.push(...arg.transferables)
        return arg.obj
      }
      return arg
    })

    worker.port.postMessage({
      action: 'call',
      key,
      callbackId,
      args: iteratedArgs
    }, transferables)
  }

  const getAvailableWorker = () => new Promise((resolve, reject) => {
    if (isTerminated) {
      return reject(new Error('Worker pool already terminated.'))
    }

    if (availableWorkers.length) {
      const worker = availableWorkers.shift()
      return resolve(worker)
    }

    const workerRequest = { resolve, reject }
    workerRequests.push(workerRequest)
  })

  const terminate = () => {
    debug('pulling the plug on the puddle...')

    isTerminated = true
    for (const pWorker of workers) {
      pWorker.worker.terminate()
    }
  }

  await Promise.all(workers.map((worker) => new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      terminate()
      reject(new Error(`Worker ${worker.id} initialization timed out`))
    }, startupTimeout)
    const workerRequest = {
      resolve: (worker) => {
        debug('worker %d ready', worker.id)

        clearTimeout(timeout)
        availableWorkers.push(worker)
        resolve()
      },
      reject: (err) => {
        debug('worker %d startup failed', worker.id)

        clearTimeout(timeout)
        terminate()
        reject(err)
      }
    }

    workerRequests.push(workerRequest)
  })))
  availableWorkers.sort((a, b) => a.id < b.id ? -1 : 1)

  debug('puddle filled, happy splashing!')

  const puddleInterface = {
    terminate
  }
  Object.defineProperty(puddleInterface, 'size', {
    get: () => workers.length
  })
  Object.defineProperty(puddleInterface, 'isTerminated', {
    get: () => isTerminated
  })

  const allWorkersInterface = new Proxy({}, {
    get: (target, key) => {
      if (key === 'then') {
        return undefined
      }

      return (...args) => Promise.all(
        workers.map(worker => new Promise((resolve, reject) => {
          if (!worker.busy) {
            callOnWorker(worker, key, args, resolve, reject)
            return
          }
          worker.callQueue.push({ key, args, resolve, reject })
        }))
      )
    }
  })

  return new Proxy({
    puddle: puddleInterface,
    pool: puddleInterface,
    all: allWorkersInterface
  }, {
    get: (target, key) => {
      // If the proxy is returned from an async function,
      // the engine checks if it is a thenable by checking existence of a then method
      if (key === 'then') {
        return undefined
      }

      if (['puddle', 'pool', 'all'].includes(key)) {
        return target[key]
      }

      return (...args) => new Promise((resolve, reject) => {
        getAvailableWorker()
          .then(worker => callOnWorker(worker, key, args, resolve, reject))
          .catch(err => reject(err))
      })
    }
  })
}

module.exports = {
  createPuddle: createThreadPool,
  spawn: createThreadPool,
  withTransfer
}
