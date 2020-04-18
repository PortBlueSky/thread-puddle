/* eslint-env jest */
import path from 'path'
import { createThreadPool, withTransfer, BaseWorkerType } from './index'
const debug = require('debug')
const majorVersion = require('./major-node-version')

debug.enabled('puddle')

const basicWorkerPath = path.resolve(__dirname, '../test/workers/basic.js')
const transferableWorkerPath = path.resolve(__dirname, '../test/workers/transferable.js')
const startupFailWorkerPath = path.resolve(__dirname, '../test/workers/startup-fail.js')
const noMethodWorkerPath = path.resolve(__dirname, '../test/workers/no-method.js')
const noObjectWorkerPath = path.resolve(__dirname, '../test/workers/no-object.js')

const countBy = (list) => list.reduce((acc, key) => {
  if (acc[key]) {
    acc[key] += 1
    return acc
  }
  acc[key] = 1
  return acc
}, {})

describe('Basic Features', () => {
  let worker

  beforeEach(async () => {
    worker = await createThreadPool(basicWorkerPath, {
      size: 2,
      workerOptions: {
        workerData: {
          test: 'test worker data'
        }
      }
    })
  })

  afterEach(() => {
    worker.pool.terminate()
    expect(worker.pool.isTerminated).toEqual(true)
  })

  it('can expose methods from worker module', async () => {
    const value = await worker.fn('value')

    expect(value).toEqual('got value')
  })

  it('can expose async methods from worker module', async () => {
    const value = await worker.asyncFn('value')

    expect(value).toEqual('got async value')
  })

  it('hands down workerData with workerOptions for worker', async () => {
    const data = await worker.getWorkerData()

    expect(data).toEqual(expect.objectContaining({
      test: 'test worker data'
    }))
  })

  it('throws error if method is not available on worker', async () => {
    try {
      await worker.notWorkerMethod()
      expect(false).toBe(true)
    } catch (err) {
      expect(err).toHaveProperty('message', '"notWorkerMethod" is not a function in this worker thread')
    }
  })

  it('calls methods round robin on workers', async () => {
    const value1 = await worker.fnWorkerNum('value')
    const value2 = await worker.fnWorkerNum('value')
    const value3 = await worker.fnWorkerNum('value')
    const value4 = await worker.fnWorkerNum('value')

    const counts = countBy([value1, value2, value3, value4])
    expect(counts).toEqual({
      'got value 9': 2,
      'got value 10': 2
    })
  })

  it('always only calls one method per worker', async () => {
    await Promise.all([
      worker.throwIfCalledAtTheSameTime(10),
      worker.throwIfCalledAtTheSameTime(10),
      worker.throwIfCalledAtTheSameTime(10),
      worker.throwIfCalledAtTheSameTime(10),
      worker.throwIfCalledAtTheSameTime(10),
      worker.throwIfCalledAtTheSameTime(10)
    ])
  })

  it('can call a method on all workers', async () => {
    const [value1, value2] = await worker.all.fnWorkerNum('value')

    expect([value1, value2]).toEqual([
      'got value 13',
      'got value 14'
    ])
  })

  it('waits for other calls to be resolved before calling on all', async () => {
    const results = await Promise.all([
      worker.asyncFn('one', 25),
      worker.asyncFn('two', 25),
      worker.all.fnWorkerNum('value')
    ])

    expect(results).toEqual([
      'got async one',
      'got async two',
      [
        'got value 15',
        'got value 16'
      ]
    ])
  })

  it('exposes the pool size as readonly', () => {
    expect(worker.pool.size).toEqual(2)
    expect(() => {
      worker.pool.size = 4
    }).toThrowError('Cannot set property size of [object Object] which has only a getter')
    // TODO: Why [object Object]?
    expect(worker.pool.size).toEqual(2)
  })

  it('emits an exit event when a worker exits', async () => {
    const fn = jest.fn()
    worker.pool.on('exit', fn)
    await worker.triggerExit()
    await new Promise((resolve) => setTimeout(resolve, 500))

    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn.mock.calls[0][0]).toEqual(0)
    expect(fn.mock.calls[0][1]).toEqual(expect.any(Number))
  })

  it('terminates the pool if all workers exited and did not error', async () => {
    await worker.triggerExit()
    await worker.triggerExit()
    await new Promise((resolve) => setTimeout(resolve, 500))

    expect(worker.pool).toHaveProperty('isTerminated', true)
  })

  it.todo('allows to call methods on the parent thread')
  it.todo('can call a method on a specific worker directly')
})

