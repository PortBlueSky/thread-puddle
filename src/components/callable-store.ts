import { Debugger } from "debug";
import { MainFunctionMap } from "..";
import { Transferable, TransferableValue } from "../Transferable";
import { CallbackId, ThreadMethodKey } from "../types/general";
import { BaseThreadMessage, CallMessage, isThreadCallbackMessage, isThreadErrorMessage, MainMessageAction } from "../types/messages";
import { CountSequence, createSequence } from "../utils/sequence";

export interface Callback {
  resolve(result: any): void
  reject(error: Error): void
}

export class CallableStore {
  private callables = new Map<CallbackId, Callback>()
  private callableSequence = createSequence()

  constructor(
    private debug: Debugger, 
    private id: number,
    private mainFunctions: Map<ThreadMethodKey, MainFunctionMap>,
    private functionSequence: CountSequence
  ) {

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

      if (typeof arg === 'function') {
        argFunctionPositions.push(index)
        if (!this.mainFunctions.has(key)) {
          this.mainFunctions.set(key, new Map<number, Function>)
        }
        const fnHolder = this.mainFunctions.get(key)!
        
        const newId = this.functionSequence.next()
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

  handleMessage(msg: BaseThreadMessage) {
    if (isThreadCallbackMessage(msg)) {
      this.debug('Callable id %d resolved callback %d', this.id, msg.callbackId)
      
      const callback = this.callables.get(msg.callbackId)
      this.callables.delete(msg.callbackId)
      callback!.resolve(msg.result)
      return
    } else if (isThreadErrorMessage(msg)) {
      this.debug('Callable id %d rejected callback %d', this.id, msg.callbackId)
      
      const callback = this.callables.get(msg.callbackId)
      this.callables.delete(msg.callbackId)
      // TODO: Resolve to correct error class
      const err = new Error(msg.message)
      err.stack = msg.stack
      callback!.reject(err)
      return
    }
  }
}
