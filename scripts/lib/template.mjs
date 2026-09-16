import { SECTION_LABELS, SECTIONS, fail, isPlainObject } from './common.mjs'

export function parseTemplate(obj) {
  const sheets = []
  if (!isPlainObject(obj)) return { sheets }
  for (const [key, s] of Object.entries(obj)) {
    if (key === 'mate') continue
    if (!key.startsWith('sheet_') || !isPlainObject(s)) continue
    const name = s.name ?? key
    const sourceData = s.sourceData ?? {}
    let columns = []
    if (Array.isArray(s.content) && Array.isArray(s.content[0])) {
      columns = s.content[0].slice(1) // 去掉 row_id
    }
    sheets.push({
      key,
      name,
      uid: s.uid ?? key,
      columns,
      sourceData,
      hasRowId: Array.isArray(s.content?.[0]) && s.content[0][0] === 'row_id',
      orderNo: s.orderNo,
    })
  }
  return { sheets }
}

export function makeOverview(obj) {
  const { sheets } = parseTemplate(obj)
  const lines = []
  lines.push(`模板一共 ${sheets.length} 张表`)
  lines.push('')
  for (const s of sheets) {
    lines.push(`• ${s.name}  (key=${s.key}, order=${s.orderNo})`)
    lines.push(`  列(${s.columns.length}): ${s.columns.join(' | ') || '(无)'}`)
  }
  return lines.join('\n')
}

export function findSheet(obj, name) {
  const { sheets } = parseTemplate(obj)
  const hit = sheets.find((s) => s.name === name || s.key === name || s.uid === name)
  if (!hit) {
    const names = sheets.map((s) => `${s.name}(${s.key})`).join(', ')
    fail(`找不到表 "${name}"。可选表：${names}`)
  }
  return hit
}

export function printSheet(obj, name) {
  const s = findSheet(obj, name)
  const lines = []
  lines.push(`表：${s.name}  (key=${s.key}, order=${s.orderNo})`)
  lines.push(`列(${s.columns.length}): ${s.columns.join(' | ') || '(无)'}`)
  lines.push('---')
  for (const sec of SECTIONS) {
    const v = s.sourceData[sec]
    lines.push(`【${SECTION_LABELS[sec]}】`)
    lines.push(`${(typeof v === 'string' ? v : JSON.stringify(v, null, 2)) ?? '(空)'}`)
    lines.push('')
  }
  return lines.join('\n')
}

export function printSection(obj, name, sec) {
  const s = findSheet(obj, name)
  if (!SECTIONS.includes(sec)) {
    fail(`节名 "${sec}" 非法。可选：${SECTIONS.join(', ')}`)
  }
  const v = s.sourceData[sec]
  return (typeof v === 'string' ? v : JSON.stringify(v, null, 2)) ?? '(空)'
}
