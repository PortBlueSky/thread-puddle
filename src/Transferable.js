function Transferable (obj, transferables) {
  if (!(this instanceof Transferable)) {
    return new Transferable(obj, transferables)
  }

  this.obj = obj
  this.transferables = [].concat(transferables).map((value) => {
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
