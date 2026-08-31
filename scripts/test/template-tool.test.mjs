import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyPatch, validateTemplate, parseTemplate } from '../bin/shujuku-template-tool.mjs'

// 最小合法模板 fixture
function baseDoc() {
  return {
    mate: { type: 'chatSheets' },
    sheet_a: {
      uid: 'sheet_a',
      name: '表A',
      sourceData: { note: '说明A', initNode: '', insertNode: '', updateNode: '', deleteNode: '', ddl: '' },
      content: [['row_id', '列1'], ['r1', 'x']],
      orderNo: 0,
    },
  }
}

// ---------- 新增表 ----------
test('新增表：自动补 uid/orderNo/缺段空串/默认配置', () => {
  const doc = baseDoc()
  const changes = applyPatch(doc, {
    sheet_b: { name: '表B', columns: ['列x', '列y'], sourceData: { note: 'n' } },
  })
  const s = doc.sheet_b
  assert.equal(s.name, '表B')
  assert.equal(s.uid, 'sheet_b')
  assert.equal(s.orderNo, 1) // max+1
  assert.deepEqual(s.content, [['row_id', '列x', '列y']])
  assert.deepEqual(s.sourceData, { note: 'n', initNode: '', insertNode: '', updateNode: '', deleteNode: '', ddl: '' })
  assert.equal(s.exportConfig.enabled, false)
  assert.equal(s.exportConfig.entryType, 'constant')
  assert.equal(s.exportConfig.entryName, '表B')
  assert.match(changes[0], /新增表 表B/)
})

test('新增表：uid 由表键生成，orderNo 与局部配置可覆盖', () => {
  const doc = baseDoc()
  applyPatch(doc, {
    sheet_b: {
      name: '表B', columns: ['c'], orderNo: 42,
      exportConfig: { enabled: true }, updateConfig: { uiSentinel: 1 },
    },
  })
  assert.equal(doc.sheet_b.uid, 'sheet_b')
  assert.equal(doc.sheet_b.orderNo, 42)
  assert.equal(doc.sheet_b.exportConfig.enabled, true)
  assert.equal(doc.sheet_b.exportConfig.entryName, '表B')
  assert.equal(doc.sheet_b.updateConfig.uiSentinel, 1)
  assert.equal(doc.sheet_b.updateConfig.contextDepth, -1)
})

test('新增表：缺 name / columns 报错', () => {
  assert.throws(() => applyPatch(baseDoc(), { sheet_b: { columns: ['c'] } }), /必须提供 name/)
  assert.throws(() => applyPatch(baseDoc(), { sheet_b: { name: '表B' } }), /columns.*必须是非空/)
  assert.throws(() => applyPatch(baseDoc(), { sheet_b: { name: '表B', columns: ['c'], mate: 1 } }), /不允许字段/)
  assert.throws(() => applyPatch(baseDoc(), { sheet_b: { name: '表B', columns: ['c'], uid: 'sheet_b' } }), /不允许字段 "uid"/)
})

// ---------- 删除表 ----------
test('删除表：null 删除已有表并返回摘要', () => {
  const doc = baseDoc()
  applyPatch(doc, { sheet_b: { name: '表B', columns: ['列x'] } })
  const changes = applyPatch(doc, { sheet_b: null })
  assert.equal('sheet_b' in doc, false)
  assert.match(changes[0], /删除表 表B/)
})

test('删除表：目标不存在或删除全部表时报错', () => {
  assert.throws(() => applyPatch(baseDoc(), { sheet_missing: null }), /目标不存在/)
  assert.throws(() => applyPatch(baseDoc(), { sheet_a: null }), /不能删除全部表/)
})

test('删除表：同一 patch 可用新表替换最后一张旧表', () => {
  const doc = baseDoc()
  applyPatch(doc, {
    sheet_a: null,
    sheet_b: { name: '表B', columns: ['列x'] },
  })
  assert.equal('sheet_a' in doc, false)
  assert.equal(doc.sheet_b.name, '表B')
})

