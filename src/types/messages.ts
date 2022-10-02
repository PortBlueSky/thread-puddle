import { MessagePort } from "worker_threads"
import { CallbackId, ThreadId, ThreadMethodKey } from "./general"

// Sent by main
export enum MainMessageAction {
  CALL = 'call',
  INIT = 'init'
}

export type BaseMainMessage = {
  action: MainMessageAction
}

export type CallMessage = BaseMainMessage & {
  key: ThreadMethodKey
  callbackId: number
  args: any
  argFunctionPositions: number[]
}

export type InitMessage = BaseMainMessage & {
  workerPath: string
  port: MessagePort
  id: ThreadId
  parentId: ThreadId
}

// Sent by thread
export enum ThreadMessageAction {
  RESOLVE = 'resolve',
  REJECT = 'reject',
  READY = 'ready',
  STARTUP_ERROR = 'startup-error',
  CALL_FUNCTION = 'call-function',
}

export type BaseThreadMessage = {
  action: ThreadMessageAction
}

export type ThreadCallbackMessage = BaseThreadMessage & {
  callbackId: CallbackId
  result: any
}

export type ThreadFunctionMessage = BaseThreadMessage & {
  functionId: CallbackId
  key: ThreadMethodKey
  args: any[]
}

export type ThreadErrorMessage = ThreadCallbackMessage & {
  message: string
  stack: string
}