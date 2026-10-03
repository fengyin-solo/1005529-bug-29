import { listRows, listTrainingLedger, saveRows, saveTrainingLedger } from '@/data/local-store'
import type { ActionResult, EntryRow } from '@/data/types'
import { TRAINING_METHODS, isValidTrainingPosition } from './positions'

// 培训模块的字段口径集中在这里：页面概览、抽屉、台账都走同一份，避免两处取值不一致。
export const TRAINING_KEY = 'training'
export const FIELD_SCORE = '考核成绩'
export const FIELD_POSITION = '受训岗位'
export const FIELD_METHOD = '培训方式'
export const FIELD_DATE = '培训日期'
export const FIELD_VALID_UNTIL = '有效期至'
export const FIELD_STATUS = '培训状态'

export const STATUS_PENDING = '待培训'
export const STATUS_TRAINING = '培训中'
export const STATUS_PASSED = '已合格'
export const STATUS_FAILED = '未通过'

export const ACTION_SUBMIT = '提交培训'
export const ACTION_PASS = '判定合格'
export const ACTION_FAIL = '判定未通过'

// 合格分数线与成绩区间：判定时按实际口径重算，越界（极值）直接挡回。
export const PASS_SCORE = 60
export const SCORE_MIN = 0
export const SCORE_MAX = 100
// 合格后培训资质有效期：自培训日期起一年。
export const VALID_MONTHS = 12

export type TrainingLedgerEntry = {
  trainingId: number
  培训编号: string
  培训主题: string
  受训岗位: string
  考核成绩: number | string
  判定结果: string
  判定日期: string
  来源: string
}

