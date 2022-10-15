import { Debugger } from "debug";
import { EventEmitter } from "stream";
import { MainFunctionMap } from "..";
import { Transferable, TransferableValue } from "../Transferable";
import { CallbackId, ThreadMethodKey } from "../types/general";
import { BaseThreadMessage, CallMessage, isThreadCallbackMessage, isThreadErrorMessage, isThreadFreeFunctionMessage, isThreadFunctionMessage, MainMessageAction } from "../types/messages";
import { createSequence } from "../utils/sequence";

export interface Callback {
  resolve(result: any): void
  reject(error: Error): void
  done?: (success: boolean) => void
}

export class CallableStore extends EventEmitter {
  private callables = new Map<CallbackId, Callback>()
  private callableSequence = createSequence()
  public mainFunctions = new Map<ThreadMethodKey, MainFunctionMap>()
  private functionSequence = createSequence()

  constructor(
    private debug: Debugger
  ) {
    super()
  }

  rejectAll(withErr: Error) {
    for (const { reject } of this.callables.values()) {
      reject(withErr)
    }
  }

  createCallMessage(key: ThreadMethodKey, args: any[], callable: Callback): { msg: CallMessage, transferables: Transferable[] } {
    const callableId = this.callableSequence.next()
    this.callables.set(callableId, callable)

    let argFunctionPositions: number[] = []
    const transferables: Transferable[] = []
    const iteratedArgs = args.map((arg: any, index: number) => {
      if (arg instanceof TransferableValue) {
        transferables.push(...arg.transferables)
        return arg.obj
      }

      // TODO:
      // Consider forcing callbacks to have an error handler with something like:
      // worker.method1(arg1, Callback(fn, (err) => handle(err)))

      if (typeof arg === 'function') {
        argFunctionPositions.push(index)
        if (!this.mainFunctions.has(key)) {
          this.mainFunctions.set(key, new Map<number, Function>)
        }
        const fnHolder = this.mainFunctions.get(key)!
        
        const newId = this.functionSequence.next()
        // TODO: use AsyncResource for correct stack trace
        // ->  https://nodejs.org/api/async_context.html#class-asyncresource
        fnHolder.set(newId, arg)

        return { id: newId } 
      }
      return arg
    })

    const msg: CallMessage = {
      action: MainMessageAction.CALL,
      key,
      callbackId: callableId,
      args: iteratedArgs,
      argFunctionPositions
    }

    return { msg, transferables }
  }

  handleMessage(msg: BaseThreadMessage, id: number): boolean {
    if (isThreadCallbackMessage(msg)) {
      this.debug('Callable id %d resolved callback %d', id, msg.callbackId)
      
      const callback = this.callables.get(msg.callbackId)!
      this.callables.delete(msg.callbackId)
      callback.resolve(msg.result)
      callback.done && callback.done(true)
      return true
    } else if (isThreadErrorMessage(msg)) {
      this.debug('Callable id %d rejected callback %d', id, msg.callbackId)
      
      const callback = this.callables.get(msg.callbackId)!
      this.callables.delete(msg.callbackId)
      // TODO: Resolve to correct error class
      const err = new Error(msg.message)
      err.stack = msg.stack
      callback.reject(err)
      callback.done && callback.done(false)
      return true
    } else if (isThreadFunctionMessage(msg)) {
      this.debug('worker %d calling function %s[%d]', id, msg.key, msg.functionId)
      
      const fnHolder = this.mainFunctions.get(msg.key)
      if (fnHolder) {
        // Note: the function has to be there,
        // if it fails, something is wrong with storing them or garbage collecting
        const mFn = fnHolder.get(msg.functionId)!
        Promise.resolve().then(() => mFn(...msg.args)).catch((err) => this.emit('callback:error', err, id))
      }
      return true
    } else if (isThreadFreeFunctionMessage(msg)) {
      this.debug('worker %d calling free %s[%d]', id, msg.key, msg.functionId)
      
      const fnHolder = this.mainFunctions.get(msg.key)
      if (fnHolder) {
        fnHolder.delete(msg.functionId)
      }
      return true
    }
    return false
  }
}
