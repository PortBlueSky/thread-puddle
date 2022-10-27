import hasTsNode from './has-ts-node'

describe('has-ts-node', () => {
  it('returns true when ts-node is installed', async () => {
    // should have ts-node in tests
    const has = hasTsNode(require.resolve)
    expect(has).toEqual(true)
  })

  it('returns false when ts-node is not installed', () => {
    const resolve = () => {
      const err = {
        code: 'MODULE_NOT_FOUND'
      }
      throw err
    }
    
    const has = hasTsNode(resolve)
    expect(has).toEqual(false)
  })

  it('rethrows the error if anything else', () => {
    const resolve = () => {
      const err = {
        code: 'whatever'
      }
      throw err
    }
    
    expect(() => hasTsNode(resolve)).toThrow()
  })
})