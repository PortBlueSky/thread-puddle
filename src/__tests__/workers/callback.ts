export class WorkerWithCallback {
  withCallback(x: number, y: number, callback: (result: number) => void) {
    const result = x + y
    callback(result)
  }

  withDelayedCallback(x: number, y: number, timeout: number, callback: (result: number) => void) {
    const result = x + y
    setTimeout(() => {
      callback(result)
    }, timeout)
  }
}

export default new WorkerWithCallback()