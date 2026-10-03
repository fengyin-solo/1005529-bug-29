import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'pharma-cleanroom:entries'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    return { ...fallback, ...parsed }
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

// 供应商审计里的「培训判定台账」：作为附属数据和业务记录存在同一份持久化里，
// 培训判定落台账与培训状态落库在同一个写入动作内完成，刷新、退出再进都不会丢。
const TRAINING_LEDGER_KEY = '__trainingLedger'

export function listTrainingLedger<T>(): T[] {
  const store = allRows() as Record<string, unknown>
  return Array.isArray(store[TRAINING_LEDGER_KEY]) ? (store[TRAINING_LEDGER_KEY] as T[]) : []
}

export function saveTrainingLedger<T>(entries: T[]): void {
  saveRows(TRAINING_LEDGER_KEY, entries as unknown as EntryRow[])
}

export function storageKey(): string {
  return STORAGE_KEY
}
