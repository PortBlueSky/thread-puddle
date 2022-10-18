import { parentPort } from 'worker_threads'

if (!parentPort) {
  throw new Error('No parentPort available')
}

parentPort.on('message', (msg: any) => {
  if (msg.action === 'calc') {
    const result = msg.a + msg.back
    parentPort?.postMessage({ action: 'result', result })
  }
})

parentPort.postMessage({ action: 'ready' })