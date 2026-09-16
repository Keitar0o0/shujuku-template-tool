import {
  SECTIONS, EXPORT_BOOLEAN_FIELDS, EXPORT_STRING_FIELDS,
  EXPORT_FIELDS, UPDATE_CONFIG_FIELDS, fail, isPlainObject,
} from './common.mjs'
import { validateTemplate } from './validation.mjs'

function stringArray(value, path, { nonEmpty = false } = {}) {
  if (!Array.isArray(value) || (nonEmpty && value.length === 0) || value.some((item) => typeof item !== 'string')) {
    fail(`${path} 必须是${nonEmpty ? '非空' : ''}字符串数组`)
  }
  return [...value]
}

function columns(value, path) {
  const result = stringArray(value, path, { nonEmpty: true })
  const seen = new Set()
  for (const column of result) {
    if (column.trim() === '') fail(`${path} 不能含空列名`)
    if (seen.has(column)) fail(`${path} 不能含重复列名 "${column}"`)
    if (/id/i.test(column)) fail(`${path} 的列名 "${column}" 含 ID/id`)
    seen.add(column)
  }
  return result
}

function mergePlacement(current, patch, path) {
  if (!isPlainObject(patch)) fail(`${path} 必须是对象`)
  for (const field of Object.keys(patch)) {
    if (!['position', 'depth', 'order'].includes(field)) fail(`${path} 不允许字段 "${field}"`)
  }
  if ('position' in patch && typeof patch.position !== 'string') fail(`${path}.position 必须是字符串`)
  for (const field of ['depth', 'order']) {
    if (field in patch && !Number.isFinite(patch[field])) fail(`${path}.${field} 必须是有限数字`)
  }
  return { ...(isPlainObject(current) ? current : {}), ...patch }
}

function mergeExportConfig(current, patch, path) {
  if (!isPlainObject(patch)) fail(`${path} 必须是对象`)
  if (!isPlainObject(current)) fail(`${path} 需要当前 exportConfig 为对象`)
  for (const [field, value] of Object.entries(patch)) {
    if (!EXPORT_FIELDS.has(field)) fail(`${path} 不允许字段 "${field}"`)
    if (EXPORT_BOOLEAN_FIELDS.includes(field)) {
      if (typeof value !== 'boolean') fail(`${path}.${field} 必须是布尔值`)
      current[field] = value
    } else if (EXPORT_STRING_FIELDS.includes(field)) {
      if (typeof value !== 'string') fail(`${path}.${field} 必须是字符串`)
      current[field] = value
    } else if (field === 'extraIndexColumns') {
      current[field] = stringArray(value, `${path}.${field}`)
    } else if (field === 'extraIndexColumnModes') {
      if (!isPlainObject(value) || Object.values(value).some((mode) => typeof mode !== 'string')) {
        fail(`${path}.${field} 必须是字符串值对象`)
      }
      current[field] = { ...value }
    } else {
      current[field] = mergePlacement(current[field], value, `${path}.${field}`)
    }
  }
  return current
}

function mergeUpdateConfig(current, patch, path) {
  if (!isPlainObject(patch)) fail(`${path} 必须是对象`)
  for (const [field, value] of Object.entries(patch)) {
    if (!UPDATE_CONFIG_FIELDS.includes(field)) fail(`${path} 不允许字段 "${field}"`)
    if (!Number.isFinite(value)) fail(`${path}.${field} 必须是有限数字`)
    current[field] = value
  }
  return current
}

// 按顺序进行字面替换，次数为非重叠命中总数，省略时为 1
function replaceAllIn(op, sec, current, pairs) {
  if (typeof current !== 'string') fail(`patch ${op}.sourceData.${sec} 做字符串替换，但当前值是 ${typeof current}`)
  let cur = current
  for (const p of pairs) {
    if (!Array.isArray(p) || (p.length !== 2 && p.length !== 3)) fail(`patch ${op}.sourceData.${sec} 的替换项必须是 [旧串, 新串, 次数?]`)
    const [from, to, count = 1] = p
    if (typeof from !== 'string' || typeof to !== 'string') fail(`patch ${op}.sourceData.${sec} 的替换项 [旧串, 新串] 必须是字符串`)
    if (from.length === 0) fail(`patch ${op}.sourceData.${sec} 的旧串必须是非空字符串`)
    if (!Number.isSafeInteger(count) || count < 1) fail(`patch ${op}.sourceData.${sec} 的次数必须是正整数`)
    const parts = cur.split(from)
    const actual = parts.length - 1
    if (actual !== count) fail(`patch ${op}.sourceData.${sec} ${actual === 0 ? '替换未命中' : '替换次数不符'}：预期 ${count} 次，实际 ${actual} 次，旧串 "${from}"`)
    cur = parts.join(to)
  }
  return cur
}

