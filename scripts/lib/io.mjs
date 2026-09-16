import {
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { randomUUID } from 'node:crypto'
import { basename, dirname, join, resolve } from 'node:path'
import { fail } from './common.mjs'

export function readJsonSource(file) {
  const source = file === '-' ? 0 : resolve(file)
  if (file !== '-' && !existsSync(source)) fail(`文件不存在: ${source}`)
  let raw
  try { raw = readFileSync(source) } catch (e) { fail(`读取${file === '-' ? '标准输入' : '文件'}失败: ${e.message}`) }
  try { return { doc: JSON.parse(raw.toString('utf8')), raw } } catch (e) { fail(`JSON 解析失败: ${e.message}`) }
}
export function readJson(file) {
  return readJsonSource(file).doc
}
export function writeJson(file, obj, { expectedBytes } = {}) {
  const abs = resolve(file)
  const temp = join(dirname(abs), `.${basename(abs)}.${process.pid}.${randomUUID()}.tmp`)
  const raw = JSON.stringify(obj, null, 2) + '\n'
  let fd
  let created = false
  let backup = null
  let backupCreated = false
  const checkVersion = () => {
    if (expectedBytes !== undefined && !readFileSync(abs).equals(expectedBytes)) {
      fail(`源文件已变化，请重新读取后应用 patch: ${abs}`)
    }
  }
  try {
    checkVersion()
    fd = openSync(temp, 'wx')
    created = true
    writeFileSync(fd, raw, 'utf8')
    fsyncSync(fd)
    closeSync(fd)
    fd = undefined
    if (expectedBytes !== undefined) {
      checkVersion()
      backup = `${abs}.${randomUUID()}.bak`
      fd = openSync(backup, 'wx')
      backupCreated = true
      writeFileSync(fd, expectedBytes)
      fsyncSync(fd)
      closeSync(fd)
      fd = undefined
    }
    checkVersion()
    renameSync(temp, abs)
    created = false
    return backup
  } catch (e) {
    if (fd !== undefined) {
      try { closeSync(fd) } catch {}
    }
    let cleanup = ''
    if (created) {
      try { unlinkSync(temp) } catch (cleanupError) {
        cleanup = `；临时文件清理失败: ${temp}（${cleanupError.message}）`
      }
    }
    if (backupCreated) {
      try { unlinkSync(backup) } catch (cleanupError) {
        cleanup += `；备份清理失败: ${backup}（${cleanupError.message}）`
      }
    }
    fail(`无法原子写入文件 ${abs}: ${e.message}${cleanup}`)
  }
}
