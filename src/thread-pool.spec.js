/* eslint-env jest */
const path = require('path')
const { createWorkerPool } = require('./index')

const workerPath = path.resolve(__dirname, '../test/assets/test-worker.js')

describe('Thread Pool', () => {
  let pool = null

  beforeEach(() => {
    pool = createWorkerPool({ size: 2, workerPath })
  })

  afterEach(() => {
    pool.terminate()
  })

  it('can expose methods from worker module', async () => {
    const worker = await pool.getWorker()
    const value = await worker.fn('value')

    expect(value).toEqual('got value')
  })

  it.skip('calls methods round robin on workers', async () => {
    const worker = await pool.getWorker()
    const values = await Promise.all([
      worker.fnWorkerNum('value'),
      worker.fnWorkerNum('value'),
      worker.fnWorkerNum('value'),
      worker.fnWorkerNum('value')
    ])

    expect(values).toEqual([
      'got value 1',
      'got value 2',
      'got value 1',
      'got value 2'
    ])
  })

  it('forwards worker method errors with stack', async () => {
    const worker = await pool.getWorker()

    try {
      await worker.fnError('worker triggered this error message')
      expect(false).toBe(true)
    } catch (err) {
      expect(err).toHaveProperty('message', 'worker triggered this error message')
    }
  })
})
