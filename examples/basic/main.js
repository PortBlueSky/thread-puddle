// main.js
const { createPuddle } = require('../../src')
const path = require('path')

async function start () {
  const worker = await createPuddle(path.resolve(__dirname, 'worker.js'), {
    size: 2
  })

  const result = await worker.say()

  console.log(result) // -> "Hello!"

  worker.puddle.terminate()
}

start()
