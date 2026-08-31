#!/usr/bin/env node
import {
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { randomUUID } from 'node:crypto'
import { basename, dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

// ---------- 常量 ----------
const SHEET_KEYS = ['note', 'initNode', 'insertNode', 'updateNode', 'deleteNode', 'ddl']
const SECTION_LABELS = {
  note: '表说明 note',
  initNode: '初始化 initNode',
  insertNode: '新增 insertNode',
  updateNode: '更新 updateNode',
  deleteNode: '删除 deleteNode',
  ddl: '建表 DDL',
}
const SECTIONS = Object.keys(SECTION_LABELS)
const EXPORT_BOOLEAN_FIELDS = [
  'enabled',
  'splitByRow',
  'preventRecursion',
  'extraIndexEnabled',
  'injectIntoWorldbook',
]
const EXPORT_STRING_FIELDS = [
  'entryName',
  'entryType',
  'keywords',
  'injectionTemplate',
  'extraIndexEntryName',
  'extraIndexInjectionTemplate',
  'sqlInjectionTemplate',
]
const EXPORT_PLACEMENT_FIELDS = [
  'entryPlacement',
  'extraIndexPlacement',
  'fixedEntryPlacement',
  'fixedIndexPlacement',
]
const EXPORT_FIELDS = new Set([
  ...EXPORT_BOOLEAN_FIELDS,
  ...EXPORT_STRING_FIELDS,
  'extraIndexColumns',
  'extraIndexColumnModes',
  ...EXPORT_PLACEMENT_FIELDS,
])
const UPDATE_CONFIG_FIELDS = ['uiSentinel', 'contextDepth', 'updateFrequency', 'batchSize', 'skipFloors', 'groupId']

// ---------- 通用 ----------
// 抛异常而非 process.exit：测试（assert.throws）可捕获，CLI 入口统一 catch 打印
class CliError extends Error {}
function fail(msg) {
  throw new CliError(msg)
}
function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}
export function readJson(file) {
  if (file === '-') {
    let raw
    try { raw = readFileSync(0, 'utf8') } catch (e) { fail(`无法读取标准输入: ${e.message}`) }
    try { return JSON.parse(raw) } catch (e) { fail(`标准输入 JSON 解析失败: ${e.message}`) }
  }
  const abs = resolve(file)
  if (!existsSync(abs)) fail(`文件不存在: ${abs}`)
  let raw
  try { raw = readFileSync(abs, 'utf8') } catch (e) { fail(`无法读取文件: ${e.message}`) }
  try { return JSON.parse(raw) } catch (e) { fail(`JSON 解析失败: ${e.message}`) }
}
export function writeJson(file, obj) {
  const abs = resolve(file)
  const temp = join(dirname(abs), `.${basename(abs)}.${process.pid}.${randomUUID()}.tmp`)
  const raw = JSON.stringify(obj, null, 2) + '\n'
  let fd
  let created = false
  try {
    fd = openSync(temp, 'wx')
    created = true
    writeFileSync(fd, raw, 'utf8')
    fsyncSync(fd)
    closeSync(fd)
    fd = undefined
    renameSync(temp, abs)
    created = false
  } catch (e) {
    if (fd !== undefined) {
      try { closeSync(fd) } catch {}
    }
    let cleanup = ''
    if (created) {
      try { unlinkSync(temp) } catch (cleanupError) {
        cleanup = `；临时文件清理失败: ${temp}（${cleanupError.message}）`
      }
    }
    fail(`无法原子写入文件 ${abs}: ${e.message}${cleanup}`)
  }
}

// ---------- 模板解析 ----------
export function parseTemplate(obj) {
  const sheets = []
  if (!isPlainObject(obj)) return { sheets }
  for (const [key, s] of Object.entries(obj)) {
    if (key === 'mate') continue
    if (!key.startsWith('sheet_') || !isPlainObject(s)) continue
    const name = s.name ?? key
    const sourceData = s.sourceData ?? {}
    let columns = []
    if (Array.isArray(s.content) && Array.isArray(s.content[0])) {
      columns = s.content[0].slice(1) // 去掉 row_id
    }
    sheets.push({
      key,
      name,
      uid: s.uid ?? key,
      columns,
      sourceData,
      hasRowId: Array.isArray(s.content?.[0]) && s.content[0][0] === 'row_id',
      orderNo: s.orderNo,
    })
  }
  return { sheets }
}

export function validateTemplate(obj) {
  const errs = []
  if (!isPlainObject(obj)) return ['模板根节点必须是对象']
  if (!isPlainObject(obj.mate)) {
    errs.push('mate 必须是对象')
  } else if (obj.mate.type !== 'chatSheets') {
    errs.push('mate.type 不是 chatSheets')
  }

  const topKeys = Object.keys(obj).filter((k) => k !== 'mate')
  for (const key of topKeys) {
    if (!key.startsWith('sheet_')) errs.push(`顶层字段 ${key} 必须以 sheet_ 开头`)
  }
  const sheetKeys = topKeys.filter((k) => k.startsWith('sheet_'))
  if (sheetKeys.length === 0) errs.push('没有任何 sheet_* 表')
  const names = new Map()
  const orders = new Map()
  for (const k of sheetKeys) {
    const s = obj[k]
    if (!isPlainObject(s)) { errs.push(`表 ${k} 不是对象`); continue }

    if (typeof s.name !== 'string' || s.name.trim() === '') {
      errs.push(`表 ${k} 的 name 必须是非空字符串`)
    } else if (names.has(s.name)) {
      errs.push(`表 ${k} 与表 ${names.get(s.name)} 的 name 重复: ${s.name}`)
    } else {
      names.set(s.name, k)
    }

    if (typeof s.uid !== 'string' || s.uid.trim() === '') {
      errs.push(`表 ${k} 缺少字段 uid 或 uid 不是非空字符串`)
    } else if (s.uid !== k) {
      errs.push(`表 ${k} 的 uid 必须与表键一致，当前为 ${s.uid}`)
    }

    if (!Number.isInteger(s.orderNo) || s.orderNo < 0) {
      errs.push(`表 ${k} 的 orderNo 必须是数字形式的非负整数`)
    } else if (orders.has(s.orderNo)) {
      errs.push(`表 ${k} 与表 ${orders.get(s.orderNo)} 的 orderNo 重复: ${s.orderNo}`)
    } else {
      orders.set(s.orderNo, k)
    }

    if (!isPlainObject(s.sourceData)) {
      errs.push(`表 ${k} 的 sourceData 必须是对象`)
    } else {
      for (const sec of SHEET_KEYS) {
        if (!(sec in s.sourceData)) {
          errs.push(`表 ${k} 的 sourceData 缺少 ${sec}`)
        } else if (typeof s.sourceData[sec] !== 'string') {
          errs.push(`表 ${k} 的 sourceData.${sec} 必须是字符串`)
        }
      }
      for (const sec of Object.keys(s.sourceData)) {
        if (!SECTIONS.includes(sec)) errs.push(`表 ${k} 的 sourceData 含未知字段 ${sec}`)
      }
      const ddl = s.sourceData.ddl
      if (typeof ddl === 'string') {
        const physicalColumn = /(?:\(|,|\n)\s*(?:"([^"]+)"|`([^`]+)`|\[([^\]]+)\]|([A-Za-z_][A-Za-z0-9_]*))\s+(?:TEXT|INTEGER|REAL|BLOB|NUMERIC|DECIMAL|BOOLEAN|DATE|DATETIME|VARCHAR|CHAR|DOUBLE|FLOAT)\b/gi
        for (const match of ddl.matchAll(physicalColumn)) {
          const column = match[1] ?? match[2] ?? match[3] ?? match[4]
          if (column !== 'row_id' && /id/i.test(column)) {
            errs.push(`表 ${k} 的 DDL 物理列名 "${column}" 含 ID/id`)
          }
        }
      }
    }

    if (!Array.isArray(s.content) || s.content.length === 0 || !Array.isArray(s.content[0])) {
      errs.push(`表 ${k} 的 content 必须包含表头数组`)
    } else {
      const header = s.content[0]
      if (header[0] !== 'row_id') errs.push(`表 ${k} 的表头第一列必须是 row_id`)
      if (header.length < 2) errs.push(`表 ${k} 至少需要一个业务列`)
      const columns = new Set()
      for (const [index, column] of header.slice(1).entries()) {
        if (typeof column !== 'string' || column.trim() === '') {
          errs.push(`表 ${k} 的第 ${index + 2} 个业务列名必须是非空字符串`)
          continue
        }
        if (columns.has(column)) errs.push(`表 ${k} 的业务列名重复: ${column}`)
        columns.add(column)
        if (/id/i.test(column)) errs.push(`表 ${k} 的业务列名 "${column}" 含 ID/id`)
      }
      const n = s.content[0].length
      s.content.forEach((row, i) => {
        if (!Array.isArray(row)) {
          errs.push(`表 ${k} 第 ${i + 1} 行必须是数组`)
        } else if (row.length !== n) {
          errs.push(`表 ${k} 第 ${i + 1} 行数据列数 ${row.length} 与表头 ${n} 不一致`)
        }
      })
    }

    if (s.hiddenPhysicalColumns !== undefined) {
      if (!Array.isArray(s.hiddenPhysicalColumns) || s.hiddenPhysicalColumns.some((v) => typeof v !== 'string')) {
        errs.push(`表 ${k} 的 hiddenPhysicalColumns 必须是字符串数组`)
      }
    }
    if (s.columnAliases !== undefined) {
      if (!isPlainObject(s.columnAliases) || Object.values(s.columnAliases).some(
        (aliases) => !Array.isArray(aliases) || aliases.some((v) => typeof v !== 'string'),
      )) {
        errs.push(`表 ${k} 的 columnAliases 必须是字符串数组对象`)
      }
    }

    // exportConfig：索引列必须取自表内列，mode 键必须是索引列的子集
    if (s.exportConfig !== undefined) {
      if (!isPlainObject(s.exportConfig)) {
        errs.push(`表 ${k} 的 exportConfig 必须是对象`)
      } else {
        for (const field of Object.keys(s.exportConfig)) {
          if (!EXPORT_FIELDS.has(field)) errs.push(`表 ${k} 的 exportConfig 含未知字段 ${field}`)
        }
        for (const field of EXPORT_BOOLEAN_FIELDS) {
          if (field in s.exportConfig && typeof s.exportConfig[field] !== 'boolean') {
            errs.push(`表 ${k} 的 exportConfig.${field} 必须是布尔值`)
          }
        }
        for (const field of EXPORT_STRING_FIELDS) {
          if (field in s.exportConfig && typeof s.exportConfig[field] !== 'string') {
            errs.push(`表 ${k} 的 exportConfig.${field} 必须是字符串`)
          }
        }
        const idxCols = s.exportConfig.extraIndexColumns
        if (idxCols !== undefined && (!Array.isArray(idxCols) || idxCols.some((c) => typeof c !== 'string'))) {
          errs.push(`表 ${k} 的 extraIndexColumns 必须是字符串数组`)
        } else if (Array.isArray(idxCols)) {
          const cols = (s.content?.[0] ?? []).filter((c) => c !== 'row_id')
          for (const c of idxCols) {
            if (!cols.includes(c)) errs.push(`表 ${k} 的 extraIndexColumns 含非表内列 "${c}"`)
          }
        }
        const modes = s.exportConfig.extraIndexColumnModes
        if (modes !== undefined && (
          !isPlainObject(modes) || Object.values(modes).some((mode) => typeof mode !== 'string')
        )) {
          errs.push(`表 ${k} 的 extraIndexColumnModes 必须是字符串值对象`)
        } else if (isPlainObject(modes)) {
          const indexedColumns = Array.isArray(idxCols) ? idxCols : []
          for (const c of Object.keys(modes)) {
            if (!indexedColumns.includes(c)) {
              errs.push(`表 ${k} 的 extraIndexColumnModes 键 "${c}" 不在 extraIndexColumns 内`)
            }
          }
        }
        for (const field of EXPORT_PLACEMENT_FIELDS) {
          if (!(field in s.exportConfig)) continue
          const placement = s.exportConfig[field]
          if (!isPlainObject(placement)) {
            errs.push(`表 ${k} 的 exportConfig.${field} 必须是对象`)
            continue
          }
          for (const key of Object.keys(placement)) {
            if (!['position', 'depth', 'order'].includes(key)) {
              errs.push(`表 ${k} 的 exportConfig.${field} 含未知字段 ${key}`)
            }
          }
          if ('position' in placement && typeof placement.position !== 'string') {
            errs.push(`表 ${k} 的 exportConfig.${field}.position 必须是字符串`)
          }
          for (const key of ['depth', 'order']) {
            if (key in placement && !Number.isFinite(placement[key])) {
              errs.push(`表 ${k} 的 exportConfig.${field}.${key} 必须是有限数字`)
            }
          }
        }
      }
    }
    if (s.updateConfig !== undefined) {
      if (!isPlainObject(s.updateConfig)) {
        errs.push(`表 ${k} 的 updateConfig 必须是对象`)
      } else {
        for (const field of Object.keys(s.updateConfig)) {
          if (!UPDATE_CONFIG_FIELDS.includes(field)) errs.push(`表 ${k} 的 updateConfig 含未知字段 ${field}`)
        }
        for (const field of UPDATE_CONFIG_FIELDS) {
          if (field in s.updateConfig && !Number.isFinite(s.updateConfig[field])) {
            errs.push(`表 ${k} 的 updateConfig.${field} 必须是有限数字`)
          }
        }
      }
    }
  }
  return errs
}

// ---------- 概览 / 单表输出 ----------
export function makeOverview(obj) {
  const { sheets } = parseTemplate(obj)
  const lines = []
  lines.push(`模板一共 ${sheets.length} 张表`)
  lines.push('')
  for (const s of sheets) {
    lines.push(`• ${s.name}  (key=${s.key}, order=${s.orderNo})`)
    lines.push(`  列(${s.columns.length}): ${s.columns.join(' | ') || '(无)'}`)
  }
  return lines.join('\n')
}

function findSheet(obj, name) {
  const { sheets } = parseTemplate(obj)
  const hit = sheets.find((s) => s.name === name || s.key === name || s.uid === name)
  if (!hit) {
    const names = sheets.map((s) => `${s.name}(${s.key})`).join(', ')
    fail(`找不到表 "${name}"。可选表：${names}`)
  }
  return hit
}

export function printSheet(obj, name) {
  const s = findSheet(obj, name)
  const lines = []
  lines.push(`表：${s.name}  (key=${s.key}, order=${s.orderNo})`)
  lines.push(`列(${s.columns.length}): ${s.columns.join(' | ') || '(无)'}`)
  lines.push('---')
  for (const sec of SECTIONS) {
    const v = s.sourceData[sec]
    lines.push(`【${SECTION_LABELS[sec]}】`)
    lines.push(`${(typeof v === 'string' ? v : JSON.stringify(v, null, 2)) ?? '(空)'}`)
    lines.push('')
  }
  return lines.join('\n')
}

export function printSection(obj, name, sec) {
  const s = findSheet(obj, name)
  if (!SECTIONS.includes(sec)) {
    fail(`节名 "${sec}" 非法。可选：${SECTIONS.join(', ')}`)
  }
  const v = s.sourceData[sec]
  return (typeof v === 'string' ? v : JSON.stringify(v, null, 2)) ?? '(空)'
}

// ---------- patch ----------
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

// 字符串 find-replace：pairs 为 [[旧串, 新串], ...]，逐条替换所有出现；旧串未命中即报错
function replaceAllIn(op, sec, current, pairs) {
  if (typeof current !== 'string') fail(`patch ${op}.sourceData.${sec} 做字符串替换，但当前值是 ${typeof current}`)
  let cur = current
  for (const p of pairs) {
    if (!Array.isArray(p) || p.length !== 2) fail(`patch ${op}.sourceData.${sec} 的替换项必须是 [旧串, 新串]`)
    const [from, to] = p
    if (typeof from !== 'string' || typeof to !== 'string') fail(`patch ${op}.sourceData.${sec} 的替换项 [旧串, 新串] 必须是字符串`)
    if (!cur.includes(from)) fail(`patch ${op}.sourceData.${sec} 替换未命中："${from}"`)
    cur = cur.split(from).join(to)
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
  for (const sec of SHEET_KEYS) {
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
    fail(`patch 后模板校验失败，已中止（未写盘）：\n  - ${errs.join('\n  - ')}`)
  }
  for (const key of Object.keys(doc)) delete doc[key]
  Object.assign(doc, next)
  return changes
}

// ---------- 主流程 ----------
function printHelp() {
  console.log(`shujuku-template-tool — SillyTavern 数据库插件模板工具

用法:
  shujuku-template-tool overview <file.json>
  shujuku-template-tool sheets <file.json> <表名>
  shujuku-template-tool section <file.json> <表名> <节名>
  shujuku-template-tool apply [--preview] <file.json> <patch.json|->
  shujuku-template-tool validate <file.json>
  shujuku-template-tool --help

说明:
  - 表名可用 表名 / key / uid 任一种
  - 已有表的 patch 传 null = 删除整张表；至少保留一张表
  - 已有表的对象 patch 只允许改: name、sourceData 六段、columns、hiddenPhysicalColumns、columnAliases、exportConfig、orderNo；mate/updateConfig 等只读
  - patch 的 sourceData 按段替换（给哪段改哪段，未给的段保留）；columns、hiddenPhysicalColumns、columnAliases 整体替换（columns 会重建表头）
  - exportConfig 按字段合并（给哪些字段改哪些，未给的保留）：标量直接替换、extraIndexColumns 数组整体替换、placement 对象合并；extraIndexColumns 传 []、extraIndexColumnModes 传 {} 清空
  - sourceData 段值传字符串=整体替换；传 [[旧串,新串], ...] = 字符串替换（逐条替换所有出现，旧串未命中则报错）
  - hiddenPhysicalColumns 传空数组、columnAliases 传空对象可删除该字段
  - patch 键指向不存在的 sheet_* = 新增表：必需 name + columns，可选 sourceData（缺段补空串）/ orderNo / exportConfig / updateConfig；uid 固定等于表键，orderNo 默认最大+1
  - patch 文件传 - 可从 stdin 读取；--preview 可放在文件参数前后
  - patch 在内存与写盘阶段均为原子操作，失败时保留原对象和原文件
`)
}

function main() {
  const [, , cmd, ...args] = process.argv
  if (!cmd || cmd === '--help' || cmd === '-h') {
    printHelp()
    process.exit(0)
  }

  try { run(cmd, args) } catch (e) {
    if (e instanceof CliError) {
      console.error('错误：' + e.message)
      process.exit(1)
    }
    throw e
  }
}

function run(cmd, args) {
  switch (cmd) {
    case 'overview': {
      if (args.length !== 1) fail('用法: overview <file.json>')
      console.log(makeOverview(readJson(args[0])))
      break
    }
    case 'sheets': {
      if (args.length !== 2) fail('用法: sheets <file.json> <表名>')
      console.log(printSheet(readJson(args[0]), args[1]))
      break
    }
    case 'section': {
      if (args.length !== 3) fail('用法: section <file.json> <表名> <节名>')
      console.log(printSection(readJson(args[0]), args[1], args[2]))
      break
    }
    case 'apply': {
      let parsed
      try {
        parsed = parseArgs({
          args,
          options: { preview: { type: 'boolean' } },
          allowPositionals: true,
          strict: true,
        })
      } catch (e) {
        fail(`apply 参数错误: ${e.message}`)
      }
      if (parsed.positionals.length !== 2) fail('用法: apply [--preview] <file.json> <patch.json|->')
      const [templateFile, patchFile] = parsed.positionals
      if (templateFile === '-') fail('apply 的模板必须使用文件路径，只有 patch 可以传 -')
      const doc = readJson(templateFile)
      const patch = readJson(patchFile)
      const changes = applyPatch(doc, patch)
      if (!parsed.values.preview) {
        writeJson(templateFile, doc)
      }
      if (changes.length > 0) console.log(changes.join('\n'))
      const { sheets } = parseTemplate(doc)
      console.log(`校验通过：最终 ${sheets.length} 张表，结构完整`)
      if (!parsed.values.preview) console.log(`已写回 ${resolve(templateFile)}`)
      break
    }
    case 'validate':
      if (args.length !== 1) fail('用法: validate <file.json>')
      {
        const obj = readJson(args[0])
        const errs = validateTemplate(obj)
        if (errs.length === 0) {
          const { sheets } = parseTemplate(obj)
          console.log(`校验通过：${sheets.length} 张表，结构完整`)
          return
        }
        console.error('校验失败：')
        for (const e of errs) console.error('  - ' + e)
        process.exit(1)
      }
      break
    default:
      fail(`未知命令 "${cmd}"。用 --help 查看用法`)
  }
}

// 直接运行时才走主流程（import 做测试时不执行）
const isDirectRun = process.argv[1] ? import.meta.url === pathToFileURL(resolve(process.argv[1])).href : false
if (isDirectRun) main()
