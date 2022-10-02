export class WorkerWithCallback {
  withCallback(x: number, y: number, callback: (result: number) => void) {
    const result = x + y
    callback(result)
  }
}

export default new WorkerWithCallback()