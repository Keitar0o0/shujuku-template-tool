import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { fail } from './common.mjs'
import { readJsonSource, readJson, writeJson } from './io.mjs'
import { parseTemplate, findSheet, makeOverview, printSheet, printSection } from './template.mjs'
import { validateTemplate } from './validation.mjs'
import { applyPatch } from './patch.mjs'

function helpText() {
  return `shujuku-template-tool — SillyTavern 数据库插件模板工具

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
  - sourceData 段值传字符串=整体替换；传 [[旧串,新串,次数?], ...] = 字面替换，次数默认 1，实际命中总数必须一致
  - hiddenPhysicalColumns 传空数组、columnAliases 传空对象可删除该字段
  - patch 键指向不存在的 sheet_* = 新增表：必需 name + columns，可选 sourceData（缺段补空串）/ orderNo / exportConfig / updateConfig；uid 固定等于表键，orderNo 默认最大+1
  - patch 文件传 - 可从 stdin 读取；--preview 可放在文件参数前后
  - apply 写回前复核源文件版本，并自动生成唯一 .bak 字节备份；预览与失败保留源文件和备份目录状态
  - 所有命令支持 --json，成功输出到 stdout，失败输出到 stderr 并以 1 退出
`
}

export function main() {
  const argv = process.argv.slice(2)
  const separator = argv.indexOf('--')
  let json = argv.slice(0, separator < 0 ? argv.length : separator).includes('--json')
  let cmd
  try {
    const parsed = parseArgs({
      args: argv,
      options: {
        json: { type: 'boolean' },
        preview: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
      },
      allowPositionals: true,
      strict: true,
    })
    json = Boolean(parsed.values.json)
    const [command, ...args] = parsed.positionals
    cmd = command
    if (!cmd || cmd === 'help' || parsed.values.help) {
      console.log(json ? JSON.stringify({ command: 'help', usage: helpText() }) : helpText())
      return
    }
    if (parsed.values.preview && cmd !== 'apply') fail('--preview 仅适用于 apply')
    run(cmd, args, { json, preview: Boolean(parsed.values.preview) })
  } catch (e) {
    console.error(json
      ? JSON.stringify({ command: cmd ?? null, valid: false, error: e.message, errors: e.errors ?? [e.message] })
      : '错误：' + e.message)
    process.exitCode = 1
  }
}

function run(cmd, args, { json, preview }) {
  const output = (value, text) => console.log(json ? JSON.stringify({ command: cmd, ...value }) : text)
  switch (cmd) {
    case 'overview': {
      if (args.length !== 1) fail('用法: overview <file.json>')
      const doc = readJson(args[0])
      const sheets = parseTemplate(doc).sheets.map(({ sourceData, ...sheet }) => sheet)
      output({ total: sheets.length, sheets }, makeOverview(doc))
      break
    }
    case 'sheets': {
      if (args.length !== 2) fail('用法: sheets <file.json> <表名>')
      const doc = readJson(args[0])
      const sheet = findSheet(doc, args[1])
      output({ sheet: { ...doc[sheet.key], key: sheet.key, columns: sheet.columns } }, printSheet(doc, args[1]))
      break
    }
    case 'section': {
      if (args.length !== 3) fail('用法: section <file.json> <表名> <节名>')
      const doc = readJson(args[0])
      const text = printSection(doc, args[1], args[2])
      const sheet = findSheet(doc, args[1])
      output({ key: sheet.key, name: sheet.name, section: args[2], value: sheet.sourceData[args[2]] ?? null }, text)
      break
    }
    case 'apply': {
      if (args.length !== 2) fail('用法: apply [--preview] <file.json> <patch.json|->')
      const [templateFile, patchFile] = args
      if (templateFile === '-') fail('apply 的模板必须使用文件路径，只有 patch 可以传 -')
      const { doc, raw } = readJsonSource(templateFile)
      const patch = readJson(patchFile)
      const changes = applyPatch(doc, patch)
      const backup = preview ? null : writeJson(templateFile, doc, { expectedBytes: raw })
      const { sheets } = parseTemplate(doc)
      const text = [...changes, `校验通过：最终 ${sheets.length} 张表，结构完整`]
      if (!preview) text.push(`已写回 ${resolve(templateFile)}`, `备份 ${backup}`)
      output({ changes, valid: true, preview, total: sheets.length, output: preview ? null : resolve(templateFile), backup }, text.join('\n'))
      break
    }
    case 'validate':
      if (args.length !== 1) fail('用法: validate <file.json>')
      {
        const obj = readJson(args[0])
        const errs = validateTemplate(obj)
        if (errs.length === 0) {
          const { sheets } = parseTemplate(obj)
          output({ valid: true, errors: [], total: sheets.length }, `校验通过：${sheets.length} 张表，结构完整`)
          return
        }
        fail(`校验失败：\n  - ${errs.join('\n  - ')}`, errs)
      }
      break
    default:
      fail(`未知命令 "${cmd}"。用 --help 查看用法`)
  }
}
