const path = require('path')
const { Worker, MessageChannel } = require('worker_threads')

function createWorkerPool ({ size = 1, workerPath }) {
  const workers = []
  const availableWorkers = []
  const workerRequests = []
  const allDoneRequests = []
  let isTerminated = false

  for (let i = 0; i < size; i += 1) {
    const worker = createWorker({
      workerPath,
      onReady (workerWithChannel) {
        if (workerRequests.length) {
          const request = workerRequests.shift()
          return request.resolve(workerWithChannel.proxy)
        }
        availableWorkers.push(workerWithChannel)

        if (!workerRequests.length && workers.length === availableWorkers.length) {
          for (const doneRequest of allDoneRequests) {
            doneRequest.resolve()
          }
        }
      }
    })
    workers.push(worker)
  }

  return {
    getWorker () {
      return new Promise((resolve, reject) => {
        if (isTerminated) {
          return reject(new Error('Worker pool already terminated.'))
        }

        if (availableWorkers.length) {
          const worker = availableWorkers.shift()
          return resolve(worker.proxy)
        }

        const workerRequest = { resolve, reject }
        workerRequests.push(workerRequest)
      })
    },
    allDone () {
      return new Promise((resolve, reject) => {
        allDoneRequests.push({ resolve, reject })
      })
    },
    terminate () {
      isTerminated = true
      for (const pWorker of workers) {
        pWorker.worker.terminate()
      }
    }
  }
}

function createWorker ({ onReady, workerPath }) {
  const worker = new Worker(path.resolve(__dirname, 'worker.js'))
  const workerCallbacks = {}
  let callbackCount = 0
  const { port1, port2 } = new MessageChannel()
  const callOnWorker = (key, args, resolve, reject) => {
    const callbackId = callbackCount++
    workerCallbacks[callbackId] = { resolve, reject }
    port2.postMessage({
      action: 'call',
      key,
      callbackId,
      args
    })
  }
  const proxy = new Proxy({}, {
    get: (target, key) => {
      if (key === 'then') {
        return undefined
      }
      return (...args) => new Promise((resolve, reject) => {
        callOnWorker(key, args, resolve, reject)
      })
    }
  })
  const workerWithChannel = { worker, port: port2, proxy }

  worker.postMessage({ action: 'init', workerPath, port: port1 }, [port1])
  port2.on('message', (msg) => {
    switch (msg.action) {
      case 'resolve': {
        const { resolve } = workerCallbacks[msg.callbackId]
        delete workerCallbacks[msg.callbackId]
        resolve(msg.result)
        onReady(workerWithChannel)
        break
      }
      case 'reject': {
        const { reject } = workerCallbacks[msg.callbackId]
        delete workerCallbacks[msg.callbackId]
        const err = new Error(msg.message)
        err.stack = msg.stack
        reject(err)
        onReady(workerWithChannel)
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

    return null
  })

  return workerWithChannel
}

module.exports = {
  createWorkerPool
}
