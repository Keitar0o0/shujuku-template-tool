#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

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

// ---------- 通用 ----------
// 抛异常而非 process.exit：测试（assert.throws）可捕获，CLI 入口统一 catch 打印
class CliError extends Error {}
function fail(msg) {
  throw new CliError(msg)
}
export function readJson(file) {
  const abs = resolve(file)
  if (!existsSync(abs)) fail(`文件不存在: ${abs}`)
  let raw
  try { raw = readFileSync(abs, 'utf8') } catch (e) { fail(`无法读取文件: ${e.message}`) }
  try { return JSON.parse(raw) } catch (e) { fail(`JSON 解析失败: ${e.message}`) }
}
export function writeJson(file, obj) {
  const abs = resolve(file)
  writeFileSync(abs, JSON.stringify(obj, null, 2) + '\n', 'utf8')
}

// ---------- 模板解析 ----------
export function parseTemplate(obj) {
  const sheets = []
  for (const [key, s] of Object.entries(obj)) {
    if (key === 'mate') continue
    if (!s || typeof s !== 'object') continue
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
  if (obj.mate?.type !== 'chatSheets') errs.push('mate.type 不是 chatSheets')
  const sheetKeys = Object.keys(obj).filter((k) => k !== 'mate')
  if (sheetKeys.length === 0) errs.push('没有任何 sheet_* 表')
  for (const k of sheetKeys) {
    const s = obj[k]
    if (!s || typeof s !== 'object') { errs.push(`表 ${k} 不是对象`); continue }
    for (const f of ['name', 'content', 'sourceData', 'uid']) {
      if (!(f in s)) errs.push(`表 ${k} 缺少字段 ${f}`)
    }
    if (s.sourceData) {
      for (const sec of SHEET_KEYS) {
        if (!(sec in s.sourceData)) errs.push(`表 ${k} 的 sourceData 缺少 ${sec}`)
      }
    }
    // 数据行与表头列数一致
    if (Array.isArray(s.content) && Array.isArray(s.content[0])) {
      const n = s.content[0].length
      s.content.forEach((row, i) => {
        if (Array.isArray(row) && row.length !== n) {
          errs.push(`表 ${k} 第 ${i + 1} 行数据列数 ${row.length} 与表头 ${n} 不一致`)
        }
      })
    }
    // exportConfig：索引列必须取自表内列，mode 键必须是索引列的子集
    if (s.exportConfig && Array.isArray(s.exportConfig.extraIndexColumns)) {
      const cols = (s.content?.[0] ?? []).filter((c) => c !== 'row_id')
      const idxCols = s.exportConfig.extraIndexColumns
      for (const c of idxCols) {
        if (!cols.includes(c)) errs.push(`表 ${k} 的 extraIndexColumns 含非表内列 "${c}"`)
      }
      const modes = s.exportConfig.extraIndexColumnModes
      if (modes && typeof modes === 'object') {
        for (const c of Object.keys(modes)) {
          if (!idxCols.includes(c)) errs.push(`表 ${k} 的 extraIndexColumnModes 键 "${c}" 不在 extraIndexColumns 内`)
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
function patchValue(current, patch, path) {
  if (Array.isArray(patch)) {
    if (!Array.isArray(current)) {
      fail(`patch 路径 ${path} 期望数组，但当前值为 ${typeof current}`)
    }
    return patch
  }
  if (patch && typeof patch === 'object') {
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      fail(`patch 路径 ${path} 期望对象，但当前值为 ${typeof current}`)
    }
    for (const [k, v] of Object.entries(patch)) {
      current[k] = patchValue(current[k], v, path + '.' + k)
    }
    return current
  }
  return patch
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

// 新增表：必需 name + columns，可选 sourceData（缺段补空串）/ uid（默认 = key）/ orderNo（默认最大 + 1）/ exportConfig / updateConfig
function createSheet(doc, op, val) {
  const allowed = ['name', 'columns', 'sourceData', 'uid', 'orderNo', 'exportConfig', 'updateConfig']
  for (const f of Object.keys(val)) {
    if (!allowed.includes(f)) fail(`新增表 ${op} 不允许字段 "${f}"`)
  }
  if (typeof val.name !== 'string' || !val.name) fail(`新增表 ${op} 必须提供 name`)
  if (!Array.isArray(val.columns) || val.columns.length === 0) fail(`新增表 ${op} 必须提供非空 columns 数组`)
  if (val.sourceData !== undefined) {
    if (!val.sourceData || typeof val.sourceData !== 'object' || Array.isArray(val.sourceData)) fail(`新增表 ${op} 的 sourceData 必须是对象`)
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
    uid: val.uid ?? op,
    name: val.name,
    sourceData,
    content: [['row_id', ...val.columns]],
    updateConfig: val.updateConfig ?? defaultUpdateConfig(),
    exportConfig: val.exportConfig ?? defaultExportConfig(val.name),
    orderNo: val.orderNo ?? maxOrder + 1,
  }
  return `✓ 新增表 ${val.name} (${op})：${val.columns.length} 列，order=${doc[op].orderNo}`
}

// 应用 patch，返回逐表改动摘要（写盘前打印）
export function applyPatch(doc, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
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
    if (!val || typeof val !== 'object' || Array.isArray(val)) {
      fail(`patch ${op} 的值必须是对象`)
    }
    const sheet = doc[op]
    if (!sheet || typeof sheet !== 'object') {
      changes.push(createSheet(doc, op, val))
      continue
    }
    const fields = []
    for (const [field, fv] of Object.entries(val)) {
      if (field === 'name') {
        if (typeof fv !== 'string') fail(`patch ${op}.name 必须是字符串`)
        sheet.name = fv
        fields.push('name')
        continue
      }
      if (field === 'columns') {
        if (!Array.isArray(fv)) fail(`patch ${op}.columns 必须是数组`)
        if (!Array.isArray(sheet.content) || !sheet.content.length) fail(`patch ${op}.columns 需要 content 存在`)
        const oldExists = sheet.content[0][0] === 'row_id'
        sheet.content[0] = [...(oldExists ? ['row_id'] : []), ...fv]
        fields.push(`columns(${fv.length} 列)`)
        continue
      }
      if (field === 'sourceData') {
        if (!fv || typeof fv !== 'object' || Array.isArray(fv)) fail(`patch ${op}.sourceData 必须是对象`)
        for (const [sec, sv] of Object.entries(fv)) {
          if (!SECTIONS.includes(sec)) fail(`patch ${op}.sourceData 只允许 ${SECTIONS.join(', ')}，收到 "${sec}"`)
          if (sv === undefined) continue
          if (Array.isArray(sv)) {
            sheet.sourceData[sec] = replaceAllIn(op, sec, sheet.sourceData[sec], sv)
            fields.push(`${sec}(${sv.length} 条替换)`)
          } else {
            sheet.sourceData[sec] = patchValue(sheet.sourceData[sec], sv, `${op}.sourceData.${sec}`)
            fields.push(`${sec}(整体替换)`)
          }
        }
        continue
      }
      if (field === 'hiddenPhysicalColumns') {
        if (!Array.isArray(fv)) fail(`patch ${op}.hiddenPhysicalColumns 必须是数组`)
        if (fv.length === 0) {
          delete sheet.hiddenPhysicalColumns
          fields.push('hiddenPhysicalColumns(删除)')
        } else {
          sheet.hiddenPhysicalColumns = fv
          fields.push(`hiddenPhysicalColumns(${fv.length})`)
        }
        continue
      }
      if (field === 'columnAliases') {
        if (!fv || typeof fv !== 'object' || Array.isArray(fv)) fail(`patch ${op}.columnAliases 必须是对象`)
        if (Object.keys(fv).length === 0) {
          delete sheet.columnAliases
          fields.push('columnAliases(删除)')
        } else {
          sheet.columnAliases = fv
          fields.push(`columnAliases(${Object.keys(fv).length})`)
        }
        continue
      }
      if (field === 'exportConfig') {
        if (!fv || typeof fv !== 'object' || Array.isArray(fv)) fail(`patch ${op}.exportConfig 必须是对象`)
        if (!sheet.exportConfig || typeof sheet.exportConfig !== 'object') fail(`patch ${op}.exportConfig 需要 exportConfig 存在`)
        for (const [k, v] of Object.entries(fv)) {
          sheet.exportConfig[k] = patchValue(sheet.exportConfig[k], v, `${op}.exportConfig.${k}`)
        }
        fields.push(`exportConfig(${Object.keys(fv).length} 项)`)
        continue
      }
      fail(`patch ${op} 只允许 name / sourceData / columns / hiddenPhysicalColumns / columnAliases / exportConfig，收到 "${field}"`)
    }
    changes.push(`✓ ${sheet.name} (${op})：${fields.join('、')}`)
  }
  return changes
}

// ---------- 主流程 ----------
function printHelp() {
  console.log(`shujuku-template — SillyTavern 数据库插件模板工具

用法:
  shujuku-template overview <file.json>                 # 表+列一览（给 Agent 快速看结构）
  shujuku-template sheets <file.json> <表名>            # 某张表全部六段
  shujuku-template section <file.json> <表名> <节名>     # 某张表某一节（note/initNode/insertNode/updateNode/deleteNode/ddl）
  shujuku-template apply <file.json> <patch.json>        # 应用 patch，打印改动摘要并写回原文件
  shujuku-template apply --preview <file.json> <patch.json>  # 打印改动摘要，不写盘
  shujuku-template validate <file.json>                  # 校验模板结构是否完整
  shujuku-template --help                                # 帮助

说明:
  - 表名可用 表名 / key / uid 任一种
  - 已有表的 patch 只允许改: name、sourceData 六段、columns、hiddenPhysicalColumns、columnAliases、exportConfig；mate/updateConfig 等只读
  - patch 的 sourceData 按段替换（给哪段改哪段，未给的段保留）；columns、hiddenPhysicalColumns、columnAliases 整体替换（columns 会重建表头）
  - exportConfig 按字段合并（给哪些字段改哪些，未给的保留）：标量直接替换、extraIndexColumns 数组整体替换、placement 对象合并；extraIndexColumns 传 []、extraIndexColumnModes 传 {} 清空
  - sourceData 段值传字符串=整体替换；传 [[旧串,新串], ...] = 字符串替换（逐条替换所有出现，旧串未命中则报错）
  - hiddenPhysicalColumns 传空数组、columnAliases 传空对象可删除该字段
  - patch 键指向不存在的 sheet_* = 新增表：必需 name + columns，可选 sourceData（缺段补空串）/ uid / orderNo / exportConfig / updateConfig；orderNo 默认最大+1，exportConfig 默认 disabled constant 模式，content 自动补 row_id 表头
  - 输入一律走文件路径
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
      if (args.length < 1) fail('用法: overview <file.json>')
      console.log(makeOverview(readJson(args[0])))
      break
    }
    case 'sheets': {
      if (args.length < 2) fail('用法: sheets <file.json> <表名>')
      console.log(printSheet(readJson(args[0]), args[1]))
      break
    }
    case 'section': {
      if (args.length < 3) fail('用法: section <file.json> <表名> <节名>')
      console.log(printSection(readJson(args[0]), args[1], args[2]))
      break
    }
    case 'apply': {
      const preview = args[0] === '--preview'
      const rest = preview ? args.slice(1) : args
      if (rest.length < 2) fail('用法: apply [--preview] <file.json> <patch.json>')
      const doc = readJson(rest[0])
      const patch = readJson(rest[1])
      const changes = applyPatch(doc, patch)
      const errs = validateTemplate(doc)
      if (errs.length > 0) {
        console.error('patch 后模板校验失败，已中止（未写盘）：')
        for (const e of errs) console.error('  - ' + e)
        process.exit(1)
      }
      console.log(changes.join('\n'))
      if (!preview) {
        writeJson(rest[0], doc)
        console.log(`已写回 ${resolve(rest[0])}`)
      }
      break
    }
    case 'validate':
      if (args.length < 1) fail('用法: validate <file.json>')
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
