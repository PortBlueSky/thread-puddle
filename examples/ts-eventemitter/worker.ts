import EventEmitter from "events"

// worker.ts
export class MyWorker extends EventEmitter {
  triggerMe(msg: string): void {
    this.emit('trigger', msg)
  }
}

export default new MyWorker()