const { createThreadPool } = require('../../src')

// worker.js
module.exports = {
  fireAndForget: async (filePath, methodName, ...args) => {
    const userModule = await createThreadPool(filePath)

    await userModule.interface1()
    await userModule.userMethod(...args)
    await userModule.interface2()

    userModule.pool.terminate()
  }
}
