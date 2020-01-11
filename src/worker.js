const { parentPort } = require('worker_threads')

parentPort.once('message', (msg) => {
  if (msg.action === 'init') {
    const { workerPath, port, id } = msg
    const worker = require(workerPath)

    worker.__ID__ = id

    port.on('message', async ({ action, key, args, callbackId }) => {
      switch (action) {
        case 'call': {
          try {
            if (typeof worker[key] !== 'function') {
              throw new Error(`"${key}" is not a function on any worker`)
            }
            const result = await worker[key](...args)
            port.postMessage({ action: 'resolve', callbackId, result })
          } catch ({ message, stack }) {
            port.postMessage({ action: 'reject', callbackId, message, stack })
          }
          break
        }
        default: {
          throw new Error(`Unknown action "${msg.action}" for thread-worker`)
        }
      }
    })

    msg.port.postMessage({ action: 'ready' })
  }
})