if (majorVersion >= 13) {
  describe('ES6 Modules', () => {
    let worker

    afterEach(() => {
      worker.pool.terminate()
    })

    it('can expose methods from worker module', async () => {
      worker = await createThreadPool(path.resolve(__dirname, '../test/workers/es6-module.mjs'), {
        size: 2
      })

      const value = await worker.fn('value')

      expect(value).toEqual('got value')
    })

    it('treats only default export as worker module', async () => {
      worker = await createThreadPool(path.resolve(__dirname, '../test/workers/es6-default.mjs'), {
        size: 2
      })

      const value = await worker.fn2('value')

      expect(value).toEqual('default value')
    })
  })
}

describe('Nested Threads', () => {
  let worker

  beforeEach(async () => {
    worker = await createThreadPool(path.resolve(__dirname, '../test/workers/nest.js'))
    await worker.setup()
  })

  afterEach(() => {
    worker.pool.terminate()
  })

  it('allows to nest worker threads', async () => {
    const result = await worker.callNested('value')

    expect(result).toEqual('nested value')
  })
})

describe('Error Handling', () => {
  let worker

  beforeEach(async () => {
    worker = await createThreadPool(basicWorkerPath, {
      size: 2
    })
  })

  afterEach(() => {
    worker.pool.terminate()
  })

  it('forwards worker method errors with worker stack trace', async () => {
    try {
      await worker.fnError('worker triggered this error message')
      expect(false).toBe(true)
    } catch (err) {
      expect(err).toHaveProperty('message', 'worker triggered this error message')
      expect(err).toHaveProperty('stack', expect.stringContaining('workers/basic.js'))
    }
  })

  it('forwards worker process errors within method', async () => {
    try {
      await worker.triggerProcessError()
      expect(false).toBe(true)
    } catch (err) {
      expect(err).toHaveProperty('message', 'Worker failure')
      expect(err).toHaveProperty('stack', expect.stringContaining('workers/basic.js'))
    }
  })

  it.skip('respawns worker afer uncaught exceptions', async () => {
    await worker.triggerUncaughtException()
    await new Promise((resolve) => setTimeout(resolve, 500))

    expect(worker.pool).toHaveProperty('size', 2)
  })

  it.skip('rejects open method calls when a worker crashes', async () => {
    const result = await Promise.all([
      worker.waitForUncaughtException(10).catch(err => err),
      worker.waitForUncaughtException(10).catch(err => err),
      worker.waitForUncaughtException(10).catch(err => err),
      worker.waitForUncaughtException(10).catch(err => err)
    ])
    result.map(err => expect(err).toHaveProperty('message', 'Worker failure'))
  })

  it('rejects open method calls when worker exits', async () => {
    const result = await Promise.all([
      worker.exitWorker(10).catch(err => err),
      worker.exitWorker(10).catch(err => err)
    ])
    result.map(err => expect(err).toHaveProperty('message', 'Worker thread exited before resolving'))
  })

  it.skip('rejects waiting method calls when all workers exited', async () => {
    const [one, two, three, four] = await Promise.all([
      worker.exitWorker(10).catch(err => err),
      worker.exitWorker(10).catch(err => err),
      worker.exitWorker(10).catch(err => err),
      worker.exitWorker(10).catch(err => err)
    ])

    expect(one).toHaveProperty('message', 'Worker thread exited before resolving')
    expect(two).toHaveProperty('message', 'Worker thread exited before resolving')
    expect(three).toHaveProperty('message', 'All workers exited before resolving')
    expect(four).toHaveProperty('message', 'All workers exited before resolving')
  })

  it.skip('emits an error event when a worker errors', async () => {
    const fn = jest.fn()
    worker.pool.on('error', fn)

    await worker.triggerUncaughtException()
    await new Promise((resolve) => setTimeout(resolve, 500))

    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn.mock.calls[0][0]).toHaveProperty('message', 'Worker failure')
    expect(fn.mock.calls[0][0]).toHaveProperty('stack', expect.stringContaining('workers/basic.js'))
  })

  it.todo('[Proposal] allows to manually respawn workers after error')
  it.todo('[Proposal] allows to manually respawn workers after exit')
  it.todo('[Proposal] calling respawn only spawns a worker once again, ignores all other calls')
})