// 新表默认结构：exportConfig 为 disabled constant 模式（仅前端读表），updateConfig 全默认
function defaultUpdateConfig() {
  return { uiSentinel: -1, contextDepth: -1, updateFrequency: -1, batchSize: -1, skipFloors: -1, groupId: -1 }
}
function defaultExportConfig(name) {
  return {
    enabled: false,
    splitByRow: false,
    entryName: name,
    entryType: 'constant',
    keywords: '',
    preventRecursion: true,
    injectionTemplate: '',
    extraIndexEnabled: false,
    injectIntoWorldbook: false,
    extraIndexEntryName: `${name}-索引`,
    extraIndexColumns: [],
    extraIndexColumnModes: {},
    extraIndexInjectionTemplate: '',
    sqlInjectionTemplate: '',
    entryPlacement: { position: 'at_depth_as_system', depth: 2, order: 10000 },
    extraIndexPlacement: { position: 'at_depth_as_system', depth: 2, order: 10010 },
    fixedEntryPlacement: { position: 'before_character_definition', depth: 2, order: 99981 },
    fixedIndexPlacement: { position: 'before_character_definition', depth: 2, order: 99982 },
  }
}

// 新增表：必需 name + columns，可选 sourceData / orderNo / exportConfig / updateConfig
function createSheet(doc, op, val) {
  const allowed = ['name', 'columns', 'sourceData', 'orderNo', 'exportConfig', 'updateConfig']
  for (const f of Object.keys(val)) {
    if (!allowed.includes(f)) fail(`新增表 ${op} 不允许字段 "${f}"`)
  }
  if (typeof val.name !== 'string' || val.name.trim() === '') fail(`新增表 ${op} 必须提供 name`)
  const newColumns = columns(val.columns, `新增表 ${op}.columns`)
  if (val.orderNo !== undefined && (!Number.isInteger(val.orderNo) || val.orderNo < 0)) {
    fail(`新增表 ${op}.orderNo 必须是非负整数`)
  }
  if (val.sourceData !== undefined) {
    if (!isPlainObject(val.sourceData)) fail(`新增表 ${op} 的 sourceData 必须是对象`)
    for (const [sec, sv] of Object.entries(val.sourceData)) {
      if (!SECTIONS.includes(sec)) fail(`新增表 ${op} 的 sourceData 只允许 ${SECTIONS.join(', ')}，收到 "${sec}"`)
      if (typeof sv !== 'string') fail(`新增表 ${op} 的 sourceData.${sec} 必须是字符串（新增表不做替换语义）`)
    }
  }
  const sourceData = {}
  for (const sec of SECTIONS) {
    sourceData[sec] = val.sourceData?.[sec] ?? ''
  }
  const maxOrder = Object.values(doc).reduce(
    (m, s) => (s && typeof s === 'object' && typeof s.orderNo === 'number' ? Math.max(m, s.orderNo) : m),
    -1,
  )
  doc[op] = {
    uid: op,
    name: val.name,
    sourceData,
    content: [['row_id', ...newColumns]],
    updateConfig: val.updateConfig === undefined
      ? defaultUpdateConfig()
      : mergeUpdateConfig(defaultUpdateConfig(), val.updateConfig, `新增表 ${op}.updateConfig`),
    exportConfig: val.exportConfig === undefined
      ? defaultExportConfig(val.name)
      : mergeExportConfig(defaultExportConfig(val.name), val.exportConfig, `新增表 ${op}.exportConfig`),
    orderNo: val.orderNo ?? maxOrder + 1,
  }
  return `✓ 新增表 ${val.name} (${op})：${newColumns.length} 列，order=${doc[op].orderNo}`
}

