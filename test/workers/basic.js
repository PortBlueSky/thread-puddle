const { workerData } = require('worker_threads')
let currentlyHandling = false

module.exports = {
  fn: (arg1) => 'got ' + arg1,
  fnError: (arg1) => { throw new Error(arg1) },
  asyncFn: async (arg1, timeout = 10) => new Promise(resolve => setTimeout(() => resolve('got async ' + arg1), timeout)),
  fnWorkerNum (arg1) {
    return `got ${arg1} ${this.__ID__}`
  },
  getWorkerData: () => workerData,
  triggerProcessError: () => {
    const err = new Error('Worker failure')
    process.emit('error', err)
  },
  triggerUncaughtException: () => {
    setTimeout(() => {
      const err = new Error('Worker failure')
      process.emit('error', err)
    }, 100)
  },
  waitForUncaughtException: (timeout) => {
    return new Promise(resolve => setTimeout(() => {
      const err = new Error('Worker failure')
      process.emit('error', err)
    }, timeout))
  },
  throwIfCalledAtTheSameTime: async (timeout) => {
    if (currentlyHandling) {
      throw new Error('Should not be called while another method call is handled')
    }
    currentlyHandling = true
    return new Promise(resolve => setTimeout(() => {
      currentlyHandling = false
      resolve()
    }, timeout))
  },
  exitWorker: async (timeout) => new Promise(resolve => setTimeout(() => {
    process.exit()
  }, timeout))
}
