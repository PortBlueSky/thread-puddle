// main.ts
import { createThreadPool } from '../../lib'
import { MyWorker } from './worker'

(async () => {
  const worker = await createThreadPool<MyWorker>('./worker')
  worker.on('trigger', (msg: string) => console.log(msg))
  await worker.triggerMe('Hello Event!') 
  
  worker.pool.terminate()
})()
