/* eslint-env jest */
const path = require('path')
const { createPuddle, spawn } = require('./index')
const debug = require('debug')

debug.enabled('puddle')

const workerPath = path.resolve(__dirname, '../test/assets/test-worker.js')

describe('Thread puddle', () => {
  let worker = null

  beforeEach(async () => {
    worker = await createPuddle(workerPath, {
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

  it.todo('always only calls one method per worker')

  it('forwards worker method errors with worker stack trace', async () => {
    try {
      await worker.fnError('worker triggered this error message')
      expect(false).toBe(true)
    } catch (err) {
      expect(err).toHaveProperty('message', 'worker triggered this error message')
      expect(err).toHaveProperty('stack', expect.stringContaining('assets/test-worker.js'))
    }
  })

  it('forwards worker process errors within method', async () => {
    try {
      await worker.triggerProcessError()
      expect(false).toBe(true)
    } catch (err) {
      expect(err).toHaveProperty('message', 'Worker failure')
      expect(err).toHaveProperty('stack', expect.stringContaining('assets/test-worker.js'))
    }
  })

  it('handles uncaught exceptions in worker', async () => {
    await worker.triggerUncaughtException()
    await new Promise((resolve) => setTimeout(resolve, 500))

    expect(worker.puddle).toHaveProperty('size', 2)
  })

  it.todo('rejects waiting method calls when a worker crashes')
  it.todo('rejects open method calls when worker crashes')
  it.todo('terminates puddle when workers fail without any methods being called (startup phase)')
  it.todo('emits an exit event when a worker exits')
  it.todo('emits an error event when a worker errors')
  it.todo('rejects modules not exporting any function')
  it.todo('rejects modules not exporting an object')
  it.todo('throws before starting a worker which exposes reserved keys (like puddle)')
})

describe('Alias', () => {
  let worker = null

  beforeEach(async () => {
    worker = await spawn(workerPath, {
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

  it('has a spawn method to create a worker thread pool', async () => {
    const value = await worker.fn('value')

    expect(value).toEqual('got value')
  })
})
