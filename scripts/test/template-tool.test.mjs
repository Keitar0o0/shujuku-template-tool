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

test('新增表：uid/orderNo/exportConfig/updateConfig 可覆盖', () => {
  const doc = baseDoc()
  applyPatch(doc, {
    sheet_b: {
      name: '表B', columns: ['c'], uid: 'sheet_custom', orderNo: 42,
      exportConfig: { enabled: true }, updateConfig: { uiSentinel: 1 },
    },
  })
  assert.equal(doc.sheet_b.uid, 'sheet_custom')
  assert.equal(doc.sheet_b.orderNo, 42)
  assert.equal(doc.sheet_b.exportConfig.enabled, true)
  assert.equal(doc.sheet_b.updateConfig.uiSentinel, 1)
})

test('新增表：缺 name / columns 报错', () => {
  assert.throws(() => applyPatch(baseDoc(), { sheet_b: { columns: ['c'] } }), /必须提供 name/)
  assert.throws(() => applyPatch(baseDoc(), { sheet_b: { name: '表B' } }), /必须提供非空 columns/)
  assert.throws(() => applyPatch(baseDoc(), { sheet_b: { name: '表B', columns: ['c'], mate: 1 } }), /不允许字段/)
})

// ---------- 已有表 patch ----------
test('改名 + columns 重建表头', () => {
  const doc = baseDoc()
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

test('已有表只读字段报错', () => {
  assert.throws(() => applyPatch(baseDoc(), { sheet_a: { exportConfig: { enabled: true } } }), /只允许 name/)
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

test('parseTemplate：列与元信息解析', () => {
  const { sheets } = parseTemplate(baseDoc())
  assert.equal(sheets.length, 1)
  assert.deepEqual(sheets[0].columns, ['列1'])
  assert.equal(sheets[0].hasRowId, true)
})
