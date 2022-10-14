import { workerData } from 'worker_threads'
import { threadId } from '../../'
let currentlyHandling = false

export default {
  fn: (arg1) => 'got ' + arg1,
  fnError: (arg1) => { throw new Error(arg1) },
  asyncFn: async (arg1, timeout = 10) => new Promise(resolve => setTimeout(() => resolve('got async ' + arg1), timeout)),
  fnWorkerNum: (arg1) => `got ${arg1} ${threadId}`,
  getWorkerData: () => workerData,
  triggerProcessError: () => {
    const err = new Error('Worker failure')
    // @ts-ignore
    process.emit('error', err)
  },
  triggerUncaughtException: () => {
    setTimeout(() => {
      const err = new Error('Worker failure')
      // @ts-ignore
      // It's not in the types, but it behaves like an uncaught exception,
      // as long as there is no error event listener 
      process.emit('error', err)
    }, 100)
  },
  waitForUnhandledRejection: (timeout) => {
    return new Promise(resolve => setTimeout(() => {
      new Promise((resolve, reject) => {
        const err = new Error('Worker Promise failure')
        reject(err)
      })
    }, timeout))
  },
  waitForUncaughtException: (timeout) => {
    return new Promise(resolve => setTimeout(() => {
      const err = new Error('Worker failure')
      // @ts-ignore
      process.emit('error', err)
    }, timeout))
  },
  throwIfCalledAtTheSameTime: async (timeout) => {
    if (currentlyHandling) {
      throw new Error('Should not be called while another method call is handled')
    }
    currentlyHandling = true
    return new Promise<void>(resolve => setTimeout(() => {
      currentlyHandling = false
      resolve()
    }, timeout))
  },
  exitWorker: async (timeout) => new Promise(resolve => setTimeout(() => {
    process.exit()
  }, timeout)),
  triggerExit: () => {
    setTimeout(() => process.exit(), 25)
  }
}
