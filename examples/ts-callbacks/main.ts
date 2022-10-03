// main.ts
import { createThreadPool } from '../../lib'
import { MyWorker } from './worker'

async function start () {
  const worker = await createThreadPool<MyWorker>('./worker')
  const callback = (msg: string) => console.log(msg)
  await worker.callMe(callback) 
  
  worker.pool.terminate()
}

start()
