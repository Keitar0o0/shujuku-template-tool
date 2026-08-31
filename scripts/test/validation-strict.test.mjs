import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateTemplate } from '../bin/shujuku-template-tool.mjs'

const sourceData = {
  note: '说明',
  initNode: '',
  insertNode: '',
  updateNode: '',
  deleteNode: '',
  ddl: '',
}

function validSheet(key = 'sheet_a', name = '表A', orderNo = 0) {
  return {
    uid: key,
    name,
    sourceData: { ...sourceData },
    content: [['row_id', '名称'], ['r1', '示例']],
    orderNo,
    updateConfig: {
      uiSentinel: -1,
      contextDepth: -1,
      updateFrequency: -1,
      batchSize: -1,
      skipFloors: -1,
      groupId: -1,
    },
    exportConfig: {
      enabled: false,
      splitByRow: false,
      entryName: name,
      entryType: 'constant',
      keywords: '',
      preventRecursion: true,
      injectionTemplate: '',
      extraIndexEnabled: false,
      extraIndexEntryName: `${name}-索引`,
      extraIndexColumns: ['名称'],
      extraIndexColumnModes: { 名称: 'both' },
      extraIndexInjectionTemplate: '',
      sqlInjectionTemplate: '',
      entryPlacement: { position: 'at_depth_as_system', depth: 2, order: 10000 },
      extraIndexPlacement: { position: 'at_depth_as_system', depth: 2, order: 10010 },
      fixedEntryPlacement: { position: 'before_character_definition', depth: 2, order: 99981 },
      fixedIndexPlacement: { position: 'before_character_definition', depth: 2, order: 99982 },
    },
  }
}

function validDoc() {
  return {
    mate: { type: 'chatSheets' },
    sheet_a: validSheet(),
  }
}

function expectInvalid(doc, pattern) {
  let errors
  assert.doesNotThrow(() => { errors = validateTemplate(doc) })
  assert.ok(errors.length > 0, '应返回至少一条校验错误')
  if (pattern) assert.match(errors.join('\n'), pattern)
}

test('严格校验：合法模板通过，六段允许空字符串', () => {
  assert.deepEqual(validateTemplate(validDoc()), [])
})

test('严格校验：根必须是普通对象', () => {
  for (const value of [null, [], 'template', 1]) {
    expectInvalid(value, /(?:根|模板).*对象/)
  }
})

test('严格校验：顶层只允许 mate 与 sheet_*', () => {
  const doc = validDoc()
  doc.other = validSheet('other', '表B', 1)
  expectInvalid(doc, /(?:顶层.*other|other.*sheet_)/)
})

for (const [field, value, pattern] of [
  ['name', 1, /name.*字符串/],
  ['uid', [], /uid.*字符串/],
  ['content', {}, /content.*数组/],
  ['sourceData', [], /sourceData.*对象/],
  ['orderNo', '0', /orderNo.*数字/],
]) {
  test(`严格校验：${field} 类型`, () => {
    const doc = validDoc()
    doc.sheet_a[field] = value
    expectInvalid(doc, pattern)
  })
}

test('严格校验：uid 必须等于顶层 sheet key', () => {
  const doc = validDoc()
  doc.sheet_a.uid = 'sheet_b'
  expectInvalid(doc, /uid.*sheet_a|sheet_a.*uid/)
})

test('严格校验：content 必须有表头且首列为 row_id', () => {
  const empty = validDoc()
  empty.sheet_a.content = []
  expectInvalid(empty, /(?:表头|row_id)/)

  const wrongFirstColumn = validDoc()
  wrongFirstColumn.sheet_a.content[0][0] = 'id'
  expectInvalid(wrongFirstColumn, /row_id/)
})

test('严格校验：业务列名必须是非空字符串', () => {
  for (const column of [1, '', '   ']) {
    const doc = validDoc()
    doc.sheet_a.content[0][1] = column
    expectInvalid(doc, /(?:业务列|列名).*(?:字符串|非空)/)
  }
})