export type TrainingActionInput = {
  score?: string | number
  judgedAt?: string
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

// 成绩只接受 0-100 的整数，空值、非数字、越界极值一律挡回。
export function normalizeScore(raw: string | number | undefined): { score: number } | { message: string } {
  const text = String(raw ?? '').trim()
  if (text === '') {
    return { message: '请填写考核成绩后再判定' }
  }
  if (!/^\d+$/.test(text)) {
    return { message: '考核成绩须为 0-100 的整数' }
  }
  const score = Number(text)
  if (score < SCORE_MIN || score > SCORE_MAX) {
    return { message: `考核成绩超出允许范围（${SCORE_MIN}-${SCORE_MAX}），已挡回` }
  }
  return { score }
}

// 有效期至 = 培训日期 + 12 个月；培训日期缺失时回退到判定当天。
export function computeValidUntil(trainingDate: unknown, judgedAt: string): string {
  const base = String(trainingDate ?? '').trim()
  const start = /^\d{4}-\d{2}-\d{2}$/.test(base) ? new Date(`${base}T00:00:00`) : new Date(`${judgedAt}T00:00:00`)
  const next = new Date(start)
  next.setMonth(next.getMonth() + VALID_MONTHS)
  return next.toISOString().slice(0, 10)
}

// 判定结论必须和成绩口径一致：≥60 才能判合格，<60 只能判未通过。
function assertScoreMatches(score: number, pass: boolean): string | null {
  if (pass && score < PASS_SCORE) {
    return `考核成绩 ${score} 分低于合格线 ${PASS_SCORE} 分，不能判定合格`
  }
  if (!pass && score >= PASS_SCORE) {
    return `考核成绩 ${score} 分已达到合格线 ${PASS_SCORE} 分，不能判定未通过`
  }
  return null
}

export function allowedActionsFor(status: string): string[] {
  switch (status) {
    case STATUS_PENDING:
      return [ACTION_SUBMIT]
    case STATUS_TRAINING:
      return [ACTION_PASS, ACTION_FAIL]
    default:
      return []
  }
}

function toLedgerEntry(row: EntryRow, score: number, result: string, judgedAt: string): TrainingLedgerEntry {
  return {
    trainingId: Number(row.id),
    培训编号: String(row['培训编号'] ?? ''),
    培训主题: String(row['培训主题'] ?? ''),
    受训岗位: String(row[FIELD_POSITION] ?? ''),
    考核成绩: score,
    判定结果: result,
    判定日期: judgedAt,
    来源: '人员培训判定',
  }
}

// 同一份培训重复判定只算一次：台账按培训记录编号去重，终态拦截在外层状态机已先挡住。
function appendLedger(entry: TrainingLedgerEntry): TrainingLedgerEntry[] {
  const ledger = listTrainingLedger<TrainingLedgerEntry>()
  if (ledger.some((item) => item.trainingId === entry.trainingId)) {
    return ledger
  }
  const next = [...ledger, entry]
  saveTrainingLedger(next)
  return next
}

// 培训动作专用入口：状态机单向校验 + 成绩/岗位口径校验 + 字段同源重算 + 台账落库。
// 培训状态、考核成绩、有效期至在同一个保存动作内写入，持久化那份与页面状态始终一致。
export function applyTrainingAction(
  id: number,
  action: string,
  input: TrainingActionInput = {},
): ActionResult {
  const rows = listRows(TRAINING_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的培训记录` }
  }
  const row = rows[index]
  const current = String(row.status)

  if (!allowedActionsFor(current).includes(action)) {
    if (current === STATUS_PASSED || current === STATUS_FAILED) {
      return { ok: false, message: `培训记录已是终态「${current}」，判定只能一次，不能重复操作` }
    }
    return { ok: false, message: `当前状态「${current}」不能执行「${action}」，请按 待培训 → 培训中 → 判定 单向流转` }
  }

  // 提交培训只做状态推进，不触碰成绩与有效期。
  if (action === ACTION_SUBMIT) {
    const updated: EntryRow = { ...row, status: STATUS_TRAINING, pending: true, abnormal: false }
    const next = [...rows]
    next[index] = updated
    saveRows(TRAINING_KEY, next)
    return { ok: true, message: '培训记录已提交，当前状态「培训中」' }
  }

  const pass = action === ACTION_PASS
  const judgedAt = input.judgedAt && /^\d{4}-\d{2}-\d{2}$/.test(input.judgedAt) ? input.judgedAt : today()
  const normalized = normalizeScore(input.score)
  if ('message' in normalized) {
    return { ok: false, message: normalized.message }
  }
  const mismatch = assertScoreMatches(normalized.score, pass)
  if (mismatch) {
    return { ok: false, message: mismatch }
  }

  // 受训岗位必须取自共享目录，异常极值/游离岗位不允许判定入库。
  const position = String(row[FIELD_POSITION] ?? '')
  if (!isValidTrainingPosition(position)) {
    return { ok: false, message: `受训岗位「${position}」不在共享岗位目录内，已挡回，请先在登记处修正` }
  }

  const target = pass ? STATUS_PASSED : STATUS_FAILED
  // 判定后成绩按实际口径重算并回写；合格同步刷新有效期至，未通过则清空有效期。
  const updated: EntryRow = {
    ...row,
    status: target,
    pending: false,
    abnormal: false,
    [FIELD_SCORE]: normalized.score,
    [FIELD_STATUS]: target,
    [FIELD_VALID_UNTIL]: pass ? computeValidUntil(row[FIELD_DATE], judgedAt) : '',
  }
  const nextRows = [...rows]
  nextRows[index] = updated
  saveRows(TRAINING_KEY, nextRows)

  // 结果落到供应商审计的台账；同一培训编号已在台账里则不重复计。
  appendLedger(toLedgerEntry(updated, normalized.score, target, judgedAt))

  return {
    ok: true,
    message: pass
      ? `已判定合格，考核成绩 ${normalized.score} 分，有效期至 ${String(updated[FIELD_VALID_UNTIL])}`
      : `已判定未通过，考核成绩 ${normalized.score} 分`,
  }
}

export function createTrainingEntry(input: {
  topic: string
  position: string
  method: string
  trainingDate: string
}): ActionResult & { id?: number } {
  const topic = input.topic.trim()
  if (!topic) {
    return { ok: false, message: '请填写培训主题' }
  }
  if (!isValidTrainingPosition(input.position)) {
    return { ok: false, message: '受训岗位必须从共享岗位目录中选择' }
  }
  if (!TRAINING_METHODS.includes(input.method)) {
    return { ok: false, message: '培训方式必须从共享选项中选择' }
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.trainingDate)) {
    return { ok: false, message: '请选择培训日期' }
  }

  const rows = listRows(TRAINING_KEY)
  const id = rows.reduce((max, row) => Math.max(max, Number(row.id)), 0) + 1
  const entry: EntryRow = {
    id,
    status: STATUS_PENDING,
    pending: true,
    abnormal: false,
    培训编号: `TRAI-${String(id).padStart(4, '0')}`,
    培训主题: topic,
    [FIELD_POSITION]: input.position,
    [FIELD_METHOD]: input.method,
    // 未判定前不预置成绩，统计只认状态，概览与抽屉天然同源。
    [FIELD_SCORE]: '',
    [FIELD_DATE]: input.trainingDate,
    [FIELD_VALID_UNTIL]: '',
    [FIELD_STATUS]: STATUS_PENDING,
  }
  saveRows(TRAINING_KEY, [...rows, entry])
  return { ok: true, message: `培训记录 ${String(entry['培训编号'])} 已登记`, id }
}

export function listTrainingLedgerEntries(): TrainingLedgerEntry[] {
  return listTrainingLedger<TrainingLedgerEntry>()
}
