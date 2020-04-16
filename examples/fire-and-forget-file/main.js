// main.js
const { createThreadPool } = require('../../src')
const path = require('path')

async function start () {
  const worker = await createThreadPool(path.resolve(__dirname, 'worker.js'), {
    size: 4
  })

  await worker.fireAndForget(
    path.resolve(__dirname, 'incoming-file'),
    'method1',
    'argument1',
    'argument2'
  )

  worker.pool.terminate()
}

start()
