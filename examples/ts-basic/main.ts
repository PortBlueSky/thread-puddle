// main.ts
import { createThreadPool } from '../../lib'
import { IMyWorker } from './worker'

(async () => {
  const worker = await createThreadPool<IMyWorker>('./worker')
  await worker.say() // -> "Hello!"
  
  worker.pool.terminate()
})()
