module.exports = {
  interface1: () => console.log('Inteface method one'),
  interface2: () => console.log('Inteface method two'),
  userMethod: (arg1, arg2) => {
    return new Promise((resolve) => {
      setTimeout(() => {
        console.log('Called user module method with', arg1, 'and', arg2)
        resolve()
      }, 100)
    })
  }
}
