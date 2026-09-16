#!/usr/bin/env node
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { main } from '../lib/cli.mjs'

export { readJson, writeJson } from '../lib/io.mjs'
export { parseTemplate, makeOverview, printSheet, printSection } from '../lib/template.mjs'
export { validateTemplate } from '../lib/validation.mjs'
export { applyPatch } from '../lib/patch.mjs'

// 直接运行时进入 CLI，导入时保留原有函数接口
const isDirectRun = process.argv[1] ? import.meta.url === pathToFileURL(resolve(process.argv[1])).href : false
if (isDirectRun) main()
