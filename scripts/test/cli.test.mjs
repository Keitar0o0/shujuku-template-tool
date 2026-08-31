import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

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
        ddl: 'CREATE TABLE demo (row_id INTEGER PRIMARY KEY, title TEXT);',
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
    const args = position === 'before'
      ? ['apply', '--preview', fixture.templatePath, fixture.patchPath]
      : ['apply', fixture.templatePath, fixture.patchPath, '--preview']
    const result = run(args)

    assertSuccess(result)
    assert.equal(readFileSync(fixture.templatePath, 'utf8'), fixture.original)
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
})
