// main.js
const { createThreadPool } = require('../../src')
const path = require('path')

async function start () {
  const worker = await createThreadPool(path.resolve(__dirname, 'worker.js'))

  await worker.setup()
  const result = await worker.callNested()

  console.log(result) // -> "value from nested worker"

  worker.pool.terminate()
}

start()
