const path = require('path')
const { Worker, MessageChannel } = require('worker_threads')
const debug = require('debug')('puddle:master')

const workerProxyPath = path.resolve(__dirname, 'worker.js')
let threadIdOffset = 1

async function createThreadPuddle ({
  size = 1,
  workerPath,
  workerOptions = {},
  startupTimeout = 3000
}) {
  debug('carving out a puddle...')

  const workers = []
  const availableWorkers = []
  const workerRequests = []
  const workerCallbacks = {}
  let callbackCount = 0
  let isTerminated = false

  const onReady = (worker) => {
    if (workerRequests.length) {
      const request = workerRequests.shift()
      return request.resolve(worker)
    }
    availableWorkers.push(worker)
  }

  const removeWorker = ({ id }) => {
    workers.splice(workers.findIndex(worker => (worker.id === id)), 1)
    availableWorkers.splice(availableWorkers.findIndex(worker => (worker.id === id)), 1)
  }

  const createWorker = (id) => {
    const worker = new Worker(workerProxyPath, workerOptions)
    const { port1, port2 } = new MessageChannel()
    const workerWithChannel = { id, worker, port: port2 }

    worker.on('exit', (code) => {
      debug('worker %d exited with code %d', id, code)
      removeWorker(workerWithChannel)
      // TODO: if all workes exited, terminate pool
    })

    worker.on('error', (err) => {
      debug(`worker ${id} Error: %s`, err.message)
      if (!isTerminated) {
        debug(`restarting worker ${id} after uncaught error`)
        createWorker(id)
        // TODO: Count worker failures, after max failures, terminate pool
      }
    })

    worker.postMessage({ action: 'init', workerPath, port: port1, id }, [port1])
    port2.on('message', (msg) => {
      switch (msg.action) {
        case 'resolve': {
          const { resolve } = workerCallbacks[msg.callbackId]
          delete workerCallbacks[msg.callbackId]
          onReady(workerWithChannel)
          resolve(msg.result)
          break
        }
        case 'reject': {
          const { reject } = workerCallbacks[msg.callbackId]
          delete workerCallbacks[msg.callbackId]
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

    workers.push(workerWithChannel)
  }

  debug('filling puddle with thread liquid...')

  for (let i = threadIdOffset; i < size + threadIdOffset; i += 1) {
    const id = i

    debug('creating worker thread %s', id)

    createWorker(id)
  }

  threadIdOffset += size

  const callOnWorker = (worker, key, args, resolve, reject) => {
    const callbackId = callbackCount++
    workerCallbacks[callbackId] = { resolve, reject }
    worker.port.postMessage({
      action: 'call',
      key,
      callbackId,
      args
    })
  }

  const getWorker = () => new Promise((resolve, reject) => {
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
    debug('Pulling the plug on the puddle...')

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
        debug('Worker %d ready', worker.id)

        clearTimeout(timeout)
        availableWorkers.push(worker)
        resolve()
      },
      reject: (err) => {
        debug('Worker %d startup failed', worker.id)

        clearTimeout(timeout)
        terminate()
        reject(err)
      }
    }

    workerRequests.push(workerRequest)
  })))
  availableWorkers.sort((a, b) => a.id < b.id ? -1 : 1)

  debug('Puddle filled, happy splashing!')

  const puddleInterface = {
    terminate
  }
  Object.defineProperty(puddleInterface, 'size', {
    get: () => workers.length
  })

  return new Proxy({
    puddle: puddleInterface
  }, {
    get: (target, key) => {
      // If the proxy is returned from an async function,
      // the engine checks if it is a thenable by checking existence of a then method
      if (key === 'then') {
        return undefined
      }
      if (key === 'puddle') {
        return target.puddle
      }
      return (...args) => new Promise((resolve, reject) => {
        getWorker().then(worker => callOnWorker(worker, key, args, resolve, reject))
      })
    }
  })
}

module.exports = {
  createThreadPuddle,
  createThreadPool: createThreadPuddle
}
