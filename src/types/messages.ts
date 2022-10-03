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
  FREE_FUNCTION = 'free-function',
}

export type BaseThreadMessage = {
  action: ThreadMessageAction
}

export type ThreadReadyMessage = BaseThreadMessage

export type ThreadCallbackMessage = BaseThreadMessage & {
  callbackId: CallbackId
  result: any
}

export type ThreadFunctionMessage = BaseThreadMessage & {
  functionId: CallbackId
  key: ThreadMethodKey
  args: any[]
}

export type ThreadFreeFunctionMessage = BaseThreadMessage & {
  functionId: CallbackId
  key: ThreadMethodKey
}

export type ThreadErrorMessage = BaseThreadMessage & {
  callbackId: CallbackId
  message: string
  stack: string
}

export function isThreadCallbackMessage(msg: BaseThreadMessage): msg is ThreadCallbackMessage {
  return msg.action === ThreadMessageAction.RESOLVE
}

export function isThreadErrorMessage(msg: BaseThreadMessage): msg is ThreadErrorMessage {
  return msg.action === ThreadMessageAction.REJECT
}

export function isThreadFunctionMessage(msg: BaseThreadMessage): msg is ThreadFunctionMessage {
  return msg.action === ThreadMessageAction.CALL_FUNCTION
}

export function isThreadFreeFunctionMessage(msg: BaseThreadMessage): msg is ThreadFreeFunctionMessage {
  return msg.action === ThreadMessageAction.FREE_FUNCTION
}

export function isThreadReadyMessage(msg: BaseThreadMessage): msg is ThreadReadyMessage {
  return msg.action === ThreadMessageAction.READY
}

export function isThreadStartupErrorMessage(msg: BaseThreadMessage): msg is ThreadErrorMessage {
  return msg.action === ThreadMessageAction.STARTUP_ERROR
}
