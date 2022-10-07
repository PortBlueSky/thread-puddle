import { MessagePort } from 'worker_threads'
import { isDetached } from './utils/is-detached'

export type Transferable = MessagePort | ArrayBuffer
export class TransferableValue {
  obj: any
  transferables: Transferable[]
  
  constructor(obj: any, transferables: Transferable[] | undefined) {
    this.obj = obj
    const transfers: any = transferables || obj
    this.transferables = [].concat(transfers).map((value: any) => {
      if (value instanceof Uint8Array || value instanceof Uint16Array || value instanceof Uint32Array) {
        value = value.buffer
      }
      if (value instanceof ArrayBuffer && isDetached(value)) {
        throw new TypeError('The ArrayBuffer for transfer is already detached')
      }
      return value
    })
  }
}

export function Transferable (obj: any, transferables?: Transferable[]) {
  return new TransferableValue(obj, transferables)
}

export function withTransfer (obj: any, transferables?: Transferable[]) {
  return new TransferableValue(obj, transferables)
}