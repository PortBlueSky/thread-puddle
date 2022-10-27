import { Debugger } from "debug"
import { EventEmitter } from "stream"
import { MessageChannel, MessagePort, Worker, WorkerOptions } from "worker_threads"
import { CallableStore } from "./components/callable-store"
import { ThreadId, ThreadMethodKey } from "./types/general"
import { BaseThreadMessage, InitMessage, isThreadReadyMessage, isThreadStartupErrorMessage, MainMessageAction, ThreadErrorMessage } from "./types/messages"

export interface QueuedCall {
  key: ThreadMethodKey
  args: Array<any>
  resolve: (result: any) => void,
  reject: (error: Error) => void
}

export class WorkerThread extends EventEmitter {
  public readonly id: ThreadId
  public connected: boolean = false
  private worker: Worker
  public readonly port: MessagePort
  public error: Error | boolean = false
  public callQueue: QueuedCall[] = []
  private busy: boolean = true
  private isTerminated: boolean = false
  public callableStore: CallableStore

  constructor(
    id: ThreadId,
    parentId: ThreadId,
    private debug: Debugger, 
    workerString: string, 
    resolvedWorkerPath: string, 
    workerOptions: WorkerOptions, 
  ) {
    super()

    this.id = id
    this.callableStore = new CallableStore(debug)

    this.callableStore.on('callback:error', (err, id, methodName, cbPosition) => {
      this.emit('callback:error', err, id, methodName, cbPosition)
    })

    const worker = new Worker(workerString, { ...workerOptions, eval: true })
    this.worker = worker

    const { port1, port2 } = new MessageChannel()
    this.port = port2

    worker.on('online', () => {
      this.debug(`worker ${id} connected`)

      this.connected = true
    })

    worker.on('exit', (code: number) => {
      this.debug('worker %d exited with code %d', id, code)

      if (!this.error) {
        const err = new Error('Worker thread exited before resolving')
        this.callableStore.rejectAll(err)
        this.callableStore.callbacks.clear()
      }

      this.emit('exit', code, id)
    })

    worker.on('error', (err) => {
      this.debug(`worker ${id} Error: %s`, err.message)

      if (!this.isTerminated) {
        this.callableStore.rejectAll(err)
        
        this.error = err
      }
      
      this.emit('error', err, id)
    })

    // TODO: Handle message error. 
    // Rare and possibly fatal as promises may never be resolved.
    // Note: This happens when trying to receive an array buffer that has already been detached.
    port2.on('messageerror', (err: Error) => {
      // Consider pool termination and reject all open promises
    })

    const messageHandler = (msg: BaseThreadMessage) => {
      this.emit('message', msg, id)

      const handled = this.callableStore.handleMessage(msg, id)

      if (!handled) {
        throw new Error(`Unknown worker pool action "${(msg as BaseThreadMessage).action}"`)
      }
    }

    const initHandler = (msg: BaseThreadMessage) => {
      if (isThreadReadyMessage(msg)) {
        port2.on('message', messageHandler)
        port2.off('message', initHandler)
        this.onReady()
      } else if (isThreadStartupErrorMessage(msg)) {
        // TODO: WTH... why is msg type never?
        const err = new Error((msg as ThreadErrorMessage).message)
        err.stack = (msg as ThreadErrorMessage).stack
        this.emit('startup-error', err, id)
        port2.off('message', initHandler)
      }
    }
    port2.on('message', initHandler)

    const initMsg: InitMessage = {
      action: MainMessageAction.INIT,
      workerPath: resolvedWorkerPath,
      port: port1,
      id,
      parentId
    }

    worker.postMessage(initMsg, [port1])
  }

  terminate() {
    this.isTerminated = true
    this.worker.terminate()
  }

  onReady() {
    this.busy = false
    
    if (this.callQueue.length > 0) {
      const { key, args, resolve, reject } = this.callQueue.shift()!
      this.callOnThread(key, args, resolve, reject)
      return
    }

    this.emit('ready', this.id)
  }

  callOnThread(
    key: ThreadMethodKey,
    args: any[],
    resolve: (result: any) => void,
    reject: (error: Error) => void
  ) {
    if (this.busy) {
      this.debug('queuing %s on worker %d', key, this.id)
      this.callQueue.push({ key, args, resolve, reject })
      return
    }

    this.debug('calling %s on worker %d', key, this.id)
    this.busy = true

    const { msg, transferables } = this.callableStore.createCallMessage(key, args, { 
      resolve, reject, done: () => this.onReady() 
    })

    this.port.postMessage(msg, transferables)
  }
}