test('严格校验：业务列名不得重复', () => {
  const doc = validDoc()
  doc.sheet_a.content[0].push('名称')
  doc.sheet_a.content[1].push('示例2')
  expectInvalid(doc, /(?:业务列|列名).*重复|重复.*(?:业务列|列名)/)
})

test('严格校验：业务列名不得包含大小写 id', () => {
  for (const column of ['user_id', 'Identity', '用户ID']) {
    const doc = validDoc()
    doc.sheet_a.content[0][1] = column
    expectInvalid(doc, /(?:业务列|列名).*id|id.*(?:业务列|列名)/i)
  }
})

test('严格校验：每一行必须是数组', () => {
  const doc = validDoc()
  doc.sheet_a.content[1] = '不是数组'
  expectInvalid(doc, /第 2 行.*数组/)
})

test('严格校验：每一行必须与表头等宽', () => {
  const doc = validDoc()
  doc.sheet_a.content[1] = ['r1']
  expectInvalid(doc, /第 2 行.*(?:列数|等宽)/)
})

test('严格校验：sourceData 六段必须存在且为字符串', () => {
  const missing = validDoc()
  delete missing.sheet_a.sourceData.note
  expectInvalid(missing, /(?:缺少.*note|note.*缺少)/)

  const wrongType = validDoc()
  wrongType.sheet_a.sourceData.ddl = null
  expectInvalid(wrongType, /ddl.*字符串/)

  const extra = validDoc()
  extra.sheet_a.sourceData.other = ''
  expectInvalid(extra, /sourceData.*未知字段.*other/)
})

test('严格校验：DDL 物理列名不得包含大小写 id，row_id 除外', () => {
  for (const column of ['identity_text TEXT', '"user_id" VARCHAR', '`msgId` NUMERIC', '[post_id] BOOLEAN']) {
    const doc = validDoc()
    doc.sheet_a.sourceData.ddl = `CREATE TABLE demo (row_id INTEGER PRIMARY KEY, ${column});`
    expectInvalid(doc, /DDL.*ID\/id/i)
  }
})

test('严格校验：表名不得重复', () => {
  const doc = validDoc()
  doc.sheet_b = validSheet('sheet_b', '表A', 1)
  expectInvalid(doc, /(?:name|表名).*重复|重复.*(?:name|表名)/)
})

test('严格校验：orderNo 不得重复', () => {
  const doc = validDoc()
  doc.sheet_b = validSheet('sheet_b', '表B', 0)
  expectInvalid(doc, /orderNo.*重复|重复.*orderNo/)
})

for (const [label, mutate, pattern] of [
  ['exportConfig 必须是对象', (sheet) => { sheet.exportConfig = [] }, /exportConfig.*对象/],
  ['exportConfig.enabled 必须是布尔值', (sheet) => { sheet.exportConfig.enabled = 'false' }, /enabled.*布尔/],
  ['exportConfig.extraIndexColumns 必须是字符串数组', (sheet) => { sheet.exportConfig.extraIndexColumns = ['名称', 1] }, /extraIndexColumns.*字符串/],
  ['exportConfig.extraIndexColumnModes 必须是对象', (sheet) => { sheet.exportConfig.extraIndexColumnModes = [] }, /extraIndexColumnModes.*对象/],
  ['exportConfig.entryPlacement 必须是对象', (sheet) => { sheet.exportConfig.entryPlacement = [] }, /entryPlacement.*对象/],
  ['exportConfig.entryPlacement.depth 必须是数字', (sheet) => { sheet.exportConfig.entryPlacement.depth = '2' }, /entryPlacement\.depth.*数字|depth.*数字/],
  ['updateConfig 必须是对象', (sheet) => { sheet.updateConfig = [] }, /updateConfig.*对象/],
  ['updateConfig 数值字段必须是数字', (sheet) => { sheet.updateConfig.batchSize = '1' }, /batchSize.*数字/],
]) {
  test(`严格校验：${label}`, () => {
    const doc = validDoc()
    mutate(doc.sheet_a)
    expectInvalid(doc, pattern)
  })
}