// ---------- 已有表 patch ----------
test('改名 + columns 重建表头', () => {
  const doc = baseDoc()
  doc.sheet_a.content = [doc.sheet_a.content[0]]
  applyPatch(doc, { sheet_a: { name: '新名', columns: ['c1', 'c2'] } })
  assert.equal(doc.sheet_a.name, '新名')
  assert.deepEqual(doc.sheet_a.content[0], ['row_id', 'c1', 'c2'])
})

test('sourceData 字符串替换，未命中报错', () => {
  const doc = baseDoc()
  applyPatch(doc, { sheet_a: { sourceData: { note: [['说明', '新说明'], ['A', 'B']] } } })
  assert.equal(doc.sheet_a.sourceData.note, '新说明B')
  assert.throws(() => applyPatch(baseDoc(), { sheet_a: { sourceData: { note: [['不存在', 'x']] } } }), /替换未命中/)
})

test('sourceData 整体替换', () => {
  const doc = baseDoc()
  applyPatch(doc, { sheet_a: { sourceData: { ddl: 'CREATE TABLE x (...)' } } })
  assert.equal(doc.sheet_a.sourceData.ddl, 'CREATE TABLE x (...)')
  assert.equal(doc.sheet_a.sourceData.note, '说明A') // 未给的段保留
})

test('hiddenPhysicalColumns / columnAliases 空值删除字段', () => {
  const doc = baseDoc()
  doc.sheet_a.hiddenPhysicalColumns = ['h1']
  doc.sheet_a.columnAliases = { a: ['别名'] }
  applyPatch(doc, { sheet_a: { hiddenPhysicalColumns: [], columnAliases: {} } })
  assert.equal('hiddenPhysicalColumns' in doc.sheet_a, false)
  assert.equal('columnAliases' in doc.sheet_a, false)
})

test('exportConfig 按字段合并：标量替换/数组整体替换/placement 合并', () => {
  const doc = baseDoc()
  doc.sheet_a.content[0].push('列x')
  doc.sheet_a.content[1].push('y')
  doc.sheet_a.exportConfig = {
    enabled: false, entryType: 'constant', keywords: '', extraIndexColumns: ['列1'],
    extraIndexColumnModes: { 列1: 'both' },
    entryPlacement: { position: 'at_depth_as_system', depth: 2, order: 10000 },
  }
  applyPatch(doc, {
    sheet_a: {
      exportConfig: {
        enabled: true,
        keywords: '账号',
        extraIndexColumns: ['列1', '列x'],
        extraIndexColumnModes: { 列1: 'both', 列x: 'index_only' },
        entryPlacement: { depth: 10000 },
      },
    },
  })
  const ec = doc.sheet_a.exportConfig
  assert.equal(ec.enabled, true) // 标量替换
  assert.equal(ec.entryType, 'constant') // 未给的字段保留
  assert.equal(ec.keywords, '账号')
  assert.deepEqual(ec.extraIndexColumns, ['列1', '列x']) // 数组整体替换
  assert.deepEqual(ec.extraIndexColumnModes, { 列1: 'both', 列x: 'index_only' })
  assert.deepEqual(ec.entryPlacement, { position: 'at_depth_as_system', depth: 10000, order: 10000 }) // 对象合并
})

test('改名会同步默认导出条目名，并保留自定义条目名', () => {
  const defaults = baseDoc()
  defaults.sheet_a.exportConfig = {
    entryName: '表A', extraIndexEntryName: '表A-索引', extraIndexColumns: [], extraIndexColumnModes: {},
  }
  applyPatch(defaults, { sheet_a: { name: '新表名' } })
  assert.equal(defaults.sheet_a.exportConfig.entryName, '新表名')
  assert.equal(defaults.sheet_a.exportConfig.extraIndexEntryName, '新表名-索引')

  const custom = baseDoc()
  custom.sheet_a.exportConfig = {
    entryName: '自定义正文', extraIndexEntryName: '自定义索引', extraIndexColumns: [], extraIndexColumnModes: {},
  }
  applyPatch(custom, { sheet_a: { name: '新表名' } })
  assert.equal(custom.sheet_a.exportConfig.entryName, '自定义正文')
  assert.equal(custom.sheet_a.exportConfig.extraIndexEntryName, '自定义索引')
})

