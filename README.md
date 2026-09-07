# Shujuku Template Tool

用于读取和修改 SillyTavern「数据库」插件模板的命令行工具，同时提供 Agent Skill，让 Agent 按表和段落处理模板

## 能做什么

- 查看模板中的表、列和填表引导
- 按需读取指定表的说明、更新提示词或 DDL
- 修改表名、列和提示词，新增或删除表
- 预览改动、校验模板结构，写回时自动备份原文件

## 使用方式

准备 Bun，将本项目放入 Agent 的技能目录，例如 `.agents/skills/shujuku-template-tool/`，然后直接描述需求

> 使用 shujuku-template-tool 查看这个模板，帮我修改「世界状态」表的更新提示词

也可以在本项目目录直接运行命令，`template.json` 替换为实际模板路径

```bash
# 查看模板概览
bun ./scripts/bin/shujuku-template-tool.mjs overview template.json

# 读取某张表的更新提示词
bun ./scripts/bin/shujuku-template-tool.mjs section template.json '世界状态' updateNode

# 校验模板
bun ./scripts/bin/shujuku-template-tool.mjs validate template.json
```

## 致谢

感谢 [AlbusKen/shujuku](https://github.com/AlbusKen/shujuku)「ACU 星数据库 III」项目，本工具围绕该数据库插件的模板格式提供读取与修改能力
