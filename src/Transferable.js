function Transferable (arg) {
  if (!(this instanceof Transferable)) {
    return new Transferable(arg)
  }

  this.bytesPerElement = 0
  this.value = arg
  this.transferList = [].concat(arg).map((obj) => {
    if (obj instanceof Uint8Array || obj instanceof Uint16Array || obj instanceof Uint32Array) {
      this.bytesPerElement = obj.BYTES_PER_ELEMENT
      return obj.buffer
    }
    return obj
  })
}

module.exports = {
  Transferable
}
