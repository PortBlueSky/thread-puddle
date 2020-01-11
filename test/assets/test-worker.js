const { workerData } = require('worker_threads')

module.exports = {
  fn: (arg1) => 'got ' + arg1,
  fnError: (arg1) => { throw new Error(arg1) },
  asyncFn: async (arg1) => new Promise(resolve => setTimeout(() => resolve('got async ' + arg1), 10)),
  fnWorkerNum (arg1) {
    return `got ${arg1} ${this.__ID__}`
  },
  getWorkerData: () => workerData
}
