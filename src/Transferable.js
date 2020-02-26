function Transferable (obj, transferables) {
  if (!(this instanceof Transferable)) {
    return new Transferable(obj, transferables)
  }

  this.obj = obj
  const transfers = transferables || obj
  this.transferables = [].concat(transfers).map((value) => {
    // TODO: Add Float64Array
    if (value instanceof Uint8Array || value instanceof Uint16Array || value instanceof Uint32Array) {
      return value.buffer
    }
    return value
  })
}

function withTransfer (obj, transferables = []) {
  return new Transferable(obj, transferables)
}

module.exports = {
  Transferable,
  withTransfer
}
