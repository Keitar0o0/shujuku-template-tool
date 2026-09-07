import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { writeJson } from '../bin/shujuku-template-tool.mjs'

const cli = fileURLToPath(new URL('../bin/shujuku-template-tool.mjs', import.meta.url))

function baseDoc() {
  return {
    mate: {
      type: 'chatSheets',
      version: 2,
      updateConfigUiSentinel: -1,
      globalInjectionConfig: {
        readableEntryPlacement: { position: 'before_character_definition', depth: 2, order: 99981 },
        wrapperPlacement: { position: 'before_character_definition', depth: 2, order: 99980 },
      },
    },
    sheet_a: {
      uid: 'sheet_a',
      name: '表A',
      sourceData: {
        note: '旧说明',
        initNode: '',
        insertNode: '',
        updateNode: '',
        deleteNode: '',
        ddl: 'CREATE TABLE demo ( -- 表A\n  row_id INTEGER PRIMARY KEY, -- 行号\n  title TEXT -- 标题\n);',
      },
      content: [['row_id', '标题']],
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
        entryName: '表A',
        entryType: 'constant',
        keywords: '',
        preventRecursion: true,
        injectionTemplate: '',
        extraIndexEnabled: false,
        extraIndexEntryName: '表A-索引',
        extraIndexColumns: [],
        extraIndexColumnModes: {},
        extraIndexInjectionTemplate: '',
        sqlInjectionTemplate: '',
        entryPlacement: { position: 'at_depth_as_system', depth: 2, order: 10000 },
        extraIndexPlacement: { position: 'at_depth_as_system', depth: 2, order: 10010 },
        fixedEntryPlacement: { position: 'before_character_definition', depth: 2, order: 99981 },
        fixedIndexPlacement: { position: 'before_character_definition', depth: 2, order: 99982 },
      },
      orderNo: 0,
    },
  }
}

function makeFixture(t, patch = { sheet_a: { sourceData: { note: '新说明' } } }) {
  const dir = mkdtempSync(join(tmpdir(), 'shujuku-cli-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const templatePath = join(dir, 'template.json')
  const patchPath = join(dir, 'patch.json')
  writeFileSync(templatePath, JSON.stringify(baseDoc(), null, 2) + '\n', 'utf8')
  writeFileSync(patchPath, JSON.stringify(patch, null, 2) + '\n', 'utf8')
  return { templatePath, patchPath, original: readFileSync(templatePath, 'utf8') }
}

function run(args, input) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', input })
}

function assertSuccess(result) {
  assert.equal(result.status, 0, result.stderr || result.stdout)
  assert.match(result.stdout, /最终[^\r\n]*1\s*张表/)
  assert.match(result.stdout, /校验通过/)
}

test('apply --preview 可放在文件参数前或 patch 末尾，且不写盘', (t) => {
  for (const position of ['before', 'after']) {
    const fixture = makeFixture(t)
    const files = readdirSync(dirname(fixture.templatePath))
    const args = position === 'before'
      ? ['apply', '--preview', fixture.templatePath, fixture.patchPath]
      : ['apply', fixture.templatePath, fixture.patchPath, '--preview']
    const result = run(args)

    assertSuccess(result)
    assert.equal(readFileSync(fixture.templatePath, 'utf8'), fixture.original)
    assert.deepEqual(readdirSync(dirname(fixture.templatePath)), files)
  }
})

test('apply 对未知选项和多余位置参数非零退出', (t) => {
  for (const extra of ['--unknown', 'extra.json']) {
    const fixture = makeFixture(t)
    const result = run(['apply', fixture.templatePath, fixture.patchPath, extra])

    assert.notEqual(result.status, 0)
    assert.equal(readFileSync(fixture.templatePath, 'utf8'), fixture.original)
  }
})

test('apply 正式执行写回源文件', (t) => {
  const fixture = makeFixture(t)
  const result = run(['apply', fixture.templatePath, fixture.patchPath])

  assertSuccess(result)
  const written = JSON.parse(readFileSync(fixture.templatePath, 'utf8'))
  assert.equal(written.sheet_a.sourceData.note, '新说明')
})

test("apply 支持 patch 路径 '-' 从 stdin 读取", (t) => {
  const fixture = makeFixture(t)
  const patch = JSON.stringify({ sheet_a: { sourceData: { note: 'stdin 说明' } } })
  const result = run(['apply', fixture.templatePath, '-'], patch)

  assertSuccess(result)
  const written = JSON.parse(readFileSync(fixture.templatePath, 'utf8'))
  assert.equal(written.sheet_a.sourceData.note, 'stdin 说明')
})

test("apply 只允许 patch 使用 '-'，模板必须是文件", () => {
  const result = run(['apply', '-', 'patch.json'], JSON.stringify(baseDoc()))
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /模板必须使用文件路径/)
})

test('apply 中途失败时源文件保持不变', (t) => {
  const fixture = makeFixture(t, {
    sheet_a: { name: '半成品', sourceData: { note: [['未命中文本', '替换']] } },
  })
  const result = run(['apply', fixture.templatePath, fixture.patchPath])

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /替换未命中/)
  assert.equal(readFileSync(fixture.templatePath, 'utf8'), fixture.original)
  assert.deepEqual(readdirSync(dirname(fixture.templatePath)), ['patch.json', 'template.json'])
})