describe('Startup', () => {
  it('terminates puddle when workers fail in startup phase', async () => {
    const startupError = await createThreadPool(startupFailWorkerPath, {
      size: 2
    }).catch(err => err)

    expect(startupError).toHaveProperty('message', 'Failing before even exporting any method')
  })

  it('rejects modules not exporting any function', async () => {
    const startupError = await createThreadPool(noMethodWorkerPath, {
      size: 2
    }).catch(err => err)

    expect(startupError).toHaveProperty('message', 'Worker should export at least one method')
  })

  it('rejects modules not exporting an object', async () => {
    const startupError = await createThreadPool(noObjectWorkerPath, {
      size: 2
    }).catch(err => err)

    expect(startupError).toHaveProperty('message', 'Worker should export an object, got null')
  })
})

describe('Termination', () => {
  let worker

  afterEach(() => {
    worker.pool.terminate()
  })

  it('terminates all workers', async () => {
    worker = await createThreadPool(basicWorkerPath, {
      size: 2
    })

    const value = worker.asyncFn('value', 100)

    worker.pool.terminate()

    const err = await value.catch(err => err)

    expect(worker.pool).toHaveProperty('isTerminated', true)
    expect(err).toHaveProperty('message', 'Worker thread exited before resolving')
  })

  it('cannot call another method after termination', async () => {
    worker = await createThreadPool(basicWorkerPath, {
      size: 2
    })

    worker.pool.terminate()

    const err = await worker.asyncFn('value', 100).catch(err => err)

    expect(err).toHaveProperty('message', 'Worker pool already terminated.')
  })
})

describe('Single Method Modules', () => {
  let worker

  beforeEach(async () => {
    worker = await createThreadPool(basicWorkerPath, {
      size: 2
    })
  })

  afterEach(() => {
    worker.pool.terminate()
  })

  it.todo('can call an exported method')
  it.todo('can call a default exported method (es6 modules)')
})

describe('Alias', () => {
  let worker

  beforeEach(async () => {
    worker = await createThreadPool(basicWorkerPath, {
      size: 2
    })
  })

  afterEach(() => {
    worker.pool.terminate()
  })

  it('has a createThreadPool method to create a worker thread pool', async () => {
    const value = await worker.fn('value')

    expect(value).toEqual('got value')
  })
})

