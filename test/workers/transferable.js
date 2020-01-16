const { Transferable } = require('../../src')

const uint8Array = new Uint8Array([1, 2, 3, 4])
const uint16Array = new Uint16Array([1, 2, 3, 4])
const uint32Array = new Uint32Array([1, 2, 3, 4])

module.exports = {
  getArray: () => uint8Array,
  get16Array: () => uint16Array,
  get32Array: () => uint32Array,
  getArrayBuffer: () => uint8Array.buffer,
  getTransferredArrayBuffer: () => Transferable(uint8Array.buffer),
  getTransferredArray: () => Transferable(uint8Array),
  getTransferred16Array: () => Transferable(uint16Array),
  getTransferred32Array: () => Transferable(uint32Array),
  tryToUseArray: () => uint8Array.map(v => v + 1)
}
