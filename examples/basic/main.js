// main.js
const { createThreadPool } = require('../../src')
const path = require('path')

async function start () {
  const worker = await createThreadPool(path.resolve(__dirname, 'worker.js'), {
    size: 2
  })

  const result = await worker.say()

  console.log(result) // -> "Hello!"

  worker.pool.terminate()
}

start()
