/* eslint-env jest */
const path = require('path')
const { createThreadPuddle } = require('./index')
const debug = require('debug')

debug.enabled('puddle')

const workerPath = path.resolve(__dirname, '../test/assets/test-worker.js')

describe('Thread Pool', () => {
  let pool = null

  beforeEach(async () => {
    pool = await createThreadPuddle({
      size: 2,
      workerPath,
      workerOptions: {
        workerData: {
          test: 'test worker data'
        }
      }
    })
  })

  afterEach(() => {
    pool.terminate()
  })

  it('can expose methods from worker module', async () => {
    const value = await pool.fn('value')

    expect(value).toEqual('got value')
  })

  it('can expose async methods from worker module', async () => {
    const value = await pool.asyncFn('value')

    expect(value).toEqual('got async value')
  })

  it('hands down workerData with workerOptions for pool', async () => {
    const data = await pool.getWorkerData()

    expect(data).toEqual(expect.objectContaining({
      test: 'test worker data'
    }))
  })

  it('throws error if method is not available on worker', async () => {
    try {
      await pool.notWorkerMethod()
      expect(false).toBe(true)
    } catch (err) {
      expect(err).toHaveProperty('message', '"notWorkerMethod" is not a function in this worker thread')
    }
  })

  it('calls methods round robin on workers', async () => {
    const value1 = await pool.fnWorkerNum('value')
    const value2 = await pool.fnWorkerNum('value')
    const value3 = await pool.fnWorkerNum('value')
    const value4 = await pool.fnWorkerNum('value')

    expect([value1, value2, value3, value4]).toEqual([
      'got value 9',
      'got value 10',
      'got value 9',
      'got value 10'
    ])
  })

  it('forwards worker method errors with worker stack trace', async () => {
    try {
      await pool.fnError('worker triggered this error message')
      expect(false).toBe(true)
    } catch (err) {
      expect(err).toHaveProperty('message', 'worker triggered this error message')
      expect(err).toHaveProperty('stack', expect.stringContaining('assets/test-worker.js'))
    }
  })
})
