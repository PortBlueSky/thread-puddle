// worker.js
module.exports = {
  fireAndForget: async (filePath, methodName, ...args) => {
    const fileModule = require(filePath) // or dynamic import()

    await fileModule[methodName](...args)

    // Remove from require cache so it can be cleaned up by GC
    const resolvedModulePath = require.resolve(filePath)
    delete require.cache[resolvedModulePath]
  }
}
