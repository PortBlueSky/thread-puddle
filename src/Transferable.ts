import { MessagePort } from 'worker_threads'

export type Transferable = MessagePort | ArrayBuffer
export class TransferableValue {
  obj: any
  transferables: Transferable[]
  
  constructor(obj: any, transferables: Transferable[] | undefined) {
    this.obj = obj
    const transfers: any = transferables || obj
    this.transferables = [].concat(transfers).map((value: any) => {
      // TODO: Add Float64Array
      if (value instanceof Uint8Array || value instanceof Uint16Array || value instanceof Uint32Array) {
        return value.buffer
      }
      return value
    })
  }
}

export function Transferable (obj: any, transferables?: Transferable[]) {
  new TransferableValue(obj, transferables)
}

export function withTransfer (obj: any, transferables?: Transferable[]) {
  return new TransferableValue(obj, transferables)
}