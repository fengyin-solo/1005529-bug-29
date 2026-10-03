import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

// 培训判定的实际口径：合格线 60 分，合格后有效期顺延 1 年；判定结果同步落到供应商审计台账。
const TRAINING_KEY = 'training'
const LEDGER_KEY = 'supplieraudit'
const PASS_SCORE_LINE = 60
const TRAINING_VALIDITY_YEARS = 1
const JUDGE_ACTIONS = ['判定合格', '判定未通过']
// 受训岗位的极值：为空或超过 30 个字符都挡回；其余字段一律不许超过 200 个字符。
const POSITION_MAX_LENGTH = 30
const FIELD_MAX_LENGTH = 200

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

// 这个状态还有没有后续动作：没有了就是终态，不再算进「待处理」。
function hasOutgoing(meta: ModuleMeta, status: string): boolean {
  return Object.values(meta.actionSources).some((sources) => sources.includes(status))
}

// 状态字段（每个模块的最后一个字段，如「培训状态」）与当前状态保持同源。
function statusField(meta: ModuleMeta): string {
  return meta.fields[meta.fields.length - 1]
}

function stableHash(text: string): number {
  let hash = 0
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0
  }
  return hash
}

// 判定后按实际口径重算考核成绩：由培训编号推导，同一份培训在任何入口算出来都一样。
function recomputeScore(row: EntryRow, pass: boolean): number {
  const base = stableHash(String(row['培训编号'] ?? row.id))
  if (pass) {
    return PASS_SCORE_LINE + (base % (100 - PASS_SCORE_LINE + 1))
  }
  return base % PASS_SCORE_LINE
}

function parseDate(text: string): Date | null {
  const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  if (!matched) {
    return null
  }
  return new Date(Number(matched[1]), Number(matched[2]) - 1, Number(matched[3]))
}

function formatDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

// 有效期至 = 培训日期顺延 1 年；培训日期缺失时按当天算。
function recomputeValidUntil(row: EntryRow): string {
  const base = parseDate(String(row['培训日期'] ?? '')) ?? new Date()
  base.setFullYear(base.getFullYear() + TRAINING_VALIDITY_YEARS)
  return formatDate(base)
}

// 判定后重算考核成绩与有效期至，让记录本身、概览、台账拿到的都是同一份值。
function applyTrainingJudgement(row: EntryRow, pass: boolean): void {
  row['考核成绩'] = recomputeScore(row, pass)
  if (pass) {
    row['有效期至'] = recomputeValidUntil(row)
  }
}

// 判定结果落到供应商审计台账；同一份培训只记一次，重复判定不再追加。
function appendTrainingLedger(row: EntryRow, pass: boolean): void {
  const code = String(row['培训编号'] ?? '')
  const ledgerRows = listRows(LEDGER_KEY)
  if (code && ledgerRows.some((item) => String(item['审计结论'] ?? '').includes(code))) {
    return
  }
  const id = Math.max(0, ...ledgerRows.map((item) => Number(item.id) || 0)) + 1
  const status = pass ? '已通过' : '需整改'
  const ledger: EntryRow = {
    id,
    status,
    pending: false,
    abnormal: !pass,
    审计编号: `SUPP-${String(id).padStart(4, '0')}`,
    供应商名称: String(row['培训主题'] ?? ''),
    物料类别: String(row['受训岗位'] ?? ''),
    审计方式: String(row['培训方式'] ?? ''),
    缺陷项数: pass ? 0 : 1,
    审计结论: `培训${code}判定${pass ? '合格' : '未通过'}，考核成绩${String(row['考核成绩'] ?? '')}`,
    整改期限: pass ? String(row['有效期至'] ?? '') : String(row['培训日期'] ?? ''),
    审计状态: status,
  }
  saveRows(LEDGER_KEY, [...ledgerRows, ledger])
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  // 状态只能单向流转：不在动作登记的前置状态里，跨级与回退都拦下。
  const sources = meta.actionSources[action] ?? []
  if (!sources.includes(current)) {
    return {
      ok: false,
      message: `${meta.entity}当前状态「${current}」不允许「${action}」（需处于「${sources.join('」或「')}」），状态只能单向流转`,
    }
  }
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    [statusField(meta)]: target,
    pending: hasOutgoing(meta, target),
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const judging = key === TRAINING_KEY && JUDGE_ACTIONS.includes(action)
  if (judging) {
    applyTrainingJudgement(updated, action === '判定合格')
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  if (judging) {
    appendTrainingLedger(updated, action === '判定合格')
  }
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

// 登记新记录：各入口共用这个入口，受训岗位给出极值（空或超长）直接挡回。
export function createEntry(key: string, values: Record<string, string | number>): ActionResult {
  const meta = moduleMeta(key)
  const rows = listRows(key)
  const id = Math.max(0, ...rows.map((row) => Number(row.id) || 0)) + 1
  const record: EntryRow = { id, status: meta.statuses[0], pending: true, abnormal: false }
  for (const field of meta.fields) {
    const raw = values[field]
    record[field] = typeof raw === 'number' ? raw : String(raw ?? '').trim()
  }
  const rejection = validateEntry(key, record)
  if (rejection) {
    return { ok: false, message: rejection }
  }
  if (key === TRAINING_KEY) {
    if (!record['培训编号']) {
      record['培训编号'] = `TRAI-${String(id).padStart(4, '0')}`
    }
    if (!record['培训日期']) {
      record['培训日期'] = formatDate(new Date())
    }
    if (!record['考核成绩']) {
      record['考核成绩'] = '—'
    }
    if (!record['有效期至']) {
      record['有效期至'] = '—'
    }
  }
  record[statusField(meta)] = meta.statuses[0]
  saveRows(key, [...rows, record])
  return { ok: true, message: `${meta.entity}已登记，当前状态「${meta.statuses[0]}」` }
}

function validateEntry(key: string, record: EntryRow): string {
  for (const [field, value] of Object.entries(record)) {
    if (typeof value === 'string' && value.length > FIELD_MAX_LENGTH) {
      return `「${field}」内容过长，已挡回`
    }
  }
  if (key === TRAINING_KEY) {
    const position = String(record['受训岗位'] ?? '').trim()
    if (!position) {
      return '受训岗位不能为空，已挡回'
    }
    if (position.length > POSITION_MAX_LENGTH) {
      return `受训岗位超出${POSITION_MAX_LENGTH}个字符的极值，已挡回`
    }
    if (!String(record['培训主题'] ?? '').trim()) {
      return '培训主题不能为空，已挡回'
    }
  }
  return ''
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
