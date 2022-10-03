// worker.ts
export class MyWorker {
  callMe(callback: (msg: string) => void): void {
    callback('Hello!')
  }
}

export default new MyWorker()