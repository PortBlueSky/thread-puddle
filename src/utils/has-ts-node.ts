export default function hasTSNode() {
  try {
    require.resolve('ts-node')
    return true
  } catch (error: any) {
    if (error && error.code === 'MODULE_NOT_FOUND') {
      return false
    } else {
      throw error
    }
  }
}