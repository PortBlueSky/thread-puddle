import { createThreadPool } from '../../lib'
import { CalcWorker } from './puddle-worker'
import { MessageChannel, MessagePort, Worker, WorkerOptions } from "worker_threads"
import path from 'path'

const ITERATIONS = 100000

async function start () {
  // Puddle
  const worker = await createThreadPool<CalcWorker>('./puddle-worker')
  const puddleStart = Date.now()
  
  for (let i = 0; i < ITERATIONS; i++) {
    await worker.add(1, 2) 
  }

  worker.pool.terminate()

  const duration = Date.now() - puddleStart
  const perCallAvg = duration / ITERATIONS

  console.log('Puddle duration:', duration)
  console.log('Puddle avg per call:', perCallAvg)
  
  // Raw
  const workerPath = path.resolve(__dirname, './raw-worker.ts')
  const workerString = `require('ts-node/register/transpile-only')\nrequire('${workerPath}')`
  const rawWorker = new Worker(workerString, { eval: true })
  let count = 0
  let rawStart = 0
  
  const done = () => {
    if (count < ITERATIONS) {
      return run()
    }

    rawWorker.terminate()

    const duration = Date.now() - rawStart
    const perCallAvg = duration / ITERATIONS
  
    console.log('Raw duration:', duration)
    console.log('Raw avg per call:', perCallAvg)
  }

  const run = () => {
    count += 1
    rawWorker.postMessage({ action: 'calc', a: 1, b: 2 })
  }

  rawWorker.on('message', (msg: any) => {
    if (msg.action === 'result') {
      done()
    } else if (msg.action === 'ready') {
      rawStart = Date.now()
      run()
    }
  })
}

start()
