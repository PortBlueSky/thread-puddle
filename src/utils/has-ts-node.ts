export default function hasTSNode(resolveFn: Function) {
  try {
    resolveFn('ts-node')
    return true
  } catch (error: any) {
    if (error && error.code === 'MODULE_NOT_FOUND') {
      return false
    } else {
      throw error
    }
  }
}
