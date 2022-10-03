// main.ts
import { createThreadPool } from '../../lib'
import { IMyWorker } from './worker'

async function start () {
  const worker = await createThreadPool<IMyWorker>('./worker')
  await worker.say() // -> "Hello!"
  
  worker.pool.terminate()
}

start()
