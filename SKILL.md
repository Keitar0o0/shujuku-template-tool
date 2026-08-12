---
name: shujuku-template-tool
description: SillyTavern「数据库」插件模板（`mate` + `sheet_*`）的解析 / 展示 / patch 工具
---

## 作用

本工具用于解析/修改 SillyTavern「数据库」插件的模板 JSON（顶层为 `mate` + 若干 `sheet_*` 表）。它把模板拆成「概览」（表与列）和「分段」（每张表的 note / initNode / insertNode / updateNode / deleteNode / ddl 六段），支持按需读取，并以**通用 patch 格式**回写

## 如何使用

- 需要先快速了解一个模板有哪些表、每张表有哪些列 → 用 `overview`
- 需要看某张表的完整填表引导（六段） → 用 `sheets`
- 只需某一段（如只改 DDL、只改更新提示词） → 用 `section`
- 要改列名 / 改某段提示词 / 改表名 → 用 `apply`

## 命令

```bash
# 概览：表名 + 每表列
node ./scripts/bin/shujuku-template-tool.mjs overview <file.json>

# 某张表全部六段
node ./scripts/bin/shujuku-template-tool.mjs sheets <file.json> <表名>

# 某张表某一节
node ./scripts/bin/shujuku-template-tool.mjs section <file.json> <表名> <note|initNode|insertNode|updateNode|deleteNode|ddl>

# 应用 patch（写回原文件）
node ./scripts/bin/shujuku-template-tool.mjs apply <file.json> <patch.json>

# 预览 patch 结果而不写盘
node ./scripts/bin/shujuku-template-tool.mjs apply --preview <file.json> <patch.json>

# 校验模板结构完整性
node ./scripts/bin/shujuku-template-tool.mjs validate <file.json>
```

可以在 `package.json` 的 `bin` 里 `pnpm link` / `bun link` 后直接用 `shujuku-template-tool`

## patch 格式（通用）

patch 是 JSON 对象，键为 `sheet_*`，值为针对该表的修改。**只允许改五样**：
`name`（表名）、`sourceData` 六段、`columns`（中文列名数组）、`hiddenPhysicalColumns`（物理隐藏列数组）、
`columnAliases`（物理列别名对象）。`mate`、`exportConfig`、`updateConfig` 等结构字段一律只读，patch 会报错

```jsonc
{
  "sheet_zhang_hao_shu_ju": {
    "name": "账号数据",                       // 可选：改表名
    "columns": ["平台", "账号", "名称"],      // 可选：整体替换中文列名（重建表头）
    "hiddenPhysicalColumns": ["col_a"],       // 可选：整体替换物理隐藏列；传 [] 删除该字段
    "columnAliases": { "col_b": ["别名1"] },  // 可选：整体替换列别名；传 {} 删除该字段
    "sourceData": {                           // 可选：改六段中的任意段
      "ddl": "CREATE TABLE ...",              // 字符串：整体替换该段
      "note": [["旧串", "新串"]]              // 数组：字符串替换（旧串未命中报错）
    }
  }
}
```

## 注意事项

- 工具无 stdin 读取，输入一律走文件路径
- `apply` 会先校验 patch 后模板结构仍完整，失败则**不写盘**并报错
- patch 的 `sourceData` 按**段**替换（patch 里给哪段就改哪段，未给的段保留原值）；`columns`、`hiddenPhysicalColumns`、`columnAliases` 为**整体替换**（`columns` 重建表头并自动补 `row_id` 前缀，后两者传 `[]` / `{}` 删除该字段）
- `sourceData` 段的值传**字符串**=整体替换；传**数组** `[[旧串, 新串], ...]`=字符串替换（逐条替换所有出现，旧串未命中则报错、不写盘）