function applyPatchInPlace(doc, patch) {
  if (!isPlainObject(patch)) {
    fail('patch 必须是一个对象')
  }
  const changes = []
  for (const [op, val] of Object.entries(patch)) {
    if (op === 'mate') {
      fail('结构字段 mate 只读，不允许 patch')
    }
    if (!op.startsWith('sheet_')) {
      fail(`未知 patch 键 "${op}"（只能以 sheet_ 开头）`)
    }
    const sheet = doc[op]
    if (val === null) {
      if (!isPlainObject(sheet)) fail(`删除表 ${op} 失败：目标不存在`)
      const name = sheet.name ?? op
      delete doc[op]
      changes.push(`✓ 删除表 ${name} (${op})`)
      continue
    }
    if (!isPlainObject(val)) {
      fail(`patch ${op} 的值必须是对象或 null`)
    }
    if (!isPlainObject(sheet)) {
      changes.push(createSheet(doc, op, val))
      continue
    }
    const fields = []
    const oldName = sheet.name
    const renameDefaultEntry = sheet.exportConfig?.entryName === oldName
    const renameDefaultIndex = sheet.exportConfig?.extraIndexEntryName === `${oldName}-索引`
    for (const [field, fv] of Object.entries(val)) {
      if (field === 'name') {
        if (typeof fv !== 'string' || fv.trim() === '') fail(`patch ${op}.name 必须是非空字符串`)
        sheet.name = fv
        fields.push('name')
        continue
      }
      if (field === 'columns') {
        const nextColumns = columns(fv, `patch ${op}.columns`)
        if (!Array.isArray(sheet.content) || !Array.isArray(sheet.content[0])) {
          fail(`patch ${op}.columns 需要 content 表头存在`)
        }
        const oldWidth = sheet.content[0].length
        const nextWidth = nextColumns.length + 1
        if (sheet.content.length > 1 && oldWidth !== nextWidth) {
          fail(`patch ${op}.columns 改变列数前必须先迁移或清空现有数据行`)
        }
        sheet.content[0] = ['row_id', ...nextColumns]
        fields.push(`columns(${nextColumns.length} 列)`)
        continue
      }
      if (field === 'sourceData') {
        if (!isPlainObject(fv)) fail(`patch ${op}.sourceData 必须是对象`)
        if (!isPlainObject(sheet.sourceData)) fail(`patch ${op}.sourceData 需要当前 sourceData 为对象`)
        for (const [sec, sv] of Object.entries(fv)) {
          if (!SECTIONS.includes(sec)) fail(`patch ${op}.sourceData 只允许 ${SECTIONS.join(', ')}，收到 "${sec}"`)
          if (Array.isArray(sv)) {
            sheet.sourceData[sec] = replaceAllIn(op, sec, sheet.sourceData[sec], sv)
            fields.push(`${sec}(${sv.length} 条替换)`)
          } else if (typeof sv === 'string') {
            sheet.sourceData[sec] = sv
            fields.push(`${sec}(整体替换)`)
          } else {
            fail(`patch ${op}.sourceData.${sec} 必须是字符串或替换项数组`)
          }
        }
        continue
      }
      if (field === 'hiddenPhysicalColumns') {
        const nextColumns = stringArray(fv, `patch ${op}.hiddenPhysicalColumns`)
        if (nextColumns.length === 0) {
          delete sheet.hiddenPhysicalColumns
          fields.push('hiddenPhysicalColumns(删除)')
        } else {
          sheet.hiddenPhysicalColumns = nextColumns
          fields.push(`hiddenPhysicalColumns(${nextColumns.length})`)
        }
        continue
      }
      if (field === 'columnAliases') {
        if (!isPlainObject(fv) || Object.values(fv).some(
          (aliases) => !Array.isArray(aliases) || aliases.some((alias) => typeof alias !== 'string'),
        )) {
          fail(`patch ${op}.columnAliases 必须是字符串数组对象`)
        }
        if (Object.keys(fv).length === 0) {
          delete sheet.columnAliases
          fields.push('columnAliases(删除)')
        } else {
          sheet.columnAliases = structuredClone(fv)
          fields.push(`columnAliases(${Object.keys(fv).length})`)
        }
        continue
      }
      if (field === 'exportConfig') {
        mergeExportConfig(sheet.exportConfig, fv, `patch ${op}.exportConfig`)
        fields.push(`exportConfig(${Object.keys(fv).length} 项)`)
        continue
      }
      if (field === 'orderNo') {
        if (!Number.isInteger(fv) || fv < 0) fail(`patch ${op}.orderNo 必须是非负整数`)
        sheet.orderNo = fv
        fields.push(`orderNo(${fv})`)
        continue
      }
      fail(`patch ${op} 只允许 name / sourceData / columns / hiddenPhysicalColumns / columnAliases / exportConfig / orderNo，收到 "${field}"`)
    }
    if (sheet.name !== oldName && isPlainObject(sheet.exportConfig)) {
      if (renameDefaultEntry && !Object.hasOwn(val.exportConfig ?? {}, 'entryName')) {
        sheet.exportConfig.entryName = sheet.name
      }
      if (renameDefaultIndex && !Object.hasOwn(val.exportConfig ?? {}, 'extraIndexEntryName')) {
        sheet.exportConfig.extraIndexEntryName = `${sheet.name}-索引`
      }
    }
    changes.push(`✓ ${sheet.name} (${op})：${fields.join('、')}`)
  }
  if (Object.keys(doc).every((key) => key === 'mate')) fail('patch 后不能删除全部表')
  return changes
}

// 在副本上完成 patch 与校验，全部成功后才更新调用方对象
export function applyPatch(doc, patch) {
  if (!isPlainObject(doc)) fail('模板必须是一个对象')
  const next = structuredClone(doc)
  const changes = applyPatchInPlace(next, patch)
  const errs = validateTemplate(next)
  if (errs.length > 0) {
    fail(`patch 后模板校验失败，已中止（未写盘）：\n  - ${errs.join('\n  - ')}`, errs)
  }
  for (const key of Object.keys(doc)) delete doc[key]
  Object.assign(doc, next)
  return changes
}
