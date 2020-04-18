import { MessagePort } from 'worker_threads'

export class TransferableValue {
  obj:any
  transferables: Array<MessagePort | ArrayBuffer>
  
  constructor(obj, transferables) {
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

export function Transferable (obj, transferables) {
  new TransferableValue(obj, transferables)
}

export function withTransfer (obj, transferables) {
  return new TransferableValue(obj, transferables)
}