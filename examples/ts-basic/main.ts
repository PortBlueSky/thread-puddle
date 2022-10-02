// main.ts
import path from 'path'
import { createThreadPool } from '../../lib'
import { IMyWorker } from './worker'

async function start () {
  const worker = await createThreadPool<IMyWorker>(path.resolve(__dirname, './worker'))
  const result = await worker.say() // -> "Hello!"
  
  worker.pool.terminate()
}

start()
