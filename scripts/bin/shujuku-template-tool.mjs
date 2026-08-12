#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

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
function fail(msg) {
  console.error('错误：' + msg)
  process.exit(1)
}
function readJson(file) {
  const abs = resolve(file)
  if (!existsSync(abs)) fail(`文件不存在: ${abs}`)
  let raw
  try { raw = readFileSync(abs, 'utf8') } catch (e) { fail(`无法读取文件: ${e.message}`) }
  try { return JSON.parse(raw) } catch (e) { fail(`JSON 解析失败: ${e.message}`) }
}
function writeJson(file, obj) {
  const abs = resolve(file)
  writeFileSync(abs, JSON.stringify(obj, null, 2) + '\n', 'utf8')
}

// ---------- 模板解析 ----------
function parseTemplate(obj) {
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

function validateTemplate(obj) {
  const errs = []
  if (obj.mate?.type !== 'chatSheets') errs.push('mate.type 不是 chatSheets')
  const sheetKeys = Object.keys(obj).filter((k) => k !== 'mate')
  if (sheetKeys.length === 0) errs.push('没有任何 sheet_* 表')
  for (const k of sheetKeys) {
    const s = obj[k]
    if (!s || typeof s !== 'object') { errs.push(`表 ${k} 不是对象`); continue }
    for (const f of ['name', 'content', 'sourceData']) {
      if (!(f in s)) errs.push(`表 ${k} 缺少字段 ${f}`)
    }
    if (s.sourceData) {
      for (const sec of SHEET_KEYS) {
        if (!(sec in s.sourceData)) errs.push(`表 ${k} 的 sourceData 缺少 ${sec}`)
      }
    }
  }
  return errs
}

// ---------- 概览 ----------
function makeOverview(obj) {
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

// ---------- 输出 ----------
function findSheet(obj, name) {
  const { sheets } = parseTemplate(obj)
  const hit = sheets.find((s) => s.name === name || s.key === name || s.uid === name)
  if (!hit) {
    const names = sheets.map((s) => `${s.name}(${s.key})`).join(', ')
    fail(`找不到表 "${name}"。可选表：${names}`)
  }
  return hit
}

function printSheet(obj, name) {
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

function printSection(obj, name, sec) {
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

function applyPatch(doc, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
    fail('patch 必须是一个对象')
  }
  for (const [op, val] of Object.entries(patch)) {
    if (op === 'mate') {
      fail('结构字段 mate 只读，不允许 patch')
    }
    if (!op.startsWith('sheet_')) {
      fail(`未知 patch 键 "${op}"（只能以 sheet_ 开头）`)
    }
    const sheet = doc[op]
    if (!sheet || typeof sheet !== 'object') fail(`patch 目标表 ${op} 不存在`)
    if (!val || typeof val !== 'object' || Array.isArray(val)) {
      fail(`patch ${op} 的值必须是对象`)
    }
    for (const [field, fv] of Object.entries(val)) {
      if (field === 'name') {
        if (typeof fv !== 'string') fail(`patch ${op}.name 必须是字符串`)
        sheet.name = fv
        continue
      }
      if (field === 'columns') {
        if (!Array.isArray(fv)) fail(`patch ${op}.columns 必须是数组`)
        if (!Array.isArray(sheet.content) || !sheet.content.length) fail(`patch ${op}.columns 需要 content 存在`)
        const oldExists = sheet.content[0][0] === 'row_id'
        const newHeader = [...(oldExists ? ['row_id'] : []), ...fv]
        sheet.content[0] = newHeader
        continue
      }
      if (field === 'sourceData') {
        if (!fv || typeof fv !== 'object' || Array.isArray(fv)) fail(`patch ${op}.sourceData 必须是对象`)
        for (const [sec, sv] of Object.entries(fv)) {
          if (!SECTIONS.includes(sec)) fail(`patch ${op}.sourceData 只允许 ${SECTIONS.join(', ')}，收到 "${sec}"`)
          if (sv === undefined) continue
          if (Array.isArray(sv)) {
            sheet.sourceData[sec] = replaceAllIn(op, sec, sheet.sourceData[sec], sv)
          } else {
            sheet.sourceData[sec] = patchValue(sheet.sourceData[sec], sv, `${op}.sourceData.${sec}`)
          }
        }
        continue
      }
      if (field === 'hiddenPhysicalColumns') {
        if (!Array.isArray(fv)) fail(`patch ${op}.hiddenPhysicalColumns 必须是数组`)
        if (fv.length === 0) {
          delete sheet.hiddenPhysicalColumns
        } else {
          sheet.hiddenPhysicalColumns = fv
        }
        continue
      }
      if (field === 'columnAliases') {
        if (!fv || typeof fv !== 'object' || Array.isArray(fv)) fail(`patch ${op}.columnAliases 必须是对象`)
        if (Object.keys(fv).length === 0) {
          delete sheet.columnAliases
        } else {
          sheet.columnAliases = fv
        }
        continue
      }
      fail(`patch ${op} 只允许 name / sourceData / columns / hiddenPhysicalColumns / columnAliases，收到 "${field}"`)
    }
  }
  return doc
}

// ---------- 校验 ----------
function cmdValidate(file) {
  const obj = readJson(file)
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

// ---------- 主流程 ----------
function printHelp() {
  console.log(`shujuku-template — SillyTavern 数据库插件模板工具

用法:
  shujuku-template overview <file.json>                 # 表+列一览（给 Agent 快速看结构）
  shujuku-template sheets <file.json> <表名>            # 某张表全部六段
  shujuku-template section <file.json> <表名> <节名>     # 某张表某一节（note/initNode/insertNode/updateNode/deleteNode/ddl）
  shujuku-template apply <file.json> <patch.json>        # 应用 patch（改 name/sourceData 六段/columns/hiddenPhysicalColumns/columnAliases），写回原文件
  shujuku-template apply --preview <file.json> <patch.json>  # 预览结果，不写盘
  shujuku-template validate <file.json>                  # 校验模板结构是否完整
  shujuku-template --help                                # 帮助

说明:
  - 表名可用 表名 / key / uid 任一种
  - patch 只允许改: 每张表的 name、sourceData 六段、columns、hiddenPhysicalColumns、columnAliases；mate/exportConfig 等只读
  - patch 的 sourceData 按段替换（给哪段改哪段，未给的段保留）；columns、hiddenPhysicalColumns、columnAliases 整体替换（columns 会重建表头）
  - sourceData 段值传字符串=整体替换；传 [[旧串,新串], ...] = 字符串替换（逐条替换所有出现，旧串未命中则报错）
  - hiddenPhysicalColumns 传空数组、columnAliases 传空对象可删除该字段
  - 输入一律走文件路径
`)
}

const [, , cmd, ...args] = process.argv
if (!cmd || cmd === '--help' || cmd === '-h') {
  printHelp()
  process.exit(0)
}

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
    applyPatch(doc, patch)
    const errs = validateTemplate(doc)
    if (errs.length === 0) {
      if (preview) {
        console.log(JSON.stringify(doc, null, 2))
      } else {
        writeJson(rest[0], doc)
        console.log(`已应用 patch 并写回 ${resolve(rest[0])}`)
      }
    } else {
      console.error('patch 后模板校验失败，已中止（未写盘）：')
      for (const e of errs) console.error('  - ' + e)
      process.exit(1)
    }
    break
  }
  case 'validate':
    cmdValidate(args[0])
    break
  default:
    fail(`未知命令 "${cmd}"。用 --help 查看用法`)
}
