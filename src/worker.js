const { parentPort } = require('worker_threads')

parentPort.once('message', (msg) => {
  if (msg.action === 'init') {
    const { workerPath, port } = msg
    const worker = require(workerPath)
    port.on('message', async ({ action, key, args, callbackId }) => {
      switch (action) {
        case 'call': {
          try {
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
