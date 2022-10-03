// main.ts
import { createThreadPool } from '../../lib'
import { MyWorker } from './worker'

async function start () {
  const worker = await createThreadPool<MyWorker>('./worker')
  await worker.say() // -> "Hello!"
  
  worker.pool.terminate()
}

start()
