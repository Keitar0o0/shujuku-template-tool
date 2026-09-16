import {
  SHEET_KEYS, SECTIONS, EXPORT_BOOLEAN_FIELDS, EXPORT_STRING_FIELDS,
  EXPORT_PLACEMENT_FIELDS, EXPORT_FIELDS, UPDATE_CONFIG_FIELDS, isPlainObject,
} from './common.mjs'

function validateDdlMappings(sheetKey, sheet, errs) {
  const ddl = sheet.sourceData?.ddl
  const header = sheet.content?.[0]
  if (typeof ddl !== 'string' || ddl.trim() === '' || !Array.isArray(header)) return

  const physicalColumn = /(?:\(|,|\n)\s*(?:"([^"]+)"|`([^`]+)`|\[([^\]]+)\]|([A-Za-z_][A-Za-z0-9_]*))\s+(?:TEXT|INTEGER|REAL|BLOB|NUMERIC|DECIMAL|BOOLEAN|DATE|DATETIME|VARCHAR|CHAR|DOUBLE|FLOAT)\b/gi
  const physicalColumns = [...ddl.matchAll(physicalColumn)].map(
    (match) => match[1] ?? match[2] ?? match[3] ?? match[4],
  )
  if (physicalColumns.length === 0) {
    errs.push(`表 ${sheetKey} 的 DDL 必须包含可解析的字段定义`)
    return
  }

  const createLine = ddl.split(/\r?\n/).find((line) => /CREATE\s+TABLE/i.test(line)) ?? ''
  const tableComment = createLine.match(/\(\s*--\s*(.+?)\s*$/)?.[1]
  if (!tableComment) {
    errs.push(`表 ${sheetKey} 的 DDL 建表行缺少 "-- ${sheet.name}"`)
  } else if (tableComment !== sheet.name) {
    errs.push(`表 ${sheetKey} 的 DDL 表注释 "${tableComment}" 与 name "${sheet.name}" 不一致`)
  }

  const mappedColumns = new Map()
  for (const line of ddl.split(/\r?\n/)) {
    const parts = line.split(/\s+--\s*/, 2)
    const match = parts[0].match(/^\s*(?:"([^"]+)"|`([^`]+)`|\[([^\]]+)\]|([A-Za-z_][A-Za-z0-9_]*))\s+(?:TEXT|INTEGER|REAL|BLOB|NUMERIC|DECIMAL|BOOLEAN|DATE|DATETIME|VARCHAR|CHAR|DOUBLE|FLOAT)\b/i)
    if (!match) continue
    const column = match[1] ?? match[2] ?? match[3] ?? match[4]
    mappedColumns.set(column, parts[1]?.trim() ?? '')
  }

  if (physicalColumns.length !== header.length) {
    errs.push(`表 ${sheetKey} 的 DDL 字段数 ${physicalColumns.length} 与 content 表头 ${header.length} 不一致`)
  }
  for (const [index, column] of physicalColumns.entries()) {
    const expected = index === 0 ? '行号' : header[index]
    const comment = mappedColumns.get(column)
    if (!comment) {
      errs.push(`表 ${sheetKey} 的 DDL 字段 "${column}" 缺少 "-- ${expected ?? '中文列名'}"`)
    } else if (typeof expected === 'string' && comment !== expected) {
      errs.push(`表 ${sheetKey} 的 DDL 字段 "${column}" 注释 "${comment}" 与 content 列名 "${expected}" 不一致`)
    }
  }
  if (physicalColumns[0] !== 'row_id') {
    errs.push(`表 ${sheetKey} 的 DDL 第一列必须是 row_id INTEGER PRIMARY KEY, -- 行号`)
  }
}

export function validateTemplate(obj) {
  const errs = []
  if (!isPlainObject(obj)) return ['模板根节点必须是对象']
  if (!isPlainObject(obj.mate)) {
    errs.push('mate 必须是对象')
  } else if (obj.mate.type !== 'chatSheets') {
    errs.push('mate.type 不是 chatSheets')
  }

  const topKeys = Object.keys(obj).filter((k) => k !== 'mate')
  for (const key of topKeys) {
    if (!key.startsWith('sheet_')) errs.push(`顶层字段 ${key} 必须以 sheet_ 开头`)
  }
  const sheetKeys = topKeys.filter((k) => k.startsWith('sheet_'))
  if (sheetKeys.length === 0) errs.push('没有任何 sheet_* 表')
  const names = new Map()
  const orders = new Map()
  for (const k of sheetKeys) {
    const s = obj[k]
    if (!isPlainObject(s)) { errs.push(`表 ${k} 不是对象`); continue }

    if (typeof s.name !== 'string' || s.name.trim() === '') {
      errs.push(`表 ${k} 的 name 必须是非空字符串`)
    } else if (names.has(s.name)) {
      errs.push(`表 ${k} 与表 ${names.get(s.name)} 的 name 重复: ${s.name}`)
    } else {
      names.set(s.name, k)
    }

    if (typeof s.uid !== 'string' || s.uid.trim() === '') {
      errs.push(`表 ${k} 缺少字段 uid 或 uid 不是非空字符串`)
    } else if (s.uid !== k) {
      errs.push(`表 ${k} 的 uid 必须与表键一致，当前为 ${s.uid}`)
    }

    if (!Number.isInteger(s.orderNo) || s.orderNo < 0) {
      errs.push(`表 ${k} 的 orderNo 必须是数字形式的非负整数`)
    } else if (orders.has(s.orderNo)) {
      errs.push(`表 ${k} 与表 ${orders.get(s.orderNo)} 的 orderNo 重复: ${s.orderNo}`)
    } else {
      orders.set(s.orderNo, k)
    }

    if (!isPlainObject(s.sourceData)) {
      errs.push(`表 ${k} 的 sourceData 必须是对象`)
    } else {
      for (const sec of SHEET_KEYS) {
        if (!(sec in s.sourceData)) {
          errs.push(`表 ${k} 的 sourceData 缺少 ${sec}`)
        } else if (typeof s.sourceData[sec] !== 'string') {
          errs.push(`表 ${k} 的 sourceData.${sec} 必须是字符串`)
        }
      }
      for (const sec of Object.keys(s.sourceData)) {
        if (!SECTIONS.includes(sec)) errs.push(`表 ${k} 的 sourceData 含未知字段 ${sec}`)
      }
      const ddl = s.sourceData.ddl
      if (typeof ddl === 'string') {
        const physicalColumn = /(?:\(|,|\n)\s*(?:"([^"]+)"|`([^`]+)`|\[([^\]]+)\]|([A-Za-z_][A-Za-z0-9_]*))\s+(?:TEXT|INTEGER|REAL|BLOB|NUMERIC|DECIMAL|BOOLEAN|DATE|DATETIME|VARCHAR|CHAR|DOUBLE|FLOAT)\b/gi
        for (const match of ddl.matchAll(physicalColumn)) {
          const column = match[1] ?? match[2] ?? match[3] ?? match[4]
          if (column !== 'row_id' && /id/i.test(column)) {
            errs.push(`表 ${k} 的 DDL 物理列名 "${column}" 含 ID/id`)
          }
        }
      }
    }

    if (!Array.isArray(s.content) || s.content.length === 0 || !Array.isArray(s.content[0])) {
      errs.push(`表 ${k} 的 content 必须包含表头数组`)
    } else {
      const header = s.content[0]
      if (header[0] !== 'row_id') errs.push(`表 ${k} 的表头第一列必须是 row_id`)
      if (header.length < 2) errs.push(`表 ${k} 至少需要一个业务列`)
      const columns = new Set()
      for (const [index, column] of header.slice(1).entries()) {
        if (typeof column !== 'string' || column.trim() === '') {
          errs.push(`表 ${k} 的第 ${index + 2} 个业务列名必须是非空字符串`)
          continue
        }
        if (columns.has(column)) errs.push(`表 ${k} 的业务列名重复: ${column}`)
        columns.add(column)
        if (/id/i.test(column)) errs.push(`表 ${k} 的业务列名 "${column}" 含 ID/id`)
      }
      const n = s.content[0].length
      s.content.forEach((row, i) => {
        if (!Array.isArray(row)) {
          errs.push(`表 ${k} 第 ${i + 1} 行必须是数组`)
        } else if (row.length !== n) {
          errs.push(`表 ${k} 第 ${i + 1} 行数据列数 ${row.length} 与表头 ${n} 不一致`)
        }
      })
    }

    validateDdlMappings(k, s, errs)

    if (s.hiddenPhysicalColumns !== undefined) {
      if (!Array.isArray(s.hiddenPhysicalColumns) || s.hiddenPhysicalColumns.some((v) => typeof v !== 'string')) {
        errs.push(`表 ${k} 的 hiddenPhysicalColumns 必须是字符串数组`)
      }
    }
    if (s.columnAliases !== undefined) {
      if (!isPlainObject(s.columnAliases) || Object.values(s.columnAliases).some(
        (aliases) => !Array.isArray(aliases) || aliases.some((v) => typeof v !== 'string'),
      )) {
        errs.push(`表 ${k} 的 columnAliases 必须是字符串数组对象`)
      }
    }

    // exportConfig：索引列必须取自表内列，mode 键必须是索引列的子集
    if (s.exportConfig !== undefined) {
      if (!isPlainObject(s.exportConfig)) {
        errs.push(`表 ${k} 的 exportConfig 必须是对象`)
      } else {
        for (const field of Object.keys(s.exportConfig)) {
          if (!EXPORT_FIELDS.has(field)) errs.push(`表 ${k} 的 exportConfig 含未知字段 ${field}`)
        }
        for (const field of EXPORT_BOOLEAN_FIELDS) {
          if (field in s.exportConfig && typeof s.exportConfig[field] !== 'boolean') {
            errs.push(`表 ${k} 的 exportConfig.${field} 必须是布尔值`)
          }
        }
        for (const field of EXPORT_STRING_FIELDS) {
          if (field in s.exportConfig && typeof s.exportConfig[field] !== 'string') {
            errs.push(`表 ${k} 的 exportConfig.${field} 必须是字符串`)
          }
        }
        const idxCols = s.exportConfig.extraIndexColumns
        if (idxCols !== undefined && (!Array.isArray(idxCols) || idxCols.some((c) => typeof c !== 'string'))) {
          errs.push(`表 ${k} 的 extraIndexColumns 必须是字符串数组`)
        } else if (Array.isArray(idxCols)) {
          const cols = (s.content?.[0] ?? []).filter((c) => c !== 'row_id')
          for (const c of idxCols) {
            if (!cols.includes(c)) errs.push(`表 ${k} 的 extraIndexColumns 含非表内列 "${c}"`)
          }
        }
        const modes = s.exportConfig.extraIndexColumnModes
        if (modes !== undefined && (
          !isPlainObject(modes) || Object.values(modes).some((mode) => typeof mode !== 'string')
        )) {
          errs.push(`表 ${k} 的 extraIndexColumnModes 必须是字符串值对象`)
        } else if (isPlainObject(modes)) {
          const indexedColumns = Array.isArray(idxCols) ? idxCols : []
          for (const c of Object.keys(modes)) {
            if (!indexedColumns.includes(c)) {
              errs.push(`表 ${k} 的 extraIndexColumnModes 键 "${c}" 不在 extraIndexColumns 内`)
            }
          }
        }
        for (const field of EXPORT_PLACEMENT_FIELDS) {
          if (!(field in s.exportConfig)) continue
          const placement = s.exportConfig[field]
          if (!isPlainObject(placement)) {
            errs.push(`表 ${k} 的 exportConfig.${field} 必须是对象`)
            continue
          }
          for (const key of Object.keys(placement)) {
            if (!['position', 'depth', 'order'].includes(key)) {
              errs.push(`表 ${k} 的 exportConfig.${field} 含未知字段 ${key}`)
            }
          }
          if ('position' in placement && typeof placement.position !== 'string') {
            errs.push(`表 ${k} 的 exportConfig.${field}.position 必须是字符串`)
          }
          for (const key of ['depth', 'order']) {
            if (key in placement && !Number.isFinite(placement[key])) {
              errs.push(`表 ${k} 的 exportConfig.${field}.${key} 必须是有限数字`)
            }
          }
        }
      }
    }
    if (s.updateConfig !== undefined) {
      if (!isPlainObject(s.updateConfig)) {
        errs.push(`表 ${k} 的 updateConfig 必须是对象`)
      } else {
        for (const field of Object.keys(s.updateConfig)) {
          if (!UPDATE_CONFIG_FIELDS.includes(field)) errs.push(`表 ${k} 的 updateConfig 含未知字段 ${field}`)
        }
        for (const field of UPDATE_CONFIG_FIELDS) {
          if (field in s.updateConfig && !Number.isFinite(s.updateConfig[field])) {
            errs.push(`表 ${k} 的 updateConfig.${field} 必须是有限数字`)
          }
        }
      }
    }
  }
  return errs
}
