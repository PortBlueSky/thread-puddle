/* eslint-env jest */
const path = require('path')
const { createPuddle, spawn } = require('./index')
const debug = require('debug')

debug.enabled('puddle')

const basicWorkerPath = path.resolve(__dirname, '../test/workers/basic.js')
const transferableWorkerPath = path.resolve(__dirname, '../test/workers/transferable.js')

describe('Basic Features', () => {
  let worker = null

  beforeEach(async () => {
    worker = await createPuddle(basicWorkerPath, {
      size: 2,
      workerOptions: {
        workerData: {
          test: 'test worker data'
        }
      }
    })
  })

  afterEach(() => {
    worker.puddle.terminate()
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

    expect([value1, value2, value3, value4]).toEqual([
      'got value 9',
      'got value 10',
      'got value 9',
      'got value 10'
    ])
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

  it.todo('emits an exit event when a worker exits')
  it.todo('allows to manually respawn workers after error')
  it.todo('allows to manually respawn workers after exit')
  it.todo('calling respawn only spawns a worker once again, ignores all other calls')
  it.todo('emits an error event when a worker errors')
  it.todo('terminates puddle when workers fail without any methods being called (startup phase)')
  it.todo('rejects modules not exporting any function')
  it.todo('rejects modules not exporting an object')
  it.todo('throws before starting a worker which exposes reserved keys (like puddle)')
})

describe('Error Handling', () => {
  let worker = null

  beforeEach(async () => {
    worker = await createPuddle(basicWorkerPath, {
      size: 2
    })
  })

  afterEach(() => {
    worker.puddle.terminate()
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

  it('respawns worker afer uncaught exceptions', async () => {
    await worker.triggerUncaughtException()
    await new Promise((resolve) => setTimeout(resolve, 500))

    expect(worker.puddle).toHaveProperty('size', 2)
  })

  it('rejects open method calls when a worker crashes', async () => {
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

  it('rejects waiting method calls when all workers exited', async () => {
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
})

describe('Alias', () => {
  let worker = null

  beforeEach(async () => {
    worker = await spawn(basicWorkerPath, {
      size: 2
    })
  })

  afterEach(() => {
    worker.puddle.terminate()
  })

  it('has a spawn method to create a worker thread pool', async () => {
    const value = await worker.fn('value')

    expect(value).toEqual('got value')
  })
})

describe('Transferable', () => {
  let worker = null

  beforeEach(async () => {
    worker = await spawn(transferableWorkerPath)
  })

  afterEach(() => {
    worker.puddle.terminate()
  })

  it('can transfer a return value from a worker', async () => {
    const arr1 = await worker.getArray()
    const arr2 = await worker.tryToUseArray()
    const arr3 = await worker.getTransferredArray()
    const err = await worker.tryToUseArray().catch(err => err)

    expect(arr1).toEqual(new Uint8Array([1, 2, 3, 4]))
    expect(arr2).toEqual(new Uint8Array([2, 3, 4, 5]))
    expect(arr3).toEqual(new Uint8Array([1, 2, 3, 4]))
    expect(err).toHaveProperty('message', 'Cannot perform %TypedArray%.prototype.map on a neutered ArrayBuffer')
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

  it.todo('allows to specifiy transferables per method (main to worker)')
  // -> worker.method(transferableValue, Transferable([transferableValue]))
  //    transferables returns an instance of Transferable which can be checked by pool per method call
})