test('orderNo 可修改，但重复值会整批回滚', () => {
  const doc = baseDoc()
  applyPatch(doc, { sheet_a: { orderNo: 7 } })
  assert.equal(doc.sheet_a.orderNo, 7)

  applyPatch(doc, { sheet_b: { name: '表B', columns: ['列B'], orderNo: 8 } })
  const before = structuredClone(doc)
  assert.throws(() => applyPatch(doc, { sheet_a: { orderNo: 8 } }), /orderNo.*重复/)
  assert.deepEqual(doc, before)
})

test('patch 中途失败或最终校验失败时不修改原对象', () => {
  const during = baseDoc()
  const duringBefore = structuredClone(during)
  assert.throws(() => applyPatch(during, {
    sheet_a: { name: '半成品' },
    sheet_missing: null,
  }), /目标不存在/)
  assert.deepEqual(during, duringBefore)

  const after = baseDoc()
  const afterBefore = structuredClone(after)
  assert.throws(() => applyPatch(after, {
    sheet_a: { sourceData: { ddl: 'CREATE TABLE demo (row_id INTEGER PRIMARY KEY, identity_text TEXT);' } },
  }), /identity_text.*ID\/id/i)
  assert.deepEqual(after, afterBefore)
})

test('patch 字段严格限制类型和配置键', () => {
  assert.throws(
    () => applyPatch(baseDoc(), { sheet_a: { sourceData: { note: { text: 'x' } } } }),
    /note.*字符串或替换项数组/,
  )
  const doc = baseDoc()
  doc.sheet_a.exportConfig = { extraIndexColumns: [], extraIndexColumnModes: {} }
  assert.throws(
    () => applyPatch(doc, { sheet_a: { exportConfig: { typoEnabled: true } } }),
    /不允许字段 "typoEnabled"/,
  )
})

test('已有表只读字段报错', () => {
  assert.throws(() => applyPatch(baseDoc(), { sheet_a: { updateConfig: { uiSentinel: 1 } } }), /只允许 name/)
  assert.throws(() => applyPatch(baseDoc(), { mate: { type: 'x' } }), /只读/)
  assert.throws(() => applyPatch(baseDoc(), { not_sheet: {} }), /只能以 sheet_ 开头/)
})

// ---------- validate ----------
test('validate：缺 uid / 缺六段报错', () => {
  const doc = baseDoc()
  delete doc.sheet_a.uid
  assert.equal(validateTemplate(doc).some((e) => e.includes('缺少字段 uid')), true)
  const doc2 = baseDoc()
  delete doc2.sheet_a.sourceData.ddl
  assert.equal(validateTemplate(doc2).some((e) => e.includes('缺少 ddl')), true)
})

test('validate：数据行与表头列数不一致报错', () => {
  const doc = baseDoc()
  doc.sheet_a.content.push(['r2', 'y', '多一列'])
  assert.equal(validateTemplate(doc).some((e) => e.includes('列数')), true)
})

test('validate：extraIndexColumns 非表内列 / mode 键不在索引列内报错', () => {
  const doc = baseDoc()
  doc.sheet_a.exportConfig = { enabled: true, extraIndexColumns: ['列1', '不存在的列'], extraIndexColumnModes: {} }
  assert.equal(validateTemplate(doc).some((e) => e.includes('非表内列')), true)
  const doc2 = baseDoc()
  doc2.sheet_a.exportConfig = { enabled: true, extraIndexColumns: ['列1'], extraIndexColumnModes: { 列1: 'both', 多余: 'index_only' } }
  assert.equal(validateTemplate(doc2).some((e) => e.includes('不在 extraIndexColumns')), true)
})

test('parseTemplate：列与元信息解析', () => {
  const { sheets } = parseTemplate(baseDoc())
  assert.equal(sheets.length, 1)
  assert.deepEqual(sheets[0].columns, ['列1'])
  assert.equal(sheets[0].hasRowId, true)
})
