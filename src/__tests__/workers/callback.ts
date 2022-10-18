export class WorkerWithCallback {
  withCallback(x: number, y: number, callback: (result: number) => void) {
    const result = x + y
    callback(result)
  }

  withCallbackReturn(x: number, y: number, callback: (result: number) => Promise<number>) {
    const result = x + y
    return callback(result)
  }

  withDelayedCallback(x: number, y: number, timeout: number, callback: (result: number) => void) {
    const result = x + y
    setTimeout(() => {
      callback(result)
    }, timeout)
  }

  triggerExit() {
    setTimeout(() => process.exit(), 25)
  }
}

export default new WorkerWithCallback()
