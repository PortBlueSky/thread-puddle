import { workerData } from 'worker_threads'
import { threadId } from '../../'
let currentlyHandling = false

export default {
  fn: (arg1: any) => 'got ' + arg1,
  fnError: (arg1: any) => { throw new Error(arg1) },
  asyncFn: async (arg1: any, timeout = 10) => new Promise(resolve => setTimeout(() => resolve('got async ' + arg1), timeout)),
  fnWorkerNum: (arg1: any) => `got ${arg1} ${threadId}`,
  getWorkerData: () => workerData,
  triggerProcessError: () => {
    const err = new Error('Worker failure')
    // @ts-expect-error Just for testing
    process.emit('error', err)
  },
  triggerUncaughtException: () => {
    setTimeout(() => {
      const err = new Error('Worker failure')
      // @ts-expect-error Just for testing
      // It's not in the types, but it behaves like an uncaught exception,
      // as long as there is no error event listener 
      process.emit('error', err)
    }, 100)
  },
  waitForUnhandledRejection: (timeout: any) => {
    return new Promise(() => setTimeout(() => {
      new Promise((_, reject) => {
        const err = new Error('Worker Promise failure')
        reject(err)
      })
    }, timeout))
  },
  waitForUncaughtException: (timeout: any) => {
    return new Promise(() => setTimeout(() => {
      const err = new Error('Worker failure')
      // @ts-expect-error Just for testing
      process.emit('error', err)
    }, timeout))
  },
  throwIfCalledAtTheSameTime: async (timeout: any) => {
    if (currentlyHandling) {
      throw new Error('Should not be called while another method call is handled')
    }
    currentlyHandling = true
    return new Promise<void>(resolve => setTimeout(() => {
      currentlyHandling = false
      resolve()
    }, timeout))
  },
  exitWorker: async (timeout: any) => new Promise(() => setTimeout(() => {
    process.exit()
  }, timeout)),
  triggerExit: () => {
    setTimeout(() => process.exit(), 25)
  }
}
