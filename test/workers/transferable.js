const { withTransfer } = require('../../src')

const uint8Array = new Uint8Array([1, 2, 3, 4])
const uint16Array = new Uint16Array([1, 2, 3, 4])
const uint32Array = new Uint32Array([1, 2, 3, 4])

module.exports = {
  getArrayBuffer: () => uint8Array.buffer,
  getTransferredArrayBuffer: () => withTransfer(uint8Array.buffer, [uint8Array.buffer]),
  getArray: () => uint8Array,
  get16Array: () => uint16Array,
  get32Array: () => uint32Array,
  getTransferredArray: () => withTransfer(uint8Array, [uint8Array]),
  getTransferred16Array: () => withTransfer(uint16Array, [uint16Array]),
  getTransferred32Array: () => withTransfer(uint32Array, [uint32Array]),
  setArray: (arr) => {
    if (!(arr instanceof Uint8Array)) {
      throw new Error('Expected Uint8Array')
    }
    return 'ok'
  },
  set16Array: (arr) => {
    if (!(arr instanceof Uint16Array)) {
      throw new Error('Expected Uint16Array')
    }
    return 'ok'
  },
  set32Array: (arr) => {
    if (!(arr instanceof Uint32Array)) {
      throw new Error('Expected Uint32Array')
    }
    return 'ok'
  },
  setTransferredArray: (arr) => {
    if (!(arr instanceof Uint8Array)) {
      throw new Error('Expected Uint8Array')
    }
    return 'ok'
  },
  setTransferred16Array: (arr) => {
    if (!(arr instanceof Uint16Array)) {
      throw new Error('Expected Uint16Array')
    }
    return 'ok'
  },
  setTransferred32Array: (arr) => {
    if (!(arr instanceof Uint32Array)) {
      throw new Error('Expected Uint32Array')
    }
    return 'ok'
  },
  tryToUseArray: () => uint8Array.map(v => v + 1)
}
