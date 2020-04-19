// main.ts
import path from 'path'
import { createThreadPool } from '../../lib'
import { IMyWorker } from './worker'

async function start () {
  const worker = await createThreadPool<IMyWorker>(path.resolve(__dirname, './worker'), {
    size: 2
  })

  const result = await worker.say()

  console.log(result) // -> "Hello!"
  
  worker.pool.terminate()
}

start()
