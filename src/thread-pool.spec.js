/* eslint-env jest */
const path = require('path')
const { createWorkerPool } = require('./index')

const workerPath = path.resolve(__dirname, '../test/assets/test-worker.js')

describe('Thread Pool', () => {
  let pool = null

  beforeEach(async () => {
    pool = await createWorkerPool({ size: 2, workerPath })
  })

  afterEach(() => {
    pool.terminate()
  })

  it('can expose methods from worker module', async () => {
    const value = await pool.fn('value')

    expect(value).toEqual('got value')
  })

  it('throws error if method is not available on worker', async () => {
    try {
      await pool.notWorkerMethod()
      expect(false).toBe(true)
    } catch (err) {
      expect(err).toHaveProperty('message', '"notWorkerMethod" is not a function on any worker')
    }
  })

  it('calls methods round robin on workers', async () => {
    const value1 = await pool.fnWorkerNum('value')
    const value2 = await pool.fnWorkerNum('value')
    const value3 = await pool.fnWorkerNum('value')
    const value4 = await pool.fnWorkerNum('value')

    expect([value1, value2, value3, value4]).toEqual([
      'got value 1',
      'got value 2',
      'got value 1',
      'got value 2'
    ])
  })

  it('forwards worker method errors with stack', async () => {
    try {
      await pool.fnError('worker triggered this error message')
      expect(false).toBe(true)
    } catch (err) {
      expect(err).toHaveProperty('message', 'worker triggered this error message')
    }
  })
})