describe('Transferable', () => {
  let worker

  beforeEach(async () => {
    worker = await createThreadPool(transferableWorkerPath)
  })

  afterEach(() => {
    worker.pool.terminate()
  })

  it('can transfer a return value from a worker', async () => {
    const arr1 = await worker.getArray()
    const arr2 = await worker.tryToUseArray()
    const arr3 = await worker.getTransferredArray()
    const err = await worker.tryToUseArray().catch(err => err)

    expect(arr1).toEqual(new Uint8Array([1, 2, 3, 4]))
    expect(arr2).toEqual(new Uint8Array([2, 3, 4, 5]))
    expect(arr3).toEqual(new Uint8Array([1, 2, 3, 4]))

    if (majorVersion < 13) {
      expect(err).toHaveProperty('message', 'Cannot perform %TypedArray%.prototype.map on a neutered ArrayBuffer')
    } else {
      expect(err).toHaveProperty('message', 'Cannot perform %TypedArray%.prototype.map on a detached ArrayBuffer')
    }
  })

  it('wraps transferred UintArrays into instance', async () => {
    const arr1 = await worker.getArray()
    const arr2 = await worker.get16Array()
    const arr3 = await worker.get32Array()
    const arr4 = await worker.getTransferredArray()
    const arr5 = await worker.getTransferred16Array()
    const arr6 = await worker.getTransferred32Array()

    expect(arr1).toEqual(new Uint8Array([1, 2, 3, 4]))
    expect(arr2).toEqual(new Uint16Array([1, 2, 3, 4]))
    expect(arr3).toEqual(new Uint32Array([1, 2, 3, 4]))
    expect(arr4).toEqual(new Uint8Array([1, 2, 3, 4]))
    expect(arr5).toEqual(new Uint16Array([1, 2, 3, 4]))
    expect(arr6).toEqual(new Uint32Array([1, 2, 3, 4]))
  })

  it('does not wrap ArrayBuffers transferred directly', async () => {
    const arrBuffer1 = await worker.getArrayBuffer()
    const arrBuffer2 = await worker.getTransferredArrayBuffer()

    expect(arrBuffer1).toBeInstanceOf(ArrayBuffer)
    expect(arrBuffer2).toBeInstanceOf(ArrayBuffer)
  })

  it('allows to specifiy transferables per method (main to worker)', async () => {
    const uint8Array = new Uint8Array([1, 2, 3, 4])
    const uint16Array = new Uint16Array([1, 2, 3, 4])
    const uint32Array = new Uint32Array([1, 2, 3, 4])

    const results = await Promise.all([
      worker.setArray(uint8Array),
      worker.set16Array(uint16Array),
      worker.set32Array(uint32Array),
      worker.setTransferredArray(withTransfer(uint8Array, [uint8Array])),
      worker.setTransferred16Array(withTransfer(uint16Array, [uint16Array])),
      worker.setTransferred32Array(withTransfer(uint32Array, [uint32Array]))
    ])

    results.map(result => expect(result).toEqual('ok'))

    try {
      uint32Array.map(i => i + 1)
      expect(true).toBe(false)
    } catch (err) {
      if (majorVersion < 13) {
        expect(err).toHaveProperty('message', 'Cannot perform %TypedArray%.prototype.map on a neutered ArrayBuffer')
      } else {
        expect(err).toHaveProperty('message', 'Cannot perform %TypedArray%.prototype.map on a detached ArrayBuffer')
      }
    }
  })

  it('can transfer a buffer to worker, manipulate it and transfer it back', async () => {
    const uint8Array = new Uint8Array([1, 2, 3, 4])
    const result = await worker.manipulateAndTransfer(withTransfer(uint8Array, [uint8Array]))

    expect(result).toEqual(new Uint8Array([2, 3, 4, 5]))
  })

  it('if no transferables are given, first argument is considered to be transferred', async () => {
    const uint8Array = new Uint8Array([1, 2, 3, 4])
    const result = await worker.manipulateAndTransfer(withTransfer(uint8Array))

    expect(result).toEqual(new Uint8Array([2, 3, 4, 5]))
  })

  it('can transfer nested values', async () => {
    const uint8Array = new Uint8Array([1, 2, 3, 4])
    const result = await worker.transferNested(withTransfer({
      value: uint8Array
    }, [uint8Array]))

    expect(result).toEqual({ value: new Uint8Array([2, 3, 4, 5]) })
  })
})
