const path = require('path')
const { Worker, MessageChannel } = require('worker_threads')

const workerProxyPath = path.resolve(__dirname, 'worker.js')

async function createWorkerPool ({ size = 1, workerPath }) {
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

  for (let i = 1; i <= size; i += 1) {
    const worker = new Worker(workerProxyPath)
    const { port1, port2 } = new MessageChannel()
    const workerWithChannel = { id: i, worker, port: port2 }

    worker.postMessage({ action: 'init', workerPath, port: port1, id: i }, [port1])
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
    isTerminated = true
    for (const pWorker of workers) {
      pWorker.worker.terminate()
    }
  }

  await Promise.all(workers.map((worker) => new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      terminate()
      reject(new Error(`Worker ${worker.id} initialization timed out`))
    }, 3000)
    const workerRequest = {
      resolve: (worker) => {
        clearTimeout(timeout)
        availableWorkers.push(worker)
        resolve()
      },
      reject: (err) => {
        clearTimeout(timeout)
        terminate()
        reject(err)
      }
    }
    workerRequests.push(workerRequest)
  })))
  availableWorkers.sort((a, b) => a.id < b.id ? -1 : 1)

  return new Proxy({}, {
    get: (target, key) => {
      if (key === 'then') {
        return undefined
      }
      if (key === 'terminate') {
        return terminate
      }
      return (...args) => new Promise((resolve, reject) => {
        getWorker().then(worker => callOnWorker(worker, key, args, resolve, reject))
      })
    }
  })
}

module.exports = {
  createWorkerPool
}
