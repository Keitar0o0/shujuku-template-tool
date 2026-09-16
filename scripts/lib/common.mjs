export const SHEET_KEYS = ['note', 'initNode', 'insertNode', 'updateNode', 'deleteNode', 'ddl']
export const SECTION_LABELS = {
  note: '表说明 note',
  initNode: '初始化 initNode',
  insertNode: '新增 insertNode',
  updateNode: '更新 updateNode',
  deleteNode: '删除 deleteNode',
  ddl: '建表 DDL',
}
export const SECTIONS = Object.keys(SECTION_LABELS)
export const EXPORT_BOOLEAN_FIELDS = [
  'enabled',
  'splitByRow',
  'preventRecursion',
  'extraIndexEnabled',
  'injectIntoWorldbook',
]
export const EXPORT_STRING_FIELDS = [
  'entryName',
  'entryType',
  'keywords',
  'injectionTemplate',
  'extraIndexEntryName',
  'extraIndexInjectionTemplate',
  'sqlInjectionTemplate',
]
export const EXPORT_PLACEMENT_FIELDS = [
  'entryPlacement',
  'extraIndexPlacement',
  'fixedEntryPlacement',
  'fixedIndexPlacement',
]
export const EXPORT_FIELDS = new Set([
  ...EXPORT_BOOLEAN_FIELDS,
  ...EXPORT_STRING_FIELDS,
  'extraIndexColumns',
  'extraIndexColumnModes',
  ...EXPORT_PLACEMENT_FIELDS,
])
export const UPDATE_CONFIG_FIELDS = ['uiSentinel', 'contextDepth', 'updateFrequency', 'batchSize', 'skipFloors', 'groupId']

// ---------- 通用 ----------
// 抛异常而非 process.exit：测试（assert.throws）可捕获，CLI 入口统一 catch 打印
class CliError extends Error {
  constructor(message, errors = [message]) {
    super(message)
    this.errors = errors
  }
}
export function fail(msg, errors) {
  throw new CliError(msg, errors)
}
export function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}
