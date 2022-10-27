// main.ts
import { createThreadPool } from '../../lib'
import { MyWorker } from './worker'

(async () => {
  const worker = await createThreadPool<MyWorker>('./worker')
  await worker.say() // -> "Hello!"
  
  worker.pool.terminate()
})()
