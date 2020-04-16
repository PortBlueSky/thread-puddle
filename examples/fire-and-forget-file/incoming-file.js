module.exports = {
  method1: (arg1, arg2) => {
    return new Promise((resolve) => {
      setTimeout(() => {
        console.log('Called module method1 with', arg1, 'and', arg2)
        resolve()
      }, 100)
    })
  }
}
