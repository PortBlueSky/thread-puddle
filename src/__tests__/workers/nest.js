const path = require('path')
const { createThreadPool } = require('../../')

let nestedWorker = null

module.exports = {
  setup: async () => {
    const worker = await createThreadPool(path.resolve(__dirname, 'nested.js'))
    nestedWorker = worker
  },
  callNested: (val) => nestedWorker.getNestedValue(val)
}