test('全部读取命令支持结构化 JSON，默认 section 保留文本正文', (t) => {
  const { templatePath } = makeFixture(t)
  for (const [args, verify] of [
    [['overview', templatePath], (value) => {
      assert.equal(value.total, 1)
      assert.deepEqual(value.sheets[0].columns, ['标题'])
      assert.equal(Object.hasOwn(value.sheets[0], 'sourceData'), false)
    }],
    [['sheets', templatePath, 'sheet_a'], (value) => {
      assert.equal(value.sheet.key, 'sheet_a')
      assert.equal(value.sheet.sourceData.note, '旧说明')
      assert.deepEqual(value.sheet.content, [['row_id', '标题']])
      assert.equal(value.sheet.exportConfig.enabled, false)
    }],
    [['section', templatePath, '表A', 'note'], (value) => {
      assert.equal(value.key, 'sheet_a')
      assert.equal(value.section, 'note')
      assert.equal(value.value, '旧说明')
    }],
    [['validate', templatePath], (value) => {
      assert.equal(value.valid, true)
      assert.deepEqual(value.errors, [])
    }],
    [['help'], (value) => assert.match(value.usage, /--json/)],
  ]) {
    for (const argv of [['--json', ...args], [...args, '--json']]) {
      const result = run(argv)
      assert.equal(result.status, 0, result.stderr)
      assert.equal(result.stderr, '')
      const value = JSON.parse(result.stdout)
      assert.equal(value.command, args[0])
      verify(value)
    }
  }
  assert.equal(run(['section', templatePath, '表A', 'note']).stdout.trim(), '旧说明')
})

test('apply JSON 预览保留文件，连续写回生成唯一原始字节备份', (t) => {
  const { templatePath, patchPath } = makeFixture(t)
  const dir = dirname(templatePath)
  const original = Buffer.from(JSON.stringify(baseDoc()) + '\r\n', 'utf8')
  writeFileSync(templatePath, original)
  const files = readdirSync(dir)
  const preview = run(['apply', '--preview', templatePath, patchPath, '--json'])
  assert.equal(preview.status, 0, preview.stderr)
  const summary = JSON.parse(preview.stdout)
  assert.equal(summary.preview, true)
  assert.equal(summary.valid, true)
  assert.equal(summary.backup, null)
  assert.equal(summary.output, null)
  assert.equal(summary.changes.length, 1)
  assert.deepEqual(readFileSync(templatePath), original)
  assert.deepEqual(readdirSync(dir), files)

  const backups = new Set()
  for (let index = 0; index < 2; index++) {
    const before = readFileSync(templatePath)
    const result = run(['apply', templatePath, patchPath, '--json'])
    assert.equal(result.status, 0, result.stderr)
    const value = JSON.parse(result.stdout)
    assert.equal(value.preview, false)
    assert.equal(value.output, templatePath)
    assert.match(value.backup, /\.bak$/)
    assert.deepEqual(readFileSync(value.backup), before)
    backups.add(value.backup)
  }
  assert.equal(backups.size, 2)
  assert.equal(readdirSync(dir).length, files.length + 2)
})

test('JSON 失败写入 stderr，完整保留校验错误与目录状态', (t) => {
  const fixture = makeFixture(t)
  const invalid = baseDoc()
  invalid.sheet_a.orderNo = -1
  invalid.sheet_a.name = ''
  writeFileSync(fixture.templatePath, JSON.stringify(invalid))
  const before = readFileSync(fixture.templatePath)
  const files = readdirSync(dirname(fixture.templatePath))
  for (const args of [
    ['validate', fixture.templatePath, '--json'],
    ['apply', fixture.templatePath, fixture.patchPath, '--json'],
    ['section', fixture.templatePath, 'sheet_a', 'typo', '--json'],
    ['overview', fixture.templatePath, '--unknown', '--json'],
  ]) {
    const result = run(args)
    assert.equal(result.status, 1)
    assert.equal(result.stdout, '')
    const error = JSON.parse(result.stderr)
    assert.equal(error.valid, false)
    assert.ok(error.errors.length > 0)
    if (['validate', 'apply'].includes(args[0])) {
      assert.ok(error.errors.some((message) => message.includes('orderNo')))
      assert.ok(error.errors.some((message) => message.includes('name')))
    }
    assert.deepEqual(readFileSync(fixture.templatePath), before)
    assert.deepEqual(readdirSync(dirname(fixture.templatePath)), files)
  }
})

test('写入前版本冲突保留最新源文件与备份目录状态', (t) => {
  const { templatePath } = makeFixture(t)
  const expectedBytes = readFileSync(templatePath)
  const latest = JSON.stringify({ ...baseDoc(), mate: { type: 'chatSheets', version: 3 } })
  writeFileSync(templatePath, latest)
  const files = readdirSync(dirname(templatePath))
  assert.throws(() => writeJson(templatePath, baseDoc(), { expectedBytes }), /源文件已变化/)
  assert.equal(readFileSync(templatePath, 'utf8'), latest)
  assert.deepEqual(readdirSync(dirname(templatePath)), files)
})
