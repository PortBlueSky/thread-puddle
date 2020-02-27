// worker.js
const path = require('path')
const { createThreadPool } = require('../../src')

let nestedWorker = null

module.exports = {
  setup: async () => {
    const worker = await createThreadPool(path.resolve(__dirname, 'nested-worker.js'))
    nestedWorker = worker
  },
  callNested: () => nestedWorker.getNestedValue()
}
